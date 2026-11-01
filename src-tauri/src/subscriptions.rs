use reqwest::{blocking::Client, redirect::Policy, Url};
use std::{io::Read, time::Duration};

const MAX_BYTES: usize = 512 * 1024;
const MAX_URL_BYTES: usize = 8192;
const MAX_REDIRECTS: usize = 5;
const URL_ERROR: &str =
    "Enter an HTTPS YAML download URL without a username, password, or fragment.";
const DOWNLOAD_ERROR: &str =
    "Could not download the YAML configuration. Check the URL and network, or import a local file.";

fn valid_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.port() != Some(0)
        && url.as_str().len() <= MAX_URL_BYTES
}

fn parse_url(input: &str) -> Result<Url, String> {
    let input = input.trim();
    if input.len() > MAX_URL_BYTES || input.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(URL_ERROR.into());
    }
    let url = Url::parse(input).map_err(|_| URL_ERROR)?;
    if !valid_url(&url) {
        return Err(URL_ERROR.into());
    }
    Ok(url)
}

fn client_builder() -> reqwest::blocking::ClientBuilder {
    // The updater already enables rustls; share its provider without touching
    // Windows proxy settings or starting an engine. Normal client proxy discovery
    // and the current network route apply to this explicit download.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .referer(false)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() > MAX_REDIRECTS || !valid_url(attempt.url()) {
                attempt.error("Unsupported YAML download redirect.")
            } else {
                attempt.follow()
            }
        }))
}

fn download(client: &Client, url: Url) -> Result<String, String> {
    let response = client
        .get(url)
        .header(
            "Accept",
            "application/yaml, text/yaml, text/plain, */*;q=0.5",
        )
        .header("Accept-Encoding", "identity")
        .header("Cache-Control", "no-store")
        .header(
            "User-Agent",
            concat!("ProxyKing/", env!("CARGO_PKG_VERSION")),
        )
        .send()
        // reqwest errors can contain the complete credential-bearing URL.
        .map_err(|_| DOWNLOAD_ERROR)?;
    if !response.status().is_success() {
        return Err("The YAML download returned an unsuccessful HTTP status. Check the link or export a local file.".into());
    }
    if response
        .headers()
        .get("Content-Encoding")
        .is_some_and(|value| !value.as_bytes().eq_ignore_ascii_case(b"identity"))
    {
        return Err(
            "The server returned compressed content. Export an uncompressed YAML file instead."
                .into(),
        );
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err("Choose a YAML configuration smaller than 512 KB.".into());
    }
    let mut bytes = Vec::new();
    response
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| DOWNLOAD_ERROR)?;
    if bytes.len() > MAX_BYTES {
        return Err("Choose a YAML configuration smaller than 512 KB.".into());
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| "The downloaded configuration must be UTF-8 YAML.".to_owned())?;
    if text.trim().is_empty() {
        return Err("The YAML download was empty.".into());
    }
    Ok(text)
}

/// One explicit download; no subscription storage, provider recursion or logging.
pub fn fetch_yaml(input: &str) -> Result<String, String> {
    let url = parse_url(input)?;
    let client = client_builder().build().map_err(|_| DOWNLOAD_ERROR)?;
    download(&client, url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, thread};

    fn test_client() -> Client {
        client_builder().no_proxy().build().unwrap()
    }

    fn serve(response: Vec<u8>) -> (Url, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!(
            "http://{}/config.yaml?token=test-only-secret",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let task = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0_u8; 1];
            while stream.read_exact(&mut byte).is_ok() {
                request.push(byte[0]);
                if request.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            // Oversize/redirect responses can be rejected before the server finishes.
            let _ = stream.write_all(&response);
            String::from_utf8(request).unwrap()
        });
        (url, task)
    }

    fn response(body: &[u8], headers: &str) -> Vec<u8> {
        let mut bytes =
            format!("HTTP/1.1 200 OK\r\nConnection: close\r\n{headers}\r\n").into_bytes();
        bytes.extend_from_slice(body);
        bytes
    }

    #[test]
    fn accepts_https_document_urls_and_rejects_unsafe_inputs_without_echoing() {
        for input in [
            "https://config.example/config.yaml",
            "https://config.example/api?token=test-only-secret",
            " https://config.example:8443/ ",
        ] {
            assert!(parse_url(input).is_ok());
        }
        for input in [
            "http://config.example/config.yaml",
            "file:///config.yaml",
            "https://user:test-only-secret@config.example/config.yaml",
            "https://config.example/config.yaml#test-only-secret",
            "https://config.example:0/config.yaml",
            "https://config.example/a\nb",
            "https://config.example/?token=\0test-only-secret",
        ] {
            assert_eq!(fetch_yaml(input).unwrap_err(), URL_ERROR);
        }
        assert_eq!(
            parse_url(&format!(
                "https://example.com/{}",
                "x".repeat(MAX_URL_BYTES)
            ))
            .unwrap_err(),
            URL_ERROR
        );
    }

    #[test]
    fn downloads_utf8_yaml_without_referer_and_returns_no_source_url() {
        let body =
            "proxies:\n  - name: 测试\n    type: socks5\n    server: example.com\n    port: 1080\n";
        let (url, task) = serve(response(body.as_bytes(), "Content-Type: text/yaml\r\n"));
        assert_eq!(download(&test_client(), url).unwrap(), body);
        let request = task.join().unwrap().to_lowercase();
        assert!(request.contains("accept-encoding: identity\r\n"));
        assert!(!request.contains("referer:"));
        assert!(!request.contains("authorization:"));
    }

    #[test]
    fn bounds_declared_and_streamed_bodies_and_sanitizes_failures() {
        let cases = [
            (response(b"", &format!("Content-Length: {}\r\n", MAX_BYTES + 1)), "512 KB"),
            (response(&vec![b'x'; MAX_BYTES + 1], ""), "512 KB"),
            (response(b"", "Content-Encoding: gzip\r\n"), "compressed"),
            (response(b"\xff", ""), "UTF-8"),
            (response(b" \n", ""), "empty"),
            (b"HTTP/1.1 403 Forbidden\r\nContent-Length: 16\r\nConnection: close\r\n\r\ntest-only-secret".to_vec(), "HTTP status"),
            (b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\ntest-only-secret".to_vec(), "Could not download"),
        ];
        let client = test_client();
        for (bytes, expected) in cases {
            let (url, task) = serve(bytes);
            let error = download(&client, url).unwrap_err();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("test-only-secret"));
            task.join().unwrap();
        }
    }

    #[test]
    fn refuses_insecure_redirects_before_contacting_target() {
        let target = TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let bytes = format!("HTTP/1.1 302 Found\r\nLocation: http://{}/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", target.local_addr().unwrap()).into_bytes();
        let (url, task) = serve(bytes);
        assert_eq!(download(&test_client(), url).unwrap_err(), DOWNLOAD_ERROR);
        task.join().unwrap();
        assert!(target.accept().is_err());
    }
}
