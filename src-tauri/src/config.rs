use crate::models::{AppSettings, Profile, SavedState};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    if settings.local_port < 1024 {
        return Err("Choose a local port between 1024 and 65535.".into());
    }
    if !["system", "local", "processes"].contains(&settings.effective_routing_mode()) {
        return Err("Choose a valid routing mode.".into());
    }
    if settings.selected_processes.len() > 128 {
        return Err("Select at most 128 applications.".into());
    }
    let mut paths = HashSet::new();
    for process in &settings.selected_processes {
        validate_process_path(&process.path)?;
        if process.name.is_empty() || process.name.chars().count() > 256 {
            return Err("A selected application has an invalid name.".into());
        }
        if !paths.insert(normalize_process_path(&process.path).to_lowercase()) {
            return Err("An application can only be selected once.".into());
        }
    }
    Ok(())
}

pub fn normalize_process_path(path: &str) -> String {
    path.replace('/', "\\")
}

pub fn validate_process_path(path: &str) -> Result<(), String> {
    let path = normalize_process_path(path);
    let bytes = path.as_bytes();
    let drive =
        bytes.len() > 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    let body = if drive {
        &path[3..]
    } else if let Some(unc) = path.strip_prefix("\\\\") {
        if unc.split('\\').count() < 3 {
            return Err("Select an application with an absolute Windows executable path.".into());
        }
        unc
    } else {
        return Err("Select an application with an absolute Windows executable path.".into());
    };
    if path.len() > 32767
        || !path.to_lowercase().ends_with(".exe")
        || body
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        || body.split('\\').any(|part| {
            part.is_empty() || part == "." || part == ".." || part.ends_with([' ', '.'])
        })
    {
        return Err("Select an application with a valid Windows executable path.".into());
    }
    Ok(())
}

pub fn process_path_pattern(path: &str) -> String {
    format!("(?i)^{}$", regex::escape(&normalize_process_path(path)))
}

pub fn validate_state(state: &SavedState) -> Result<(), String> {
    validate_settings(&state.settings)?;
    if state.profiles.len() > 500 {
        return Err("A maximum of 500 profiles can be saved.".into());
    }
    let mut ids = HashSet::new();
    for profile in &state.profiles {
        validate_profile(profile)?;
        if !ids.insert(&profile.id) {
            return Err("Profile IDs must be unique.".into());
        }
    }
    if state
        .selected_profile_id
        .as_ref()
        .is_some_and(|id| !ids.contains(id))
    {
        return Err("The selected profile does not exist.".into());
    }
    Ok(())
}

fn allowed_keys(value: &Value, allowed: &[&str], label: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{label} must be an object."))?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("{label} contains an unsupported option."));
    }
    Ok(())
}

fn nonempty(value: &Value, field: &str) -> Result<(), String> {
    if !value
        .get(field)
        .and_then(Value::as_str)
        .is_some_and(|v| !v.is_empty() && v.len() <= 8192)
    {
        return Err(format!("Profile is missing a valid {field}."));
    }
    Ok(())
}

pub fn validate_profile(profile: &Profile) -> Result<(), String> {
    if profile.id.is_empty()
        || profile.id.len() > 128
        || profile.name.trim().is_empty()
        || profile.name.chars().count() > 256
    {
        return Err("Profile name or ID is invalid.".into());
    }
    if profile.port == 0
        || profile.server.is_empty()
        || profile.server.len() > 253
        || profile.server.chars().any(|c| {
            c.is_whitespace() || c.is_control() || matches!(c, '/' | '\\' | '@' | '#' | '?')
        })
    {
        return Err("Profile server or port is invalid.".into());
    }
    if !["shadowsocks", "vless", "trojan", "http", "socks"].contains(&profile.protocol.as_str()) {
        return Err(
            "Only Shadowsocks, VLESS, Trojan, HTTP, and SOCKS5 profiles are supported.".into(),
        );
    }
    let outbound = &profile.outbound;
    allowed_keys(
        outbound,
        &[
            "type",
            "tag",
            "server",
            "server_port",
            "method",
            "password",
            "uuid",
            "flow",
            "tls",
            "transport",
            "network",
            "packet_encoding",
            "username",
            "version",
        ],
        "Outbound",
    )?;
    if outbound["type"].as_str() != Some(&profile.protocol)
        || outbound["server"].as_str() != Some(&profile.server)
        || outbound["server_port"].as_u64() != Some(profile.port as u64)
    {
        return Err("Profile endpoint does not match its connection configuration.".into());
    }
    if serde_json::to_vec(outbound)
        .map_err(|_| "Profile is invalid.")?
        .len()
        > 65536
    {
        return Err("Profile configuration is too large.".into());
    }
    match profile.protocol.as_str() {
        "shadowsocks" => {
            nonempty(outbound, "method")?;
            nonempty(outbound, "password")?;
        }
        "vless" => {
            nonempty(outbound, "uuid")?;
        }
        "trojan" => {
            nonempty(outbound, "password")?;
        }
        "http" | "socks" => {
            let allowed = if profile.protocol == "http" {
                vec![
                    "type",
                    "tag",
                    "server",
                    "server_port",
                    "username",
                    "password",
                    "tls",
                ]
            } else {
                vec![
                    "type",
                    "tag",
                    "server",
                    "server_port",
                    "username",
                    "password",
                    "version",
                ]
            };
            allowed_keys(outbound, &allowed, "Proxy outbound")?;
            if profile.protocol == "socks" && outbound["version"].as_str() != Some("5") {
                return Err("Only SOCKS version 5 is supported.".into());
            }
            if outbound.get("username").is_some() || outbound.get("password").is_some() {
                nonempty(outbound, "username")?;
                let username = outbound["username"].as_str().unwrap_or_default();
                let password = outbound
                    .get("password")
                    .and_then(Value::as_str)
                    .ok_or("Proxy authentication requires a password field.")?;
                if username
                    .chars()
                    .chain(password.chars())
                    .any(char::is_control)
                    || password.len() > 8192
                {
                    return Err(
                        "Proxy credentials contain invalid characters or are too long.".into(),
                    );
                }
                if profile.protocol == "http" && username.contains(':') {
                    return Err("An HTTP proxy username cannot contain a colon.".into());
                }
                if profile.protocol == "socks"
                    && (username.len() > 255 || password.is_empty() || password.len() > 255)
                {
                    return Err(
                        "SOCKS5 usernames and passwords must each contain 1–255 UTF-8 bytes."
                            .into(),
                    );
                }
            }
        }
        _ => unreachable!(),
    }
    if let Some(tls) = outbound.get("tls") {
        allowed_keys(
            tls,
            &[
                "enabled",
                "server_name",
                "insecure",
                "alpn",
                "utls",
                "reality",
                "min_version",
                "max_version",
            ],
            "TLS",
        )?;
        if let Some(utls) = tls.get("utls") {
            allowed_keys(utls, &["enabled", "fingerprint"], "TLS fingerprint")?;
        }
        if let Some(reality) = tls.get("reality") {
            allowed_keys(reality, &["enabled", "public_key", "short_id"], "Reality")?;
        }
    }
    if let Some(transport) = outbound.get("transport") {
        allowed_keys(
            transport,
            &[
                "type",
                "path",
                "headers",
                "host",
                "method",
                "service_name",
                "max_early_data",
                "early_data_header_name",
            ],
            "Transport",
        )?;
        if !transport["type"]
            .as_str()
            .is_some_and(|v| ["ws", "http", "grpc", "httpupgrade", "quic"].contains(&v))
        {
            return Err("Unsupported transport type.".into());
        }
    }
    Ok(())
}

pub fn build_config(profile: &Profile, settings: &AppSettings) -> Result<Value, String> {
    validate_profile(profile)?;
    validate_settings(settings)?;
    let mut outbound = profile.outbound.clone();
    outbound["tag"] = json!("proxy");
    if settings.effective_routing_mode() == "processes" {
        if settings.selected_processes.is_empty() {
            return Err(
                "Select at least one running application before connecting in selected-app mode."
                    .into(),
            );
        }
        let paths: Vec<String> = settings
            .selected_processes
            .iter()
            .map(|process| process_path_pattern(&process.path))
            .collect();
        return Ok(json!({
            "log": {"level":"info", "timestamp":false},
            "inbounds": [
                {"type":"tun","tag":"selected-apps","interface_name":"ProxyKing","address":["172.30.255.1/30","fdfe:dcba:9876::1/126"],"auto_route":true,"strict_route":false,"dns_mode":"disabled","stack":"mixed","mtu":1500},
                {"type":"mixed","tag":"local","listen":"127.0.0.1","listen_port":settings.local_port}
            ],
            "outbounds":[outbound,{"type":"direct","tag":"direct"}],
            "route":{"auto_detect_interface":true,"rules":[{"process_path_regex":paths,"action":"route","outbound":"proxy"}],"final":"direct"}
        }));
    }
    Ok(json!({
        "log": {"level":"info", "timestamp":false},
        "inbounds": [{"type": "mixed", "tag": "local", "listen": "127.0.0.1", "listen_port": settings.local_port}],
        "outbounds": [outbound],
        "route": {"final": "proxy"}
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> Profile {
        Profile {
            id: "test".into(),
            name: "Example".into(),
            protocol: "trojan".into(),
            server: "example.com".into(),
            port: 443,
            outbound: json!({"type": "trojan", "server": "example.com", "server_port": 443, "password": "secret", "tls": {"enabled": true}}),
            created_at: "2026-01-01".into(),
        }
    }

    #[test]
    fn confines_listener_and_routes_through_selected_profile() {
        let config = build_config(
            &profile(),
            &AppSettings {
                routing_mode: Some("local".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(config["inbounds"][0]["listen"], "127.0.0.1");
        assert_eq!(config["route"]["final"], config["outbounds"][0]["tag"]);
        assert_eq!(config["outbounds"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejects_endpoint_mismatch_and_file_access_options() {
        let mut p = profile();
        p.outbound["server"] = json!("other.example");
        assert!(validate_profile(&p).is_err());
        p = profile();
        p.outbound["tls"]["certificate_path"] = json!("C:\\private.pem");
        assert!(validate_profile(&p).is_err());
        p = profile();
        p.outbound["detour"] = json!("direct");
        assert!(validate_profile(&p).is_err());
    }

    #[test]
    fn rejects_invalid_saved_selection_and_duplicate_ids() {
        let mut state = SavedState {
            profiles: vec![profile()],
            selected_profile_id: Some("missing".into()),
            ..Default::default()
        };
        assert!(validate_state(&state).is_err());
        state.selected_profile_id = None;
        state.profiles.push(profile());
        assert!(validate_state(&state).is_err());
    }

    #[test]
    fn selected_apps_are_exact_case_insensitive_paths_and_everything_else_is_direct() {
        let path = r"C:\Program Files\Example (Beta)\app.v2.exe";
        let settings = AppSettings {
            selected_processes: vec![crate::models::SelectedProcess {
                name: "app.v2.exe".into(),
                path: path.into(),
                include_children: false,
            }],
            ..Default::default()
        };
        let config = build_config(&profile(), &settings).unwrap();
        assert_eq!(config["inbounds"][0]["type"], "tun");
        assert_eq!(config["inbounds"][0]["dns_mode"], "disabled");
        assert_eq!(config["inbounds"][0]["strict_route"], false);
        assert_eq!(config["route"]["final"], "direct");
        assert_eq!(config["route"]["auto_detect_interface"], true);
        let pattern = config["route"]["rules"][0]["process_path_regex"][0]
            .as_str()
            .unwrap();
        let regex = regex::Regex::new(pattern).unwrap();
        assert!(regex.is_match(&path.to_uppercase()));
        assert!(!regex.is_match(r"C:\Program Files\Example (Beta)\appXv2.exe"));
        assert!(!regex.is_match(r"C:\Other\app.v2.exe"));
        assert!(!regex.is_match(&format!("{path}.bak")));
        assert!(config.get("dns").is_none());
    }

    #[test]
    fn process_paths_reject_wildcards_relative_paths_and_duplicates() {
        for path in [
            "app.exe",
            r"C:\apps\..\app.exe",
            r"C:\apps\*.exe",
            r"C:\apps\app.exe:stream",
            r"C:\apps\app.exe\\",
        ] {
            assert!(validate_process_path(path).is_err(), "{path}");
        }
        assert!(validate_process_path(r"C:\apps\app.exe").is_ok());
        assert!(validate_process_path(r"\\server\share\app.exe").is_ok());
        let settings = AppSettings::default();
        assert!(validate_settings(&settings).is_ok());
        assert!(build_config(&profile(), &settings).is_err());
        let mut duplicate = settings;
        duplicate.selected_processes = vec![
            crate::models::SelectedProcess {
                name: "app.exe".into(),
                path: r"C:\Apps\app.exe".into(),
                include_children: false,
            },
            crate::models::SelectedProcess {
                name: "app.exe".into(),
                path: r"c:\apps\APP.exe".into(),
                include_children: false,
            },
        ];
        assert!(validate_settings(&duplicate).is_err());
    }

    #[test]
    fn validates_manual_proxy_authentication_without_allowing_arbitrary_engine_options() {
        let mut p = profile();
        p.protocol = "http".into();
        p.outbound = json!({"type":"http","server":"example.com","server_port":443,"username":"user","password":"","tls":{"enabled":true,"server_name":"example.com"}});
        assert!(validate_profile(&p).is_ok());
        p.outbound["username"] = json!("invalid:user");
        assert!(validate_profile(&p).is_err());
        p.protocol = "socks".into();
        p.outbound = json!({"type":"socks","server":"example.com","server_port":443,"version":"5","username":"user","password":"password"});
        assert!(validate_profile(&p).is_ok());
        p.outbound["password"] = json!("");
        assert!(validate_profile(&p).is_err());
        p.outbound["password"] = json!("界".repeat(86));
        assert!(validate_profile(&p).is_err());
        p.outbound["password"] = json!("password");
        p.outbound["tls"] = json!({"enabled":true});
        assert!(validate_profile(&p).is_err());
        p.outbound.as_object_mut().unwrap().remove("tls");
        p.outbound["version"] = json!("4");
        assert!(validate_profile(&p).is_err());
    }
}
