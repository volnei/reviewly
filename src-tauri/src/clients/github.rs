use chrono::{DateTime, Utc};
use reqwest::Response;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::sync::Semaphore;

use crate::clients::check;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub const API: &str = "https://api.github.com";
pub const ACCEPT: &str = "application/vnd.github+json";
pub const API_VERSION: &str = "2022-11-28";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewer {
    pub login: String,
    pub avatar_url: String,
    pub name: Option<String>,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRef {
    pub login: String,
    pub avatar_url: String,
    pub html_url: String,
    pub id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoRef {
    pub full_name: String,
    pub html_url: String,
    pub default_branch: String,
    pub owner: UserRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchRef {
    #[serde(rename = "ref")]
    pub r#ref: String,
    pub sha: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: u64,
    pub name: String,
    pub color: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullSummary {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub user: UserRef,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub html_url: String,
    pub repository_url: Option<String>,
    pub pull_request: Option<Value>,
    pub repository: Option<RepoRef>,
    pub body: Option<String>,
    pub head: Option<BranchRef>,
    pub base: Option<BranchRef>,
    #[serde(default)]
    pub labels: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullDetail {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub state: String,
    pub draft: bool,
    pub user: UserRef,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub html_url: String,
    pub body: Option<String>,
    pub head: BranchRef,
    pub base: BranchRef,
    pub mergeable: Option<bool>,
    pub mergeable_state: Option<String>,
    pub merged: Option<bool>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
    pub changed_files: Option<u64>,
    pub commits: Option<u64>,
    /// The full PR object includes its labels — keep them so the detail view
    /// doesn't have to scrape them out of the (often-missing) list cache.
    #[serde(default)]
    pub labels: Vec<Value>,
    /// Present (non-null) when GitHub auto-merge is enabled for this PR.
    #[serde(default)]
    pub auto_merge: Option<AutoMerge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoMerge {
    pub merge_method: Option<String>,
    pub enabled_by: Option<UserRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PullFile {
    pub sha: Option<String>,
    pub filename: String,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub changes: u64,
    pub blob_url: Option<String>,
    pub raw_url: Option<String>,
    pub patch: Option<String>,
    pub previous_filename: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewThread {
    pub id: u64,
    pub pull_request_review_id: Option<u64>,
    pub diff_hunk: Option<String>,
    pub path: String,
    pub commit_id: String,
    pub original_commit_id: Option<String>,
    pub user: UserRef,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub html_url: String,
    pub line: Option<u64>,
    pub original_line: Option<u64>,
    pub side: Option<String>,
    pub in_reply_to_id: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Review {
    pub id: u64,
    pub user: UserRef,
    pub body: Option<String>,
    pub state: String,
    pub html_url: String,
    pub submitted_at: Option<DateTime<Utc>>,
    pub commit_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub unread: bool,
    pub reason: String,
    pub updated_at: DateTime<Utc>,
    pub last_read_at: Option<DateTime<Utc>>,
    pub subject: NotificationSubject,
    pub repository: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSubject {
    pub title: String,
    pub url: Option<String>,
    pub latest_comment_url: Option<String>,
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchPage<T> {
    pub total_count: u64,
    pub incomplete_results: bool,
    pub items: Vec<T>,
}

pub fn auth_request<'a>(
    state: &'a AppState,
    token: &str,
    method: reqwest::Method,
    url: &str,
) -> reqwest::RequestBuilder {
    state
        .http
        .request(method, url)
        .bearer_auth(token)
        .header("Accept", ACCEPT)
        .header("X-GitHub-Api-Version", API_VERSION)
}

pub async fn viewer(state: &AppState, token: &str) -> AppResult<Viewer> {
    let res = auth_request(state, token, reqwest::Method::GET, &format!("{API}/user"))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// GitHub's Search API is capped at ~30 req/min and punishes bursts with a
/// secondary (abuse) limit. We funnel every search through a small concurrency
/// gate (kills the burst) and retry on 403/429, waiting for the reset window.
static SEARCH_GATE: Semaphore = Semaphore::const_new(5);

/// Seconds to wait before retrying a rate-limited response: prefer `Retry-After`,
/// fall back to `X-RateLimit-Reset` when the remaining quota is 0.
fn rate_limit_wait(res: &Response) -> Option<u64> {
    let h = res.headers();
    if let Some(secs) = h
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
    {
        return Some(secs);
    }
    if h.get("x-ratelimit-remaining").and_then(|v| v.to_str().ok()) == Some("0") {
        if let Some(reset) = h
            .get("x-ratelimit-reset")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
        {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            return Some(reset.saturating_sub(now).saturating_add(1));
        }
    }
    None
}

/// Short TTL: just long enough to dedupe bursts + the poller/UI overlap,
/// without overriding the frontend's own (longer) staleness cadence.
const SEARCH_TTL: Duration = Duration::from_secs(60);

/// One throttled, cached, auto-retrying GET against `/search/issues`, returning
/// the parsed JSON body. Identical concurrent queries coalesce on the cache.
async fn search_get(
    state: &AppState,
    token: &str,
    params: &[(&str, &str)],
) -> AppResult<serde_json::Value> {
    let key = format!(
        "search?{}",
        params.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&")
    );
    if let Some(v) = state.cache_get(&key, SEARCH_TTL) {
        return Ok(v);
    }

    let _permit = SEARCH_GATE.acquire().await.expect("search gate");
    // Another task may have filled the cache while we waited for a permit.
    if let Some(v) = state.cache_get(&key, SEARCH_TTL) {
        return Ok(v);
    }

    let url = format!("{API}/search/issues");
    // Conditional request: a 304 returns our cached body and does NOT count
    // against the rate limit, so revalidating an expired entry is ~free.
    let etag = state.cache_etag(&key);
    let mut attempt: u32 = 0;
    loop {
        let mut req = auth_request(state, token, reqwest::Method::GET, &url).query(params);
        if let Some(tag) = &etag {
            req = req.header(reqwest::header::IF_NONE_MATCH, tag);
        }
        let res = req.send().await?;
        if res.status() == reqwest::StatusCode::NOT_MODIFIED {
            state.cache_refresh(&key);
            if let Some(v) = state.cache_value(&key) {
                return Ok(v);
            }
            // 304 but we somehow lost the body — drop the validator and retry fresh.
        }
        if res.status().is_success() {
            let new_etag = res
                .headers()
                .get(reqwest::header::ETAG)
                .and_then(|v| v.to_str().ok())
                .map(String::from);
            let v: serde_json::Value = res.json().await?;
            state.cache_put_etag(key, v.clone(), new_etag);
            return Ok(v);
        }
        let code = res.status().as_u16();
        if (code == 403 || code == 429) && attempt < 3 {
            let wait = rate_limit_wait(&res).unwrap_or(1u64 << attempt).clamp(1, 60);
            tokio::time::sleep(Duration::from_secs(wait)).await;
            attempt += 1;
            continue;
        }
        let body = res.text().await.unwrap_or_default();
        return Err(AppError::Upstream { status: code, body });
    }
}

pub async fn search_prs(state: &AppState, token: &str, query: &str) -> AppResult<Vec<PullSummary>> {
    // Paginate at 100/page so lists aren't capped at one page. GitHub Search
    // hard-caps at 1000 results; stop early when a short page comes back.
    const MAX_PAGES: u32 = 5;
    let mut out: Vec<PullSummary> = Vec::new();
    let mut page = 1u32;
    loop {
        let page_s = page.to_string();
        let v = search_get(
            state,
            token,
            &[
                ("q", query),
                ("per_page", "100"),
                ("sort", "updated"),
                ("order", "desc"),
                ("page", page_s.as_str()),
            ],
        )
        .await?;
        let parsed: SearchPage<PullSummary> =
            serde_json::from_value(v).map_err(|e| AppError::Other(format!("parse search: {e}")))?;
        let n = parsed.items.len();
        out.extend(parsed.items);
        if n < 100 || page >= MAX_PAGES {
            break;
        }
        page += 1;
    }
    Ok(out)
}

/// Total number of issues/PRs matching a search query (uses `total_count`,
/// so it's accurate beyond the 50-item page cap and cheap with `per_page=1`).
pub async fn search_count(state: &AppState, token: &str, query: &str) -> AppResult<u64> {
    let v = search_get(state, token, &[("q", query), ("per_page", "1")]).await?;
    Ok(v.get("total_count").and_then(|c| c.as_u64()).unwrap_or(0))
}

/// List a repo's open PRs as *full* PR objects. Unlike `/search/issues`
/// (which omits `head`/`base`), the pulls endpoint includes the branch refs
/// we need to reconstruct PR stacks.
pub async fn list_repo_pulls(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    pr_state: &str,       // "open" | "closed" | "all"
    since: Option<&str>,  // stop paging once items are older than this ISO `updated_at`
) -> AppResult<Vec<PullSummary>> {
    // The per-repo pulls endpoint has NO 1000-result cap (unlike Search), so we
    // can page the whole repo. Cap pages defensively at ~5000 PRs. With `since`
    // set, sorted-by-updated-desc lets us stop early once we cross the watermark.
    const MAX_PAGES: u32 = 50;
    let url = format!("{API}/repos/{owner}/{repo}/pulls");
    let repo_url = format!("{API}/repos/{owner}/{repo}");
    let mut out: Vec<PullSummary> = Vec::new();
    let mut page = 1u32;
    loop {
        let page_s = page.to_string();
        let res = auth_request(state, token, reqwest::Method::GET, &url)
            .query(&[
                ("state", pr_state),
                ("per_page", "100"),
                ("sort", "updated"),
                ("direction", "desc"),
                ("page", page_s.as_str()),
            ])
            .send()
            .await?;
        let res = check(res).await?;
        // Parse as raw JSON so we can reshape pulls-endpoint quirks before
        // deserializing into the search-shaped PullSummary.
        let raw: Vec<serde_json::Value> = res.json().await?;
        let n = raw.len();
        // Did this page reach below the watermark? (sorted desc → then we stop)
        let mut crossed = false;
        for mut item in raw {
            if let (Some(s), Some(u)) = (since, item.get("updated_at").and_then(|v| v.as_str())) {
                if u < s {
                    crossed = true;
                }
            }
            // pulls exposes `merged_at` at the top level; the UI reads
            // `pull_request.merged_at` (search shape) to tell merged from closed.
            if let Some(m) = item.get("merged_at").cloned() {
                if !m.is_null() {
                    item["pull_request"] = serde_json::json!({ "merged_at": m });
                }
            }
            // pulls omits `repository_url`; inject it so the UI maps PR → repo.
            if item.get("repository_url").map_or(true, |v| v.is_null()) {
                item["repository_url"] = serde_json::Value::String(repo_url.clone());
            }
            if let Ok(ps) = serde_json::from_value::<PullSummary>(item) {
                out.push(ps);
            }
        }
        if n < 100 || page >= MAX_PAGES || crossed {
            break;
        }
        page += 1;
    }
    Ok(out)
}

pub async fn get_pull(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<PullDetail> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn list_pull_files(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<PullFile>> {
    let mut out: Vec<PullFile> = Vec::new();
    let mut page = 1u32;
    loop {
        let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/files");
        let res = auth_request(state, token, reqwest::Method::GET, &url)
            .query(&[
                ("per_page", "100".to_string()),
                ("page", page.to_string()),
            ])
            .send()
            .await?;
        let res = check(res).await?;
        let batch: Vec<PullFile> = res.json().await?;
        let done = batch.len() < 100;
        out.extend(batch);
        if done || page >= 30 {
            break;
        }
        page += 1;
    }
    Ok(out)
}

pub async fn list_reviews(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<Review>> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/reviews");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[("per_page", "100")])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn list_review_comments(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Vec<ReviewThread>> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/comments");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[("per_page", "100")])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn list_issue_comments(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/issues/{number}/comments");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[("per_page", "100")])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubmitReviewInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub event: String,
    pub comments: Vec<DraftComment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_id: Option<String>,
}

// GitHub rejects null for these optional fields (422: "nil is not a number" /
// "nil is not a member of [LEFT, RIGHT]"), so omit them entirely when absent
// rather than serializing `None` as `null`. A single-line comment then carries
// only path/body/line/side, and a range comment adds start_line/start_side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftComment {
    pub path: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_line: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_side: Option<String>,
}

pub async fn submit_review(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    input: &SubmitReviewInput,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/reviews");
    let res = auth_request(state, token, reqwest::Method::POST, &url)
        .json(input)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn create_issue_comment(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    body: &str,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/issues/{number}/comments");
    let res = auth_request(state, token, reqwest::Method::POST, &url)
        .json(&serde_json::json!({ "body": body }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn create_review_reply(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    comment_id: u64,
    body: &str,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies");
    let res = auth_request(state, token, reqwest::Method::POST, &url)
        .json(&serde_json::json!({ "body": body }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// Post a single inline review comment on a changed line. Uses the dedicated
/// pulls-comments endpoint (NOT a COMMENT review, which GitHub rejects without
/// a body), so a standalone "post this suggestion" works.
#[allow(clippy::too_many_arguments)]
pub async fn create_review_comment(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
    commit_id: &str,
    path: &str,
    line: u64,
    side: &str,
    body: &str,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/comments");
    let res = auth_request(state, token, reqwest::Method::POST, &url)
        .json(&serde_json::json!({
            "body": body,
            "commit_id": commit_id,
            "path": path,
            "line": line,
            "side": side,
        }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn list_notifications(
    state: &AppState,
    token: &str,
    all: bool,
) -> AppResult<Vec<Notification>> {
    let url = format!("{API}/notifications");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[
            ("all", all.to_string()),
            ("per_page", "50".to_string()),
        ])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn mark_notification_read(state: &AppState, token: &str, id: &str) -> AppResult<()> {
    let url = format!("{API}/notifications/threads/{id}");
    let res = auth_request(state, token, reqwest::Method::PATCH, &url)
        .send()
        .await?;
    check(res).await?;
    Ok(())
}

pub async fn list_commits(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    number: u64,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/commits");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[("per_page", "100")])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

pub async fn list_checks(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    sha: &str,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/commits/{sha}/check-runs");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[("per_page", "100"), ("filter", "latest")])
        .send()
        .await?;
    let res = check(res).await?;
    let mut body: Value = res.json().await?;
    dedupe_latest_check_runs(&mut body);
    Ok(body)
}

/// Keep only the most-recent run per check name. The check-runs endpoint can
/// return a stale failed run alongside a newer passing re-run for the same name;
/// without this, a check that failed once and later passed still reads as
/// failing. We pick the latest by `started_at` (ISO, lexicographically sortable),
/// tie-broken by the higher `id` (newer run).
fn dedupe_latest_check_runs(body: &mut Value) {
    use std::collections::HashMap;
    let Some(runs) = body.get("check_runs").and_then(|v| v.as_array()) else {
        return;
    };
    let started = |v: &Value| {
        v.get("started_at")
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string()
    };
    let id = |v: &Value| v.get("id").and_then(|s| s.as_u64()).unwrap_or(0);
    let mut latest: HashMap<String, Value> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for run in runs {
        let name = run
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        match latest.get(&name) {
            None => {
                order.push(name.clone());
                latest.insert(name, run.clone());
            }
            Some(prev) => {
                let newer = match (started(run), started(prev)) {
                    (a, b) if a != b => a > b,
                    _ => id(run) > id(prev),
                };
                if newer {
                    latest.insert(name, run.clone());
                }
            }
        }
    }
    let deduped: Vec<Value> = order.into_iter().filter_map(|k| latest.remove(&k)).collect();
    body["total_count"] = Value::from(deduped.len());
    body["check_runs"] = Value::Array(deduped);
}

/// Structured failure annotations for a check run (file, line, message) —
/// the "what failed" details GitHub shows inline.
pub async fn check_annotations(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    check_run_id: u64,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/check-runs/{check_run_id}/annotations");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .query(&[("per_page", "50")])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// A GitHub Actions job with its per-step breakdown (name, status, conclusion,
/// timing) — the "what actually ran" that the check-run output doesn't carry.
pub async fn actions_job(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    job_id: u64,
) -> AppResult<Value> {
    let url = format!("{API}/repos/{owner}/{repo}/actions/jobs/{job_id}");
    let res = auth_request(state, token, reqwest::Method::GET, &url)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// POST to an Actions rerun endpoint and map the common failures to friendly
/// text (shared by the job- and run-level rerun paths).
async fn post_actions_rerun(state: &AppState, token: &str, url: &str) -> AppResult<()> {
    let res = auth_request(state, token, reqwest::Method::POST, url)
        .send()
        .await?;
    let status = res.status();
    if status.is_success() {
        return Ok(());
    }
    let body = res.text().await.unwrap_or_default();
    // Surface GitHub's own `message` rather than a guess.
    let gh: String = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(140).collect());
    let said = if gh.is_empty() {
        String::new()
    } else {
        format!(" GitHub said: “{gh}”.")
    };
    let msg = match status.as_u16() {
        // A 403 on an Actions endpoint is almost always a missing `workflow` token
        // scope — not a repo-permission problem — so point the user at the fix.
        401 | 403 => format!(
            "Couldn't re-run — your sign-in is likely missing the `workflow` permission. Sign out and back in (Settings) to grant it, or in dev run `gh auth refresh -s workflow`.{said}"
        ),
        404 => "GitHub can't re-run this — it may be too old or part of an outdated run."
            .to_string(),
        _ => format!("GitHub returned {status}.{said}"),
    };
    Err(AppError::Other(msg))
}

/// Re-run a single GitHub Actions job via the Actions API
/// (`/actions/jobs/{job_id}/rerun`). This is the correct path for Actions checks
/// — the Checks `rerequest` endpoints only work for checks created by a GitHub
/// App you own, so they 404 for everything else. Re-runs only this job (and the
/// jobs that depend on it), never the whole run.
pub async fn rerun_actions_job(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    job_id: u64,
) -> AppResult<()> {
    let url = format!("{API}/repos/{owner}/{repo}/actions/jobs/{job_id}/rerun");
    post_actions_rerun(state, token, &url).await
}

/// Re-run only the FAILED jobs of an Actions workflow run
/// (`/actions/runs/{run_id}/rerun-failed-jobs`). The fallback for an Actions
/// check whose job id we couldn't parse — re-runs the failures of that one run,
/// never every check in the suite.
pub async fn rerun_actions_run_failed(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    run_id: u64,
) -> AppResult<()> {
    let url = format!("{API}/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs");
    post_actions_rerun(state, token, &url).await
}

/// Ask GitHub to re-run a single check via `/check-runs/{id}/rerequest`. Only
/// works for checks created by a GitHub App (third-party status checks). We
/// deliberately do NOT fall back to re-running the parent check-suite — that
/// re-runs every check in the suite, not the one the user picked.
pub async fn rerun_check_run(
    state: &AppState,
    token: &str,
    owner: &str,
    repo: &str,
    check_run_id: u64,
) -> AppResult<()> {
    let url = format!("{API}/repos/{owner}/{repo}/check-runs/{check_run_id}/rerequest");
    let res = auth_request(state, token, reqwest::Method::POST, &url)
        .send()
        .await?;
    if res.status().is_success() {
        return Ok(());
    }
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    Err(AppError::Upstream {
        status: status.as_u16(),
        body,
    })
}
