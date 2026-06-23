use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Public GitHub OAuth Client ID for the Reviewly desktop app.
///
/// Set via `REVIEWLY_GITHUB_CLIENT_ID` at build time. The client ID is
/// public — it's safe to ship in the binary — but a Device Flow app
/// must be registered at https://github.com/settings/developers with
/// "Enable Device Flow" toggled on.
pub const GITHUB_CLIENT_ID: &str = match option_env!("REVIEWLY_GITHUB_CLIENT_ID") {
    Some(s) => s,
    // Fallback dev placeholder — will fail at runtime with a clear message
    // until the real client_id is provided.
    None => "MISSING_CLIENT_ID",
};

// `workflow` is required to re-run GitHub Actions checks (the Actions API
// rejects re-runs without it, even with repo write access).
pub const SCOPE: &str = "repo read:user notifications workflow";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceStart {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub device_code: String,
}

#[derive(Debug, Deserialize)]
struct AccessTokenResp {
    access_token: Option<String>,
    token_type: Option<String>,
    scope: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub async fn start(state: &AppState) -> AppResult<DeviceStart> {
    if GITHUB_CLIENT_ID == "MISSING_CLIENT_ID" {
        return Err(AppError::Auth(
            "REVIEWLY_GITHUB_CLIENT_ID not set at build time".into(),
        ));
    }
    let res = state
        .http
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", GITHUB_CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(AppError::Auth(format!("device code request failed: {body}")));
    }
    let code: DeviceCode = res.json().await?;
    Ok(DeviceStart {
        user_code: code.user_code,
        verification_uri: code.verification_uri,
        expires_in: code.expires_in,
        interval: code.interval,
        device_code: code.device_code,
    })
}

/// Poll the access_token endpoint until we get a token, an unrecoverable
/// error, or `max_seconds` elapses. Honors `slow_down` (increase interval).
pub async fn poll(
    state: &AppState,
    device_code: &str,
    initial_interval: u64,
    max_seconds: u64,
) -> AppResult<String> {
    let mut interval = initial_interval.max(1);
    let started = std::time::Instant::now();
    loop {
        if started.elapsed().as_secs() >= max_seconds {
            return Err(AppError::Auth("device flow timed out".into()));
        }
        tokio::time::sleep(Duration::from_secs(interval)).await;

        let res = state
            .http
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", GITHUB_CLIENT_ID),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await?;

        let parsed: AccessTokenResp = res.json().await?;
        if let Some(token) = parsed.access_token {
            tracing::info!(
                token_type = parsed.token_type.unwrap_or_default(),
                scope = parsed.scope.unwrap_or_default(),
                "device flow: got access token"
            );
            return Ok(token);
        }
        match parsed.error.as_deref() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval += 5;
                continue;
            }
            Some(other) => {
                return Err(AppError::Auth(format!(
                    "{other}: {}",
                    parsed.error_description.unwrap_or_default()
                )));
            }
            None => {
                return Err(AppError::Auth(
                    "device flow returned no token and no error".into(),
                ));
            }
        }
    }
}
