//! Read structured connection metadata; never retain raw engine output or API bodies.
use crate::models::{now_ms, LogEntry};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashSet, VecDeque},
    io::Read,
    net::{Ipv4Addr, TcpListener},
    time::Duration,
};

const MAX_BODY: u64 = 4 * 1024 * 1024;

#[derive(Clone)]
pub struct Controller {
    address: String,
    secret: String,
    client: reqwest::blocking::Client,
}

impl Controller {
    #[cfg(test)]
    pub fn unauthorized_for_test(&self) -> Result<(), reqwest::Error> {
        self.client
            .get(format!("http://{}/connections", self.address))
            .send()?
            .error_for_status()
            .map(|_| ())
    }
    pub fn configure(configuration: &mut Value) -> Result<Self, String> {
        let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not reserve the local usage monitor port.")?;
        let address = reservation
            .local_addr()
            .map_err(|_| "Could not read the usage monitor port.")?
            .to_string();
        let secret = random_secret()?;
        let client = monitor_client()?;
        configuration["experimental"]["clash_api"] = json!({
            "external_controller":address, "secret":secret,
            "access_control_allow_origin":["http://proxyking.invalid"],
            "access_control_allow_private_network":false
        });
        // Attribution is best effort in every routing mode, without changing route rules.
        configuration["route"]["find_process"] = json!(true);
        Ok(Self {
            address,
            secret,
            client,
        })
    }

    pub fn snapshot(&self) -> Result<Snapshot, ()> {
        let response = self
            .client
            .get(format!("http://{}/connections", self.address))
            .bearer_auth(&self.secret)
            .send()
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?;
        let mut body = Vec::new();
        response
            .take(MAX_BODY + 1)
            .read_to_end(&mut body)
            .map_err(|_| ())?;
        if body.len() as u64 > MAX_BODY {
            return Err(());
        }
        serde_json::from_slice(&body).map_err(|_| ())
    }
}

fn monitor_client() -> Result<reqwest::blocking::Client, String> {
    // The updater enables reqwest's rustls-no-provider feature. Initialize the same
    // ring provider before constructing a client, including before any update check.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_millis(750))
        .build()
        .map_err(|_| "Could not prepare the local usage monitor.".into())
}

#[cfg(windows)]
fn random_secret() -> Result<String, String> {
    use windows_sys::Win32::Security::Cryptography::{
        BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
    };
    let mut bytes = [0_u8; 32];
    if unsafe {
        BCryptGenRandom(
            std::ptr::null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    } < 0
    {
        return Err("Could not secure the local usage monitor.".into());
    }
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(not(windows))]
fn random_secret() -> Result<String, String> {
    Err("Usage monitoring is available on Windows only.".into())
}

#[derive(Deserialize)]
pub struct Snapshot {
    connections: Vec<Connection>,
}

#[derive(Deserialize)]
struct Connection {
    id: String,
    metadata: Metadata,
    chains: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    network: String,
    #[serde(rename = "destinationIP")]
    destination_ip: String,
    destination_port: String,
    host: String,
    process_path: String,
}

impl Connection {
    fn message(&self) -> Option<String> {
        let network = match self.metadata.network.as_str() {
            "tcp" => "TCP",
            "udp" => "UDP",
            "icmp" => "ICMP",
            _ => return None,
        };
        let route = if self.chains.iter().any(|tag| tag == "proxy") {
            "Proxy"
        } else if self.chains.iter().any(|tag| tag == "direct") {
            "Direct"
        } else {
            return None;
        };
        let host = if self.metadata.host.is_empty() {
            &self.metadata.destination_ip
        } else {
            &self.metadata.host
        };
        // Accept an address/domain only. URLs, userinfo, queries and arbitrary text are rejected.
        if host.is_empty()
            || host.len() > 253
            || !host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-_:".contains(&b))
        {
            return None;
        }
        if host.contains(':') && host.parse::<std::net::Ipv6Addr>().is_err() {
            return None;
        }
        let port = self.metadata.destination_port.parse::<u16>().ok()?;
        let host = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.clone()
        };
        let basename = self
            .metadata
            .process_path
            .rsplit(['\\', '/'])
            .next()
            .unwrap_or_default();
        // The engine can append an account name; expose only a validated executable basename.
        let app = basename
            .as_bytes()
            .windows(4)
            .position(|part| part.eq_ignore_ascii_case(b".exe"))
            .map(|end| &basename[..end + 4])
            .filter(|name| {
                name.len() <= 256
                    && name
                        .chars()
                        .all(|c| c.is_alphanumeric() || " ._-()".contains(c))
            })
            .unwrap_or("Unknown app");
        Some(format!(
            "{app} → {host}:{port} · {network} · {route} (observed)"
        ))
    }
}

#[derive(Default)]
pub struct Usage {
    pub enabled: bool,
    controller: Option<Controller>,
    generation: u64,
    seen: HashSet<String>,
    pub logs: VecDeque<LogEntry>,
    failed: bool,
}

impl Usage {
    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled != enabled {
            self.enabled = enabled;
            self.generation += 1;
            self.seen.clear();
            self.failed = false;
        }
    }

    pub fn attach(&mut self, controller: Option<Controller>) {
        self.controller = controller;
        self.generation += 1;
        self.seen.clear();
        self.failed = false;
    }

    pub fn clear(&mut self) {
        self.logs.clear();
        // Reject requests already in flight; keep observed active IDs to avoid duplicates.
        self.generation += 1;
    }

    pub fn request(&self) -> Option<(u64, Controller)> {
        self.enabled
            .then(|| {
                self.controller
                    .clone()
                    .map(|controller| (self.generation, controller))
            })
            .flatten()
    }

    pub fn accept(&mut self, generation: u64, result: Result<Snapshot, ()>) {
        if !self.enabled || generation != self.generation || self.controller.is_none() {
            return;
        }
        match result {
            Ok(snapshot) => {
                self.failed = false;
                let mut active = HashSet::new();
                for connection in snapshot.connections.into_iter().take(10000) {
                    if connection.id.len() > 128 || !active.insert(connection.id.clone()) {
                        continue;
                    }
                    if !self.seen.contains(&connection.id) {
                        if let Some(message) = connection.message() {
                            self.push("usage", message);
                        }
                    }
                }
                self.seen = active;
            }
            Err(()) if !self.failed => {
                self.failed = true;
                self.push("warn", "Usage logging is temporarily unavailable. Connection history may have gaps; monitoring will retry.".into());
            }
            Err(()) => {}
        }
    }

    fn push(&mut self, level: &str, message: String) {
        self.logs.push_back(LogEntry {
            timestamp: now_ms(),
            level: level.into(),
            message,
        });
        while self.logs.len() > 300 {
            self.logs.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection(id: &str, route: &str) -> Connection {
        serde_json::from_value(json!({
            "id":id, "metadata":{
                "network":"tcp", "destinationIP":"203.0.113.1", "destinationPort":"443",
                "host":"example.com", "processPath":"C:\\Users\\private-account\\Chrome\\chrome.exe (private-account)"
            }, "chains":[route], "upload":42, "password":"must-not-be-retained", "rule":"private rule"
        })).unwrap()
    }

    fn active() -> Usage {
        let mut usage = Usage::default();
        usage.set_enabled(true);
        usage.attach(Some(Controller {
            address: "127.0.0.1:1".into(),
            secret: "test-only".into(),
            client: monitor_client().unwrap(),
        }));
        usage
    }

    #[test]
    fn exposes_only_app_basename_destination_network_and_route() {
        assert_eq!(
            connection("one", "proxy").message().unwrap(),
            "chrome.exe → example.com:443 · TCP · Proxy (observed)"
        );
        let mut direct = connection("two", "direct");
        direct.metadata.host.clear();
        direct.metadata.destination_ip = "2001:db8::1".into();
        direct.metadata.network = "udp".into();
        direct.metadata.process_path.clear();
        assert_eq!(
            direct.message().unwrap(),
            "Unknown app → [2001:db8::1]:443 · UDP · Direct (observed)"
        );
        direct.metadata.process_path = "C:\\Apps\\İ雪.EXE (account)".into();
        assert!(direct.message().unwrap().starts_with("İ雪.EXE →"));
        for unsafe_host in [
            "https://user:password@example.com/private?token=secret",
            "user@example.com",
            "example.com\nsecret",
            "example.com:password",
            "example.com/path",
        ] {
            direct.metadata.host = unsafe_host.into();
            assert!(direct.message().is_none());
        }
    }

    #[test]
    fn off_clear_and_disconnect_reject_pending_samples_and_keep_history_bounded() {
        let mut usage = active();
        let generation = usage.request().unwrap().0;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![connection("one", "proxy")],
            }),
        );
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![connection("one", "proxy")],
            }),
        );
        assert_eq!(
            usage.logs.len(),
            1,
            "an active connection is logged only once"
        );
        usage.set_enabled(false);
        assert!(usage.request().is_none());
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![connection("two", "proxy")],
            }),
        );
        assert_eq!(usage.logs.len(), 1, "off retains history but adds nothing");
        usage.set_enabled(true);
        let generation = usage.request().unwrap().0;
        usage.clear();
        usage.accept(generation, Err(()));
        assert!(usage.logs.is_empty());
        let generation = usage.request().unwrap().0;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![connection("one", "proxy")],
            }),
        );
        usage.clear();
        let generation = usage.request().unwrap().0;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![connection("one", "proxy")],
            }),
        );
        assert!(
            usage.logs.is_empty(),
            "clear does not re-add already observed active IDs"
        );
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: (0..400)
                    .map(|id| connection(&id.to_string(), "direct"))
                    .collect(),
            }),
        );
        assert_eq!(usage.logs.len(), 300);
        usage.attach(None);
        assert!(usage.request().is_none());
        usage.accept(generation, Err(()));
        assert_eq!(usage.logs.len(), 300);
    }

    #[test]
    fn unavailable_monitor_warns_once_until_recovery() {
        let mut usage = active();
        let generation = usage.request().unwrap().0;
        usage.accept(generation, Err(()));
        usage.accept(generation, Err(()));
        assert_eq!(usage.logs.len(), 1);
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![],
            }),
        );
        usage.accept(generation, Err(()));
        assert_eq!(usage.logs.len(), 2);
    }
}
