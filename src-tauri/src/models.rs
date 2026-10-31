use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub protocol: String,
    pub server: String,
    pub port: u16,
    pub outbound: Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    pub system_proxy: bool,
    pub local_port: u16,
    #[serde(default)]
    pub routing_mode: Option<String>,
    #[serde(default)]
    pub selected_processes: Vec<SelectedProcess>,
    #[serde(default)]
    pub usage_logging: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelectedProcess {
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub include_children: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InheritedProcess {
    pub name: String,
    pub path: String,
    pub launcher_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcess {
    pub pid: u32,
    pub name: String,
    pub path: String,
}

impl AppSettings {
    pub fn effective_routing_mode(&self) -> &str {
        self.routing_mode
            .as_deref()
            .unwrap_or(if self.system_proxy { "system" } else { "local" })
    }

    pub fn normalize(&mut self) {
        let mode = self.effective_routing_mode().to_owned();
        self.system_proxy = mode == "system";
        self.routing_mode = Some(mode);
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            system_proxy: false,
            local_port: 2080,
            routing_mode: Some("processes".into()),
            selected_processes: Vec::new(),
            usage_logging: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedState {
    pub profiles: Vec<Profile>,
    pub selected_profile_id: Option<String>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: String,
    pub profile_id: Option<String>,
    pub connected_at: Option<u64>,
    pub engine_available: bool,
    pub engine_version: Option<String>,
    pub local_port: u16,
    pub system_proxy: bool,
    pub routing_mode: String,
    pub is_elevated: bool,
    pub inherited_processes: Vec<InheritedProcess>,
    pub error: Option<String>,
}

impl Default for RuntimeStatus {
    fn default() -> Self {
        Self {
            state: "disconnected".into(),
            profile_id: None,
            connected_at: None,
            engine_available: false,
            engine_version: None,
            local_port: 2080,
            system_proxy: false,
            routing_mode: "processes".into(),
            is_elevated: false,
            inherited_processes: Vec::new(),
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_saved_settings_keep_their_previous_routing_mode() {
        for (enabled, expected) in [(true, "system"), (false, "local")] {
            let mut settings: AppSettings =
                serde_json::from_value(serde_json::json!({"systemProxy":enabled,"localPort":2080}))
                    .unwrap();
            settings.normalize();
            assert_eq!(settings.effective_routing_mode(), expected);
            assert!(settings.selected_processes.is_empty());
            assert_eq!(settings.system_proxy, enabled);
            assert!(!settings.usage_logging);
        }
        assert_eq!(AppSettings::default().effective_routing_mode(), "processes");
        assert!(!AppSettings::default().system_proxy);
        let legacy: SelectedProcess = serde_json::from_value(
            serde_json::json!({"name":"steam.exe","path":"C:\\Apps\\steam.exe"}),
        )
        .unwrap();
        assert!(!legacy.include_children);
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: u64,
    pub level: String,
    pub message: String,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
