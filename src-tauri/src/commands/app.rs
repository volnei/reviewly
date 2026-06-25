use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};

/// File that records the "start in tray" preference, read in `setup` before the
/// frontend exists. A tiny flag file in the app config dir.
fn start_in_tray_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("start-in-tray"))
}

/// Whether to start hidden in the tray. Defaults to false (no file / unreadable).
pub fn should_start_in_tray(app: &AppHandle) -> bool {
    start_in_tray_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
}

/// Persist the "start in tray" preference for the next launch.
#[tauri::command]
pub fn set_start_in_tray(app: AppHandle, enabled: bool) -> AppResult<()> {
    let Some(path) = start_in_tray_path(&app) else {
        return Ok(());
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, if enabled { "1" } else { "0" })
        .map_err(|e| AppError::Other(format!("write start-in-tray: {e}")))
}

/// Register/unregister the app to launch at login (OS autostart).
#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, enabled: bool) -> AppResult<()> {
    let mgr = app.autolaunch();
    let res = if enabled { mgr.enable() } else { mgr.disable() };
    res.map_err(|e| AppError::Other(format!("autostart: {e}")))
}

/// Whether the app is currently registered to launch at login.
#[tauri::command]
pub fn get_launch_at_login(app: AppHandle) -> AppResult<bool> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| AppError::Other(format!("autostart: {e}")))
}

#[cfg(target_os = "macos")]
const ICON_WHITE: &[u8] = include_bytes!("../../icons/app-icon-white.png");
#[cfg(target_os = "macos")]
const ICON_BLACK: &[u8] = include_bytes!("../../icons/app-icon-black.png");

#[cfg(target_os = "macos")]
fn apply_app_icon(bytes: &[u8]) {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let data = NSData::with_bytes(bytes);
    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
        let app = NSApplication::sharedApplication(mtm);
        unsafe { app.setApplicationIconImage(Some(&image)) };
    }
}

/// Swap the macOS Dock icon between the white- and black-background variants.
#[tauri::command]
pub fn set_app_icon(app: AppHandle, variant: String) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        let bytes: &'static [u8] = if variant == "black" { ICON_BLACK } else { ICON_WHITE };
        let _ = app.run_on_main_thread(move || apply_app_icon(bytes));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, &variant);
    }
    Ok(())
}
