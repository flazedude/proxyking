//! Real-engine process matching tests. These never create a TUN adapter or
//! change Windows proxy, route, firewall, or DNS settings.

use crate::{
    config,
    models::{AppSettings, Profile, SelectedProcess},
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

fn command(path: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new(path);
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    command
}

struct ChildGuard(Option<Child>, Option<JoinHandle<Vec<u8>>>);

impl ChildGuard {
    fn new(mut child: Child, capture_diagnostics: bool) -> Self {
        let diagnostics = capture_diagnostics.then(|| {
            let mut stderr = child.stderr.take().unwrap();
            thread::spawn(move || {
                let mut captured = Vec::new();
                let mut buffer = [0; 1024];
                while let Ok(count) = stderr.read(&mut buffer) {
                    if count == 0 {
                        break;
                    }
                    // Continue draining after the diagnostic budget is reached.
                    let available = (16 * 1024usize).saturating_sub(captured.len());
                    captured.extend_from_slice(&buffer[..count.min(available)]);
                }
                captured
            })
        });
        Self(Some(child), diagnostics)
    }

    fn child(&mut self) -> &mut Child {
        self.0.as_mut().unwrap()
    }

    fn output(mut self) -> Output {
        let deadline = Instant::now() + Duration::from_secs(12);
        while self.child().try_wait().unwrap().is_none() {
            assert!(Instant::now() < deadline, "test child timed out");
            thread::sleep(Duration::from_millis(20));
        }
        self.0.take().unwrap().wait_with_output().unwrap()
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(reader) = self.1.take() {
            let diagnostics = reader.join().unwrap_or_default();
            if thread::panicking() {
                eprintln!(
                    "routing test engine diagnostics:\n{}",
                    String::from_utf8_lossy(&diagnostics)
                );
            }
        }
    }
}

struct FixtureCopy {
    directory: PathBuf,
    executable: PathBuf,
}

impl FixtureCopy {
    fn new(source: &Path) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "proxyking-routing-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).unwrap();
        let executable = directory.join("unselected-client.exe");
        std::fs::copy(source, &executable).unwrap();
        Self {
            directory,
            executable,
        }
    }
}

impl Drop for FixtureCopy {
    fn drop(&mut self) {
        // Remove only the two exact paths created by this fixture.
        let _ = std::fs::remove_file(&self.executable);
        let _ = std::fs::remove_dir(&self.directory);
    }
}

fn read_header(stream: &mut TcpStream) -> std::io::Result<String> {
    let mut bytes = Vec::new();
    while bytes.len() < 16 * 1024 {
        let mut byte = [0];
        stream.read_exact(&mut byte)?;
        bytes.push(byte[0]);
        if bytes.ends_with(b"\r\n\r\n") {
            return Ok(String::from_utf8_lossy(&bytes).into_owned());
        }
    }
    Err(std::io::Error::other("test HTTP header is too large"))
}

struct MockServer {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<Result<(), String>>>,
}

impl MockServer {
    fn start(proxy: bool, marker: &'static str) -> Self {
        Self::with_delay(proxy, marker, Duration::ZERO)
    }

    fn with_delay(proxy: bool, marker: &'static str, delay: Duration) -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::clone(&stop);
        let thread = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(35);
            loop {
                if cancelled.load(Ordering::SeqCst) {
                    return Err("test server cancelled".into());
                }
                if Instant::now() >= deadline {
                    return Err("test server received no request".into());
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        // Windows accepted sockets inherit FIONBIO from the listener.
                        stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                        stream
                            .set_read_timeout(Some(Duration::from_secs(4)))
                            .map_err(|e| e.to_string())?;
                        stream
                            .set_write_timeout(Some(Duration::from_secs(4)))
                            .map_err(|e| e.to_string())?;
                        if proxy {
                            let connect = read_header(&mut stream).map_err(|e| e.to_string())?;
                            if !connect.starts_with("CONNECT 127.0.0.1:") {
                                return Err(format!(
                                    "expected proxy CONNECT, received {connect:?}"
                                ));
                            }
                            stream
                                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                                .map_err(|e| e.to_string())?;
                        }
                        let request = read_header(&mut stream).map_err(|e| e.to_string())?;
                        if !request.starts_with("GET /process-route-check ") {
                            return Err(format!("unexpected origin request: {request:?}"));
                        }
                        let response = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{marker}", marker.len());
                        thread::sleep(delay);
                        stream
                            .write_all(response.as_bytes())
                            .map_err(|e| e.to_string())?;
                        return Ok(());
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => return Err(error.to_string()),
                }
            }
        });
        Self {
            address,
            stop,
            thread: Some(thread),
        }
    }

    fn finish(&mut self) {
        self.thread.take().unwrap().join().unwrap().unwrap();
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            if let Ok(Err(error)) = thread.join() {
                eprintln!("routing fixture server: {error}");
            }
        }
    }
}

fn start_engine(engine: &Path, action: &str, configuration: &Value) -> ChildGuard {
    let child = command(engine)
        .args([action, "-c", "stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut child = ChildGuard::new(child, action == "run");
    child
        .child()
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(configuration).unwrap())
        .unwrap();
    child
}

fn run_client(executable: &Path, proxy_port: u16, origin_port: u16, expected: &str) {
    let child = command(executable)
        .args([
            "--exact",
            "routing_tests::routing_client_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("PROXYKING_ROUTING_TEST_PROXY", proxy_port.to_string())
        .env("PROXYKING_ROUTING_TEST_ORIGIN", origin_port.to_string())
        .env("PROXYKING_ROUTING_TEST_EXPECTED", expected)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let output = ChildGuard::new(child, false).output();
    assert!(
        output.status.success(),
        "routing client failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout).contains("1 passed"),
        "the routing client fixture must actually run"
    );
}

fn run_observed_client(
    executable: &Path,
    proxy_port: u16,
    origin_port: u16,
    expected: &'static str,
    route: &str,
    controller: &crate::usage::Controller,
) {
    let mut usage = crate::usage::Usage::default();
    usage.set_selected([executable.to_str().unwrap()].into_iter());
    usage.set_enabled(true);
    usage.attach(Some(controller.clone()));
    let app = executable
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_lowercase();
    let executable = executable.to_owned();
    let client = thread::spawn(move || run_client(&executable, proxy_port, origin_port, expected));
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let (generation, monitor) = usage.request().unwrap();
        usage.accept(generation, monitor.snapshot());
        if usage.logs.iter().any(|entry| {
            entry.message.to_lowercase().starts_with(&app) && entry.message.contains(route)
        }) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "real app attribution or route missing from usage entries"
        );
        thread::sleep(Duration::from_millis(10));
    }
    client.join().unwrap();
}

#[test]
#[ignore = "invoked in a separate process by the real-engine routing test"]
fn routing_client_fixture() {
    if let Ok(gate) = std::env::var("PROXYKING_ROUTING_TEST_GATE") {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !Path::new(&gate).exists() {
            assert!(
                Instant::now() < deadline,
                "parent did not release routing fixture"
            );
            thread::sleep(Duration::from_millis(20));
        }
    }
    let proxy_port: u16 = std::env::var("PROXYKING_ROUTING_TEST_PROXY")
        .unwrap()
        .parse()
        .unwrap();
    let origin_port: u16 = std::env::var("PROXYKING_ROUTING_TEST_ORIGIN")
        .unwrap()
        .parse()
        .unwrap();
    let expected = std::env::var("PROXYKING_ROUTING_TEST_EXPECTED").unwrap();
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, proxy_port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(&[5, 1, 0]).unwrap();
    let mut greeting = [0; 2];
    stream.read_exact(&mut greeting).unwrap();
    assert_eq!(greeting, [5, 0]);
    stream
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
    let mut reply = [0; 10];
    stream.read_exact(&mut reply).unwrap();
    assert_eq!(reply[1], 0, "SOCKS request must connect");
    stream
        .write_all(
            b"GET /process-route-check HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        )
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(
        response.ends_with(&expected),
        "expected {expected:?}, received {response:?}"
    );
}

#[test]
fn real_engine_routes_only_selected_executable_without_tun() {
    let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sing-box.exe");
    assert!(
        engine.is_file(),
        "run npm run setup:engine before the routing integration test"
    );
    let selected = std::env::current_exe().unwrap();
    let unselected = FixtureCopy::new(&selected);
    let mut origin =
        MockServer::with_delay(false, "direct-origin-marker", Duration::from_millis(500));
    let mut upstream =
        MockServer::with_delay(true, "selected-proxy-marker", Duration::from_millis(500));
    let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let local_port = reservation.local_addr().unwrap().port();
    let profile = Profile {
        id: "routing-integration".into(),
        name: "Local routing fixture".into(),
        protocol: "http".into(),
        server: "127.0.0.1".into(),
        port: upstream.address.port(),
        outbound: json!({"type":"http","server":"127.0.0.1","server_port":upstream.address.port()}),
        created_at: "test".into(),
    };
    let settings = AppSettings {
        system_proxy: false,
        local_port,
        routing_mode: Some("processes".into()),
        usage_logging: false,
        selected_processes: vec![SelectedProcess {
            name: "Selected test executable".into(),
            include_children: false,
            // Deliberately vary casing to exercise Windows path semantics.
            path: selected
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_lowercase(),
        }],
    };
    let mut configuration = config::build_config(&profile, &settings).unwrap();
    let controller = crate::usage::Controller::configure(&mut configuration).unwrap();
    let checked = start_engine(&engine, "check", &configuration).output();
    assert!(
        checked.status.success(),
        "production TUN config rejected: {}",
        String::from_utf8_lossy(&checked.stderr)
    );

    // Preserve production route rules, final outbound, and interface detection.
    // Only remove the adapter-creating inbound before starting the real engine.
    configuration["inbounds"]
        .as_array_mut()
        .unwrap()
        .retain(|inbound| inbound["type"] != "tun");
    assert_eq!(configuration["inbounds"].as_array().unwrap().len(), 1);
    assert_eq!(configuration["inbounds"][0]["type"], "mixed");
    drop(reservation);
    let mut running = start_engine(&engine, "run", &configuration);
    let deadline = Instant::now() + Duration::from_secs(8);
    while TcpStream::connect((Ipv4Addr::LOCALHOST, local_port)).is_err() {
        assert!(
            running.child().try_wait().unwrap().is_none(),
            "routing engine exited during startup"
        );
        assert!(
            Instant::now() < deadline,
            "routing engine listener did not start"
        );
        thread::sleep(Duration::from_millis(20));
    }

    run_observed_client(
        &selected,
        local_port,
        origin.address.port(),
        "selected-proxy-marker",
        "TCP · Proxy",
        &controller,
    );
    upstream.finish();
    run_observed_client(
        &unselected.executable,
        local_port,
        origin.address.port(),
        "direct-origin-marker",
        "TCP · Direct",
        &controller,
    );
    origin.finish();
    drop(running);
}

#[test]
fn discovers_a_new_launcher_child_and_hot_reloads_without_restarting_engine() {
    use crate::{descendants::ChildRules, platform};
    let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/sing-box.exe");
    let selected = std::env::current_exe().unwrap();
    let fixture = FixtureCopy::new(&selected);
    let mut upstream = MockServer::start(true, "selected-proxy-marker");
    let mut origin = MockServer::start(false, "direct-origin-marker");
    let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let local_port = reservation.local_addr().unwrap().port();
    let profile = Profile {
        id: "launcher-check".into(),
        name: "Launcher check".into(),
        protocol: "http".into(),
        server: "127.0.0.1".into(),
        port: upstream.address.port(),
        outbound: json!({"type":"http","server":"127.0.0.1","server_port":upstream.address.port()}),
        created_at: "test".into(),
    };
    let settings = AppSettings {
        local_port,
        selected_processes: vec![SelectedProcess {
            name: "launcher.exe".into(),
            path: selected
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .into(),
            include_children: true,
        }],
        ..Default::default()
    };
    let excluded = vec![engine.to_string_lossy().into_owned()];
    let mut rules = ChildRules::new(
        &fixture.directory,
        settings.selected_processes.clone(),
        excluded,
        &platform::process_snapshot().unwrap(),
    )
    .unwrap();
    let mut configuration = config::build_config(&profile, &settings).unwrap();
    rules.attach(&mut configuration);
    let checked = start_engine(&engine, "check", &configuration).output();
    assert!(
        checked.status.success(),
        "{}",
        String::from_utf8_lossy(&checked.stderr)
    );
    configuration["inbounds"]
        .as_array_mut()
        .unwrap()
        .retain(|inbound| inbound["type"] != "tun");
    drop(reservation);
    let mut running = start_engine(&engine, "run", &configuration);
    let deadline = Instant::now() + Duration::from_secs(8);
    while TcpStream::connect((Ipv4Addr::LOCALHOST, local_port)).is_err() {
        assert!(running.child().try_wait().unwrap().is_none());
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(20));
    }
    let engine_pid = running.child().id();
    let gate = fixture.directory.join("client-ready");
    let child = command(&fixture.executable)
        .args([
            "--exact",
            "routing_tests::routing_client_fixture",
            "--ignored",
            "--nocapture",
        ])
        .env("PROXYKING_ROUTING_TEST_PROXY", local_port.to_string())
        .env(
            "PROXYKING_ROUTING_TEST_ORIGIN",
            origin.address.port().to_string(),
        )
        .env("PROXYKING_ROUTING_TEST_EXPECTED", "selected-proxy-marker")
        .env("PROXYKING_ROUTING_TEST_GATE", &gate)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let child_pid = child.id();
    let child = ChildGuard::new(child, false);
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        rules
            .refresh(&platform::process_snapshot().unwrap())
            .unwrap();
        if rules
            .children()
            .iter()
            .any(|item| platform::same_executable_path(Path::new(&item.path), &fixture.executable))
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "new child was not discovered: {child_pid}"
        );
        thread::sleep(Duration::from_millis(20));
    }
    // Allow the actual engine file watcher to consume the atomic replacement.
    thread::sleep(Duration::from_secs(2));
    std::fs::write(&gate, b"ready").unwrap();
    let output = child.output();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    upstream.finish();
    assert_eq!(running.child().id(), engine_pid);
    assert!(running.child().try_wait().unwrap().is_none());
    rules
        .refresh(&platform::process_snapshot().unwrap())
        .unwrap();
    assert!(!rules
        .children()
        .iter()
        .any(|item| platform::same_executable_path(Path::new(&item.path), &fixture.executable)));
    thread::sleep(Duration::from_secs(2));
    run_client(
        &fixture.executable,
        local_port,
        origin.address.port(),
        "direct-origin-marker",
    );
    origin.finish();
    drop(running);
    drop(rules);
    std::fs::remove_file(gate).unwrap();
}
