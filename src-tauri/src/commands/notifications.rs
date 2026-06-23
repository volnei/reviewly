use tauri::State;

use crate::clients::github::{self, Notification};
use crate::creds;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn gh_list_notifications(
    state: State<'_, AppState>,
    all: Option<bool>,
) -> AppResult<Vec<Notification>> {
    let token = creds::require_token()?;
    github::list_notifications(&state, &token, all.unwrap_or(false)).await
}

#[tauri::command]
pub async fn gh_mark_notification_read(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let token = creds::require_token()?;
    github::mark_notification_read(&state, &token, &id).await
}
