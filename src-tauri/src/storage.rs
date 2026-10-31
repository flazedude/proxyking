use serde::{de::DeserializeOwned, Serialize};
use std::{fs, io::Write, path::Path};

pub fn read_encrypted<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let encrypted = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read protected application data.".into()),
    };
    if encrypted.len() > 40 * 1024 * 1024 {
        return Err("Protected application data is too large.".into());
    }
    let plaintext = unprotect(&encrypted)?;
    serde_json::from_slice(&plaintext)
        .map(Some)
        .map_err(|_| "Protected application data is damaged.".into())
}

pub fn write_encrypted<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let plaintext = serde_json::to_vec(value).map_err(|_| "Could not encode application data.")?;
    let encrypted = protect(&plaintext)?;
    let parent = path.parent().ok_or("Invalid application data directory.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not create application data directory.")?;
    let temporary = path.with_extension("tmp");
    let mut file =
        fs::File::create(&temporary).map_err(|_| "Could not save protected application data.")?;
    file.write_all(&encrypted)
        .and_then(|_| file.sync_all())
        .map_err(|_| "Could not save protected application data.")?;
    drop(file);
    atomic_replace(&temporary, path)
}

#[cfg(windows)]
pub(crate) fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        Err("Could not commit protected application data.".into())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(crate) fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|_| "Could not commit protected application data.".into())
}

#[cfg(windows)]
fn crypt(input: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let data = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };
    let ok = unsafe {
        if encrypt {
            CryptProtectData(
                &data,
                null(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &data,
                null_mut(),
                null(),
                null(),
                null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err("Windows could not protect or unlock this user's saved data.".into());
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(bytes)
}

#[cfg(windows)]
fn protect(input: &[u8]) -> Result<Vec<u8>, String> {
    crypt(input, true)
}
#[cfg(windows)]
fn unprotect(input: &[u8]) -> Result<Vec<u8>, String> {
    crypt(input, false)
}
#[cfg(not(windows))]
fn protect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure profile storage is currently available on Windows only.".into())
}
#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure profile storage is currently available on Windows only.".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn dpapi_round_trip_does_not_store_credentials_in_plaintext() {
        let secret = b"proxyking-test-password-which-must-stay-encrypted";
        let encrypted = protect(secret).unwrap();
        assert!(!encrypted
            .windows(secret.len())
            .any(|window| window == secret));
        assert_eq!(unprotect(&encrypted).unwrap(), secret);
        assert!(unprotect(b"invalid encrypted state").is_err());
    }
}
