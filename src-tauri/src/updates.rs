use semver::Version;

const SOURCES: [&str; 3] = [
    "http://192.168.2.76:17845/proxyking/latest.json",
    "http://192.168.2.59:17845/proxyking/latest.json",
    "https://github.com/flazedude/proxyking/releases/latest/download/latest.json",
];

struct Identity<'a> {
    version: &'a str,
    signature: &'a str,
}

fn newest_matching(candidates: &[Identity<'_>]) -> Result<Vec<usize>, String> {
    let versions: Vec<Version> = candidates
        .iter()
        .map(|candidate| {
            Version::parse(candidate.version)
                .map_err(|_| "An update source returned an invalid version.".to_owned())
        })
        .collect::<Result<_, _>>()?;
    let Some(newest) = versions.iter().max() else {
        return Ok(vec![]);
    };
    let indexes: Vec<usize> = versions
        .iter()
        .enumerate()
        .filter_map(|(index, version)| (version == newest).then_some(index))
        .collect();
    let signature = candidates[indexes[0]].signature;
    if signature.is_empty()
        || indexes
            .iter()
            .any(|&index| candidates[index].signature != signature)
    {
        return Err("Update sources disagree about this version's signed package. Installation was stopped.".into());
    }
    Ok(indexes)
}

fn valid_download(source: usize, version: &str, url: &str) -> bool {
    let Ok(parsed) = Version::parse(version) else {
        return false;
    };
    if !parsed.pre.is_empty() || !parsed.build.is_empty() || parsed.to_string() != version {
        return false;
    }
    let filename = format!("ProxyKing_{version}_x64-setup.exe");
    let expected = match source {
        0 | 1 => format!(
            "{}{filename}",
            SOURCES[source].trim_end_matches("latest.json")
        ),
        2 => format!(
            "https://github.com/flazedude/proxyking/releases/download/v{version}/{filename}"
        ),
        _ => return false,
    };
    url == expected
}

#[cfg(not(test))]
pub mod native {
    use super::*;
    use crate::runtime::Service;
    use serde::Serialize;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };
    use std::time::Duration;
    use tauri::{ipc::Channel, Manager, Resource, ResourceId, State, Webview};
    use tauri_plugin_updater::{Update, UpdaterExt};

    fn transport_failure(error: &tauri_plugin_updater::Error) -> bool {
        matches!(
            error,
            tauri_plugin_updater::Error::Reqwest(_)
                | tauri_plugin_updater::Error::Network(_)
                | tauri_plugin_updater::Error::ReleaseNotFound
        )
    }

    struct Pending {
        candidates: Vec<Update>,
        downloaded: Mutex<Option<(Update, Vec<u8>)>>,
        downloading: AtomicBool,
    }
    impl Resource for Pending {}

    struct DownloadGuard<'a>(&'a AtomicBool);
    impl Drop for DownloadGuard<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Metadata {
        rid: ResourceId,
        version: String,
    }

    #[derive(Clone, Serialize)]
    #[serde(tag = "event", content = "data")]
    pub enum DownloadEvent {
        #[serde(rename_all = "camelCase")]
        Started {
            content_length: Option<u64>,
        },
        #[serde(rename_all = "camelCase")]
        Progress {
            chunk_length: usize,
        },
        Finished,
    }

    async fn check_one(
        webview: &Webview,
        source: usize,
    ) -> tauri_plugin_updater::Result<Option<Update>> {
        let mut builder = webview
            .updater_builder()
            .endpoints(vec![SOURCES[source].parse()?])?
            .timeout(Duration::from_secs(if source < 2 { 3 } else { 20 }));
        if source < 2 {
            builder = builder
                .no_proxy()
                .configure_client(|client| client.redirect(reqwest::redirect::Policy::none()));
        }
        builder.build()?.check().await
    }

    #[tauri::command]
    pub async fn check_updates(webview: Webview) -> Result<Option<Metadata>, String> {
        // Check every source. A valid but stale LAN manifest must not mask GitHub.
        let checks = futures_util::future::join_all(
            (0..SOURCES.len()).map(|source| check_one(&webview, source)),
        )
        .await;
        let mut reachable = false;
        let mut candidates = Vec::new();
        for (source, check) in checks.into_iter().enumerate() {
            match check {
                Ok(update) => {
                    reachable = true;
                    if let Some(mut update) = update {
                        if !valid_download(source, &update.version, update.download_url.as_str()) {
                            return Err("An update source returned an unexpected package address or version.".into());
                        }
                        update.timeout =
                            Some(Duration::from_secs(if source < 2 { 30 } else { 180 }));
                        candidates.push(update);
                    }
                }
                Err(error) if transport_failure(&error) => {}
                Err(_) => return Err(
                    "An update source returned invalid release metadata. Installation was stopped."
                        .into(),
                ),
            }
        }
        if !reachable {
            return Err(
                "Could not reach either LAN host or GitHub. Check your connection and retry."
                    .into(),
            );
        }
        let identities: Vec<_> = candidates
            .iter()
            .map(|update| Identity {
                version: &update.version,
                signature: &update.signature,
            })
            .collect();
        let indexes = newest_matching(&identities)?;
        let Some(&first) = indexes.first() else {
            return Ok(None);
        };
        let version = candidates[first].version.clone();
        let candidates = indexes
            .into_iter()
            .map(|index| candidates[index].clone())
            .collect();
        let rid = webview.resources_table().add(Pending {
            candidates,
            downloaded: Mutex::new(None),
            downloading: AtomicBool::new(false),
        });
        Ok(Some(Metadata { rid, version }))
    }

    #[tauri::command]
    pub async fn download_update(
        webview: Webview,
        rid: ResourceId,
        on_event: Channel<DownloadEvent>,
    ) -> Result<(), String> {
        let pending = webview
            .resources_table()
            .get::<Pending>(rid)
            .map_err(|_| "Check for updates again.")?;
        if pending.downloading.swap(true, Ordering::SeqCst) {
            return Err("An update download is already running.".into());
        }
        let _guard = DownloadGuard(&pending.downloading);
        *pending
            .downloaded
            .lock()
            .map_err(|_| "Update state is unavailable.")? = None;
        for candidate in &pending.candidates {
            let mut first = true;
            let result = candidate
                .download(
                    |chunk_length, content_length| {
                        if first {
                            let _ = on_event.send(DownloadEvent::Started { content_length });
                            first = false;
                        }
                        let _ = on_event.send(DownloadEvent::Progress { chunk_length });
                    },
                    || {},
                )
                .await;
            match result {
                Ok(bytes) => {
                    *pending.downloaded.lock().map_err(|_| "Update state is unavailable.")? = Some((candidate.clone(), bytes));
                    let _ = on_event.send(DownloadEvent::Finished);
                    return Ok(());
                }
                Err(error) if transport_failure(&error) => continue,
                Err(_) => return Err("Update signature or signed version verification failed. Installation was stopped.".into()),
            }
        }
        Err("The selected update could not be downloaded from its matching LAN or GitHub sources. Check again to retry.".into())
    }

    #[tauri::command]
    pub async fn install_update(
        webview: Webview,
        rid: ResourceId,
        service: State<'_, Arc<Service>>,
    ) -> Result<(), String> {
        let pending = webview
            .resources_table()
            .get::<Pending>(rid)
            .map_err(|_| "Check for updates again.")?;
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || {
            let downloaded = pending
                .downloaded
                .lock()
                .map_err(|_| "Update state is unavailable.")?;
            let (update, bytes) = downloaded
                .as_ref()
                .ok_or("Download and verify the update before installing.")?;
            update
                .verify(bytes)
                .map_err(|_| "Update verification failed before installation.")?;
            service.disconnect()?;
            update
                .install(bytes)
                .map_err(|_| "Could not start the update installer.".to_owned())
        })
        .await
        .map_err(|_| "The update installation task failed.")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn newer_github_beats_stale_lan_and_matching_sources_keep_preference() {
        let sources = [
            Identity {
                version: "0.3.2",
                signature: "old",
            },
            Identity {
                version: "0.3.3",
                signature: "same",
            },
            Identity {
                version: "0.3.3",
                signature: "same",
            },
        ];
        assert_eq!(newest_matching(&sources).unwrap(), vec![1, 2]);
        assert_eq!(newest_matching(&[]).unwrap(), Vec::<usize>::new());
        assert!(newest_matching(&[
            Identity {
                version: "0.3.3",
                signature: "a"
            },
            Identity {
                version: "0.3.3",
                signature: "b"
            }
        ])
        .is_err());
    }
    #[test]
    fn download_addresses_are_pinned_to_the_announcing_official_host_and_version() {
        assert!(valid_download(
            0,
            "0.3.2",
            "http://192.168.2.76:17845/proxyking/ProxyKing_0.3.2_x64-setup.exe"
        ));
        assert!(!valid_download(
            0,
            "0.3.2",
            "http://192.168.2.59:17845/proxyking/ProxyKing_0.3.2_x64-setup.exe"
        ));
        assert!(!valid_download(
            0,
            "0.3.2",
            "http://192.168.2.76:17845/secret.exe"
        ));
        assert!(valid_download(2, "0.3.2", "https://github.com/flazedude/proxyking/releases/download/v0.3.2/ProxyKing_0.3.2_x64-setup.exe"));
        assert!(!valid_download(
            2,
            "0.3.2",
            "https://evil.example/ProxyKing_0.3.2_x64-setup.exe"
        ));
        assert!(!valid_download(2, "0.3.2", "https://github.com/flazedude/proxyking/releases/download/v0.3.1/ProxyKing_0.3.1_x64-setup.exe"));
    }
}
