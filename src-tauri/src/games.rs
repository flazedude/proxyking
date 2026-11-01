//! Read-only discovery from launcher metadata, never a whole-drive search.
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledGame {
    pub id: String,
    pub title: String,
    pub launcher: String,
    pub kind: String,
    pub steam_id: Option<u32>,
    pub executables: Vec<String>,
    pub icon: Option<String>,
}

fn bounded_text(path: &Path) -> Option<String> {
    let mut value = String::new();
    fs::File::open(path)
        .ok()?
        .take(1024 * 1024 + 1)
        .read_to_string(&mut value)
        .ok()?;
    (value.len() <= 1024 * 1024).then_some(value)
}

fn vdf_value(text: &str, key: &str) -> Option<String> {
    let pattern = format!(r#""{}"\s+"((?:\\.|[^"\\])*)""#, regex::escape(key));
    regex::Regex::new(&pattern)
        .ok()?
        .captures(text)
        .map(|value| value[1].replace(r"\\", r"\").replace(r#"\""#, "\""))
}

fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains(':')
        && !path.starts_with(['/', '\\'])
        && path
            .replace('\\', "/")
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

fn skip_name(name: &str) -> bool {
    let name = name.to_lowercase();
    [
        "redist",
        "unins",
        "setup",
        "install",
        "crash",
        "report",
        "cef",
        "anticheat",
        "easyanti",
        "battleye",
        "unitycrash",
        "vc_redist",
        "dxsetup",
        "helper",
        "benchmark",
        "updater",
        "webview",
        "bugsplat",
        "bssndrpt",
        "editor",
        "gpuburner",
        "vconsole",
        "shadercompile",
    ]
    .iter()
    .any(|word| name.contains(word))
}

fn executable_candidates(root: &Path, preferred: Option<&Path>) -> Vec<String> {
    let Ok(canonical_root) = fs::canonicalize(root) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut queue = vec![(canonical_root.clone(), 0)];
    let mut visited = 0;
    while let Some((directory, depth)) = queue.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 12000 || found.len() >= 64 {
                break;
            }
            let Ok(meta) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            // Includes Windows junctions/reparse points, not only symlinks.
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if entry
                    .metadata()
                    .is_ok_and(|m| m.file_attributes() & 0x400 != 0)
                {
                    continue;
                }
            }
            if meta.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if meta.is_dir()
                && depth < 6
                && !skip_name(&name)
                && !matches!(
                    name.to_lowercase().as_str(),
                    "windows" | "node_modules" | ".git" | "__installer"
                )
            {
                queue.push((path, depth + 1));
            } else if meta.is_file() && name.to_lowercase().ends_with(".exe") && !skip_name(&name) {
                if let Ok(canonical) = fs::canonicalize(path) {
                    if canonical.starts_with(&canonical_root) {
                        found.push(
                            canonical
                                .to_string_lossy()
                                .trim_start_matches(r"\\?\")
                                .to_owned(),
                        );
                    }
                }
            }
        }
        if visited > 12000 || found.len() >= 64 {
            break;
        }
    }
    if let Some(preferred) = preferred {
        if let Ok(canonical) = fs::canonicalize(preferred) {
            if canonical.is_file()
                && canonical.starts_with(&canonical_root)
                && canonical
                    .extension()
                    .is_some_and(|v| v.eq_ignore_ascii_case("exe"))
            {
                found.insert(
                    0,
                    canonical
                        .to_string_lossy()
                        .trim_start_matches(r"\\?\")
                        .into(),
                );
            }
        }
    }
    let mut seen = HashSet::new();
    found.retain(|path| seen.insert(path.to_lowercase()));
    // Prefer shipping executables over launchers, but leave the choice explicit.
    let preferred_key = preferred
        .and_then(|path| fs::canonicalize(path).ok())
        .map(|path| {
            path.to_string_lossy()
                .trim_start_matches(r"\\?\")
                .to_lowercase()
        });
    found.sort_by_key(|path| {
        (
            preferred_key
                .as_ref()
                .is_none_or(|preferred| preferred != &path.to_lowercase()),
            path.to_lowercase().contains("launcher"),
            path.to_lowercase(),
        )
    });
    found
}

fn add_game(
    games: &mut Vec<InstalledGame>,
    title: String,
    launcher: &str,
    steam_id: Option<u32>,
    root: &Path,
    preferred: Option<&Path>,
    kind: &str,
) {
    if games.len() >= 500
        || title.is_empty()
        || title.len() > 512
        || title.chars().any(char::is_control)
    {
        return;
    }
    let executables = if kind == "launcher" {
        preferred
            .filter(|path| {
                path.is_file()
                    && path
                        .extension()
                        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
                    && !skip_name(&path.file_name().unwrap_or_default().to_string_lossy())
            })
            .map(|path| vec![path.to_string_lossy().into_owned()])
            .unwrap_or_default()
    } else {
        executable_candidates(root, preferred)
    };
    if executables.is_empty() {
        return;
    }
    let id = format!(
        "{}:{}",
        launcher,
        steam_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| executables[0].to_lowercase())
    );
    if games
        .iter()
        .any(|game| game.id == id || (game.title == title && game.executables == executables))
    {
        return;
    }
    games.push(InstalledGame {
        id,
        title,
        launcher: launcher.into(),
        kind: kind.into(),
        steam_id,
        executables,
        icon: None,
    });
}

fn steam_games(root: &Path, games: &mut Vec<InstalledGame>) {
    let mut libraries = vec![root.to_owned()];
    if let Some(text) = bounded_text(&root.join("steamapps/libraryfolders.vdf")) {
        let pattern =
            regex::Regex::new(r#""path"\s+"((?:\\.|[^"\\])*)""#).expect("static VDF pattern");
        for capture in pattern.captures_iter(&text).take(32) {
            let path = PathBuf::from(capture[1].replace(r"\\", r"\"));
            if path.is_absolute() && !libraries.contains(&path) {
                libraries.push(path);
            }
        }
    }
    for library in libraries {
        let Ok(manifests) = fs::read_dir(library.join("steamapps")) else {
            continue;
        };
        for manifest in manifests.flatten().take(1000) {
            let name = manifest.file_name().to_string_lossy().into_owned();
            if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
                continue;
            }
            let Some(text) = bounded_text(&manifest.path()) else {
                continue;
            };
            let (Some(id), Some(title), Some(directory)) = (
                vdf_value(&text, "appid").and_then(|id| id.parse::<u32>().ok()),
                vdf_value(&text, "name"),
                vdf_value(&text, "installdir"),
            ) else {
                continue;
            };
            if id == 228980 || directory.contains(['/', '\\']) || !safe_relative(&directory) {
                continue;
            }
            add_game(
                games,
                title,
                "steam",
                Some(id),
                &library.join("steamapps/common").join(directory),
                None,
                "game",
            );
        }
    }
}

fn epic_games(manifests: &Path, games: &mut Vec<InstalledGame>) {
    let Ok(entries) = fs::read_dir(manifests) else {
        return;
    };
    for entry in entries.flatten().take(1000) {
        if entry.path().extension().is_none_or(|ext| ext != "item") {
            continue;
        }
        let Some(text) = bounded_text(&entry.path()) else {
            continue;
        };
        let Ok(item) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if item["bIsIncompleteInstall"].as_bool() == Some(true) {
            continue;
        }
        let (Some(title), Some(root), Some(executable)) = (
            item["DisplayName"].as_str(),
            item["InstallLocation"].as_str(),
            item["LaunchExecutable"].as_str(),
        ) else {
            continue;
        };
        if !safe_relative(executable) || !Path::new(root).is_absolute() {
            continue;
        }
        let root = Path::new(root);
        let preferred = root.join(executable);
        add_game(
            games,
            title.into(),
            "epic",
            None,
            root,
            Some(&preferred),
            "game",
        );
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use windows_sys::Win32::{Foundation::ERROR_SUCCESS, System::Registry::*};
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain([0]).collect()
    }
    fn open(parent: HKEY, path: &str) -> Option<Key> {
        let mut handle = std::ptr::null_mut();
        (unsafe { RegOpenKeyExW(parent, wide(path).as_ptr(), 0, KEY_READ, &mut handle) }
            == ERROR_SUCCESS)
            .then_some(Key(handle))
    }
    fn value(key: &Key, name: &str) -> Option<String> {
        let mut buffer = vec![0u16; 16384];
        let mut size = (buffer.len() * 2) as u32;
        let mut kind = 0;
        let result = unsafe {
            RegQueryValueExW(
                key.0,
                wide(name).as_ptr(),
                std::ptr::null_mut(),
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if result != ERROR_SUCCESS || ![REG_SZ, REG_EXPAND_SZ].contains(&kind) || size < 2 {
            return None;
        }
        Some(
            String::from_utf16_lossy(&buffer[..(size as usize / 2).min(buffer.len())])
                .trim_end_matches('\0')
                .to_owned(),
        )
    }
    pub fn scan() -> Vec<InstalledGame> {
        let mut games = Vec::new();
        let steam = open(HKEY_CURRENT_USER, r"Software\Valve\Steam")
            .and_then(|key| value(&key, "SteamPath"));
        if let Some(root) = steam {
            let root = PathBuf::from(root);
            steam_games(&root, &mut games);
            add_game(
                &mut games,
                "Steam".into(),
                "steam",
                None,
                &root,
                Some(&root.join("steam.exe")),
                "launcher",
            );
            if let Some(game) = games
                .iter_mut()
                .find(|game| game.kind == "launcher" && game.launcher == "steam")
            {
                game.executables.retain(|path| {
                    Path::new(path)
                        .file_name()
                        .is_some_and(|name| name.eq_ignore_ascii_case("steam.exe"))
                });
            }
        }
        if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
            epic_games(
                &PathBuf::from(program_data).join("Epic/EpicGamesLauncher/Data/Manifests"),
                &mut games,
            );
        }
        for parent in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            for path in [
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
                r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            ] {
                let Some(uninstall) = open(parent, path) else {
                    continue;
                };
                for index in 0..4096 {
                    let mut name = [0u16; 512];
                    let mut size = name.len() as u32;
                    if unsafe {
                        RegEnumKeyExW(
                            uninstall.0,
                            index,
                            name.as_mut_ptr(),
                            &mut size,
                            std::ptr::null_mut(),
                            std::ptr::null_mut(),
                            std::ptr::null_mut(),
                            std::ptr::null_mut(),
                        )
                    } != ERROR_SUCCESS
                    {
                        break;
                    }
                    let Some(key) = open(
                        uninstall.0,
                        &String::from_utf16_lossy(&name[..size as usize]),
                    ) else {
                        continue;
                    };
                    let Some(title) = value(&key, "DisplayName") else {
                        continue;
                    };
                    let publisher = value(&key, "Publisher").unwrap_or_default().to_lowercase();
                    let lower = title.to_lowercase();
                    let launcher = if publisher.contains("blizzard") {
                        "battlenet"
                    } else if publisher.contains("ubisoft") {
                        "ubisoft"
                    } else if publisher.contains("riot") {
                        "riot"
                    } else if publisher.contains("gog") {
                        "gog"
                    } else if publisher.contains("electronic arts") {
                        "ea"
                    } else if lower == "epic games launcher" {
                        "epic"
                    } else {
                        continue;
                    };
                    if lower.contains("uninstall")
                        || lower.contains("prerequisite")
                        || lower.contains("online services")
                    {
                        continue;
                    }
                    let icon = value(&key, "DisplayIcon").map(|path| {
                        path.trim_matches('"')
                            .split(",0")
                            .next()
                            .unwrap_or("")
                            .trim_matches('"')
                            .to_string()
                    });
                    let root = value(&key, "InstallLocation")
                        .filter(|path| !path.is_empty())
                        .map(PathBuf::from)
                        .or_else(|| {
                            icon.as_ref()
                                .and_then(|path| Path::new(path).parent().map(Path::to_owned))
                        });
                    let Some(root) = root else { continue };
                    if !root.is_absolute()
                        || root.components().count() < 3
                        || root
                            .components()
                            .any(|component| component == Component::ParentDir)
                    {
                        continue;
                    }
                    let kind = if lower.contains("battle.net")
                        || lower.contains("launcher")
                        || lower.contains("启动器")
                        || lower == "gog galaxy"
                        || lower == "ea app"
                        || lower == "ubisoft connect"
                    {
                        "launcher"
                    } else {
                        "game"
                    };
                    let preferred = if kind == "launcher" {
                        let executable = match launcher {
                            "battlenet" => "Battle.net.exe",
                            "ubisoft" => "UbisoftConnect.exe",
                            "riot" => "RiotClientServices.exe",
                            "gog" => "GalaxyClient.exe",
                            "ea" => "EADesktop.exe",
                            "epic" => "Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe",
                            _ => "",
                        };
                        Some(root.join(executable))
                    } else {
                        icon.as_ref().map(PathBuf::from).filter(|path| {
                            path.extension()
                                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
                        })
                    };
                    add_game(
                        &mut games,
                        title,
                        launcher,
                        None,
                        &root,
                        preferred.as_deref(),
                        kind,
                    );
                }
            }
        }
        games.retain(|game| !game.executables.is_empty());
        games.sort_by_key(|game| (game.kind.clone(), game.title.to_lowercase()));
        games
    }
}

pub fn scan() -> Result<Vec<InstalledGame>, String> {
    #[cfg(windows)]
    {
        let mut games = windows::scan();
        for game in &mut games {
            game.icon = crate::game_icons::executable_icon(Path::new(&game.executables[0]));
        }
        Ok(games)
    }
    #[cfg(not(windows))]
    {
        Err("Installed-game discovery is available on Windows only.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_cannot_escape_an_install_directory() {
        for path in [
            "../game.exe",
            "..\\game.exe",
            "C:\\game.exe",
            "/game.exe",
            "",
            "folder//game.exe",
        ] {
            assert!(!safe_relative(path));
        }
        assert!(safe_relative("Game/Binaries/Win64/game.exe"));
        assert_eq!(
            vdf_value(
                r#""AppState" { "name" "A Game" "installdir" "A Game" }"#,
                "name"
            ),
            Some("A Game".into())
        );
        assert!(skip_name("CrashReportClient.exe"));
    }
    #[test]
    fn reads_verified_steam_and_epic_installs_and_ignores_stale_or_dlc_entries() {
        let root = std::env::temp_dir().join(format!(
            "proxyking-game-fixture-{}",
            crate::models::now_ms()
        ));
        fs::create_dir_all(root.join("steamapps/common/Fixture/bin")).unwrap();
        fs::write(root.join("steamapps/common/Fixture/bin/game.exe"), []).unwrap();
        fs::write(
            root.join("steamapps/common/Fixture/bin/CrashReportClient.exe"),
            [],
        )
        .unwrap();
        fs::write(
            root.join("steamapps/appmanifest_123.acf"),
            r#""appid" "123" "name" "Fixture Game" "installdir" "Fixture""#,
        )
        .unwrap();
        fs::write(
            root.join("steamapps/appmanifest_124.acf"),
            r#""appid" "124" "name" "Stale Game" "installdir" "Missing""#,
        )
        .unwrap();
        fs::write(
            root.join("steamapps/appmanifest_125.acf"),
            r#""appid" "125" "name" "Escaping Game" "installdir" "../Fixture""#,
        )
        .unwrap();
        let mut games = Vec::new();
        steam_games(&root, &mut games);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].steam_id, Some(123));
        assert_eq!(games[0].executables.len(), 1);
        fs::create_dir_all(root.join("manifests")).unwrap();
        fs::write(root.join("manifests/game.item"), serde_json::json!({"DisplayName":"Epic Fixture","InstallLocation":root.join("steamapps/common/Fixture"),"LaunchExecutable":"bin/game.exe"}).to_string()).unwrap();
        fs::write(
            root.join("manifests/dlc.item"),
            serde_json::json!({"DisplayName":"DLC","InstallLocation":root,"LaunchExecutable":""})
                .to_string(),
        )
        .unwrap();
        epic_games(&root.join("manifests"), &mut games);
        assert_eq!(games.len(), 2);
        assert_eq!(games[1].launcher, "epic");
        // The fixture was created beneath a concrete, checked temp path.
        assert!(
            root.starts_with(std::env::temp_dir())
                && root
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("proxyking-game-fixture-")
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "read-only scan of this PC, invoked explicitly for discovery QA"]
    fn scan_this_pc() {
        let games = scan().unwrap();
        for game in &games {
            println!(
                "{} | {} | {} executable(s) | icon {}",
                game.launcher,
                game.title,
                game.executables.len(),
                game.icon.is_some()
            );
        }
        println!("{} installed entries", games.len());
    }
}
