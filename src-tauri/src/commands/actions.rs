//! Catch-all module for mutation commands that don't fit cleanly elsewhere.
//! Reactions, labels, reviewers, merging, closing, editing — anything that
//! changes PR state via the GitHub REST or GraphQL API.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::clients::check;
use crate::clients::github::{auth_request, Label, UserRef, API};
use crate::clients::graphql::graphql;
use crate::creds;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Turn GitHub's raw `enablePullRequestAutoMerge` rejections into guidance.
/// The common ones: the PR is already mergeable (`clean`/`unstable` status), so
/// there's nothing to queue behind; or the repo simply hasn't enabled auto-merge.
fn friendly_auto_merge_error(raw: &str) -> String {
    if raw.contains("unstable status") || raw.contains("clean status") {
        "GitHub won't queue auto-merge while this PR is already mergeable. \
         Use \u{201c}Merge now,\u{201d} or wait for the pending checks to finish and merge then."
            .to_string()
    } else if raw.contains("not allowed")
        || raw.contains("not enabled")
        || raw.contains("Protected branch")
    {
        "Auto-merge isn't enabled for this repository. Turn it on under \
         Settings \u{2192} General \u{2192} Allow auto-merge, or use \u{201c}Merge now.\u{201d}"
            .to_string()
    } else {
        raw.to_string()
    }
}

/* ─────────────────────── reactions ─────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reaction {
    pub id: u64,
    pub content: String,
    pub user: UserRef,
}

/// Where to attach a reaction. Drives endpoint selection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReactionTarget {
    IssueComment,
    ReviewComment,
    Review,
    Issue,
}

fn reactions_path(target: ReactionTarget, owner: &str, repo: &str, id: u64, pr: u64) -> String {
    match target {
        ReactionTarget::IssueComment => {
            format!("{API}/repos/{owner}/{repo}/issues/comments/{id}/reactions")
        }
        ReactionTarget::ReviewComment => {
            format!("{API}/repos/{owner}/{repo}/pulls/comments/{id}/reactions")
        }
        ReactionTarget::Review => {
            format!("{API}/repos/{owner}/{repo}/pulls/{pr}/reviews/{id}/reactions")
        }
        ReactionTarget::Issue => format!("{API}/repos/{owner}/{repo}/issues/{id}/reactions"),
    }
}

#[tauri::command]
pub async fn gh_list_reactions(
    state: State<'_, AppState>,
    target: ReactionTarget,
    owner: String,
    repo: String,
    id: u64,
    pr: Option<u64>,
) -> AppResult<Vec<Reaction>> {
    let token = creds::require_token()?;
    let url = reactions_path(target, &owner, &repo, id, pr.unwrap_or(0));
    let res = auth_request(&state, &token, reqwest::Method::GET, &url)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_react(
    state: State<'_, AppState>,
    target: ReactionTarget,
    owner: String,
    repo: String,
    id: u64,
    pr: Option<u64>,
    content: String,
) -> AppResult<Reaction> {
    let token = creds::require_token()?;
    let url = reactions_path(target, &owner, &repo, id, pr.unwrap_or(0));
    let res = auth_request(&state, &token, reqwest::Method::POST, &url)
        .json(&json!({ "content": content }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_unreact(
    state: State<'_, AppState>,
    target: ReactionTarget,
    owner: String,
    repo: String,
    id: u64,
    pr: Option<u64>,
    reaction_id: u64,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let url = format!(
        "{}/{}",
        reactions_path(target, &owner, &repo, id, pr.unwrap_or(0)),
        reaction_id
    );
    let res = auth_request(&state, &token, reqwest::Method::DELETE, &url)
        .send()
        .await?;
    check(res).await?;
    Ok(())
}

/* ─────────────────────── labels ─────────────────────── */

#[tauri::command]
pub async fn gh_repo_labels(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
) -> AppResult<Vec<Label>> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/labels");
    // GitHub paginates labels at 100/page; large repos (e.g. calcom/cal) have
    // hundreds, so a single page silently drops the rest — that's why labels
    // like `ready-for-e2e` went missing. Page through all of them, then sort.
    let mut out: Vec<Label> = Vec::new();
    let mut page = 1u32;
    loop {
        let page_s = page.to_string();
        let res = auth_request(&state, &token, reqwest::Method::GET, &url)
            .query(&[("per_page", "100"), ("page", page_s.as_str())])
            .send()
            .await?;
        let res = check(res).await?;
        let batch: Vec<Label> = res.json().await?;
        let n = batch.len();
        out.extend(batch);
        if n < 100 || page >= 20 {
            break;
        }
        page += 1;
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub async fn gh_set_pr_labels(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    labels: Vec<String>,
) -> AppResult<Vec<Label>> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/issues/{number}/labels");
    let res = auth_request(&state, &token, reqwest::Method::PUT, &url)
        .json(&json!({ "labels": labels }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_remove_pr_label(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    name: String,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let encoded = urlencoding::encode(&name);
    let url = format!("{API}/repos/{owner}/{repo}/issues/{number}/labels/{encoded}");
    let res = auth_request(&state, &token, reqwest::Method::DELETE, &url)
        .send()
        .await?;
    check(res).await?;
    Ok(())
}

/* ─────────────────────── reviewers ─────────────────────── */

#[tauri::command]
pub async fn gh_request_reviewers(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    reviewers: Vec<String>,
    team_reviewers: Option<Vec<String>>,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/requested_reviewers");
    let mut body = json!({ "reviewers": reviewers });
    if let Some(teams) = team_reviewers {
        body["team_reviewers"] = json!(teams);
    }
    let res = auth_request(&state, &token, reqwest::Method::POST, &url)
        .json(&body)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_remove_reviewers(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    reviewers: Vec<String>,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/requested_reviewers");
    let res = auth_request(&state, &token, reqwest::Method::DELETE, &url)
        .json(&json!({ "reviewers": reviewers }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_get_requested_reviewers(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/requested_reviewers");
    let res = auth_request(&state, &token, reqwest::Method::GET, &url)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_repo_collaborators(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
) -> AppResult<Vec<UserRef>> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/collaborators");
    let res = auth_request(&state, &token, reqwest::Method::GET, &url)
        .query(&[("per_page", "100")])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/* ─────────────────────── PR state changes ─────────────────────── */

#[tauri::command]
pub async fn gh_set_pr_state(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    open: bool,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}");
    let res = auth_request(&state, &token, reqwest::Method::PATCH, &url)
        .json(&json!({ "state": if open { "open" } else { "closed" } }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_update_pr(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    title: Option<String>,
    body: Option<String>,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}");
    let mut payload = json!({});
    if let Some(t) = title {
        payload["title"] = json!(t);
    }
    if let Some(b) = body {
        payload["body"] = json!(b);
    }
    let res = auth_request(&state, &token, reqwest::Method::PATCH, &url)
        .json(&payload)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_merge_pr(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
    method: String, // "merge" | "squash" | "rebase"
    commit_title: Option<String>,
    commit_message: Option<String>,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/merge");
    let mut payload = json!({ "merge_method": method });
    if let Some(t) = commit_title {
        payload["commit_title"] = json!(t);
    }
    if let Some(m) = commit_message {
        payload["commit_message"] = json!(m);
    }
    let res = auth_request(&state, &token, reqwest::Method::PUT, &url)
        .json(&payload)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// Queue the PR to merge automatically once required checks and reviews pass
/// (GitHub's auto-merge). Requires auto-merge to be enabled on the repo.
#[tauri::command]
pub async fn gh_enable_auto_merge(
    state: State<'_, AppState>,
    pr_node_id: String,
    method: String, // "merge" | "squash" | "rebase"
) -> AppResult<()> {
    let token = creds::require_token()?;
    let mm = match method.as_str() {
        "squash" => "SQUASH",
        "rebase" => "REBASE",
        _ => "MERGE",
    };
    let q = r#"mutation($id: ID!, $m: PullRequestMergeMethod!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $m }) {
            pullRequest { id }
        }
    }"#;
    let result: AppResult<Value> =
        graphql(&state, &token, q, json!({ "id": pr_node_id, "m": mm })).await;
    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Other(friendly_auto_merge_error(&e.to_string()))),
    }
}

/// Cancel a previously-enabled auto-merge.
#[tauri::command]
pub async fn gh_disable_auto_merge(
    state: State<'_, AppState>,
    pr_node_id: String,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let q = r#"mutation($id: ID!) {
        disablePullRequestAutoMerge(input: { pullRequestId: $id }) {
            pullRequest { id }
        }
    }"#;
    let _: Value = graphql(&state, &token, q, json!({ "id": pr_node_id })).await?;
    Ok(())
}

/// List Dependabot security alerts for a repository (open by default).
#[tauri::command]
pub async fn gh_dependabot_alerts(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    state_filter: Option<String>,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/dependabot/alerts");
    let res = auth_request(&state, &token, reqwest::Method::GET, &url)
        .query(&[
            ("state", state_filter.as_deref().unwrap_or("open")),
            ("per_page", "100"),
        ])
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// A GitHub user's public profile — backing the avatar hover mini-card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    pub html_url: String,
    pub bio: Option<String>,
    pub company: Option<String>,
    pub location: Option<String>,
    pub blog: Option<String>,
    pub twitter_username: Option<String>,
    pub hireable: Option<bool>,
    pub created_at: Option<String>,
    pub followers: u64,
    pub following: u64,
    pub public_repos: u64,
}

/// Fetch a user's public profile by login (cached by the frontend on hover).
#[tauri::command]
pub async fn gh_user(state: State<'_, AppState>, login: String) -> AppResult<UserProfile> {
    let token = creds::require_token()?;
    let url = format!("{API}/users/{login}");
    let res = auth_request(&state, &token, reqwest::Method::GET, &url)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/// List repositories the user can access (owned, collaborator, org member),
/// most-recently-pushed first — used to pick a repo for Dependabot alerts.
#[tauri::command]
pub async fn gh_list_repos(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let token = creds::require_token()?;
    let url = format!("{API}/user/repos");
    let res = auth_request(&state, &token, reqwest::Method::GET, &url)
        .query(&[
            ("per_page", "100"),
            ("sort", "pushed"),
            ("affiliation", "owner,collaborator,organization_member"),
        ])
        .send()
        .await?;
    let res = check(res).await?;
    let repos: Vec<Value> = res.json().await?;
    Ok(repos
        .into_iter()
        .filter_map(|r| r.get("full_name").and_then(|v| v.as_str()).map(String::from))
        .collect())
}

#[tauri::command]
pub async fn gh_update_branch(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/{number}/update-branch");
    let res = auth_request(&state, &token, reqwest::Method::PUT, &url)
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

/* ─────────────────────── Draft ↔ Ready (GraphQL) ─────────────────────── */

#[tauri::command]
pub async fn gh_set_draft(
    state: State<'_, AppState>,
    pr_node_id: String,
    draft: bool,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let q = if draft {
        r#"mutation($id: ID!) {
            convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { id isDraft } }
        }"#
    } else {
        r#"mutation($id: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { id isDraft } }
        }"#
    };
    let _: Value = graphql(&state, &token, q, json!({ "id": pr_node_id })).await?;
    Ok(())
}

/* ─────────────────────── Thread resolve (GraphQL) ─────────────────────── */

#[tauri::command]
pub async fn gh_resolve_thread(
    state: State<'_, AppState>,
    thread_node_id: String,
    resolve: bool,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let q = if resolve {
        r#"mutation($id: ID!) {
            resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
        }"#
    } else {
        r#"mutation($id: ID!) {
            unresolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
        }"#
    };
    let _: Value = graphql(&state, &token, q, json!({ "id": thread_node_id })).await?;
    Ok(())
}

/* ─────────────────────── Edit / delete comments ─────────────────────── */

#[tauri::command]
pub async fn gh_edit_issue_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
    body: String,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/issues/comments/{comment_id}");
    let res = auth_request(&state, &token, reqwest::Method::PATCH, &url)
        .json(&json!({ "body": body }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_delete_issue_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/issues/comments/{comment_id}");
    let res = auth_request(&state, &token, reqwest::Method::DELETE, &url)
        .send()
        .await?;
    check(res).await?;
    Ok(())
}

#[tauri::command]
pub async fn gh_edit_review_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
    body: String,
) -> AppResult<Value> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/comments/{comment_id}");
    let res = auth_request(&state, &token, reqwest::Method::PATCH, &url)
        .json(&json!({ "body": body }))
        .send()
        .await?;
    let res = check(res).await?;
    Ok(res.json().await?)
}

#[tauri::command]
pub async fn gh_delete_review_comment(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    comment_id: u64,
) -> AppResult<()> {
    let token = creds::require_token()?;
    let url = format!("{API}/repos/{owner}/{repo}/pulls/comments/{comment_id}");
    let res = auth_request(&state, &token, reqwest::Method::DELETE, &url)
        .send()
        .await?;
    check(res).await?;
    Ok(())
}

/* ─────────────────────── Mark all notifications read ─────────────────────── */

#[tauri::command]
pub async fn gh_mark_all_notifications_read(state: State<'_, AppState>) -> AppResult<()> {
    let token = creds::require_token()?;
    let url = format!("{API}/notifications");
    let res = auth_request(&state, &token, reqwest::Method::PUT, &url)
        .json(&json!({ "read": true }))
        .send()
        .await?;
    check(res).await?;
    Ok(())
}

/* ─────────────────────── PR node id (for GraphQL ops) ─────────────────────── */

#[tauri::command]
pub async fn gh_pr_node_id(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<String> {
    let token = creds::require_token()?;
    let q = r#"query($o: String!, $r: String!, $n: Int!) {
        repository(owner: $o, name: $r) { pullRequest(number: $n) { id } }
    }"#;
    #[derive(Deserialize)]
    struct R { repository: Repo }
    #[derive(Deserialize)]
    struct Repo { #[serde(rename = "pullRequest")] pr: Pr }
    #[derive(Deserialize)]
    struct Pr { id: String }
    let r: R = graphql(
        &state,
        &token,
        q,
        json!({ "o": owner, "r": repo, "n": number }),
    )
    .await?;
    Ok(r.repository.pr.id)
}

/* ─────────────────────── Review thread list with node_id ─────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewThreadGraphQL {
    pub id: String,
    pub is_resolved: bool,
    pub path: String,
    pub line: Option<u64>,
    pub original_line: Option<u64>,
    pub comment_ids: Vec<u64>,
}

/// List PR review threads with their node IDs and resolved state — needed so
/// the UI can toggle resolve via GraphQL. Maps each thread's REST comment IDs
/// back to the thread node id.
#[tauri::command]
pub async fn gh_list_review_threads(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Vec<ReviewThreadGraphQL>> {
    let token = creds::require_token()?;
    let q = r#"query($o: String!, $r: String!, $n: Int!) {
        repository(owner: $o, name: $r) {
            pullRequest(number: $n) {
                reviewThreads(first: 100) {
                    nodes {
                        id
                        isResolved
                        path
                        line
                        originalLine
                        comments(first: 100) { nodes { databaseId } }
                    }
                }
            }
        }
    }"#;
    #[derive(Deserialize)]
    struct R { repository: Repo }
    #[derive(Deserialize)]
    struct Repo { #[serde(rename = "pullRequest")] pr: Pr }
    #[derive(Deserialize)]
    struct Pr {
        #[serde(rename = "reviewThreads")]
        review_threads: Threads,
    }
    #[derive(Deserialize)]
    struct Threads { nodes: Vec<Thread> }
    #[derive(Deserialize)]
    struct Thread {
        id: String,
        #[serde(rename = "isResolved")]
        is_resolved: bool,
        path: String,
        line: Option<u64>,
        #[serde(rename = "originalLine")]
        original_line: Option<u64>,
        comments: Comments,
    }
    #[derive(Deserialize)]
    struct Comments { nodes: Vec<Comment> }
    #[derive(Deserialize)]
    struct Comment {
        #[serde(rename = "databaseId")]
        database_id: Option<u64>,
    }

    let r: R = graphql(
        &state,
        &token,
        q,
        json!({ "o": owner, "r": repo, "n": number }),
    )
    .await?;
    Ok(r.repository
        .pr
        .review_threads
        .nodes
        .into_iter()
        .map(|t| ReviewThreadGraphQL {
            id: t.id,
            is_resolved: t.is_resolved,
            path: t.path,
            line: t.line,
            original_line: t.original_line,
            comment_ids: t.comments.nodes.into_iter().filter_map(|c| c.database_id).collect(),
        })
        .collect())
}

/* ─────────────────────── GitHub activity (settings card) ─────────────────────── */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityDay {
    date: String,
    count: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    commits: u64,
    merged_prs: u64,
    days: Vec<ActivityDay>,
}

/// A year of GitHub activity for the settings card: total commit contributions,
/// total merged PRs, and a per-day merged-PR count for the heatmap. `login` is
/// the viewer's handle (the frontend already has it).
#[tauri::command]
pub async fn gh_activity(state: State<'_, AppState>, login: String) -> AppResult<Activity> {
    let token = creds::require_token()?;
    let now = chrono::Utc::now();
    let from = now - chrono::Duration::days(365);
    let from_date = from.format("%Y-%m-%d").to_string();
    let from_dt = from.to_rfc3339();
    let q = format!("is:pr is:merged author:{login} merged:>={from_date}");

    let query = r#"query($q: String!, $from: DateTime!, $after: String) {
        viewer { contributionsCollection(from: $from) { totalCommitContributions } }
        search(query: $q, type: ISSUE, first: 100, after: $after) {
            issueCount
            pageInfo { hasNextPage endCursor }
            nodes { ... on PullRequest { mergedAt } }
        }
    }"#;

    #[derive(Deserialize)]
    struct Resp {
        viewer: V,
        search: S,
    }
    #[derive(Deserialize)]
    struct V {
        #[serde(rename = "contributionsCollection")]
        cc: Cc,
    }
    #[derive(Deserialize)]
    struct Cc {
        #[serde(rename = "totalCommitContributions")]
        commits: u64,
    }
    #[derive(Deserialize)]
    struct S {
        #[serde(rename = "issueCount")]
        issue_count: u64,
        #[serde(rename = "pageInfo")]
        page_info: Pi,
        nodes: Vec<Node>,
    }
    #[derive(Deserialize)]
    struct Pi {
        #[serde(rename = "hasNextPage")]
        has_next: bool,
        #[serde(rename = "endCursor")]
        end_cursor: Option<String>,
    }
    #[derive(Deserialize)]
    struct Node {
        #[serde(rename = "mergedAt")]
        merged_at: Option<String>,
    }

    let mut commits = 0u64;
    let mut merged_prs = 0u64;
    let mut counts: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut after: Option<String> = None;
    // Page through the merged PRs (capped) so the heatmap is complete for most
    // users without unbounded requests.
    for _ in 0..6 {
        let r: Resp = graphql(
            &state,
            &token,
            query,
            json!({ "q": q, "from": from_dt, "after": after }),
        )
        .await?;
        commits = r.viewer.cc.commits;
        merged_prs = r.search.issue_count;
        for n in r.search.nodes {
            if let Some(m) = n.merged_at {
                if m.len() >= 10 {
                    *counts.entry(m[..10].to_string()).or_insert(0) += 1;
                }
            }
        }
        if !r.search.page_info.has_next {
            break;
        }
        after = r.search.page_info.end_cursor;
        if after.is_none() {
            break;
        }
    }

    let mut days: Vec<ActivityDay> = counts
        .into_iter()
        .map(|(date, count)| ActivityDay { date, count })
        .collect();
    days.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(Activity {
        commits,
        merged_prs,
        days,
    })
}
