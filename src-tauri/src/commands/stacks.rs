//! GitHub's native stacked pull requests (public preview, API version
//! 2026-03-10): the stack a PR belongs to, and the asynchronous merge that
//! stacked PRs require. Kept apart from the rest because these endpoints need
//! the newer API version header, which would change other responses if set
//! globally.

use serde_json::{json, Value};
use tauri::State;

use crate::clients::github::API;
use crate::creds;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const API_VERSION: &str = "2026-03-10";

fn req(
    state: &AppState,
    token: &str,
    method: reqwest::Method,
    url: &str,
) -> reqwest::RequestBuilder {
    state
        .http
        .request(method, url)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .header("User-Agent", "reviewly")
}

async fn ok(res: reqwest::Response) -> AppResult<reqwest::Response> {
    let status = res.status();
    if status.is_success() {
        return Ok(res);
    }
    let body = res.text().await.unwrap_or_default();
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(String::from))
        .unwrap_or(body);
    Err(AppError::Other(format!("GitHub {status}: {message}")))
}

/// The stack containing this pull request, or `null` when it isn't in one.
/// Two calls: the list filtered by PR number gives the stack's number, the
/// stack itself gives every layer in order.
#[tauri::command]
pub async fn gh_pr_stack(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Option<Value>> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/stacks");
    let res = req(&state, &token, reqwest::Method::GET, &url)
        .query(&[("pull_request", number.to_string())])
        .send()
        .await?;
    // 404 means the repository has no stacks feature yet; that is "not stacked".
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let list: Vec<Value> = ok(res).await?.json().await?;
    let Some(stack_number) = list
        .first()
        .and_then(|s| s.get("number"))
        .and_then(Value::as_u64)
    else {
        return Ok(None);
    };
    let url = format!("{API}/repos/{owner}/{repo}/stacks/{stack_number}");
    let res = req(&state, &token, reqwest::Method::GET, &url)
        .send()
        .await?;
    Ok(Some(ok(res).await?.json().await?))
}

/// Merge in the background: the only way a stacked PR merges. Returns the
/// raw response; the id to poll is in it.
#[tauri::command]
pub async fn gh_merge_async(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    method: String,
    commit_title: Option<String>,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/merge-async");
    let mut payload = json!({ "merge_method": method });
    if let Some(t) = commit_title {
        payload["commit_title"] = json!(t);
    }
    let res = req(&state, &token, reqwest::Method::PUT, &url)
        .json(&payload)
        .send()
        .await?;
    let res = ok(res).await?;
    let text = res.text().await?;
    Ok(serde_json::from_str(&text).unwrap_or(Value::Null))
}

/// Where an asynchronous merge got to: pending, enqueued, merged, failed.
#[tauri::command]
pub async fn gh_merge_async_status(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    id: String,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/merge-async/{id}");
    let res = req(&state, &token, reqwest::Method::GET, &url)
        .send()
        .await?;
    Ok(ok(res).await?.json().await?)
}

/// Every stack in a repository, open or not, so a list can mark the pull
/// requests that are layers of one. A few pages at most; stacks are rare.
#[tauri::command]
pub async fn gh_repo_stacks(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
) -> AppResult<Vec<Value>> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/stacks");
    let mut out: Vec<Value> = Vec::new();
    for page in 1..=5u32 {
        let res = req(&state, &token, reqwest::Method::GET, &url)
            .query(&[("per_page", "100"), ("page", &page.to_string())])
            .send()
            .await?;
        // 404: the repository has no stacks feature; that is "no stacks".
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            break;
        }
        let batch: Vec<Value> = ok(res).await?.json().await?;
        let n = batch.len();
        out.extend(batch);
        if n < 100 {
            break;
        }
    }
    Ok(out)
}
