//! Read structured connection metadata; never retain raw engine output or API bodies.
use crate::{
    config,
    models::{now_ms, LogEntry},
};
use prost::Message;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::{HashSet, VecDeque},
    io::Read,
    net::{Ipv4Addr, TcpListener},
    time::Duration,
};

const MAX_BODY: u64 = 4 * 1024 * 1024;

fn path_key(path: &str) -> String {
    let path = config::normalize_process_path(path).to_lowercase();
    if let Some(unc) = path.strip_prefix(r"\\?\unc\") {
        format!(r"\\{unc}")
    } else {
        path.trim_start_matches(r"\\?\").to_owned()
    }
}

fn connection_path_key(path: &str) -> String {
    path_key(executable_path(path))
}

fn executable_path(path: &str) -> &str {
    // Legacy Clash metadata may append a Windows DOMAIN\account label.
    if let Some((executable, account)) = path.rsplit_once(" (") {
        if executable.to_lowercase().ends_with(".exe") && account.ends_with(')') {
            return executable;
        }
    }
    path
}

#[derive(Clone)]
pub struct Controller {
    address: String,
    secret: String,
    client: reqwest::blocking::Client,
}

impl Controller {
    #[cfg(test)]
    pub fn unauthorized_for_test(&self) -> Result<(), ()> {
        let response = self
            .client
            .post(self.url())
            .header("Content-Type", "application/grpc-web+proto")
            .body(vec![0, 0, 0, 0, 0])
            .send()
            .map_err(|_| ())?;
        read_snapshot(response).map(|_| ())
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
        configuration["services"] = json!([{
            "type":"api", "tag":"usage", "listen":"127.0.0.1",
            "listen_port":reservation.local_addr().map_err(|_| "Could not read the usage monitor port.")?.port(), "secret":secret,
            "dashboard":false,
            "access_control_allow_origin":["http://proxyking.invalid"],
            "access_control_allow_private_network":false
        }]);
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
            .post(self.url())
            .bearer_auth(&self.secret)
            .header("Content-Type", "application/grpc-web+proto")
            .header("X-Grpc-Web", "1")
            .body(vec![0, 0, 0, 0, 0])
            .send()
            .map_err(|_| ())?
            .error_for_status()
            .map_err(|_| ())?;
        read_snapshot(response)
    }

    fn url(&self) -> String {
        format!(
            "http://{}/daemon.StartedService/SubscribeConnections",
            self.address
        )
    }
}

// Pinned sing-box 1.14.2 daemon/started_service.proto. Decode only the fields
// needed for activity; usernames, credentials, rules and raw engine logs are skipped.
#[derive(prost::Message)]
struct WireEvents {
    #[prost(message, repeated, tag = "1")]
    events: Vec<WireEvent>,
}
#[derive(prost::Message)]
struct WireEvent {
    #[prost(message, optional, tag = "3")]
    connection: Option<WireConnection>,
}
#[derive(prost::Message)]
struct WireProcess {
    #[prost(string, tag = "4")]
    path: String,
}
#[derive(prost::Message)]
struct WireConnection {
    #[prost(string, tag = "1")]
    id: String,
    #[prost(string, tag = "5")]
    network: String,
    #[prost(string, tag = "7")]
    destination: String,
    #[prost(string, tag = "8")]
    domain: String,
    #[prost(int64, tag = "13")]
    closed_at: i64,
    #[prost(string, tag = "19")]
    outbound: String,
    #[prost(string, repeated, tag = "21")]
    chains: Vec<String>,
    #[prost(message, optional, tag = "22")]
    process: Option<WireProcess>,
}

fn read_snapshot(mut response: impl Read) -> Result<Snapshot, ()> {
    // Read only the initial gRPC-Web message, which contains active connections
    // AND the engine's bounded recently closed history. Drop the stream afterward.
    let mut header = [0_u8; 5];
    response.read_exact(&mut header).map_err(|_| ())?;
    let length = u32::from_be_bytes(header[1..].try_into().map_err(|_| ())?) as usize;
    if header[0] != 0 || length as u64 > MAX_BODY {
        return Err(());
    }
    let mut body = vec![0; length];
    response.read_exact(&mut body).map_err(|_| ())?;
    let events = WireEvents::decode(body.as_slice()).map_err(|_| ())?;
    let connections = events
        .events
        .into_iter()
        .filter_map(|event| {
            let connection = event.connection?;
            let (host, port) = connection.destination.rsplit_once(':')?;
            let destination_ip = host
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_owned();
            let destination_port = port.to_owned();
            let chains = if connection.chains.is_empty() {
                vec![connection.outbound]
            } else {
                connection.chains
            };
            Some(Connection {
                id: connection.id,
                chains,
                closed_at: connection.closed_at.max(0) as u64,
                metadata: Metadata {
                    network: connection.network,
                    destination_ip,
                    destination_port,
                    host: connection.domain,
                    process_path: connection.process.map(|p| p.path).unwrap_or_default(),
                },
            })
        })
        .collect();
    Ok(Snapshot { connections })
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
    #[serde(default)]
    closed_at: u64,
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
        let basename = executable_path(&self.metadata.process_path)
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
    selected: HashSet<String>,
    children: HashSet<String>,
    collect_since: u64,
}

impl Usage {
    pub fn set_selected<'a>(&mut self, paths: impl Iterator<Item = &'a str>) {
        let selected = paths.map(path_key).collect();
        if self.selected != selected {
            self.selected = selected;
            self.generation += 1;
            self.seen.clear();
            self.collect_since = now_ms();
        }
    }

    pub fn set_children<'a>(&mut self, paths: impl Iterator<Item = &'a str>) {
        let children = paths.map(path_key).collect();
        if self.children != children {
            self.children = children;
            self.generation += 1;
            // Preserve IDs already logged while allowing newly included connections.
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled != enabled {
            self.enabled = enabled;
            self.collect_since = now_ms();
            self.generation += 1;
            self.seen.clear();
            self.failed = false;
        }
    }

    pub fn attach(&mut self, controller: Option<Controller>) {
        self.controller = controller;
        self.collect_since = now_ms();
        self.generation += 1;
        self.seen.clear();
        self.failed = false;
    }

    pub fn clear(&mut self) {
        self.logs.clear();
        self.collect_since = now_ms();
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
                    if connection.closed_at > 0 && connection.closed_at < self.collect_since {
                        continue;
                    }
                    let path = connection_path_key(&connection.metadata.process_path);
                    if !self.selected.contains(&path) && !self.children.contains(&path) {
                        continue;
                    }
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

    #[test]
    fn decodes_closed_connection_metadata_and_rejects_bad_frames() {
        let events = WireEvents {
            events: vec![WireEvent {
                connection: Some(WireConnection {
                    id: "short-lived".into(),
                    network: "tcp".into(),
                    destination: "[2001:db8::1]:443".into(),
                    domain: String::new(),
                    closed_at: 123,
                    outbound: "proxy".into(),
                    chains: Vec::new(),
                    process: Some(WireProcess {
                        path: r"C:\Apps\steam.exe".into(),
                    }),
                }),
            }],
        };
        let body = events.encode_to_vec();
        let mut frame = vec![0];
        frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
        frame.extend_from_slice(&body);
        let snapshot = read_snapshot(std::io::Cursor::new(frame)).unwrap();
        assert_eq!(snapshot.connections[0].closed_at, 123);
        assert_eq!(
            snapshot.connections[0].message().unwrap(),
            "steam.exe → [2001:db8::1]:443 · TCP · Proxy (observed)"
        );
        for frame in [
            vec![128, 0, 0, 0, 0],
            vec![1, 0, 0, 0, 0],
            vec![0, 0, 64, 0, 1],
            vec![0, 0, 0, 0, 10, 1],
            vec![0, 0, 0, 0, 1, 255],
        ] {
            assert!(read_snapshot(std::io::Cursor::new(frame)).is_err());
        }
    }

    #[test]
    fn closed_history_does_not_replay_off_periods_or_cleared_entries() {
        let mut usage = active();
        usage.collect_since = 100;
        let mut old = connection("before-on", "proxy");
        old.closed_at = 90;
        let mut recent = connection("after-on", "proxy");
        recent.closed_at = 110;
        let generation = usage.request().unwrap().0;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![old, recent],
            }),
        );
        assert_eq!(usage.logs.len(), 1);
        usage.clear();
        let generation = usage.request().unwrap().0;
        let mut recent = connection("after-on", "proxy");
        recent.closed_at = 110;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![recent],
            }),
        );
        assert!(usage.logs.is_empty());
        usage.set_enabled(false);
        usage.set_enabled(true);
        let generation = usage.request().unwrap().0;
        let mut off = connection("while-off", "proxy");
        off.closed_at = usage.collect_since.saturating_sub(1);
        let mut new = connection("after-reenable", "proxy");
        new.closed_at = usage.collect_since + 1;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![off, new],
            }),
        );
        assert_eq!(usage.logs.len(), 1);
    }

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
        usage.set_selected([r"C:\Users\private-account\Chrome\chrome.exe"].into_iter());
        usage.set_enabled(true);
        usage.attach(Some(Controller {
            address: "127.0.0.1:1".into(),
            secret: "test-only".into(),
            client: monitor_client().unwrap(),
        }));
        usage
    }

    #[test]
    fn records_only_selected_paths_and_current_children() {
        let mut usage = active();
        let mut selected = connection("selected", "direct");
        selected.metadata.process_path =
            r"\\?\C:/Users/private-account/Chrome/CHROME.EXE (account)".into();
        let mut unrelated = connection("unrelated", "proxy");
        unrelated.metadata.process_path = r"C:\Other\chrome.exe".into();
        let mut unknown = connection("unknown", "direct");
        unknown.metadata.process_path.clear();
        let mut child = connection("child", "proxy");
        child.metadata.process_path = r"C:\Game\helper.exe".into();
        let generation = usage.request().unwrap().0;
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![selected, unrelated, unknown, child],
            }),
        );
        assert_eq!(usage.logs.len(), 1);
        assert!(usage.logs[0].message.contains("Direct"));

        usage.set_children([r"C:\Game\helper.exe"].into_iter());
        let mut child = connection("child", "proxy");
        child.metadata.process_path = r"C:\Game\helper.exe".into();
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![child],
            }),
        );
        assert_eq!(usage.logs.len(), 1, "scope changes reject stale samples");
        let generation = usage.request().unwrap().0;
        let mut child = connection("child", "proxy");
        child.metadata.process_path = r"C:\Game\helper.exe".into();
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![child],
            }),
        );
        assert_eq!(
            usage.logs.len(),
            2,
            "newly discovered active children are included"
        );
        assert!(usage.logs[1].message.contains("helper.exe"));

        usage.set_children(std::iter::empty());
        usage.set_selected(std::iter::empty());
        let generation = usage.request().unwrap().0;
        let mut child = connection("new-child", "proxy");
        child.metadata.process_path = r"C:\Game\helper.exe".into();
        usage.accept(
            generation,
            Ok(Snapshot {
                connections: vec![connection("new-selected", "proxy"), child],
            }),
        );
        assert_eq!(
            usage.logs.len(),
            2,
            "an empty selection never logs all traffic"
        );
    }

    #[test]
    fn path_matching_preserves_executable_boundaries_and_unc_paths() {
        assert_eq!(
            connection_path_key(r"C:\Apps\steam.exe (DOMAIN\account)"),
            path_key(r"C:\Apps\steam.exe")
        );
        assert_eq!(
            path_key(r"\\?\UNC\Server\Share\App.exe"),
            path_key(r"\\server\share\app.exe")
        );
        assert_eq!(
            connection_path_key(r"C:\App.exe\Game.exe (account)"),
            path_key(r"C:\App.exe\Game.exe")
        );
        for path in [
            r"C:\App.exe.backup",
            r"C:\App.exe (copy)\Other.exe",
            "App.exe",
            "",
        ] {
            assert_ne!(connection_path_key(path), path_key(r"C:\App.exe"));
        }
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
