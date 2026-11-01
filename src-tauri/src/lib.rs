mod config;
mod descendants;
mod game_icons;
mod games;
mod models;
mod platform;
mod proxy;
#[cfg(all(test, windows))]
mod routing_tests;
mod runtime;
mod storage;
mod subscriptions;
mod updates;
mod usage;

// Keep native core unit tests independent of the GUI runtime and its Windows
// Common Controls activation manifest, which Tauri embeds only in app binaries.
#[cfg(not(test))]
mod application {
    use super::{config, games, models, platform, runtime, subscriptions, updates};
    use models::{AppSettings, LogEntry, Profile, RunningProcess, RuntimeStatus, SavedState};
    use runtime::Service;
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    use tauri::{Manager, State};

    #[tauri::command]
    async fn load_state(service: State<'_, Arc<Service>>) -> Result<SavedState, String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.load())
            .await
            .map_err(|_| "The profile loading task failed.")?
    }

    #[tauri::command]
    async fn save_state(data: SavedState, service: State<'_, Arc<Service>>) -> Result<(), String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.save(&data))
            .await
            .map_err(|_| "The profile saving task failed.")?
    }

    #[tauri::command]
    async fn get_status(service: State<'_, Arc<Service>>) -> Result<RuntimeStatus, String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.status())
            .await
            .map_err(|_| "The connection status task failed.")?
    }

    #[tauri::command]
    async fn connect(
        profile: Profile,
        settings: AppSettings,
        service: State<'_, Arc<Service>>,
    ) -> Result<RuntimeStatus, String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.connect(profile, settings))
            .await
            .map_err(|_| "The connection task failed.")?
    }

    #[tauri::command]
    async fn disconnect(service: State<'_, Arc<Service>>) -> Result<RuntimeStatus, String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.disconnect())
            .await
            .map_err(|_| "The disconnect task failed.")?
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LatencyResult {
        latency_ms: u64,
    }

    #[tauri::command]
    async fn test_profile(profile: Profile) -> Result<LatencyResult, String> {
        config::validate_profile(&profile)?;
        let start = Instant::now();
        let stream = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::net::TcpStream::connect((profile.server.as_str(), profile.port)),
        )
        .await
        .map_err(|_| "TCP reachability check timed out after 5 seconds.")?
        .map_err(|_| {
            "The server's TCP port could not be reached. Check the address and network."
        })?;
        drop(stream);
        Ok(LatencyResult {
            latency_ms: start.elapsed().as_millis().max(1) as u64,
        })
    }

    #[tauri::command]
    async fn get_logs(service: State<'_, Arc<Service>>) -> Result<Vec<LogEntry>, String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.logs())
            .await
            .map_err(|_| "The log loading task failed.")?
    }

    #[tauri::command]
    async fn clear_logs(service: State<'_, Arc<Service>>) -> Result<(), String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.clear_logs())
            .await
            .map_err(|_| "The log clearing task failed.")?
    }

    #[tauri::command]
    async fn routing_conflict() -> Result<bool, String> {
        tauri::async_runtime::spawn_blocking(platform::routing_conflict)
            .await
            .map_err(|_| "Could not check other proxy applications.")?
    }

    #[tauri::command]
    async fn scan_games() -> Result<Vec<games::InstalledGame>, String> {
        tauri::async_runtime::spawn_blocking(games::scan)
            .await
            .map_err(|_| "The game discovery task failed.")?
    }

    #[tauri::command]
    async fn fetch_yaml_subscription(url: String) -> Result<String, String> {
        tauri::async_runtime::spawn_blocking(move || subscriptions::fetch_yaml(&url))
            .await
            .map_err(|_| "The YAML download task failed.")?
    }

    #[tauri::command]
    async fn list_processes(
        service: State<'_, Arc<Service>>,
    ) -> Result<Vec<RunningProcess>, String> {
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || service.list_processes())
            .await
            .map_err(|_| "The running application query failed.")?
    }

    #[tauri::command]
    async fn restart_elevated(
        app: tauri::AppHandle,
        service: State<'_, Arc<Service>>,
    ) -> Result<(), String> {
        if platform::is_elevated() {
            return Ok(());
        }
        let service = Arc::clone(&service);
        tauri::async_runtime::spawn_blocking(move || {
            service.disconnect()?;
            platform::launch_elevated()?;
            // Give the IPC reply time to complete. The elevated process waits on
            // this process handle before initializing the single-instance plugin.
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(200));
                app.exit(0);
            });
            Ok(())
        })
        .await
        .map_err(|_| "The administrator restart task failed.")?
    }

    #[cfg_attr(mobile, tauri::mobile_entry_point)]
    pub fn run() {
        let mut builder = tauri::Builder::default();
        #[cfg(desktop)]
        {
            builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }));
        }
        let app = builder
            .setup(|app| {
                let data_dir = app.path().app_data_dir()?;
                let mut candidates = Vec::new();
                if let Ok(resources) = app.path().resource_dir() {
                    candidates.push(resources.join("resources").join("sing-box.exe"));
                }
                #[cfg(debug_assertions)]
                candidates.push(
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("resources")
                        .join("sing-box.exe"),
                );
                app.manage(Service::new(data_dir, candidates));
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                load_state,
                save_state,
                get_status,
                connect,
                disconnect,
                test_profile,
                get_logs,
                clear_logs,
                list_processes,
                scan_games,
                fetch_yaml_subscription,
                routing_conflict,
                restart_elevated,
                updates::native::check_updates,
                updates::native::download_update,
                updates::native::install_update
            ])
            .build(tauri::generate_context!())
            .expect("Could not start ProxyKing");
        app.run(|handle, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(service) = handle.try_state::<Arc<Service>>() {
                    service.shutdown();
                }
            }
        });
    }
}

#[cfg(not(test))]
pub use application::run;
pub use platform::prepare_relaunch;
