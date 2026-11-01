use std::path::Path;

#[cfg(windows)]
pub fn executable_icon(path: &Path) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        mem::{size_of, zeroed},
        ptr::null_mut,
    };
    use windows_sys::Win32::{
        Graphics::Gdi::*,
        UI::{Shell::*, WindowsAndMessaging::*},
    };
    let path: Vec<u16> = path.to_string_lossy().encode_utf16().chain([0]).collect();
    unsafe {
        let mut info: SHFILEINFOW = zeroed();
        if SHGetFileInfoW(
            path.as_ptr(),
            0,
            &mut info,
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        ) == 0
            || info.hIcon.is_null()
        {
            return None;
        }
        let dc = CreateCompatibleDC(null_mut());
        if dc.is_null() {
            DestroyIcon(info.hIcon);
            return None;
        }
        let mut bitmap: BITMAPINFO = zeroed();
        bitmap.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        bitmap.bmiHeader.biWidth = 64;
        bitmap.bmiHeader.biHeight = -64;
        bitmap.bmiHeader.biPlanes = 1;
        bitmap.bmiHeader.biBitCount = 32;
        bitmap.bmiHeader.biCompression = BI_RGB;
        let mut pixels = null_mut();
        let dib = CreateDIBSection(dc, &bitmap, DIB_RGB_COLORS, &mut pixels, null_mut(), 0);
        if dib.is_null() {
            DeleteDC(dc);
            DestroyIcon(info.hIcon);
            return None;
        }
        let previous = SelectObject(dc, dib);
        std::ptr::write_bytes(pixels.cast::<u8>(), 20, 64 * 64 * 4);
        let result = DrawIconEx(dc, 0, 0, info.hIcon, 64, 64, 0, null_mut(), DI_NORMAL);
        let mut bytes = Vec::with_capacity(54 + 64 * 64 * 4);
        if result != 0 {
            bytes.extend_from_slice(b"BM");
            bytes.extend_from_slice(&(54u32 + 64 * 64 * 4).to_le_bytes());
            bytes.extend_from_slice(&[0; 4]);
            bytes.extend_from_slice(&54u32.to_le_bytes());
            bytes.extend_from_slice(&40u32.to_le_bytes());
            bytes.extend_from_slice(&64i32.to_le_bytes());
            bytes.extend_from_slice(&(-64i32).to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&32u16.to_le_bytes());
            bytes.extend_from_slice(&[0; 24]);
            bytes.extend_from_slice(std::slice::from_raw_parts(pixels.cast::<u8>(), 64 * 64 * 4));
        }
        SelectObject(dc, previous);
        DeleteObject(dib);
        DeleteDC(dc);
        DestroyIcon(info.hIcon);
        (result != 0).then(|| format!("data:image/bmp;base64,{}", STANDARD.encode(bytes)))
    }
}

#[cfg(not(windows))]
pub fn executable_icon(_: &Path) -> Option<String> {
    None
}
