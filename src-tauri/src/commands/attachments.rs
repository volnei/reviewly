use base64::Engine;
use serde::Serialize;
use tauri::State;
use url::Url;

use crate::clients::check;
use crate::creds;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct FetchedAttachment {
    pub content_type: String,
    pub data_b64: String,
    pub size: u64,
}

/// Fetch a GitHub-hosted asset (user-attachments, raw.githubusercontent.com,
/// avatars, etc.) authenticated with the stored token, and return a
/// base64-encoded payload the UI can turn into a data URL.
///
/// Only github.com and *.githubusercontent.com hosts are allowed.
#[tauri::command]
pub async fn gh_fetch_attachment(
    state: State<'_, AppState>,
    url: String,
) -> AppResult<FetchedAttachment> {
    let parsed = Url::parse(&url).map_err(|e| AppError::Other(format!("bad url: {e}")))?;
    let host = parsed.host_str().unwrap_or("");
    let allowed = host == "github.com"
        || host.ends_with(".github.com")
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com");
    if !allowed {
        return Err(AppError::Other(format!("host not allowed: {host}")));
    }

    let token = creds::require_token()?;
    let res = state
        .http
        .get(parsed.as_str())
        .bearer_auth(&token)
        .header("Accept", "*/*")
        .send()
        .await?;
    let res = check(res).await?;
    let content_type = res
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = res.bytes().await?;
    let size = bytes.len() as u64;
    let data_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(FetchedAttachment {
        content_type,
        data_b64,
        size,
    })
}
