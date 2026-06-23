use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::process::Command;

use crate::auth::device::{self, DeviceStart};
use crate::clients::github;
use crate::creds;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub signed_in: bool,
    pub viewer: Option<github::Viewer>,
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> AppResult<AuthStatus> {
    let Some(token) = creds::load_token()? else {
        return Ok(AuthStatus { signed_in: false, viewer: None });
    };
    match github::viewer(&state, &token).await {
        Ok(v) => Ok(AuthStatus { signed_in: true, viewer: Some(v) }),
        Err(e) => {
            tracing::warn!("viewer probe failed, clearing creds: {e}");
            // If the token is invalid (401), wipe it so the UI returns to onboarding.
            if matches!(&e, crate::error::AppError::Upstream { status: 401, .. }) {
                let _ = creds::delete_token();
            }
            Ok(AuthStatus { signed_in: false, viewer: None })
        }
    }
}

#[tauri::command]
pub async fn auth_device_start(state: State<'_, AppState>) -> AppResult<DeviceStart> {
    device::start(&state).await
}

#[tauri::command]
pub async fn auth_device_poll(
    app: AppHandle,
    state: State<'_, AppState>,
    device_code: String,
    interval: u64,
) -> AppResult<github::Viewer> {
    let token = device::poll(&state, &device_code, interval, 900).await?;
    creds::save_token(&token)?;
    let viewer = github::viewer(&state, &token).await?;
    let _ = app.emit("auth:ready", &viewer);
    Ok(viewer)
}

#[tauri::command]
pub fn auth_sign_out(app: AppHandle) -> AppResult<()> {
    creds::delete_token()?;
    let _ = app.emit("auth:signed_out", ());
    Ok(())
}

/// Whether the local `gh` CLI is installed and authenticated.
#[tauri::command]
pub async fn auth_gh_available() -> bool {
    let Ok(output) = Command::new("gh").arg("auth").arg("status").output().await else {
        return false;
    };
    output.status.success()
}

/// Read the token from `gh auth token`, verify it works against GitHub, and
/// stash it in the keychain. Returns the viewer profile on success.
#[tauri::command]
pub async fn auth_use_gh_cli(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<github::Viewer> {
    let output = Command::new("gh")
        .arg("auth")
        .arg("token")
        .output()
        .await
        .map_err(|e| AppError::Auth(format!("failed to spawn gh: {e}")))?;
    if !output.status.success() {
        return Err(AppError::Auth(format!(
            "gh auth token exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err(AppError::Auth(
            "gh auth token returned empty output".into(),
        ));
    }
    // Verify by hitting /user first so we don't store a stale token.
    let viewer = github::viewer(&state, &token).await?;
    creds::save_token(&token)?;
    let _ = app.emit("auth:ready", &viewer);
    Ok(viewer)
}
