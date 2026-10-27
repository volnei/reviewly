use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::auth::device::{self, DeviceStart};
use crate::clients::github;
use crate::creds;
use crate::error::{AppError, AppResult};
use crate::github_instance::GitHubInstance;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct AuthStatus {
    pub signed_in: bool,
    pub viewer: Option<github::Viewer>,
    pub host: String,
}

#[tauri::command]
pub async fn auth_status(state: State<'_, AppState>) -> AppResult<AuthStatus> {
    let Some(credentials) = creds::load_credentials()? else {
        return Ok(AuthStatus {
            signed_in: false,
            viewer: None,
            host: state.github().host,
        });
    };
    let instance = GitHubInstance::from_host(&credentials.host)?;
    state.set_github(instance.clone());
    let token = credentials.token;
    match github::viewer(&state, &token).await {
        Ok(v) => Ok(AuthStatus {
            signed_in: true,
            viewer: Some(v),
            host: instance.host,
        }),
        Err(e) => {
            tracing::warn!("viewer probe failed, clearing creds: {e}");
            // If the token is invalid (401), wipe it so the UI returns to onboarding.
            if matches!(&e, crate::error::AppError::Upstream { status: 401, .. }) {
                let _ = creds::delete_token();
            }
            Ok(AuthStatus {
                signed_in: false,
                viewer: None,
                host: instance.host,
            })
        }
    }
}

#[tauri::command]
pub async fn auth_device_start(state: State<'_, AppState>) -> AppResult<DeviceStart> {
    state.set_github(GitHubInstance::default());
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
    creds::save_token("github.com", &token)?;
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
pub async fn auth_gh_available(host: Option<String>) -> bool {
    let host = host.unwrap_or_else(|| "github.com".into());
    let Ok(output) = crate::commands::ai::cli_command("gh")
        .arg("auth")
        .arg("status")
        .arg("--hostname")
        .arg(host)
        .output()
        .await
    else {
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
    host: Option<String>,
) -> AppResult<github::Viewer> {
    let instance = GitHubInstance::from_host(host.as_deref().unwrap_or("github.com"))?;
    let output = crate::commands::ai::cli_command("gh")
        .arg("auth")
        .arg("token")
        .arg("--hostname")
        .arg(&instance.host)
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
        return Err(AppError::Auth("gh auth token returned empty output".into()));
    }
    // Verify by hitting /user first so we don't store a stale token.
    state.set_github(instance.clone());
    let viewer = github::viewer(&state, &token).await?;
    creds::save_token(&instance.host, &token)?;
    let _ = app.emit("auth:ready", &viewer);
    Ok(viewer)
}

/// Connect to GitHub Enterprise with a personal access token. The token is
/// verified against that server before it ever reaches the OS keychain.
#[tauri::command]
pub async fn auth_use_token(
    app: AppHandle,
    state: State<'_, AppState>,
    host: String,
    token: String,
) -> AppResult<github::Viewer> {
    let instance = GitHubInstance::from_host(&host)?;
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::Auth("Enter a personal access token.".into()));
    }
    state.set_github(instance.clone());
    let viewer = github::viewer(&state, token).await?;
    creds::save_token(&instance.host, token)?;
    let _ = app.emit("auth:ready", &viewer);
    Ok(viewer)
}
