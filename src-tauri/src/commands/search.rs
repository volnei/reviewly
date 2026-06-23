use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::clients::github::{self, PullSummary};
use crate::clients::graphql::graphql;
use crate::creds;
use crate::error::AppResult;
use crate::state::AppState;

/// "For me" — PRs where the current user is review-requested.
///
/// The dashboard wants the open review queue (`include_closed=false,
/// include_drafts=false`); the PR-list page wants every state so its State
/// filter has real content (`include_closed=true, include_drafts=true`).
#[tauri::command]
pub async fn gh_review_requested(
    state: State<'_, AppState>,
    include_drafts: bool,
    include_closed: bool,
) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    let mut q = String::from("is:pr review-requested:@me archived:false");
    if !include_closed {
        q.push_str(" is:open");
    }
    if !include_drafts {
        q.push_str(" -is:draft");
    }
    github::search_prs(&state, &token, &q).await
}

/// "Created" — PRs the current user opened.
#[tauri::command]
pub async fn gh_created(
    state: State<'_, AppState>,
    include_closed: bool,
) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    let scope = if include_closed { "" } else { " is:open" };
    let q = format!("is:pr author:@me archived:false{scope}");
    github::search_prs(&state, &token, &q).await
}

/// "Involves me" — for the dashboard mentions feed.
#[tauri::command]
pub async fn gh_involves(state: State<'_, AppState>) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    let q = "is:pr is:open involves:@me -author:@me archived:false";
    github::search_prs(&state, &token, q).await
}

/// Free-form search box ("jump to PR" / palette).
#[tauri::command]
pub async fn gh_search(state: State<'_, AppState>, query: String) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    github::search_prs(&state, &token, &query).await
}

/// Count of PRs matching a query (accurate `total_count`, for dashboard widgets).
#[tauri::command]
pub async fn gh_search_count(state: State<'_, AppState>, query: String) -> AppResult<u64> {
    let token = creds::require_token()?;
    github::search_count(&state, &token, &query).await
}

/// CI rollup state per review-requested PR (one GraphQL call), so the PR list
/// can flag failing/pending checks without a REST call per row.
#[derive(Serialize)]
pub struct CiStatus {
    pub number: u64,
    pub state: String,
}

#[derive(Deserialize)]
struct CiData {
    search: CiSearch,
}
#[derive(Deserialize)]
struct CiSearch {
    nodes: Vec<CiNode>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct CiNode {
    number: u64,
    commits: Option<StatsCommits>,
}

#[tauri::command]
pub async fn gh_pr_ci(state: State<'_, AppState>, query: String) -> AppResult<Vec<CiStatus>> {
    let token = creds::require_token()?;
    const GQL: &str = "query($q:String!){ search(query:$q, type:ISSUE, first:100){ nodes{ ... on PullRequest { number commits(last:1){ nodes{ commit{ statusCheckRollup{ state } } } } } } } }";
    let data: CiData = graphql(&state, &token, GQL, serde_json::json!({ "q": query })).await?;
    let out = data
        .search
        .nodes
        .into_iter()
        .filter(|n| n.number > 0)
        .map(|n| {
            let raw = n
                .commits
                .and_then(|c| c.nodes.into_iter().next())
                .and_then(|cn| cn.commit.rollup)
                .map(|r| r.state);
            let state = match raw.as_deref() {
                Some("SUCCESS") => "success",
                Some("FAILURE") | Some("ERROR") => "failure",
                Some("PENDING") | Some("EXPECTED") => "pending",
                _ => "none",
            };
            CiStatus { number: n.number, state: state.to_string() }
        })
        .collect();
    Ok(out)
}

/// Everything the dashboard needs in ONE GraphQL call (GraphQL has a separate,
/// generous rate limit — off the strict 30/min Search budget): the awaiting /
/// mentions / open counts, the review+CI+age breakdown of your open PRs, and
/// the raw opened/merged/closed event dates over the last ~12 months. The
/// chart buckets the dates client-side, so changing the period costs no request.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub review_requested: u64,
    pub mentions: u64,
    pub opened: u64,
    pub approved: u64,
    pub changes_requested: u64,
    pub awaiting_review: u64,
    pub draft: u64,
    pub ci_pass: u64,
    pub ci_fail: u64,
    pub ci_pending: u64,
    pub stale: u64,
    /// Your open PRs, enriched with review decision + CI, so the inbox can list
    /// them by action (ready to merge / needs attention / awaiting / draft).
    pub mine: Vec<MinePr>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinePr {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub repo: String,
    pub author: String,
    pub avatar: String,
    pub is_draft: bool,
    /// "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null.
    pub review_decision: Option<String>,
    /// "success" | "failure" | "pending" | "none".
    pub ci: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
struct DashData {
    mine: MineSearch,
    rr: CountSearch,
    men: CountSearch,
}
#[derive(Deserialize)]
struct MineSearch {
    #[serde(rename = "issueCount")]
    issue_count: u64,
    nodes: Vec<StatsNode>,
}
#[derive(Deserialize)]
struct CountSearch {
    #[serde(rename = "issueCount")]
    issue_count: u64,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct StatsNode {
    #[serde(rename = "databaseId")]
    database_id: Option<u64>,
    number: Option<u64>,
    title: Option<String>,
    url: Option<String>,
    #[serde(rename = "isDraft")]
    is_draft: bool,
    #[serde(rename = "reviewDecision")]
    review_decision: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
    author: Option<GqlAuthor>,
    repository: Option<GqlRepo>,
    commits: Option<StatsCommits>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct GqlAuthor {
    login: Option<String>,
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
}
#[derive(Deserialize, Default)]
#[serde(default)]
struct GqlRepo {
    #[serde(rename = "nameWithOwner")]
    name_with_owner: Option<String>,
}
#[derive(Deserialize)]
struct StatsCommits {
    nodes: Vec<StatsCommitNode>,
}
#[derive(Deserialize)]
struct StatsCommitNode {
    commit: StatsCommit,
}
#[derive(Deserialize)]
struct StatsCommit {
    #[serde(rename = "statusCheckRollup")]
    rollup: Option<StatsRollup>,
}
#[derive(Deserialize)]
struct StatsRollup {
    state: String,
}

#[tauri::command]
pub async fn gh_dashboard(state: State<'_, AppState>, repo_qualifier: String) -> AppResult<Dashboard> {
    let token = creds::require_token()?;
    let q = repo_qualifier.trim();
    let prefix = if q.is_empty() { String::new() } else { format!("{q} ") };
    let mine = format!("{prefix}is:pr is:open author:@me archived:false");
    let rr = format!("{prefix}is:pr is:open review-requested:@me archived:false -is:draft");
    let men = format!("{prefix}is:pr is:open involves:@me -author:@me archived:false");

    let gql = format!(
        "query($mine:String!,$rr:String!,$men:String!){{ mine: search(query:$mine,type:ISSUE,first:100){{ issueCount nodes{{ ... on PullRequest {{ databaseId number title url isDraft reviewDecision createdAt updatedAt author{{ login avatarUrl }} repository{{ nameWithOwner }} commits(last:1){{ nodes{{ commit{{ statusCheckRollup{{ state }} }} }} }} }} }} }} rr: search(query:$rr,type:ISSUE){{ issueCount }} men: search(query:$men,type:ISSUE){{ issueCount }} }}"
    );
    let data: DashData = graphql(
        &state,
        &token,
        &gql,
        serde_json::json!({ "mine": mine, "rr": rr, "men": men }),
    )
    .await?;

    let now = Utc::now();
    let week = chrono::Duration::days(7);
    let mut d = Dashboard {
        review_requested: data.rr.issue_count,
        mentions: data.men.issue_count,
        opened: data.mine.issue_count,
        approved: 0,
        changes_requested: 0,
        awaiting_review: 0,
        draft: 0,
        ci_pass: 0,
        ci_fail: 0,
        ci_pending: 0,
        stale: 0,
        mine: Vec::new(),
    };
    for n in data.mine.nodes {
        let ci = match n
            .commits
            .as_ref()
            .and_then(|c| c.nodes.first())
            .and_then(|cn| cn.commit.rollup.as_ref())
            .map(|r| r.state.as_str())
        {
            Some("SUCCESS") => "success",
            Some("FAILURE") | Some("ERROR") => "failure",
            Some("PENDING") | Some("EXPECTED") => "pending",
            _ => "none",
        };
        if n.is_draft {
            d.draft += 1;
        } else {
            match n.review_decision.as_deref() {
                Some("APPROVED") => d.approved += 1,
                Some("CHANGES_REQUESTED") => d.changes_requested += 1,
                _ => d.awaiting_review += 1,
            }
        }
        match ci {
            "success" => d.ci_pass += 1,
            "failure" => d.ci_fail += 1,
            "pending" => d.ci_pending += 1,
            _ => {}
        }
        if let Some(u) = n.updated_at.as_deref() {
            if let Ok(dt) = DateTime::parse_from_rfc3339(u) {
                if now.signed_duration_since(dt.with_timezone(&Utc)) > week {
                    d.stale += 1;
                }
            }
        }
        let (author, avatar) = match n.author {
            Some(a) => (a.login.unwrap_or_default(), a.avatar_url.unwrap_or_default()),
            None => (String::new(), String::new()),
        };
        if let Some(id) = n.database_id {
            d.mine.push(MinePr {
                id,
                number: n.number.unwrap_or(0),
                title: n.title.unwrap_or_default(),
                url: n.url.unwrap_or_default(),
                repo: n.repository.and_then(|r| r.name_with_owner).unwrap_or_default(),
                author,
                avatar,
                is_draft: n.is_draft,
                review_decision: n.review_decision,
                ci: ci.to_string(),
                created_at: n.created_at,
                updated_at: n.updated_at,
            });
        }
    }
    Ok(d)
}

/// The UI pushes its watched `owner/repo` list here so the background poller can
/// delta-watch those repos and emit `repos:changed` when any of them moves. This
/// keeps the local DB fresh event-driven, not just on focus/interval.
#[tauri::command]
pub fn set_watched_repos(state: State<'_, AppState>, repos: Vec<String>) {
    if let Ok(mut w) = state.watched_repos.write() {
        *w = repos;
    }
}

/// All open PRs in a repo, with `head`/`base` refs — used to build PR stacks.
#[tauri::command]
pub async fn gh_list_repo_pulls(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    github::list_repo_pulls(&state, &token, &owner, &repo, "open", None).await
}

/// Incremental delta for the local-first sync: PRs updated since `since` (ISO),
/// state "open" or "all". Stops paging once it crosses the watermark.
#[tauri::command]
pub async fn gh_list_repo_pulls_delta(
    state: State<'_, AppState>,
    repo: String,
    pr_state: Option<String>,
    since: Option<String>,
) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    let st = pr_state.as_deref().unwrap_or("all");
    let (owner, name) = repo.split_once('/').ok_or_else(|| {
        crate::error::AppError::Other(format!("invalid repo '{repo}' (want owner/name)"))
    })?;
    github::list_repo_pulls(&state, &token, owner, name, st, since.as_deref()).await
}

/// Every PR across the given `owner/repo` list, fully paginated per repo. This
/// is the "complete queue" source for watched repos — the per-repo pulls
/// endpoint has no 1000-result cap, so it returns everything (unlike Search).
/// `pr_state` is "open" (default, fast) or "all" (adds merged/closed, heavier).
#[tauri::command]
pub async fn gh_list_repos_open_prs(
    state: State<'_, AppState>,
    repos: Vec<String>,
    pr_state: Option<String>,
) -> AppResult<Vec<PullSummary>> {
    let token = creds::require_token()?;
    let st = pr_state.as_deref().unwrap_or("open");
    let mut out: Vec<PullSummary> = Vec::new();
    for full in &repos {
        if let Some((owner, repo)) = full.split_once('/') {
            // A single broken/inaccessible repo shouldn't sink the whole list.
            if let Ok(mut v) = github::list_repo_pulls(&state, &token, owner, repo, st, None).await {
                out.append(&mut v);
            }
        }
    }
    Ok(out)
}
