use crate::storage;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ProxySnapshot {
    flags: u32,
    server: String,
    bypass: String,
    auto_config_url: String,
}

#[derive(Serialize, Deserialize)]
struct Recovery {
    original: ProxySnapshot,
    applied: ProxySnapshot,
}

fn safe_to_restore(current: &ProxySnapshot, recovery: &Recovery) -> bool {
    current == &recovery.applied
}

fn restoration_target(current: &ProxySnapshot, recovery: &Recovery) -> Option<ProxySnapshot> {
    if safe_to_restore(current, recovery) {
        return Some(recovery.original.clone());
    }
    // A different endpoint belongs to another proxy tool. Preserve its entire configuration.
    if current.server != recovery.applied.server {
        return None;
    }
    // Independent PAC/bypass changes must survive, but our stopped local endpoint must not.
    let mut target = current.clone();
    target.server = recovery.original.server.clone();
    if current.flags == recovery.applied.flags {
        target.flags = recovery.original.flags;
    }
    if current.bypass == recovery.applied.bypass {
        target.bypass = recovery.original.bypass.clone();
    }
    if current.auto_config_url == recovery.applied.auto_config_url {
        target.auto_config_url = recovery.original.auto_config_url.clone();
    }
    Some(target)
}

pub struct SystemProxy {
    journal: PathBuf,
}

impl SystemProxy {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            journal: data_dir.join("proxy-recovery.dat"),
        }
    }

    /// Persist recovery before changing Windows; restore only settings that remain ours.
    pub fn apply(&self, port: u16) -> Result<(), String> {
        if self.journal.exists() {
            self.restore()?;
        }
        let original = read_proxy()?;
        let applied = ProxySnapshot {
            flags: 3, // PROXY_TYPE_DIRECT | PROXY_TYPE_PROXY; PAC and autodetection are disabled.
            server: format!("127.0.0.1:{port}"),
            bypass: "localhost;127.*;[::1];<local>".into(),
            auto_config_url: original.auto_config_url.clone(),
        };
        let recovery = Recovery { original, applied };
        storage::write_encrypted(&self.journal, &recovery)?;
        if let Err(error) = write_proxy(&recovery.applied) {
            // InternetSetOption can succeed before the refresh fails. Guard rollback as usual.
            let _ = self.restore();
            return Err(error);
        }
        if read_proxy()? != recovery.applied {
            return Err("Windows proxy settings changed while connecting. Reconnect after other proxy tools finish.".into());
        }
        Ok(())
    }

    /// false means another application changed settings and those newer fields were preserved.
    pub fn restore(&self) -> Result<bool, String> {
        let Some(recovery) = storage::read_encrypted::<Recovery>(&self.journal)? else {
            return Ok(true);
        };
        let current = read_proxy()?;
        let restored = safe_to_restore(&current, &recovery);
        if let Some(target) = restoration_target(&current, &recovery) {
            write_proxy(&target)?;
        }
        std::fs::remove_file(&self.journal)
            .map_err(|_| "Could not clear the Windows proxy recovery record.")?;
        Ok(restored)
    }
}

#[cfg(windows)]
fn read_proxy() -> Result<ProxySnapshot, String> {
    use std::{
        mem::{size_of, zeroed},
        ptr::null_mut,
    };
    use windows_sys::Win32::{Foundation::GlobalFree, Networking::WinInet::*};
    let mut options: [INTERNET_PER_CONN_OPTIONW; 4] = unsafe { zeroed() };
    options[0].dwOption = INTERNET_PER_CONN_FLAGS_UI;
    options[1].dwOption = INTERNET_PER_CONN_PROXY_SERVER;
    options[2].dwOption = INTERNET_PER_CONN_PROXY_BYPASS;
    options[3].dwOption = INTERNET_PER_CONN_AUTOCONFIG_URL;
    let mut list: INTERNET_PER_CONN_OPTION_LISTW = unsafe { zeroed() };
    list.dwSize = size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32;
    list.dwOptionCount = options.len() as u32;
    list.pOptions = options.as_mut_ptr();
    let mut size = list.dwSize;
    let ok = unsafe {
        InternetQueryOptionW(
            null_mut(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            (&mut list as *mut INTERNET_PER_CONN_OPTION_LISTW).cast(),
            &mut size,
        )
    };
    if ok == 0 {
        return Err("Could not read Windows proxy settings.".into());
    }
    let mut strings = Vec::new();
    for option in &options[1..] {
        let pointer = unsafe { option.Value.pszValue };
        let text = if pointer.is_null() {
            String::new()
        } else {
            let mut length = 0;
            unsafe {
                while *pointer.add(length) != 0 {
                    length += 1;
                }
            }
            let text =
                String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) });
            unsafe {
                GlobalFree(pointer.cast());
            }
            text
        };
        strings.push(text);
    }
    Ok(ProxySnapshot {
        flags: unsafe { options[0].Value.dwValue },
        server: strings.remove(0),
        bypass: strings.remove(0),
        auto_config_url: strings.remove(0),
    })
}

#[cfg(windows)]
fn write_proxy(snapshot: &ProxySnapshot) -> Result<(), String> {
    use std::{
        mem::{size_of, zeroed},
        ptr::null_mut,
    };
    use windows_sys::Win32::Networking::WinInet::*;
    let mut server: Vec<u16> = snapshot.server.encode_utf16().chain(Some(0)).collect();
    let mut bypass: Vec<u16> = snapshot.bypass.encode_utf16().chain(Some(0)).collect();
    let mut pac: Vec<u16> = snapshot
        .auto_config_url
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut options: [INTERNET_PER_CONN_OPTIONW; 4] = unsafe { zeroed() };
    options[0].dwOption = INTERNET_PER_CONN_FLAGS;
    options[0].Value.dwValue = snapshot.flags;
    options[1].dwOption = INTERNET_PER_CONN_PROXY_SERVER;
    options[1].Value.pszValue = server.as_mut_ptr();
    options[2].dwOption = INTERNET_PER_CONN_PROXY_BYPASS;
    options[2].Value.pszValue = bypass.as_mut_ptr();
    options[3].dwOption = INTERNET_PER_CONN_AUTOCONFIG_URL;
    options[3].Value.pszValue = pac.as_mut_ptr();
    let mut list: INTERNET_PER_CONN_OPTION_LISTW = unsafe { zeroed() };
    list.dwSize = size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32;
    list.dwOptionCount = options.len() as u32;
    list.pOptions = options.as_mut_ptr();
    if unsafe {
        InternetSetOptionW(
            null_mut(),
            INTERNET_OPTION_PER_CONNECTION_OPTION,
            (&list as *const INTERNET_PER_CONN_OPTION_LISTW).cast(),
            list.dwSize,
        )
    } == 0
    {
        return Err("Windows could not update the system proxy settings.".into());
    }
    let notified =
        unsafe { InternetSetOptionW(null_mut(), INTERNET_OPTION_SETTINGS_CHANGED, null_mut(), 0) };
    let refreshed =
        unsafe { InternetSetOptionW(null_mut(), INTERNET_OPTION_REFRESH, null_mut(), 0) };
    if notified == 0 || refreshed == 0 {
        return Err("Windows could not refresh its system proxy settings.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn read_proxy() -> Result<ProxySnapshot, String> {
    Err("System proxy integration is currently available on Windows only.".into())
}
#[cfg(not(windows))]
fn write_proxy(_: &ProxySnapshot) -> Result<(), String> {
    Err("System proxy integration is currently available on Windows only.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_proxy_snapshot_is_readable_without_mutation() {
        assert!(read_proxy().is_ok());
    }
    fn snapshot() -> ProxySnapshot {
        ProxySnapshot {
            flags: 3,
            server: "127.0.0.1:2080".into(),
            bypass: "<local>".into(),
            auto_config_url: String::new(),
        }
    }
    #[test]
    fn restore_preserves_changes_from_other_proxy_tools() {
        let recovery = Recovery {
            original: ProxySnapshot {
                flags: 1,
                ..snapshot()
            },
            applied: snapshot(),
        };
        assert!(safe_to_restore(&snapshot(), &recovery));
        let mut external = snapshot();
        external.server = "127.0.0.1:9999".into();
        assert!(!safe_to_restore(&external, &recovery));
        assert!(restoration_target(&external, &recovery).is_none());
        external = snapshot();
        external.flags = 9;
        assert!(!safe_to_restore(&external, &recovery));
        external = snapshot();
        external.auto_config_url = "https://example.com/proxy.pac".into();
        assert!(!safe_to_restore(&external, &recovery));
    }

    #[test]
    fn changed_bypass_or_pac_does_not_leave_a_dead_local_proxy() {
        let recovery = Recovery {
            original: ProxySnapshot {
                flags: 9,
                server: String::new(),
                bypass: "original.local".into(),
                auto_config_url: "https://old.example/proxy.pac".into(),
            },
            applied: snapshot(),
        };
        let current = ProxySnapshot {
            bypass: "new.local".into(),
            auto_config_url: "https://new.example/proxy.pac".into(),
            ..snapshot()
        };
        let target = restoration_target(&current, &recovery).unwrap();
        assert_eq!(target.server, "");
        assert_eq!(target.flags, 9);
        assert_eq!(target.bypass, "new.local");
        assert_eq!(target.auto_config_url, "https://new.example/proxy.pac");
        let externally_disabled = ProxySnapshot {
            flags: 1,
            ..snapshot()
        };
        assert_eq!(
            restoration_target(&externally_disabled, &recovery)
                .unwrap()
                .flags,
            1
        );
    }
}
