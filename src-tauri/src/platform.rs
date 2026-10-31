use crate::{config, models::RunningProcess};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub parent_pid: u32,
    pub created: u64,
    pub name: String,
    pub path: String,
}

pub fn same_executable_path(first: &Path, second: &Path) -> bool {
    fn normalized(path: &Path) -> String {
        let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_owned());
        config::normalize_process_path(&resolved.to_string_lossy())
            .trim_start_matches(r"\\?\")
            .to_lowercase()
    }
    normalized(first) == normalized(second)
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::{
        mem::{size_of, zeroed},
        ptr::null_mut,
    };
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, GetLastError, ERROR_INVALID_PARAMETER, FILETIME, HANDLE,
            INVALID_HANDLE_VALUE, WAIT_OBJECT_0,
        },
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                GetCurrentProcess, GetProcessTimes, OpenProcess, OpenProcessToken,
                QueryFullProcessImageNameW, WaitForSingleObject, PROCESS_NAME_WIN32,
                PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
            },
        },
    };

    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    fn image_path(handle: HANDLE) -> Option<PathBuf> {
        let mut buffer = vec![0_u16; 32768];
        let mut length = buffer.len() as u32;
        if unsafe {
            QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length)
        } == 0
        {
            return None;
        }
        Some(PathBuf::from(String::from_utf16_lossy(
            &buffer[..length as usize],
        )))
    }

    pub fn is_elevated() -> bool {
        let mut token = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
            return false;
        }
        let token = OwnedHandle(token);
        let mut elevation: TOKEN_ELEVATION = unsafe { zeroed() };
        let mut length = 0;
        unsafe {
            GetTokenInformation(
                token.0,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut length,
            ) != 0
                && elevation.TokenIsElevated != 0
        }
    }

    pub fn process_snapshot() -> Result<Vec<ProcessIdentity>, String> {
        // Do not pair a recycled PID with the snapshot's previous parent.
        let snapshot_started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            / 100
            + 116444736000000000_u128;
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err("Windows could not read the list of running applications.".into());
        }
        let snapshot = OwnedHandle(snapshot);
        let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
        entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
        let mut more = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
        let mut result = Vec::new();
        while more {
            let handle =
                unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID) };
            if !handle.is_null() {
                let handle = OwnedHandle(handle);
                if let Some(path) = image_path(handle.0) {
                    let path_text = path.to_string_lossy().into_owned();
                    let mut created: FILETIME = unsafe { zeroed() };
                    let mut exited: FILETIME = unsafe { zeroed() };
                    let mut kernel: FILETIME = unsafe { zeroed() };
                    let mut user: FILETIME = unsafe { zeroed() };
                    if config::validate_process_path(&path_text).is_ok()
                        && unsafe {
                            GetProcessTimes(
                                handle.0,
                                &mut created,
                                &mut exited,
                                &mut kernel,
                                &mut user,
                            )
                        } != 0
                    {
                        if let Some(name) = path
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                        {
                            let creation_time = ((created.dwHighDateTime as u64) << 32)
                                | created.dwLowDateTime as u64;
                            if u128::from(creation_time) > snapshot_started {
                                more = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
                                continue;
                            }
                            result.push(ProcessIdentity {
                                pid: entry.th32ProcessID,
                                parent_pid: entry.th32ParentProcessID,
                                created: creation_time,
                                name,
                                path: path_text,
                            });
                        }
                    }
                }
            }
            more = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
        }
        Ok(result)
    }

    pub fn list_processes(excluded_paths: &[PathBuf]) -> Result<Vec<RunningProcess>, String> {
        let mut result: Vec<RunningProcess> = process_snapshot()?
            .into_iter()
            .filter(|process| {
                !excluded_paths
                    .iter()
                    .any(|excluded| same_executable_path(Path::new(&process.path), excluded))
            })
            .map(|process| RunningProcess {
                pid: process.pid,
                name: process.name,
                path: process.path,
            })
            .collect();
        result.sort_by(|first, second| {
            first
                .name
                .to_lowercase()
                .cmp(&second.name.to_lowercase())
                .then(first.pid.cmp(&second.pid))
        });
        Ok(result)
    }

    /// Only invoked by an explicit user action. The new process waits for this instance to exit.
    #[cfg(not(test))]
    pub fn launch_elevated() -> Result<(), String> {
        use std::{os::windows::ffi::OsStrExt, ptr::null};
        use windows_sys::Win32::{
            System::Com::{
                CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            },
            UI::{
                Shell::{
                    ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
                },
                WindowsAndMessaging::SW_SHOWNORMAL,
            },
        };
        let executable =
            std::env::current_exe().map_err(|_| "Could not locate the ProxyKing executable.")?;
        let verb: Vec<u16> = "runas".encode_utf16().chain(Some(0)).collect();
        let file: Vec<u16> = executable
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let args: Vec<u16> = format!("--elevated-relaunch {}", std::process::id())
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let directory: Vec<u16> = executable
            .parent()
            .unwrap_or(Path::new("."))
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let com_initialized = unsafe {
            CoInitializeEx(
                null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            )
        } >= 0;
        let mut info: SHELLEXECUTEINFOW = unsafe { zeroed() };
        info.cbSize = size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = args.as_ptr();
        info.lpDirectory = directory.as_ptr();
        info.nShow = SW_SHOWNORMAL;
        let success = unsafe { ShellExecuteExW(&mut info) } != 0;
        if !info.hProcess.is_null() {
            unsafe {
                CloseHandle(info.hProcess);
            }
        }
        if com_initialized {
            unsafe {
                CoUninitialize();
            }
        }
        if !success {
            return Err("Administrator restart was canceled or Windows could not launch ProxyKing. You can also close ProxyKing and choose Run as administrator in Windows.".into());
        }
        Ok(())
    }

    pub fn wait_for_previous_instance(parent_pid: u32) -> Result<(), String> {
        if parent_pid == 0 || parent_pid == std::process::id() || !is_elevated() {
            return Err("Invalid administrator restart request.".into());
        }
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                parent_pid,
            )
        };
        if handle.is_null() {
            // The previous instance may already have completed its orderly exit.
            return if unsafe { GetLastError() } == ERROR_INVALID_PARAMETER {
                Ok(())
            } else {
                Err("Could not wait for the previous ProxyKing instance. Close it and start ProxyKing again.".into())
            };
        }
        let handle = OwnedHandle(handle);
        let own =
            std::env::current_exe().map_err(|_| "Could not locate the ProxyKing executable.")?;
        let parent =
            image_path(handle.0).ok_or("Could not verify the previous ProxyKing instance.")?;
        if !same_executable_path(&own, &parent) {
            return Err(
                "Administrator restart can only wait for a previous ProxyKing instance.".into(),
            );
        }
        if unsafe { WaitForSingleObject(handle.0, 30000) } != WAIT_OBJECT_0 {
            return Err("The previous ProxyKing instance did not close. Close it and start ProxyKing again.".into());
        }
        Ok(())
    }
}

#[cfg(all(windows, not(test)))]
pub use windows::launch_elevated;
#[cfg(windows)]
pub use windows::{is_elevated, list_processes, process_snapshot};

#[cfg(not(windows))]
pub fn process_snapshot() -> Result<Vec<ProcessIdentity>, String> {
    Err("Child-process tracking is currently available on Windows only.".into())
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}
#[cfg(not(windows))]
pub fn list_processes(_: &[PathBuf]) -> Result<Vec<RunningProcess>, String> {
    Err("Application selection is currently available on Windows only.".into())
}
#[cfg(all(not(windows), not(test)))]
pub fn launch_elevated() -> Result<(), String> {
    Err("Administrator restart is currently available on Windows only.".into())
}

pub fn prepare_relaunch() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) != Some("--elevated-relaunch") {
        return Ok(());
    }
    if args.len() != 2 {
        return Err("Invalid administrator restart request.".into());
    }
    let parent = args[1]
        .parse::<u32>()
        .map_err(|_| "Invalid administrator restart request.")?;
    #[cfg(windows)]
    {
        windows::wait_for_previous_instance(parent)
    }
    #[cfg(not(windows))]
    {
        let _ = parent;
        Err("Administrator restart is currently available on Windows only.".into())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn process_listing_reads_real_paths_and_can_exclude_this_application() {
        let executable = std::env::current_exe().unwrap();
        let processes = list_processes(&[]).unwrap();
        assert!(processes
            .iter()
            .any(|process| process.pid == std::process::id()
                && same_executable_path(Path::new(&process.path), &executable)));
        assert!(!list_processes(&[executable])
            .unwrap()
            .iter()
            .any(|process| process.pid == std::process::id()));
        let _elevated = is_elevated(); // Read-only token query; never prompts for elevation.
    }
}
