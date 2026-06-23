use serde::Deserialize;
use tauri::State;

use crate::clients::github::{self, PullDetail, PullFile};
use crate::clients::graphql::graphql;
use crate::creds;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Names of the checks/contexts marked **required** for this PR (branch
/// protection). Uses GraphQL `isRequired(pullRequestNumber:)` so it works
/// without repo-admin access (the REST branch-protection endpoint 403s for
/// non-admins). Returns an empty list when nothing is required or unknown.
#[tauri::command]
pub async fn gh_required_contexts(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Vec<String>> {
    const Q: &str = r#"
    query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$number){
          commits(last:1){ nodes{ commit{
            statusCheckRollup{ contexts(first:100){ nodes{
              __typename
              ... on CheckRun{ name isRequired(pullRequestNumber:$number) }
              ... on StatusContext{ context isRequired(pullRequestNumber:$number) }
            }}}
          }}}
        }
      }
    }"#;

    #[derive(Deserialize)]
    struct Data {
        repository: Option<Repo>,
    }
    #[derive(Deserialize)]
    struct Repo {
        #[serde(rename = "pullRequest")]
        pull_request: Option<Pr>,
    }
    #[derive(Deserialize)]
    struct Pr {
        commits: Commits,
    }
    #[derive(Deserialize)]
    struct Commits {
        nodes: Vec<CommitNode>,
    }
    #[derive(Deserialize)]
    struct CommitNode {
        commit: Commit,
    }
    #[derive(Deserialize)]
    struct Commit {
        #[serde(rename = "statusCheckRollup")]
        rollup: Option<Rollup>,
    }
    #[derive(Deserialize)]
    struct Rollup {
        contexts: Contexts,
    }
    #[derive(Deserialize)]
    struct Contexts {
        nodes: Vec<ContextNode>,
    }
    #[derive(Deserialize)]
    struct ContextNode {
        name: Option<String>,
        context: Option<String>,
        #[serde(rename = "isRequired")]
        is_required: Option<bool>,
    }

    let token = creds::require_token()?;
    let data: Data = graphql(
        &state,
        &token,
        Q,
        serde_json::json!({ "owner": owner, "repo": repo, "number": number }),
    )
    .await?;

    let mut out: Vec<String> = Vec::new();
    if let Some(pr) = data.repository.and_then(|r| r.pull_request) {
        for node in pr.commits.nodes {
            let Some(rollup) = node.commit.rollup else {
                continue;
            };
            for c in rollup.contexts.nodes {
                if c.is_required == Some(true) {
                    if let Some(n) = c.name.or(c.context) {
                        if !out.contains(&n) {
                            out.push(n);
                        }
                    }
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn gh_get_pull(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<PullDetail> {
    let token = creds::require_token()?;
    github::get_pull(&state, &token, &owner, &repo, number).await
}

#[tauri::command]
pub async fn gh_list_pull_files(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<Vec<PullFile>> {
    let token = creds::require_token()?;
    github::list_pull_files(&state, &token, &owner, &repo, number).await
}

#[tauri::command]
pub async fn gh_list_commits(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    number: u64,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::list_commits(&state, &token, &owner, &repo, number).await
}

#[tauri::command]
pub async fn gh_list_checks(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    sha: String,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::list_checks(&state, &token, &owner, &repo, &sha).await
}

#[tauri::command]
pub async fn gh_check_annotations(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    check_run_id: u64,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::check_annotations(&state, &token, &owner, &repo, check_run_id).await
}

/// A GitHub Actions job (steps + timing) — the per-step breakdown shown when a
/// check is expanded, so the CI result shows everything that ran.
#[tauri::command]
pub async fn gh_actions_job(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    job_id: u64,
) -> AppResult<serde_json::Value> {
    let token = creds::require_token()?;
    github::actions_job(&state, &token, &owner, &repo, job_id).await
}

/// Re-run a single GitHub Actions job (the correct path for Actions checks; the
/// Checks `rerequest` endpoints 404 unless your own GitHub App created the check).
#[tauri::command]
pub async fn gh_rerun_job(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    job_id: u64,
) -> AppResult<()> {
    let token = creds::require_token()?;
    github::rerun_actions_job(&state, &token, &owner, &repo, job_id).await
}

/// Re-run only the failed jobs of an Actions run — the fallback for an Actions
/// check whose job id we couldn't parse, so we never re-run the whole suite.
#[tauri::command]
pub async fn gh_rerun_failed_jobs(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    run_id: u64,
) -> AppResult<()> {
    let token = creds::require_token()?;
    github::rerun_actions_run_failed(&state, &token, &owner, &repo, run_id).await
}

#[tauri::command]
pub async fn gh_rerun_check(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    check_run_id: u64,
) -> AppResult<()> {
    let token = creds::require_token()?;
    github::rerun_check_run(&state, &token, &owner, &repo, check_run_id).await
}

/// Fetch a file's raw content from the GitHub API as decoded UTF-8 text.
/// Powers the diff viewer's "expand context" (full-file lines between hunks).
#[tauri::command]
pub async fn gh_get_file_content(
    state: State<'_, AppState>,
    owner: String,
    repo: String,
    path: String,
    r#ref: String,
) -> AppResult<String> {
    use base64::Engine;

    let token = creds::require_token()?;
    let url = format!("https://api.github.com/repos/{owner}/{repo}/contents/{path}");
    let res = github::auth_request(&state, &token, reqwest::Method::GET, &url)
        .header("Accept", "application/vnd.github+json")
        .query(&[("ref", r#ref.as_str())])
        .send()
        .await?;
    let res = crate::clients::check(res).await?;
    let v: serde_json::Value = res.json().await?;
    let encoded = v
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .replace('\n', "");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|e| AppError::Other(format!("base64: {e}")))?;
    String::from_utf8(bytes).map_err(|e| AppError::Other(format!("utf8: {e}")))
}
