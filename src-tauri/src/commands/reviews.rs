use tauri::State;

use crate::clients::github::{self, DraftComment, Review, SubmitReviewInput};
use crate::creds;
use crate::error::AppResult;
use crate::state::AppState;

#[tauri::command]
pub async fn gh_list_reviews(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Vec<Review>> {
    let token = creds::require_token()?;
    github::list_reviews(&state, &token, &owner, &repo, number).await
}

#[tauri::command]
pub async fn gh_submit_review(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    body: Option<String>,
    event: String,
    comments: Vec<DraftComment>,
    commit_id: Option<String>,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    let input = SubmitReviewInput {
        body,
        event,
        comments,
        commit_id,
    };
    github::submit_review(&state, &token, &owner, &repo, number, &input).await
}
