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
