//! Launcher descendants become temporary executable-path rules. No credentials
//! are stored here, and discovery never restarts the connection engine.
use crate::{
    config,
    models::{InheritedProcess, SelectedProcess},
    platform::ProcessIdentity,
    storage,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Default)]
pub struct Tracker {
    // Creation time is part of the identity: Windows recycles process IDs.
    members: HashMap<(u32, u64), String>,
}

impl Tracker {
    pub fn update(
        &mut self,
        roots: &[SelectedProcess],
        snapshot: &[ProcessIdentity],
        excluded: &[String],
    ) -> Result<Vec<InheritedProcess>, String> {
        let key = |path: &str| config::normalize_process_path(path).to_lowercase();
        let excluded: HashSet<String> = excluded.iter().map(|path| key(path)).collect();
        let selected: HashSet<String> = roots.iter().map(|root| key(&root.path)).collect();
        let enabled: HashMap<String, String> = roots
            .iter()
            .filter(|root| root.include_children)
            .map(|root| (key(&root.path), root.path.clone()))
            .collect();
        let current: HashMap<u32, &ProcessIdentity> = snapshot
            .iter()
            .map(|process| (process.pid, process))
            .collect();
        let mut members = HashMap::new();
        for process in snapshot {
            if excluded.contains(&key(&process.path)) {
                continue;
            }
            let identity = (process.pid, process.created);
            if let Some(root) = enabled
                .get(&key(&process.path))
                .or_else(|| self.members.get(&identity))
            {
                members.insert(identity, root.clone());
            }
        }
        // Order in the Toolhelp snapshot is arbitrary. Resolve all generations.
        loop {
            let mut changed = false;
            for process in snapshot {
                let identity = (process.pid, process.created);
                if members.contains_key(&identity) || excluded.contains(&key(&process.path)) {
                    continue;
                }
                let root = if let Some(parent) = current.get(&process.parent_pid) {
                    if parent.created > process.created || parent.pid == process.pid {
                        None
                    } else {
                        members.get(&(parent.pid, parent.created)).cloned()
                    }
                } else {
                    // A tracked launcher/helper may have exited since the last
                    // sample. Keep its newly observed child, then retire the PID.
                    self.members
                        .iter()
                        .find(|((pid, created), _)| {
                            *pid == process.parent_pid && *created <= process.created
                        })
                        .map(|(_, root)| root.clone())
                };
                if let Some(root) = root {
                    members.insert(identity, root);
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        let mut paths = BTreeMap::new();
        for process in snapshot {
            if let Some(root) = members.get(&(process.pid, process.created)) {
                if !selected.contains(&key(&process.path)) {
                    paths
                        .entry(key(&process.path))
                        .or_insert_with(|| InheritedProcess {
                            name: process.name.clone(),
                            path: process.path.clone(),
                            launcher_path: root.clone(),
                        });
                }
            }
        }
        if paths.len() > 512 {
            return Err("The launcher tree exceeded 512 child executables. Disable child inclusion or narrow your selection.".into());
        }
        self.members = members;
        Ok(paths.into_values().collect())
    }
}

pub struct ChildRules {
    pub roots: Vec<SelectedProcess>,
    pub excluded: Vec<String>,
    pub tracker: Tracker,
    path: PathBuf,
    last: Vec<InheritedProcess>,
}

impl ChildRules {
    pub fn new(
        directory: &Path,
        roots: Vec<SelectedProcess>,
        excluded: Vec<String>,
        snapshot: &[ProcessIdentity],
    ) -> Result<Self, String> {
        fs::create_dir_all(directory).map_err(|_| "Could not create the child-rule directory.")?;
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = directory.join(format!("children-{}-{nonce}.json", std::process::id()));
        let mut result = Self {
            roots,
            excluded,
            tracker: Tracker::default(),
            path,
            last: Vec::new(),
        };
        let children = result
            .tracker
            .update(&result.roots, snapshot, &result.excluded)?;
        result.write(&children)?;
        result.last = children;
        Ok(result)
    }

    pub fn attach(&self, configuration: &mut Value) {
        configuration["route"]["find_process"] = json!(true);
        configuration["route"]["rule_set"] =
            json!([{"type":"local","tag":"launcher-children","format":"source","path":self.path}]);
        configuration["route"]["rules"]
            .as_array_mut()
            .expect("validated process configuration")
            .push(json!({"rule_set":["launcher-children"],"action":"route","outbound":"proxy"}));
    }

    pub fn children(&self) -> &[InheritedProcess] {
        &self.last
    }

    pub fn refresh(&mut self, snapshot: &[ProcessIdentity]) -> Result<bool, String> {
        let children = self.tracker.update(&self.roots, snapshot, &self.excluded)?;
        if children == self.last {
            return Ok(false);
        }
        self.write(&children)?;
        self.last = children;
        Ok(true)
    }

    fn write(&self, children: &[InheritedProcess]) -> Result<(), String> {
        let patterns: Vec<String> = children
            .iter()
            .map(|child| config::process_path_pattern(&child.path))
            .collect();
        let rules = if patterns.is_empty() {
            json!([])
        } else {
            json!([{"process_path_regex":patterns}])
        };
        let bytes = serde_json::to_vec(&json!({"version":3,"rules":rules}))
            .map_err(|_| "Could not encode child-process rules.")?;
        let temporary = self.path.with_extension("tmp");
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temporary)
            .map_err(|_| "Could not write child-process rules.")?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not write child-process rules.")?;
        drop(file);
        storage::atomic_replace(&temporary, &self.path)
            .map_err(|_| "Could not update child-process rules.".to_string())
    }
}

impl Drop for ChildRules {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let _ = fs::remove_file(self.path.with_extension("tmp"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn process(pid: u32, parent: u32, created: u64, name: &str) -> ProcessIdentity {
        ProcessIdentity {
            pid,
            parent_pid: parent,
            created,
            name: name.into(),
            path: format!(r"C:\Apps\{name}"),
        }
    }
    fn root() -> SelectedProcess {
        SelectedProcess {
            name: "steam.exe".into(),
            path: r"C:\Apps\steam.exe".into(),
            include_children: true,
        }
    }
    #[test]
    fn recursive_inheritance_survives_parent_exit_but_not_pid_reuse() {
        let mut tracker = Tracker::default();
        let roots = vec![root()];
        let first = vec![
            process(3, 2, 30, "game.exe"),
            process(2, 1, 20, "helper.exe"),
            process(1, 0, 10, "steam.exe"),
            process(4, 0, 40, "unrelated.exe"),
        ];
        assert_eq!(tracker.update(&roots, &first, &[]).unwrap().len(), 2);
        let next = vec![
            process(3, 2, 30, "game.exe"),
            process(5, 3, 50, "grandchild.exe"),
            process(2, 0, 60, "reused.exe"),
            process(6, 2, 70, "other.exe"),
        ];
        let children = tracker.update(&roots, &next, &[]).unwrap();
        assert_eq!(children.len(), 2);
        assert!(children
            .iter()
            .all(|child| !child.path.contains("other") && !child.path.contains("reused")));
        assert!(tracker.update(&roots, &[], &[]).unwrap().is_empty());
    }
    #[test]
    fn disabled_and_excluded_apps_do_not_expand() {
        let snapshot = vec![
            process(1, 0, 10, "steam.exe"),
            process(2, 1, 20, "helper.exe"),
            process(3, 2, 30, "game.exe"),
        ];
        let mut root = root();
        root.include_children = false;
        assert!(Tracker::default()
            .update(&[root], &snapshot, &[])
            .unwrap()
            .is_empty());
        assert!(Tracker::default()
            .update(&[self::root()], &snapshot, &[r"C:\Apps\helper.exe".into()])
            .unwrap()
            .is_empty());
    }
    #[test]
    fn a_recycled_parent_pid_cannot_adopt_an_older_process() {
        let snapshot = vec![process(1, 0, 30, "steam.exe"), process(2, 1, 20, "old.exe")];
        assert!(Tracker::default()
            .update(&[root()], &snapshot, &[])
            .unwrap()
            .is_empty());
    }
}
