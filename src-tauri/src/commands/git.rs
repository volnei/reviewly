use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio::process::Command;

const GIT_TIMEOUT: Duration = Duration::from_secs(20);
const GIT_NET_TIMEOUT: Duration = Duration::from_secs(180);

/// Run `git -C <path> <args...>` with a timeout and return trimmed stdout.
/// Shells out to the system `git` (same approach as the AI CLIs) — no extra
/// plugin/capability.
async fn run_git(path: &str, args: &[&str], timeout: Duration) -> AppResult<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(path);
    for a in args {
        cmd.arg(a);
    }
    let out = tokio::time::timeout(timeout, cmd.output())
        .await
        .map_err(|_| AppError::Other("git timed out".into()))?
        .map_err(|e| AppError::Other(format!("failed to spawn git: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Other(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// `git` with the standard (short) timeout, for local operations.
async fn git(path: &str, args: &[&str]) -> AppResult<String> {
    run_git(path, args, GIT_TIMEOUT).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub remote_url: Option<String>,
    pub current_branch: String,
    pub dirty: bool,
}

/// Inspect a local git work tree: origin remote, current branch, dirty flag.
/// Errors if `path` is not inside a git repository.
#[tauri::command]
pub async fn git_repo_info(path: String) -> AppResult<RepoInfo> {
    git(&path, &["rev-parse", "--is-inside-work-tree"]).await?;
    let remote_url = git(&path, &["remote", "get-url", "origin"]).await.ok();
    let current_branch = git(&path, &["branch", "--show-current"]).await.unwrap_or_default();
    let dirty = !git(&path, &["status", "--porcelain"]).await.unwrap_or_default().is_empty();
    Ok(RepoInfo { remote_url, current_branch, dirty })
}

const CLONE_TIMEOUT: Duration = Duration::from_secs(600);

/// Clone `url` into `parent_dir/<repo-name>` and return the new path. Lets the
/// user pull a repo into the workspace from inside the app.
#[tauri::command]
pub async fn git_clone(url: String, parent_dir: String) -> AppResult<String> {
    let trimmed = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let name = trimmed.rsplit(['/', ':']).next().unwrap_or("");
    if name.is_empty() {
        return Err(AppError::Other("could not derive a repo name from the URL".into()));
    }
    let dest = std::path::Path::new(&parent_dir).join(name);
    if dest.exists() {
        return Err(AppError::Other(format!("{} already exists", dest.display())));
    }
    let dest_str = dest.to_string_lossy().to_string();
    let out = tokio::time::timeout(
        CLONE_TIMEOUT,
        Command::new("git").arg("clone").arg(url.trim()).arg(&dest_str).output(),
    )
    .await
    .map_err(|_| AppError::Other("git clone timed out".into()))?
    .map_err(|e| AppError::Other(format!("failed to spawn git: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Other(format!(
            "git clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(dest_str)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

/// List a directory's entries (dirs first, `.git` hidden) for the code browser.
#[tauri::command]
pub async fn list_dir(path: String) -> AppResult<Vec<DirEntry>> {
    let rd = std::fs::read_dir(&path).map_err(|e| AppError::Other(format!("read_dir: {e}")))?;
    let mut out: Vec<DirEntry> = Vec::new();
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        out.push(DirEntry { name, is_dir });
    }
    out.sort_by(|a, b| {
        b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

const MAX_FILE_BYTES: u64 = 2_000_000;

/// Read a UTF-8 text file for the code viewer. Rejects large or binary files.
#[tauri::command]
pub async fn read_file(path: String) -> AppResult<String> {
    let meta = std::fs::metadata(&path).map_err(|e| AppError::Other(format!("stat: {e}")))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(AppError::Other("file too large to preview".into()));
    }
    let bytes = std::fs::read(&path).map_err(|e| AppError::Other(format!("read: {e}")))?;
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err(AppError::Other("binary file".into()));
    }
    String::from_utf8(bytes).map_err(|_| AppError::Other("file is not valid UTF-8".into()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branches {
    pub current: String,
    pub all: Vec<String>,
}

/// Local branches + the current one, for the branch switcher.
#[tauri::command]
pub async fn git_branches(path: String) -> AppResult<Branches> {
    let current = git(&path, &["branch", "--show-current"]).await.unwrap_or_default();
    let out = git(&path, &["branch", "--format=%(refname:short)"]).await?;
    let all = out.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect();
    Ok(Branches { current, all })
}

/// Switch the working tree to `branch`.
#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> AppResult<()> {
    git(&path, &["checkout", &branch]).await?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
}

/// Linked worktrees (`git worktree list --porcelain`).
#[tauri::command]
pub async fn git_worktrees(path: String) -> AppResult<Vec<Worktree>> {
    let out = git(&path, &["worktree", "list", "--porcelain"]).await?;
    let mut wts: Vec<Worktree> = Vec::new();
    let mut cur: Option<Worktree> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            if let Some(w) = cur.take() {
                wts.push(w);
            }
            cur = Some(Worktree { path: p.to_string(), branch: None });
        } else if let Some(b) = line.strip_prefix("branch ") {
            if let Some(w) = cur.as_mut() {
                w.branch = Some(b.trim_start_matches("refs/heads/").to_string());
            }
        }
    }
    if let Some(w) = cur.take() {
        wts.push(w);
    }
    Ok(wts)
}

/// Run `gh` inside a repo dir (it handles GitHub auth/credentials).
async fn gh(path: &str, args: &[&str]) -> AppResult<String> {
    let mut cmd = Command::new("gh");
    cmd.current_dir(path);
    for a in args {
        cmd.arg(a);
    }
    let out = tokio::time::timeout(Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| AppError::Other("gh timed out".into()))?
        .map_err(|e| AppError::Other(format!("failed to spawn gh: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Other(format!(
            "gh {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Push the current branch and open a PR. Returns the PR URL `gh` prints.
#[tauri::command]
pub async fn gh_pr_create(
    path: String,
    title: String,
    body: String,
    base: Option<String>,
) -> AppResult<String> {
    let branch = git(&path, &["branch", "--show-current"]).await?;
    if branch.is_empty() {
        return Err(AppError::Other("not on a branch".into()));
    }
    git(&path, &["push", "-u", "origin", &branch]).await?;
    let mut args: Vec<&str> =
        vec!["pr", "create", "--head", &branch, "--title", &title, "--body", &body];
    if let Some(b) = base.as_deref() {
        args.push("--base");
        args.push(b);
    }
    gh(&path, &args).await
}

/// Check out an existing PR into the local clone (`gh pr checkout <n>`).
#[tauri::command]
pub async fn gh_pr_checkout(path: String, number: u64) -> AppResult<()> {
    gh(&path, &["pr", "checkout", &number.to_string()]).await?;
    Ok(())
}

/// `git` with a network-friendly (long) timeout, for push/pull/fetch.
async fn git_net(path: &str, args: &[&str]) -> AppResult<String> {
    run_git(path, args, GIT_NET_TIMEOUT).await
}

#[derive(Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkingTree {
    pub branch: String,
    pub upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    pub staged: Vec<FileChange>,
    pub unstaged: Vec<FileChange>,
}

fn parse_count(rest: &str, key: &str) -> u32 {
    rest.find(key)
        .and_then(|i| rest[i + key.len()..].split([',', ']']).next())
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Working-tree status: current branch, ahead/behind, and the staged +
/// unstaged file changes (the GitHub-Desktop "Changes" screen).
#[tauri::command]
pub async fn git_status(path: String) -> AppResult<WorkingTree> {
    let out = git(&path, &["status", "--porcelain=v1", "-b"]).await?;
    let mut wt = WorkingTree {
        branch: String::new(),
        upstream: false,
        ahead: 0,
        behind: 0,
        staged: Vec::new(),
        unstaged: Vec::new(),
    };
    for line in out.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            let head = rest.split_whitespace().next().unwrap_or("");
            match head.split_once("...") {
                Some((b, _)) => {
                    wt.branch = b.to_string();
                    wt.upstream = true;
                }
                None => wt.branch = head.to_string(),
            }
            wt.ahead = parse_count(rest, "ahead ");
            wt.behind = parse_count(rest, "behind ");
            continue;
        }
        if line.len() < 4 {
            continue;
        }
        let x = &line[0..1];
        let y = &line[1..2];
        let mut p = line[3..].to_string();
        if let Some((_, new)) = p.split_once(" -> ") {
            p = new.to_string();
        }
        if x != " " && x != "?" {
            wt.staged.push(FileChange { path: p.clone(), status: x.to_string() });
        }
        if y != " " {
            let status = if x == "?" { "?".to_string() } else { y.to_string() };
            wt.unstaged.push(FileChange { path: p, status });
        }
    }
    Ok(wt)
}

#[tauri::command]
pub async fn git_stage(path: String, file: Option<String>) -> AppResult<()> {
    match file {
        Some(f) => git(&path, &["add", "--", &f]).await?,
        None => git(&path, &["add", "-A"]).await?,
    };
    Ok(())
}

#[tauri::command]
pub async fn git_unstage(path: String, file: Option<String>) -> AppResult<()> {
    match file {
        Some(f) => git(&path, &["restore", "--staged", "--", &f]).await?,
        None => git(&path, &["reset"]).await?,
    };
    Ok(())
}

/// Unified diff for one file (staged or working-tree).
#[tauri::command]
pub async fn git_diff_file(path: String, file: String, staged: bool) -> AppResult<String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&file);
    git(&path, &args).await
}

/// The full staged diff — fed to the AI for a commit-message draft.
#[tauri::command]
pub async fn git_staged_diff(path: String) -> AppResult<String> {
    git(&path, &["diff", "--cached"]).await
}

#[tauri::command]
pub async fn git_commit(path: String, message: String, amend: Option<bool>) -> AppResult<()> {
    if message.trim().is_empty() {
        return Err(AppError::Other("empty commit message".into()));
    }
    if amend.unwrap_or(false) {
        git(&path, &["commit", "--amend", "-m", &message]).await?;
    } else {
        git(&path, &["commit", "-m", &message]).await?;
    }
    Ok(())
}

/// Discard a file's changes — reset it to HEAD (tracked) or delete it
/// (untracked). The GitHub-Desktop "Discard changes" action; irreversible,
/// so it's deliberately per-file.
#[tauri::command]
pub async fn git_discard(path: String, file: String, untracked: bool) -> AppResult<()> {
    if untracked {
        git(&path, &["clean", "-fd", "--", &file]).await?;
    } else {
        git(&path, &["restore", "--source=HEAD", "--staged", "--worktree", "--", &file]).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_create_branch(path: String, name: String) -> AppResult<()> {
    git(&path, &["checkout", "-b", &name]).await?;
    Ok(())
}

/// Delete a local branch (`-d`, or `-D` to force an unmerged one).
#[tauri::command]
pub async fn git_delete_branch(path: String, name: String, force: Option<bool>) -> AppResult<()> {
    let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
    git(&path, &["branch", flag, &name]).await?;
    Ok(())
}

const MAX_SHOW_BYTES: usize = 1_500_000;

/// The full unified diff of a single commit (`git show`), for the history view.
/// The commit header is suppressed (`--format=`) so the body parses as a plain
/// patch; pathologically huge commits are truncated.
#[tauri::command]
pub async fn git_show(path: String, hash: String) -> AppResult<String> {
    let out = git(&path, &["show", "--no-color", "--format=", &hash]).await?;
    if out.len() > MAX_SHOW_BYTES {
        return Ok(out.chars().take(MAX_SHOW_BYTES).collect());
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub subject: String,
}

/// Recent commit history (newest first). Fields are unit-separated (\x1f).
#[tauri::command]
pub async fn git_log(path: String, limit: Option<u32>) -> AppResult<Vec<Commit>> {
    let n = limit.unwrap_or(50).to_string();
    let out = git(
        &path,
        &["log", "--pretty=format:%H%x1f%h%x1f%an%x1f%ar%x1f%s", "-n", &n],
    )
    .await?;
    let mut commits = Vec::new();
    for line in out.lines() {
        let parts: Vec<&str> = line.split('\u{1f}').collect();
        if parts.len() == 5 {
            commits.push(Commit {
                hash: parts[0].to_string(),
                short: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                subject: parts[4].to_string(),
            });
        }
    }
    Ok(commits)
}

#[tauri::command]
pub async fn git_fetch(path: String) -> AppResult<()> {
    git_net(&path, &["fetch", "--prune"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_pull(path: String) -> AppResult<()> {
    git_net(&path, &["pull", "--ff-only"]).await?;
    Ok(())
}

#[tauri::command]
pub async fn git_push(path: String) -> AppResult<()> {
    // Set upstream on first push of a new branch.
    let branch = git(&path, &["branch", "--show-current"]).await?;
    if branch.is_empty() {
        return Err(AppError::Other("detached HEAD — nothing to push".into()));
    }
    git_net(&path, &["push", "-u", "origin", &branch]).await?;
    Ok(())
}

/// All tracked files, repo-relative — feeds the ⌘P fuzzy file finder.
#[tauri::command]
pub async fn git_ls_files(path: String) -> AppResult<Vec<String>> {
    let out = git(&path, &["ls-files"]).await?;
    Ok(out.lines().map(|s| s.to_string()).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrepHit {
    pub file: String,
    pub line: u32,
    pub text: String,
}

/// Literal, case-insensitive content search across tracked files (`git grep`).
/// Returns up to `limit` hits; empty query or no matches yields an empty list.
#[tauri::command]
pub async fn git_grep(path: String, query: String, limit: Option<u32>) -> AppResult<Vec<GrepHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // `git grep` exits non-zero when there are no matches — treat that as empty.
    let out = git(&path, &["grep", "-n", "-I", "-F", "-i", "--no-color", "-e", q])
        .await
        .unwrap_or_default();
    let cap = limit.unwrap_or(200) as usize;
    let mut hits = Vec::new();
    for line in out.lines() {
        let mut it = line.splitn(3, ':');
        if let (Some(f), Some(l), Some(t)) = (it.next(), it.next(), it.next()) {
            if let Ok(ln) = l.parse::<u32>() {
                hits.push(GrepHit {
                    file: f.to_string(),
                    line: ln,
                    text: t.chars().take(300).collect(),
                });
                if hits.len() >= cap {
                    break;
                }
            }
        }
    }
    Ok(hits)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileActivity {
    pub path: String,
    pub last_short: String,
    pub last_author: String,
    /// Last commit time, unix seconds.
    pub last_time: i64,
    pub last_subject: String,
    /// Number of commits touching this file inside the window (churn).
    pub churn: u32,
}

/// Per-file recent activity inside a time window: the last commit that touched
/// each file plus its churn (commit count). One bounded `git log` walk; files
/// untouched in the window simply don't appear (they read as "quiet"/stale).
#[tauri::command]
pub async fn git_file_activity(
    path: String,
    since_days: Option<u32>,
) -> AppResult<Vec<FileActivity>> {
    let since = format!("--since={} days ago", since_days.unwrap_or(90));
    // \x01 marks a commit header line; fields within it are \x1f-separated.
    // File paths follow on their own lines until the next header.
    let out = run_git(
        &path,
        &[
            "log",
            &since,
            "--no-renames",
            "--name-only",
            "--pretty=format:%x01%H%x1f%an%x1f%at%x1f%s",
        ],
        Duration::from_secs(60),
    )
    .await?;

    let mut map: HashMap<String, FileActivity> = HashMap::new();
    let mut cur_short = String::new();
    let mut cur_author = String::new();
    let mut cur_time: i64 = 0;
    let mut cur_subject = String::new();

    for line in out.lines() {
        if let Some(header) = line.strip_prefix('\u{1}') {
            let mut f = header.split('\u{1f}');
            let hash = f.next().unwrap_or("");
            cur_short = hash.chars().take(7).collect();
            cur_author = f.next().unwrap_or("").to_string();
            cur_time = f.next().unwrap_or("0").parse().unwrap_or(0);
            cur_subject = f.next().unwrap_or("").to_string();
            continue;
        }
        if line.is_empty() {
            continue;
        }
        // A file path touched by the current commit (newest first).
        map.entry(line.to_string())
            .and_modify(|a| a.churn += 1)
            .or_insert_with(|| FileActivity {
                path: line.to_string(),
                last_short: cur_short.clone(),
                last_author: cur_author.clone(),
                last_time: cur_time,
                last_subject: cur_subject.clone(),
                churn: 1,
            });
    }
    Ok(map.into_values().collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NumstatChange {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchChanges {
    /// The base ref the diff was computed against, if one was found.
    pub base: Option<String>,
    pub files: Vec<NumstatChange>,
}

/// Files changed on the current branch versus its merge-base with the default
/// branch — powers the "changed vs base" tint with +/- counts. Best-effort:
/// returns an empty set (base: None) when no base ref can be resolved.
#[tauri::command]
pub async fn git_branch_changes(path: String) -> AppResult<BranchChanges> {
    let mut base = String::new();
    for cand in ["origin/HEAD", "origin/main", "origin/master", "main", "master"] {
        if let Ok(b) = git(&path, &["merge-base", "HEAD", cand]).await {
            if !b.is_empty() {
                base = b;
                break;
            }
        }
    }
    if base.is_empty() {
        return Ok(BranchChanges { base: None, files: Vec::new() });
    }
    let range = format!("{base}..HEAD");
    let out = git(&path, &["diff", "--numstat", "--no-color", &range]).await.unwrap_or_default();
    let mut files = Vec::new();
    for line in out.lines() {
        let mut it = line.split('\t');
        if let (Some(a), Some(d), Some(p)) = (it.next(), it.next(), it.next()) {
            files.push(NumstatChange {
                path: p.to_string(),
                additions: a.parse().unwrap_or(0),
                deletions: d.parse().unwrap_or(0),
            });
        }
    }
    Ok(BranchChanges { base: Some(base), files })
}
