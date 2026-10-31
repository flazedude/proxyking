#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(error) = proxyking_lib::prepare_relaunch() {
        eprintln!("{error}");
        return;
    }
    proxyking_lib::run();
}
