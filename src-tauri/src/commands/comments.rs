use tauri::State;

use crate::clients::github::{self, ReviewThread};
use crate::creds;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn gh_list_review_comments(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Vec<ReviewThread>> {
    let token = creds::require_token()?;
    github::list_review_comments(&state, &token, &owner, &repo, number).await
}

#[tauri::command]
pub async fn gh_list_issue_comments(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::list_issue_comments(&state, &token, &owner, &repo, number).await
}

#[tauri::command]
pub async fn gh_create_issue_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    body: String,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::create_issue_comment(&state, &token, &owner, &repo, number, &body).await
}

#[tauri::command]
pub async fn gh_reply_review_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    comment_id: u64,
    body: String,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::create_review_reply(&state, &token, &owner, &repo, number, comment_id, &body).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn gh_create_review_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    commit_id: String,
    path: String,
    line: u64,
    side: String,
    body: String,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::create_review_comment(
        &state, &token, &owner, &repo, number, &commit_id, &path, line, &side, &body,
    )
    .await
}
