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

/// Mirror which notification reasons (review_requested, mention, comment,
/// ci_activity, …) are allowed to raise a desktop alert.
#[tauri::command]
pub fn set_notification_reasons(state: State<'_, AppState>, reasons: Vec<String>) {
    if let Ok(mut r) = state.notify_reasons.lock() {
        *r = reasons.into_iter().collect();
    }
}

/// Mirror the desktop-poll interval (seconds), clamped to a sane range.
#[tauri::command]
pub fn set_poll_interval(state: State<'_, AppState>, secs: u64) {
    state
        .notify_poll_secs
        .store(secs.clamp(15, 3600), std::sync::atomic::Ordering::Relaxed);
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
