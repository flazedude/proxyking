use crate::{
    config,
    descendants::ChildRules,
    models::{now_ms, AppSettings, LogEntry, Profile, RunningProcess, RuntimeStatus, SavedState},
    platform,
    proxy::SystemProxy,
    storage,
    usage::{Controller, Usage},
};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub struct Service {
    inner: Mutex<Runtime>,
    storage_lock: Mutex<()>,
    data_dir: PathBuf,
    shutting_down: AtomicBool,
}

struct Runtime {
    status: RuntimeStatus,
    engine: Option<PathBuf>,
    child: Option<Child>,
    job: Option<ProcessJob>,
    system_proxy: SystemProxy,
    logs: VecDeque<LogEntry>,
    child_rules: Option<ChildRules>,
    usage: Usage,
}

impl Runtime {
    fn log(&mut self, level: &str, message: impl Into<String>) {
        self.logs.push_back(LogEntry {
            timestamp: now_ms(),
            level: level.into(),
            message: message.into(),
        });
        while self.logs.len() > 300 {
            self.logs.pop_front();
        }
    }

    fn stop(&mut self) -> Result<(), String> {
        let restore = self.system_proxy.restore();
        if let Ok(false) = restore {
            self.log(
                "warn",
                "Another application changed the Windows proxy; its settings were preserved.",
            );
        }
        if restore.is_ok() {
            self.status.system_proxy = false;
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.job = None;
        self.child_rules = None;
        self.usage.attach(None);
        self.usage.set_children(std::iter::empty());
        self.status.inherited_processes.clear();
        self.status.connected_at = None;
        self.status.profile_id = None;
        restore.map(|_| ())
    }
}

impl Service {
    pub fn new(data_dir: PathBuf, candidates: Vec<PathBuf>) -> Arc<Self> {
        let engine = if cfg!(windows) {
            candidates.into_iter().find(|path| path.is_file())
        } else {
            None
        };
        let version = engine.as_ref().and_then(|path| {
            hidden_command(path)
                .arg("version")
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .output()
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .and_then(|text| {
                    text.lines()
                        .next()
                        .map(|line| line.chars().take(100).collect())
                })
        });
        let mut usage = Usage::default();
        if let Some(state) = storage::read_encrypted::<SavedState>(&data_dir.join("profiles.dat"))
            .ok()
            .flatten()
        {
            usage.set_enabled(state.settings.usage_logging);
            usage.set_selected(
                state
                    .settings
                    .selected_processes
                    .iter()
                    .map(|process| process.path.as_str()),
            );
        }
        let mut runtime = Runtime {
            status: RuntimeStatus {
                engine_available: engine.is_some(),
                engine_version: version,
                is_elevated: platform::is_elevated(),
                ..Default::default()
            },
            engine,
            child: None,
            job: None,
            system_proxy: SystemProxy::new(&data_dir),
            logs: VecDeque::new(),
            child_rules: None,
            usage,
        };
        match runtime.system_proxy.restore() {
            Ok(false) => runtime.log("warn", "A previous proxy session ended unexpectedly; newer Windows settings were preserved."),
            Ok(true) => {},
            Err(error) => { runtime.status.state = "error".into(); runtime.status.error = Some(error.clone()); runtime.log("error", error); }
        }
        runtime.log(
            "info",
            "ProxyKing is ready. Choose selected-app, system-proxy, or local-proxy routing.",
        );
        if runtime.engine.is_none() {
            runtime.log("warn", "The Windows connection engine is not installed.");
        }
        let service = Arc::new(Self {
            inner: Mutex::new(runtime),
            storage_lock: Mutex::new(()),
            data_dir,
            shutting_down: AtomicBool::new(false),
        });
        let weak = Arc::downgrade(&service);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(250));
            let Some(service) = weak.upgrade() else {
                break;
            };
            if service.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            if let Ok(mut runtime) = service.inner.lock() {
                let exited = runtime
                    .child
                    .as_mut()
                    .is_some_and(|child| !matches!(child.try_wait(), Ok(None)));
                if exited {
                    let error = match runtime.stop() {
                        Ok(()) => {
                            "The connection engine stopped unexpectedly. Reconnect to try again."
                                .into()
                        }
                        Err(error) => format!("The connection engine stopped. {error}"),
                    };
                    runtime.status.state = "error".into();
                    runtime.status.error = Some(error.clone());
                    runtime.log("error", error);
                } else if runtime.child_rules.is_some() {
                    let refresh = platform::process_snapshot().and_then(|snapshot| {
                        let rules = runtime.child_rules.as_mut().expect("active child tracking");
                        rules.refresh(&snapshot).map(|changed| {
                            if changed {
                                Some(rules.children().to_vec())
                            } else {
                                None
                            }
                        })
                    });
                    match refresh {
                        Ok(Some(children)) => {
                            runtime
                                .usage
                                .set_children(children.iter().map(|process| process.path.as_str()));
                            runtime.status.inherited_processes = children;
                        }
                        Ok(None) => {}
                        Err(error) => {
                            let cleanup = runtime.stop();
                            let error = match cleanup {
                                Ok(()) => error,
                                Err(cleanup) => format!("{error} {cleanup}"),
                            };
                            runtime.status.state = "error".into();
                            runtime.status.error = Some(error.clone());
                            runtime.log("error", error);
                        }
                    }
                }
            };
        });
        let weak = Arc::downgrade(&service);
        thread::spawn(move || loop {
            thread::sleep(Duration::from_secs(1));
            let Some(service) = weak.upgrade() else {
                break;
            };
            if service.shutting_down.load(Ordering::SeqCst) {
                break;
            }
            let request = service
                .inner
                .lock()
                .ok()
                .and_then(|runtime| runtime.usage.request());
            if let Some((generation, controller)) = request {
                // Never hold the lifecycle lock during an HTTP request.
                let result = controller.snapshot();
                if let Ok(mut runtime) = service.inner.lock() {
                    runtime.usage.accept(generation, result);
                }
            }
        });
        service
    }

    pub fn load(&self) -> Result<SavedState, String> {
        let _guard = self
            .storage_lock
            .lock()
            .map_err(|_| "Profile storage is busy.")?;
        let mut state: SavedState =
            storage::read_encrypted(&self.data_dir.join("profiles.dat"))?.unwrap_or_default();
        state.settings.normalize();
        config::validate_state(&state)?;
        Ok(state)
    }

    pub fn save(&self, state: &SavedState) -> Result<(), String> {
        config::validate_state(state)?;
        let mut state = state.clone();
        state.settings.normalize();
        let _guard = self
            .storage_lock
            .lock()
            .map_err(|_| "Profile storage is busy.")?;
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?;
        storage::write_encrypted(&self.data_dir.join("profiles.dat"), &state)?;
        runtime.usage.set_enabled(state.settings.usage_logging);
        runtime.usage.set_selected(
            state
                .settings
                .selected_processes
                .iter()
                .map(|process| process.path.as_str()),
        );
        Ok(())
    }

    pub fn list_processes(&self) -> Result<Vec<RunningProcess>, String> {
        let mut excluded = Vec::new();
        if let Ok(path) = std::env::current_exe() {
            excluded.push(path);
        }
        if let Some(engine) = self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?
            .engine
            .clone()
        {
            excluded.push(engine);
        }
        platform::list_processes(&excluded)
    }

    pub fn status(&self) -> Result<RuntimeStatus, String> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?
            .status
            .clone())
    }

    pub fn logs(&self) -> Result<Vec<LogEntry>, String> {
        let runtime = self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?;
        Ok(runtime
            .logs
            .iter()
            .chain(runtime.usage.logs.iter())
            .cloned()
            .collect())
    }

    pub fn clear_logs(&self) -> Result<(), String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?;
        runtime.logs.clear();
        runtime.usage.clear();
        Ok(())
    }

    pub fn connect(
        &self,
        profile: Profile,
        mut settings: AppSettings,
    ) -> Result<RuntimeStatus, String> {
        settings.normalize();
        let mut configuration = config::build_config(&profile, &settings)?;
        if !cfg!(windows) {
            return Err("Connections are currently available on Windows only.".into());
        }
        let process_mode = settings.effective_routing_mode() == "processes";
        if process_mode && !platform::is_elevated() {
            return Err("Selected-app routing needs administrator access to create its Windows tunnel. Use Restart as administrator, then connect again.".into());
        }
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?;
        if self.shutting_down.load(Ordering::SeqCst) {
            return Err("ProxyKing is closing.".into());
        }
        if runtime.child.is_some() {
            return Err("Disconnect the current profile before connecting another.".into());
        }
        let engine = runtime.engine.clone().ok_or(
            "The sing-box engine is missing. Run the engine setup script and restart ProxyKing.",
        )?;
        if process_mode {
            let own = std::env::current_exe()
                .map_err(|_| "Could not determine ProxyKing's executable path.")?;
            if settings.selected_processes.iter().any(|process| {
                platform::same_executable_path(std::path::Path::new(&process.path), &own)
                    || platform::same_executable_path(std::path::Path::new(&process.path), &engine)
            }) {
                return Err("ProxyKing and its connection engine cannot be selected for proxy routing. Choose the application whose traffic you want to route.".into());
            }
        }
        let child_rules = if process_mode
            && settings
                .selected_processes
                .iter()
                .any(|process| process.include_children)
        {
            let excluded = vec![
                std::env::current_exe()
                    .map_err(|_| "Could not locate ProxyKing.")?
                    .to_string_lossy()
                    .into_owned(),
                engine.to_string_lossy().into_owned(),
            ];
            let rules = ChildRules::new(
                &self.data_dir,
                settings.selected_processes.clone(),
                excluded,
                &platform::process_snapshot()?,
            )?;
            rules.attach(&mut configuration);
            Some(rules)
        } else {
            None
        };
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, settings.local_port));
        let reservation = TcpListener::bind(address).map_err(|_| {
            format!(
                "Local port {} is already in use. Choose another port in Settings.",
                settings.local_port
            )
        })?;
        let controller = Controller::configure(&mut configuration)?;
        runtime.status.state = "connecting".into();
        runtime.status.error = None;
        runtime.status.profile_id = Some(profile.id.clone());
        runtime.status.local_port = settings.local_port;
        runtime.status.routing_mode = settings.effective_routing_mode().into();
        runtime.status.inherited_processes = child_rules
            .as_ref()
            .map(|rules| rules.children().to_vec())
            .unwrap_or_default();
        runtime.child_rules = child_rules;
        runtime.log("info", "Starting the connection engine.");
        drop(reservation);
        let result = (|| -> Result<(), String> {
            let mut child = hidden_command(&engine)
                .args(["run", "-c", "stdin", "--disable-color"])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|_| "Could not start the sing-box connection engine.")?;
            let job = match ProcessJob::attach(&child) {
                Ok(job) => job,
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
            };
            let mut stdin = child
                .stdin
                .take()
                .ok_or("Could not open the engine configuration pipe.")?;
            let startup_ready = Arc::new(AtomicBool::new(false));
            let stderr = child
                .stderr
                .take()
                .ok_or("Could not monitor the connection engine startup.")?;
            let signal = Arc::clone(&startup_ready);
            thread::spawn(move || drain_engine_output(stderr, &signal));
            runtime.child = Some(child);
            runtime.job = Some(job);
            let bytes = serde_json::to_vec(&configuration)
                .map_err(|_| "Could not encode connection configuration.")?;
            stdin
                .write_all(&bytes)
                .map_err(|_| "The engine could not read this profile's configuration.")?;
            drop(stdin); // sing-box reads stdin to EOF. No credential-bearing config is written to disk.
            let deadline = Instant::now() + Duration::from_secs(if process_mode { 30 } else { 8 });
            loop {
                let child = runtime
                    .child
                    .as_mut()
                    .ok_or("Connection engine is unavailable.")?;
                if child
                    .try_wait()
                    .map_err(|_| "Could not inspect the connection engine.")?
                    .is_some()
                {
                    return Err(if process_mode {
                        "The application tunnel could not start. Confirm administrator access, check for another active VPN or tunnel, and verify the proxy profile.".into()
                    } else {
                        "The engine rejected this profile. Check its protocol, credentials, TLS, and transport options.".into()
                    });
                }
                if startup_ready.load(Ordering::Acquire)
                    && TcpStream::connect_timeout(&address, Duration::from_millis(100)).is_ok()
                {
                    break;
                }
                if Instant::now() >= deadline {
                    return Err(if process_mode {
                        "The application tunnel did not become ready in time. Check administrator access and other active VPNs or tunnels.".into()
                    } else {
                        "The local proxy did not become ready in time.".into()
                    });
                }
                thread::sleep(Duration::from_millis(50));
            }
            if settings.effective_routing_mode() == "system" {
                runtime.status.system_proxy = true;
                runtime.system_proxy.apply(settings.local_port)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            let error = match runtime.stop() {
                Ok(()) => error,
                Err(restore) => format!("{error} {restore}"),
            };
            runtime.status.state = "error".into();
            runtime.status.error = Some(error.clone());
            runtime.log("error", &error);
            return Err(error);
        }
        runtime.status.state = "connected".into();
        runtime.usage.set_selected(
            settings
                .selected_processes
                .iter()
                .map(|process| process.path.as_str()),
        );
        let children = runtime.status.inherited_processes.clone();
        runtime
            .usage
            .set_children(children.iter().map(|process| process.path.as_str()));
        runtime.usage.attach(Some(controller));
        runtime.status.connected_at = Some(now_ms());
        if process_mode {
            runtime.log("info", "Application tunnel is ready. Selected executable paths use this proxy; other and unidentified processes route directly. Windows DNS settings are unchanged.");
            if runtime.child_rules.is_some() {
                runtime.log("info","Launcher child tracking enabled. Discovered child executable paths are included automatically after a short rule-update delay; all instances of those paths are covered.");
            }
        } else {
            runtime.log("info", "Local proxy is listening. Remote server authentication is verified when traffic is sent.");
        }
        if settings.effective_routing_mode() == "system" {
            runtime.log(
                "info",
                "Windows system proxy enabled for apps that follow its proxy settings.",
            );
        }
        Ok(runtime.status.clone())
    }

    pub fn disconnect(&self) -> Result<RuntimeStatus, String> {
        let mut runtime = self
            .inner
            .lock()
            .map_err(|_| "Connection state is unavailable.")?;
        match runtime.stop() {
            Ok(()) => {
                runtime.status.state = "disconnected".into();
                runtime.status.error = None;
                runtime.log("info", "Disconnected. Previous Windows proxy settings restored where still owned by ProxyKing.");
            }
            Err(error) => {
                runtime.status.state = "error".into();
                runtime.status.error = Some(error.clone());
                runtime.log("error", &error);
                return Err(error);
            }
        }
        Ok(runtime.status.clone())
    }

    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        if let Ok(mut runtime) = self.inner.lock() {
            let _ = runtime.stop();
        }
    }
}

/// Engine logs are consumed only to detect completion of all startup stages.
/// Never retain or expose raw engine text: it can contain profile or traffic data.
fn drain_engine_output(mut reader: impl Read, ready: &AtomicBool) {
    let marker = regex::Regex::new(r"^INFO(?:\[[0-9]+\])? sing-box started \([0-9.]+s\)$")
        .expect("constant startup marker regex");
    let mut buffer = [0_u8; 1024];
    let mut line = Vec::with_capacity(4096);
    let mut oversized = false;
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        for byte in &buffer[..count] {
            if *byte == b'\n' {
                if !oversized
                    && std::str::from_utf8(&line)
                        .is_ok_and(|text| marker.is_match(text.trim_end_matches('\r')))
                {
                    ready.store(true, Ordering::Release);
                }
                line.clear();
                oversized = false;
            } else if line.len() < 4096 {
                line.push(*byte);
            } else {
                oversized = true;
            }
        }
    }
}

fn hidden_command(path: &std::path::Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    }
    command
}

#[cfg(windows)]
struct ProcessJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessJob {}

#[cfg(windows)]
impl ProcessJob {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::{
            mem::{size_of, zeroed},
            os::windows::io::AsRawHandle,
            ptr::null,
        };
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        let handle = unsafe { CreateJobObjectW(null(), null()) };
        if handle.is_null() {
            return Err("Windows could not create the engine lifetime guard.".into());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } == 0
            || unsafe { AssignProcessToJobObject(handle, child.as_raw_handle()) } == 0
        {
            unsafe {
                CloseHandle(handle);
            }
            return Err("Windows could not attach the connection engine lifetime guard.".into());
        }
        Ok(Self(handle))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn startup_marker_requires_exact_complete_engine_message() {
        let ready = AtomicBool::new(false);
        drain_engine_output(std::io::Cursor::new(b"ERROR[0000] failed: sing-box started (0.00s)\nINFO[0000] inbound/tun: created adapter\n"), &ready);
        assert!(!ready.load(Ordering::Acquire));
        drain_engine_output(
            std::io::Cursor::new(b"INFO[0001] sing-box started (1.25s)\n"),
            &ready,
        );
        assert!(ready.load(Ordering::Acquire));
        let ready = AtomicBool::new(false);
        let oversized = format!("{}INFO[0000] sing-box started (0.00s)\n", "x".repeat(5000));
        drain_engine_output(std::io::Cursor::new(oversized), &ready);
        assert!(!ready.load(Ordering::Acquire));
    }

    #[test]
    fn bundled_engine_accepts_each_supported_protocol_configuration() {
        let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sing-box.exe");
        if !engine.is_file() {
            eprintln!("Engine integration test skipped: run the engine setup script first.");
            return;
        }
        let outbounds = [
            serde_json::json!({"type":"shadowsocks", "server":"example.com", "server_port":443,"method":"aes-128-gcm","password":"test-only-password"}),
            serde_json::json!({"type":"vless", "server":"example.com", "server_port":443,"uuid":"f5e61721-45b7-4112-8541-bc3ab68d6335","tls":{"enabled":true,"server_name":"example.com","utls":{"enabled":true,"fingerprint":"chrome"}},"transport":{"type":"ws","path":"/proxy","headers":{"Host":"example.com"}}}),
            serde_json::json!({"type":"trojan", "server":"example.com", "server_port":443,"password":"test-only-password","tls":{"enabled":true,"server_name":"example.com"},"transport":{"type":"grpc","service_name":"proxy"}}),
        ];
        for outbound in outbounds {
            let profile = Profile {
                id: "engine-check".into(),
                name: "Engine check".into(),
                protocol: outbound["type"].as_str().unwrap().into(),
                server: "example.com".into(),
                port: 443,
                outbound,
                created_at: "2026-01-01".into(),
            };
            let config = config::build_config(
                &profile,
                &AppSettings {
                    system_proxy: false,
                    local_port: 2080,
                    routing_mode: Some("local".into()),
                    selected_processes: Vec::new(),
                    usage_logging: false,
                },
            )
            .unwrap();
            let mut child = hidden_command(&engine)
                .args(["check", "-c", "stdin"])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child
                .stdin
                .take()
                .unwrap()
                .write_all(&serde_json::to_vec(&config).unwrap())
                .unwrap();
            let output = child.wait_with_output().unwrap();
            assert!(
                output.status.success(),
                "{} config rejected: {}",
                profile.protocol,
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }

    #[test]
    fn encrypted_forwarding_and_lifecycle_without_changing_windows_proxy() {
        let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sing-box.exe");
        if !engine.is_file() {
            eprintln!("Engine integration test skipped: run the engine setup script first.");
            return;
        }
        let port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let upstream_port = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let origin = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let origin_port = origin.local_addr().unwrap().port();
        origin.set_nonblocking(true).unwrap();
        let upstream_config = serde_json::json!({
            "log":{"disabled":true},
            "inbounds":[{"type":"shadowsocks","listen":"127.0.0.1","listen_port":upstream_port,"method":"aes-128-gcm","password":"test-only-password"}],
            "outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"direct"}
        });
        let mut upstream = hidden_command(&engine)
            .args(["run", "-c", "stdin"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let _upstream_job = ProcessJob::attach(&upstream).unwrap();
        upstream
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&upstream_config).unwrap())
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while TcpStream::connect((Ipv4Addr::LOCALHOST, upstream_port)).is_err() {
            assert!(
                upstream.try_wait().unwrap().is_none(),
                "local Shadowsocks test server stopped"
            );
            assert!(
                Instant::now() < deadline,
                "local Shadowsocks test server did not start"
            );
            thread::sleep(Duration::from_millis(25));
        }
        let service = Service::new(
            std::env::temp_dir().join(format!(
                "proxyking-test-{}-{}",
                std::process::id(),
                now_ms()
            )),
            vec![engine],
        );
        assert!(!service
            .list_processes()
            .unwrap()
            .iter()
            .any(|process| process.pid == std::process::id()));
        let profile = Profile {
            id: "engine-test".into(),
            name: "Engine test".into(),
            protocol: "shadowsocks".into(),
            server: "127.0.0.1".into(),
            port: upstream_port,
            outbound: serde_json::json!({"type":"shadowsocks", "server":"127.0.0.1", "server_port":upstream_port,"method":"aes-128-gcm","password":"test-only-password"}),
            created_at: "2026-01-01".into(),
        };
        let settings = AppSettings {
            system_proxy: false,
            local_port: port,
            routing_mode: Some("local".into()),
            selected_processes: vec![crate::models::SelectedProcess {
                name: "Test executable".into(),
                path: std::env::current_exe()
                    .unwrap()
                    .to_string_lossy()
                    .trim_start_matches(r"\\?\")
                    .into(),
                include_children: false,
            }],
            usage_logging: true,
        };
        let saved = SavedState {
            profiles: vec![profile.clone()],
            selected_profile_id: Some(profile.id.clone()),
            settings: settings.clone(),
        };
        service.save(&saved).unwrap();
        service.save(&saved).unwrap(); // Atomic replacement must also work for an existing file.
        let loaded = service.load().unwrap();
        assert_eq!(loaded.profiles[0].outbound, profile.outbound);
        assert_eq!(loaded.selected_profile_id, saved.selected_profile_id);
        assert_eq!(
            service
                .connect(profile.clone(), settings.clone())
                .unwrap()
                .state,
            "connected"
        );
        assert!(!service.status().unwrap().system_proxy);
        assert!(!service.logs().unwrap().is_empty());
        service.clear_logs().unwrap();
        assert!(service.logs().unwrap().is_empty());
        assert!(
            service.connect(profile, settings).is_err(),
            "a second process must not start"
        );
        let origin_thread = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                if let Ok((mut stream, _)) = origin.accept() {
                    // Accepted Windows sockets inherit the listener's nonblocking mode.
                    stream.set_nonblocking(false).unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut request = [0; 1024];
                    let length = stream.read(&mut request).unwrap();
                    assert!(String::from_utf8_lossy(&request[..length])
                        .starts_with("GET /proxyking-test "));
                    let payload = "verified encrypted ProxyKing forwarding";
                    let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}", payload.len());
                    stream.write_all(response.as_bytes()).unwrap();
                    break;
                }
                assert!(
                    Instant::now() < deadline,
                    "local HTTP origin was never reached through Shadowsocks"
                );
                thread::sleep(Duration::from_millis(10));
            }
        });
        let mut socket = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        socket.write_all(&[5, 1, 0]).unwrap();
        let mut response = [0; 2];
        socket.read_exact(&mut response).unwrap();
        assert_eq!(response, [5, 0], "mixed listener must support SOCKS5");
        socket
            .write_all(&[
                5,
                1,
                0,
                1,
                127,
                0,
                0,
                1,
                (origin_port >> 8) as u8,
                origin_port as u8,
            ])
            .unwrap();
        let mut connect_reply = [0; 10];
        socket.read_exact(&mut connect_reply).unwrap();
        assert_eq!(
            connect_reply[1], 0,
            "SOCKS CONNECT must succeed through Shadowsocks"
        );
        // Keep a real routed connection alive while inspecting structured metadata.
        // This never creates a TUN adapter or changes Windows proxy settings.
        let (generation, controller) = service.inner.lock().unwrap().usage.request().unwrap();
        let snapshot = controller
            .snapshot()
            .expect("authenticated engine usage API");
        service
            .inner
            .lock()
            .unwrap()
            .usage
            .accept(generation, Ok(snapshot));
        let entries = service.logs().unwrap();
        let usage = entries
            .iter()
            .find(|entry| entry.level == "usage")
            .expect("real proxied connection must be visible");
        assert!(usage.message.contains(&format!("127.0.0.1:{origin_port}")));
        assert!(usage.message.contains("TCP · Proxy"));
        assert!(!usage.message.contains("test-only-password"));
        assert!(controller.unauthorized_for_test().is_err());
        let mut no_selection = saved.clone();
        no_selection.settings.selected_processes.clear();
        service.save(&no_selection).unwrap();
        service.clear_logs().unwrap();
        let (empty_generation, _) = service.inner.lock().unwrap().usage.request().unwrap();
        service
            .inner
            .lock()
            .unwrap()
            .usage
            .accept(empty_generation, controller.snapshot());
        assert!(
            service.logs().unwrap().is_empty(),
            "unselected traffic is excluded even in local mode"
        );
        service.save(&saved).unwrap();
        service.clear_logs().unwrap();
        service
            .inner
            .lock()
            .unwrap()
            .usage
            .accept(generation, controller.snapshot());
        assert!(
            service.logs().unwrap().is_empty(),
            "clear rejects in-flight snapshots"
        );
        let mut disabled = saved.clone();
        disabled.settings.usage_logging = false;
        service.save(&disabled).unwrap();
        assert!(!service.load().unwrap().settings.usage_logging);
        assert!(service.inner.lock().unwrap().usage.request().is_none());
        service
            .inner
            .lock()
            .unwrap()
            .usage
            .accept(generation, controller.snapshot());
        assert!(
            service.logs().unwrap().is_empty(),
            "off rejects stale samples"
        );
        service.save(&saved).unwrap();
        socket
            .write_all(
                b"GET /proxyking-test HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let mut http_response = String::new();
        socket.read_to_string(&mut http_response).unwrap();
        assert!(http_response.ends_with("verified encrypted ProxyKing forwarding"));
        origin_thread.join().unwrap();
        drop(socket);
        assert_eq!(service.disconnect().unwrap().state, "disconnected");
        assert!(service.inner.lock().unwrap().usage.request().is_none());
        assert!(
            TcpStream::connect((Ipv4Addr::LOCALHOST, port)).is_err(),
            "disconnect must close the engine listener"
        );
        service.shutdown();
        std::fs::remove_file(service.data_dir.join("profiles.dat")).unwrap();
        std::fs::remove_dir(&service.data_dir).unwrap();
        upstream.kill().unwrap();
        upstream.wait().unwrap();
    }
}

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(not(windows))]
struct ProcessJob;
#[cfg(not(windows))]
impl ProcessJob {
    fn attach(_: &Child) -> Result<Self, String> {
        Err("Engine lifecycle integration is currently available on Windows only.".into())
    }
}
