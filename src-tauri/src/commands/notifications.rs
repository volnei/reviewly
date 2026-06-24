use tauri::State;

use crate::clients::github::{self, Notification};
use crate::creds;
use crate::error::AppResult;
use crate::state::AppState;

/// Mirror the Settings "Desktop notifications" toggle into the poller, which
/// checks this flag before showing an OS alert for a newly-requested review.
#[tauri::command]
pub fn set_notifications_enabled(state: State<'_, AppState>, enabled: bool) {
    state
        .notify_enabled
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
}

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
