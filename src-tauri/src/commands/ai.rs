use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// Default silence window for an AI CLI without repository access.
/// Streaming Claude/Codex runs reset this window whenever the CLI emits output.
const AI_TIMEOUT: Duration = Duration::from_secs(180);

/// Repository discovery can be quiet while a large read or search is running.
/// This is an inactivity guard, not a wall-clock deadline: a healthy agent may
/// keep working for longer as long as it continues to report activity.
const REVIEW_TIMEOUT: Duration = Duration::from_secs(900);

/// The right cap for a run: the long agentic one when it can read the repo,
/// the short one for diff-only / chat.
fn run_timeout(cwd: Option<&str>) -> Duration {
    if has_repo(cwd) {
        REVIEW_TIMEOUT
    } else {
        AI_TIMEOUT
    }
}

/// The effective timeout: the user's explicit Settings override (seconds) when
/// set and positive, else the provided smart default.
fn resolve_timeout(override_secs: Option<u64>, default: Duration) -> Duration {
    match override_secs {
        Some(s) if s > 0 => Duration::from_secs(s),
        _ => default,
    }
}

/// CLI binary for a provider id. Unknown ids fall back to Claude.
fn provider_bin(provider: &str) -> &str {
    match provider {
        "codex" => "codex",
        "agy" => "agy",
        "gemini" => "gemini",
        _ => "claude",
    }
}

/// Dispatch a one-shot run to the selected backend and return its final text.
async fn run_provider(
    provider: &str,
    prompt: &str,
    cwd: Option<&str>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    match provider {
        "codex" => run_codex(prompt, cwd, model.as_deref(), timeout_secs).await,
        "agy" => run_agy(prompt, cwd, model.as_deref(), timeout_secs).await,
        "gemini" => run_gemini(prompt, cwd, model.as_deref(), timeout_secs).await,
        "openai" => run_openai_compatible(prompt, base_url, model, api_key, timeout_secs).await,
        _ => run_claude(prompt, cwd, model.as_deref(), timeout_secs).await,
    }
}

/// Run the AI CLI inside the PR's local clone (when one exists) so the agent can
/// actually grep/read the repo — not just the embedded diff. Ignored if the path
/// is missing or not a directory, so callers can always pass it optimistically.
/// True when `cwd` points at a real directory — the PR's local clone. Gates both
/// the working directory and whether the review may read the repo.
fn has_repo(cwd: Option<&str>) -> bool {
    cwd.is_some_and(|d| !d.is_empty() && std::path::Path::new(d).is_dir())
}

fn apply_cwd(cmd: &mut Command, cwd: Option<&str>) {
    if let Some(dir) = cwd {
        if !dir.is_empty() && std::path::Path::new(dir).is_dir() {
            cmd.current_dir(dir);
        }
    }
}

/// PATH augmented with the locations CLIs are commonly installed to. A macOS app
/// launched from Finder/Dock inherits only a minimal PATH (`/usr/bin:/bin:…`),
/// so Homebrew's `/opt/homebrew/bin`, npm-global, and `~/.local/bin` are absent
/// — which makes an installed `claude`/`codex`/`gemini` look "not installed" and
/// breaks spawning it. We merge those dirs into whatever PATH we already have.
/// Computed once.
fn cli_path() -> &'static str {
    use std::sync::OnceLock;
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut dirs: Vec<String> = Vec::new();
        let add = |d: String, dirs: &mut Vec<String>| {
            if !d.is_empty() && !dirs.iter().any(|x| *x == d) {
                dirs.push(d);
            }
        };
        if let Ok(p) = std::env::var("PATH") {
            for d in p.split(':') {
                add(d.to_string(), &mut dirs);
            }
        }
        for d in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            "/opt/local/bin",
            "/opt/local/sbin",
            "/usr/bin",
            "/bin",
        ] {
            add(d.to_string(), &mut dirs);
        }
        if let Ok(home) = std::env::var("HOME") {
            for d in [
                ".local/bin",
                ".cargo/bin",
                ".bun/bin",
                ".deno/bin",
                ".npm-global/bin",
                ".claude/local",
            ] {
                add(format!("{home}/{d}"), &mut dirs);
            }
        }
        dirs.join(":")
    })
}

/// A `Command` for a CLI tool, with PATH widened to the usual install dirs so it
/// resolves even when the app was launched from Finder/Dock (see `cli_path`).
/// Shared with `git`/`gh` spawns in the git & auth commands — a GUI launch
/// hides Homebrew's bin dir, which is why an installed `gh` looked "not found".
pub(crate) fn cli_command(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    cmd.env("PATH", cli_path());
    cmd
}

/// Append the CLI's model flag (`--model` / `-m`) when a non-empty model
/// override is configured. Empty/absent → the CLI keeps its own default.
fn add_model(cmd: &mut Command, flag: &str, model: Option<&str>) {
    if let Some(m) = model.map(str::trim).filter(|m| !m.is_empty()) {
        cmd.arg(flag).arg(m);
    }
}

/// Turn a CLI failure (or a success with no output) into a *helpful* error.
/// Well-known stderr signatures — not-signed-in, rate-limit/quota, unknown
/// model, context-length — become a friendly one-liner so the real cause
/// reaches the user; otherwise the trailing stderr (capped) is shown, instead
/// of a raw multi-KB dump or a silent empty parse failure downstream.
fn cli_error(name: &str, code: &str, stderr: &str) -> AppError {
    let low = stderr.to_lowercase();
    let msg = if low.contains("not logged in")
        || low.contains("authenticat")
        || low.contains("please run")
        || (low.contains("api key") && (low.contains("missing") || low.contains("not ")))
    {
        format!("{name} isn't signed in — run `{name}` once in a terminal to log in, then retry.")
    } else if low.contains("rate limit")
        || low.contains("quota")
        || low.contains("429")
        || low.contains("overloaded")
    {
        format!("{name} hit a rate limit or quota — wait a moment and try again.")
    } else if low.contains("model")
        && (low.contains("not found")
            || low.contains("unknown")
            || low.contains("invalid")
            || low.contains("does not exist")
            || low.contains("not supported"))
    {
        format!("The model set in Settings → AI review isn't valid for {name}.")
    } else if (low.contains("context") && low.contains("length"))
        || low.contains("too many tokens")
        || low.contains("maximum context")
        || low.contains("prompt is too long")
    {
        "This PR is too large for the model's context window — try a smaller PR.".to_string()
    } else if stderr.is_empty() {
        format!("{name} produced no output (exit {code}).")
    } else {
        // Errors sit at the END of a noisy stderr — keep the tail.
        let tail: String = stderr
            .chars()
            .rev()
            .take(300)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{name} exited {code}: {tail}")
    };
    AppError::Other(msg)
}

/// The CLI's own failure text. Some CLIs — Claude among them — print the reason
/// on STDOUT and leave stderr EMPTY, so fall back to stdout: otherwise the real
/// cause (an expired login, an invalid model) is swallowed and the user is left
/// with the useless generic "produced no output".
fn cli_detail(stdout: &[u8], stderr: &[u8]) -> String {
    let err = String::from_utf8_lossy(stderr).trim().to_string();
    if !err.is_empty() {
        return err;
    }
    String::from_utf8_lossy(stdout).trim().to_string()
}

/// Exit code as a bare number ("1"). `ExitStatus`'s Display is "exit status: 1",
/// which would render as "exit exit status: 1" in the messages above.
fn exit_code(status: &std::process::ExitStatus) -> String {
    status
        .code()
        .map(|c| c.to_string())
        .unwrap_or_else(|| "signal".to_string())
}

/// True when the selected provider's CLI is available in PATH. The OpenAI-
/// compatible provider has no binary — it's gated on a configured base URL in
/// the UI — so report it as available here.
#[tauri::command]
pub async fn ai_available(provider: String) -> bool {
    if provider == "openai" {
        return true;
    }
    cli_command(provider_bin(&provider))
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Run a one-shot review/answer with the chosen provider and return the
/// final message as text. The prompt is fully self-contained (it embeds the
/// diff), so the agents never need to touch the filesystem.
#[tauri::command]
pub async fn ai_review(
    provider: String,
    prompt: String,
    cwd: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    run_provider(
        &provider,
        &prompt,
        cwd.as_deref(),
        base_url,
        model,
        api_key,
        timeout_secs,
    )
    .await
}

/// Run a review in the BACKGROUND, keyed by `key` (the PR). Returns immediately;
/// the result is delivered via an `ai:done` event `{ key, ok, output|error,
/// provider, headSha }`. Because the work runs in a Rust task (not tied to the
/// webview), it survives navigating away and webview refreshes — the event fires
/// whenever it finishes and the reloaded UI's listener picks it up. `ai_inflight`
/// lets the UI restore the "generating" state on mount.
#[tauri::command]
pub async fn ai_review_bg(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    provider: String,
    prompt: String,
    head_sha: Option<String>,
    cwd: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<()> {
    {
        let mut set = state
            .ai_inflight
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if set.contains(&key) {
            return Ok(()); // already generating for this PR — don't double-spawn
        }
        set.insert(key.clone());
    }
    let inflight = state.ai_inflight.clone();
    let tasks = state.ai_tasks.clone();
    let head_sha = head_sha.unwrap_or_default();
    let task_key = key.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = run_provider(
            &provider,
            &prompt,
            cwd.as_deref(),
            base_url,
            model,
            api_key,
            timeout_secs,
        )
        .await;
        if let Ok(mut set) = inflight.lock() {
            set.remove(&task_key);
        }
        if let Ok(mut t) = tasks.lock() {
            t.remove(&task_key);
        }
        let payload = match result {
            Ok(output) => serde_json::json!({
                "key": task_key, "ok": true, "output": output,
                "provider": provider, "headSha": head_sha,
            }),
            Err(e) => serde_json::json!({
                "key": task_key, "ok": false, "error": e.to_string(),
                "provider": provider, "headSha": head_sha,
            }),
        };
        let _ = app.emit("ai:done", payload);
    });
    if let Ok(mut t) = state.ai_tasks.lock() {
        t.insert(key, handle);
    }
    Ok(())
}

/// Cancel a running guided-tour generation. Aborting the task drops the AI CLI
/// child (kill_on_drop), so the process is stopped; emits `ai:done {canceled}`.
#[tauri::command]
pub fn ai_cancel(app: AppHandle, state: State<'_, AppState>, key: String) {
    let was_running = {
        let mut t = state
            .ai_tasks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        match t.remove(&key) {
            Some(handle) => {
                handle.abort();
                true
            }
            None => false,
        }
    };
    if let Ok(mut s) = state.ai_inflight.lock() {
        s.remove(&key);
    }
    if was_running {
        let _ = app.emit(
            "ai:done",
            serde_json::json!({ "key": key, "ok": false, "error": "Canceled", "canceled": true }),
        );
    }
}

/// PR keys whose guided-tour generation is currently running in the background.
#[tauri::command]
pub fn ai_inflight(state: State<'_, AppState>) -> Vec<String> {
    state
        .ai_inflight
        .lock()
        .map(|s| s.iter().cloned().collect())
        .unwrap_or_default()
}

/// Feed `prompt` to a freshly-spawned child's stdin on a detached task. Writing
/// concurrently with the child's own run avoids a deadlock when the prompt is
/// larger than the OS pipe buffer and the child only drains stdin as it works;
/// dropping the write handle at the end signals EOF.
fn feed_stdin(child: &mut tokio::process::Child, prompt: &str) {
    if let Some(mut sin) = child.stdin.take() {
        let bytes = prompt.as_bytes().to_vec();
        tauri::async_runtime::spawn(async move {
            let _ = sin.write_all(&bytes).await;
            let _ = sin.shutdown().await;
        });
    }
}

async fn run_claude(
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    let mut cmd = cli_command("claude");
    // Prompt goes over stdin, not argv: a large PR context could otherwise hit
    // the OS arg-length limit, while stdin has no such ceiling. `claude -p`
    // reads the query from stdin when no positional prompt is given.
    cmd.arg("-p")
        .arg("--output-format")
        .arg("text")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    add_model(&mut cmd, "--model", model);
    // With the PR's local clone present, let the review READ the repo
    // (read-only — no edits, no shell) so it can resolve its own questions from
    // the actual code instead of reasoning off the diff alone. Without a clone
    // there's nothing local to explore, so we leave it diff-only.
    if has_repo(cwd) {
        cmd.arg("--allowedTools").arg("Read Grep Glob LS");
    }
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn claude: {e}")))?;
    feed_stdin(&mut child, prompt);

    let timeout = resolve_timeout(timeout_secs, run_timeout(cwd));
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait claude: {e}")))?,
        // On timeout the dropped future kills the child (kill_on_drop).
        Err(_) => {
            return Err(AppError::Other(format!(
                "Claude took longer than {}s and was stopped. Try again, or increase the AI time limit in Settings.",
                timeout.as_secs()
            )))
        }
    };

    if !output.status.success() {
        return Err(cli_error(
            "claude",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if out.is_empty() {
        return Err(cli_error(
            "claude",
            "0",
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    Ok(out)
}

/// Run the Claude CLI in *apply* mode — full edit + shell access — inside `cwd`,
/// so the agent can actually implement a change (bump a dependency, update the
/// lockfile, run the build/tests and fix fallout). Powers the Dependabot AI-fix
/// flow. Long timeout: install + build + test can take several minutes.
///
/// `--dangerously-skip-permissions` lets it edit files and run shell commands
/// without prompting; only ever pointed at the user's own local clone.
pub async fn apply_with_claude(prompt: &str, cwd: &str) -> AppResult<String> {
    const APPLY_TIMEOUT: Duration = Duration::from_secs(600);
    let mut cmd = cli_command("claude");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--dangerously-skip-permissions")
        .arg("--output-format")
        .arg("text")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, Some(cwd));
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn claude: {e}")))?;
    let output = match tokio::time::timeout(APPLY_TIMEOUT, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait claude: {e}")))?,
        Err(_) => {
            return Err(AppError::Other(
                "The AI fix took longer than 10 minutes and was stopped.".into(),
            ))
        }
    };
    if !output.status.success() {
        return Err(AppError::Other(format!(
            "claude exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn apply_with_codex(prompt: &str, cwd: &str, model: Option<&str>) -> AppResult<String> {
    const APPLY_TIMEOUT: Duration = Duration::from_secs(900);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let out_path = std::env::temp_dir().join(format!("reviewly-codex-apply-{nanos}.md"));
    let mut cmd = cli_command("codex");
    cmd.arg("exec")
        .arg("--skip-git-repo-check")
        .arg("-s")
        .arg("workspace-write")
        .arg("--output-last-message")
        .arg(&out_path);
    add_model(&mut cmd, "-m", model);
    cmd.arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, Some(cwd));
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn codex: {e}")))?;
    feed_stdin(&mut child, prompt);
    let output = tokio::time::timeout(APPLY_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| {
            AppError::Other(
                "The implementation took longer than 15 minutes and was stopped.".into(),
            )
        })?
        .map_err(|e| AppError::Other(format!("wait codex: {e}")))?;
    if !output.status.success() {
        let _ = tokio::fs::remove_file(&out_path).await;
        return Err(cli_error(
            "codex",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    let text = tokio::fs::read_to_string(&out_path)
        .await
        .unwrap_or_else(|_| String::from_utf8_lossy(&output.stdout).to_string());
    let _ = tokio::fs::remove_file(&out_path).await;
    Ok(text.trim().to_string())
}

async fn apply_with_agy(prompt: &str, cwd: &str, model: Option<&str>) -> AppResult<String> {
    const APPLY_TIMEOUT: Duration = Duration::from_secs(900);
    let mut cmd = cli_command("agy");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--mode")
        .arg("accept-edits")
        .arg("--dangerously-skip-permissions")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    add_model(&mut cmd, "--model", model);
    apply_cwd(&mut cmd, Some(cwd));
    let output = tokio::time::timeout(
        APPLY_TIMEOUT,
        cmd.spawn()
            .map_err(|e| AppError::Other(format!("failed to spawn agy: {e}")))?
            .wait_with_output(),
    )
    .await
    .map_err(|_| {
        AppError::Other("The implementation took longer than 15 minutes and was stopped.".into())
    })?
    .map_err(|e| AppError::Other(format!("wait agy: {e}")))?;
    if !output.status.success() {
        return Err(cli_error(
            "agy",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn apply_with_gemini(prompt: &str, cwd: &str, model: Option<&str>) -> AppResult<String> {
    const APPLY_TIMEOUT: Duration = Duration::from_secs(900);
    let mut cmd = cli_command("gemini");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--yolo")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    add_model(&mut cmd, "-m", model);
    apply_cwd(&mut cmd, Some(cwd));
    let output = tokio::time::timeout(
        APPLY_TIMEOUT,
        cmd.spawn()
            .map_err(|e| AppError::Other(format!("failed to spawn gemini: {e}")))?
            .wait_with_output(),
    )
    .await
    .map_err(|_| {
        AppError::Other("The implementation took longer than 15 minutes and was stopped.".into())
    })?
    .map_err(|e| AppError::Other(format!("wait gemini: {e}")))?;
    if !output.status.success() {
        return Err(cli_error(
            "gemini",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run an explicitly authorized implementation agent in a local clone. This
/// command edits and tests, but deliberately never commits, pushes or opens a
/// PR; the caller inspects its result before performing those Git operations.
#[tauri::command]
pub async fn ai_apply(
    provider: String,
    prompt: String,
    cwd: String,
    model: Option<String>,
) -> AppResult<String> {
    if !has_repo(Some(&cwd)) {
        return Err(AppError::Other(
            "the local repository is unavailable".into(),
        ));
    }
    match provider.as_str() {
        "claude" => apply_with_claude(&prompt, &cwd).await,
        "codex" => apply_with_codex(&prompt, &cwd, model.as_deref()).await,
        "agy" => apply_with_agy(&prompt, &cwd, model.as_deref()).await,
        "gemini" => apply_with_gemini(&prompt, &cwd, model.as_deref()).await,
        _ => Err(AppError::Other(
            "An OpenAI-compatible endpoint can draft a spec, but cannot edit the local repository. Choose Claude, Codex or Antigravity to implement it."
                .into(),
        )),
    }
}

async fn run_codex(
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    // Write only the agent's final message to a temp file so we get clean
    // markdown back instead of the interleaved progress log on stdout.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut out_path = std::env::temp_dir();
    out_path.push(format!("reviewly-codex-{nanos}.md"));

    // Pass the prompt over stdin (`-`): avoids OS arg-length limits and codex's
    // "reading additional input from stdin" hang when a prompt arg is given.
    let mut cmd = cli_command("codex");
    cmd.arg("exec")
        .arg("--skip-git-repo-check")
        .arg("-s")
        .arg("read-only")
        .arg("--output-last-message")
        .arg(&out_path);
    add_model(&mut cmd, "-m", model); // codex needs -m before the `-` stdin arg
    cmd.arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn codex: {e}")))?;

    feed_stdin(&mut child, prompt);

    let timeout = resolve_timeout(timeout_secs, run_timeout(cwd));
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait codex: {e}")))?,
        Err(_) => {
            let _ = tokio::fs::remove_file(&out_path).await;
            return Err(AppError::Other(format!(
                "Codex took longer than {}s and was stopped. Try again, or increase the AI time limit in Settings.",
                timeout.as_secs()
            )));
        }
    };

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&out_path).await;
        return Err(cli_error(
            "codex",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }

    let text = tokio::fs::read_to_string(&out_path)
        .await
        .unwrap_or_else(|_| String::from_utf8_lossy(&output.stdout).to_string());
    let _ = tokio::fs::remove_file(&out_path).await;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(cli_error(
            "codex",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    Ok(text)
}

/// Antigravity CLI in non-interactive mode (`agy -p`). Drop-in like Claude/Codex;
/// runs inside the PR clone when present so it can read the repo.
async fn run_agy(
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    let mut cmd = cli_command("agy");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--dangerously-skip-permissions")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    add_model(&mut cmd, "--model", model);
    apply_cwd(&mut cmd, cwd);
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn agy: {e}")))?;
    let timeout = resolve_timeout(timeout_secs, run_timeout(cwd));
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait agy: {e}")))?,
        Err(_) => {
            return Err(AppError::Other(format!(
                "Antigravity took longer than {}s and was stopped. Try again, or increase the AI time limit in Settings.",
                timeout.as_secs()
            )))
        }
    };
    if !output.status.success() {
        return Err(cli_error(
            "agy",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if out.is_empty() {
        return Err(cli_error(
            "agy",
            "0",
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    Ok(out)
}

/// Gemini CLI in non-interactive mode (`gemini -p`). Drop-in like Claude/Codex;
/// runs inside the PR clone when present so it can read the repo.
async fn run_gemini(
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    let mut cmd = cli_command("gemini");
    cmd.arg("-p")
        .arg(prompt)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    add_model(&mut cmd, "-m", model);
    apply_cwd(&mut cmd, cwd);
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn gemini: {e}")))?;
    let timeout = resolve_timeout(timeout_secs, run_timeout(cwd));
    let output = match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait gemini: {e}")))?,
        Err(_) => {
            return Err(AppError::Other(format!(
                "Gemini took longer than {}s and was stopped. Try again, or increase the AI time limit in Settings.",
                timeout.as_secs()
            )))
        }
    };
    if !output.status.success() {
        return Err(cli_error(
            "gemini",
            &exit_code(&output.status),
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if out.is_empty() {
        return Err(cli_error(
            "gemini",
            "0",
            &cli_detail(&output.stdout, &output.stderr),
        ));
    }
    Ok(out)
}

/// Any OpenAI-compatible chat endpoint: Ollama / LM Studio (local), OpenRouter,
/// DeepSeek, Groq, etc. Pure HTTP — no CLI, no repo access (reasons over the
/// embedded diff only). `base_url` is the API root (…/v1); the key is optional.
async fn run_openai_compatible(
    prompt: &str,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<String> {
    let base = base_url.unwrap_or_default();
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::Other(
            "No endpoint configured — set a Base URL in Settings → AI review.".into(),
        ));
    }
    let model = model.unwrap_or_default();
    let model = model.trim();
    if model.is_empty() {
        return Err(AppError::Other(
            "No model configured — set a Model in Settings → AI review.".into(),
        ));
    }

    let url = format!("{base}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
        "stream": false,
        "temperature": 0.2,
    });
    let client = reqwest::Client::builder()
        .timeout(resolve_timeout(timeout_secs, AI_TIMEOUT))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?;
    let mut req = client.post(&url).json(&body);
    if let Some(k) = api_key.as_deref() {
        if !k.trim().is_empty() {
            req = req.bearer_auth(k.trim());
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request to {base} failed: {e}")))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message").cloned().or_else(|| Some(e.clone())))
                    .map(|m| m.to_string())
            })
            .unwrap_or_else(|| text.chars().take(300).collect());
        return Err(AppError::Other(format!(
            "{base} returned {}: {msg}",
            status.as_u16()
        )));
    }

    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Other(format!("bad JSON from endpoint: {e}")))?;
    let content = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string());
    match content {
        Some(c) if !c.is_empty() => Ok(c),
        _ => Err(AppError::Other(
            "Endpoint returned no message content.".into(),
        )),
    }
}

/// Stream a one-shot answer token-by-token. Emits `ai:chunk { key, delta }` as
/// text arrives and a final `ai:complete { key, ok, output, costUsd?, error? }`.
/// De-duped + cancelable via the same inflight/task maps as `ai_review_bg`.
#[tauri::command]
pub async fn ai_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    provider: String,
    prompt: String,
    cwd: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<()> {
    {
        let mut set = state
            .ai_inflight
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if set.contains(&key) {
            return Ok(());
        }
        set.insert(key.clone());
    }
    let inflight = state.ai_inflight.clone();
    let tasks = state.ai_tasks.clone();
    let task_key = key.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let _ = app.emit(
            "ai:progress",
            serde_json::json!({
                "key": &task_key,
                "provider": &provider,
                "phase": "starting",
                "message": "Starting the local model session",
                "model": &model,
            }),
        );
        let result = stream_provider(
            &app,
            &task_key,
            &provider,
            &prompt,
            cwd.as_deref(),
            base_url,
            model,
            api_key,
            timeout_secs,
        )
        .await;
        if let Ok(mut s) = inflight.lock() {
            s.remove(&task_key);
        }
        if let Ok(mut t) = tasks.lock() {
            t.remove(&task_key);
        }
        let payload = match result {
            Ok((text, cost)) => serde_json::json!({
                "key": task_key, "ok": true, "output": text, "costUsd": cost,
            }),
            Err(e) => serde_json::json!({
                "key": task_key, "ok": false, "error": e.to_string(),
            }),
        };
        let _ = app.emit("ai:complete", payload);
    });
    if let Ok(mut t) = state.ai_tasks.lock() {
        t.insert(key, handle);
    }
    Ok(())
}

/// Returns (full_text, cost_usd). Claude and OpenAI-compatible stream text live;
/// Codex streams structured run telemetry and emits its clean final answer.
async fn stream_provider(
    app: &AppHandle,
    key: &str,
    provider: &str,
    prompt: &str,
    cwd: Option<&str>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<(String, Option<f64>)> {
    match provider {
        "claude" => stream_claude(app, key, prompt, cwd, model.as_deref(), timeout_secs).await,
        "codex" => stream_codex(app, key, prompt, cwd, model.as_deref(), timeout_secs).await,
        "agy" => stream_agy(app, key, prompt, cwd, model.as_deref(), timeout_secs).await,
        "openai" => stream_openai(app, key, prompt, base_url, model, api_key, timeout_secs).await,
        other => {
            let text =
                run_provider(other, prompt, cwd, base_url, model, api_key, timeout_secs).await?;
            let _ = app.emit("ai:chunk", serde_json::json!({ "key": key, "delta": text }));
            Ok((text, None))
        }
    }
}

fn short_tool_value(value: &str) -> String {
    const LIMIT: usize = 96;
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= LIMIT {
        compact
    } else {
        format!("{}…", compact.chars().take(LIMIT).collect::<String>())
    }
}

fn claude_tool_progress(name: &str, input: &serde_json::Value) -> String {
    match name {
        "Read" => input
            .get("file_path")
            .and_then(|value| value.as_str())
            .map(short_tool_value)
            .map(|path| format!("Reading {path}"))
            .unwrap_or_else(|| "Reading a repository file".into()),
        "Glob" => input
            .get("pattern")
            .and_then(|value| value.as_str())
            .map(short_tool_value)
            .map(|pattern| format!("Mapping files matching {pattern}"))
            .unwrap_or_else(|| "Mapping the affected repository surface".into()),
        "Grep" => input
            .get("pattern")
            .and_then(|value| value.as_str())
            .map(short_tool_value)
            .map(|pattern| format!("Searching for {pattern}"))
            .unwrap_or_else(|| "Searching the repository".into()),
        _ => format!("Inspecting the repository with {name}"),
    }
}

async fn stream_claude(
    app: &AppHandle,
    key: &str,
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<(String, Option<f64>)> {
    let mut cmd = cli_command("claude");
    // Prompt over stdin (not argv) so a large PR context can't hit the OS
    // arg-length limit — same as run_claude. Streaming stdout is unaffected.
    cmd.arg("-p")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let spec_discovery = key.starts_with("spec-draft:");
    if spec_discovery {
        // A spec needs repository evidence, not an unrestricted coding agent.
        // Keep Claude's native search loop while preventing edits and shell work.
        cmd.arg("--tools").arg("Read,Glob,Grep");
    }
    add_model(&mut cmd, "--model", model);
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn claude: {e}")))?;
    feed_stdin(&mut child, prompt);
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("claude: no stdout".into()))?;
    let mut stderr = child.stderr.take();
    // Drain stderr concurrently. A verbose CLI can otherwise fill its pipe and
    // block even though stdout is still healthy, which looks like a timeout.
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(ref mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes).await;
        }
        bytes
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut full = String::new();
    // Non-stream-json stdout lines: Claude prints failures (expired login, bad
    // model) as plain text there, so keep them to explain an empty run.
    let mut noise = String::new();
    let mut cost: Option<f64> = None;
    let mut active_tool: Option<String> = None;
    let mut tool_input = String::new();
    let mut writing_announced = false;

    let idle = resolve_timeout(timeout_secs, run_timeout(cwd));
    let read = async {
        loop {
            let line = match tokio::time::timeout(idle, lines.next_line()).await {
                Ok(result) => result
                    .map_err(|e| AppError::Other(format!("read claude: {e}")))?,
                Err(_) => {
                    return Err(AppError::Other(format!(
                        "Claude produced no activity for {}s and was stopped. Try again, or increase the AI inactivity limit in Settings.",
                        idle.as_secs()
                    )))
                }
            };
            let Some(line) = line else { break };
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                if noise.len() < 1000 {
                    noise.push_str(line.trim());
                    noise.push('\n');
                }
                continue;
            };
            match v.get("type").and_then(|t| t.as_str()) {
                Some("system") if v.get("subtype").and_then(|s| s.as_str()) == Some("init") => {
                    let _ = app.emit(
                        "ai:progress",
                        serde_json::json!({
                            "key": key,
                            "provider": "claude",
                            "phase": "thinking",
                            "message": if spec_discovery { "Session ready; mapping the repository" } else { "Session ready; analyzing the current context" },
                            "model": v.get("model").and_then(|x| x.as_str()),
                            "sessionId": v.get("session_id").and_then(|x| x.as_str()),
                        }),
                    );
                }
                Some("stream_event") => {
                    let ev = v.get("event");
                    let event_type = ev
                        .and_then(|event| event.get("type"))
                        .and_then(|kind| kind.as_str());
                    if event_type == Some("message_start") {
                        let message = ev.and_then(|e| e.get("message"));
                        let usage = message.and_then(|m| m.get("usage"));
                        let _ = app.emit(
                            "ai:progress",
                            serde_json::json!({
                                "key": key,
                                "provider": "claude",
                                "phase": if spec_discovery { "exploring" } else { "writing" },
                                "message": if spec_discovery { "Finding the affected specs, code and tests" } else { "Generating the response" },
                                "model": message.and_then(|m| m.get("model")).and_then(|x| x.as_str()),
                                "inputTokens": usage.and_then(|u| u.get("input_tokens")).and_then(|x| x.as_u64()),
                                "cachedTokens": usage.and_then(|u| u.get("cache_read_input_tokens")).and_then(|x| x.as_u64()),
                            }),
                        );
                    }
                    if event_type == Some("content_block_start") {
                        let block = ev.and_then(|event| event.get("content_block"));
                        if block
                            .and_then(|value| value.get("type"))
                            .and_then(|kind| kind.as_str())
                            == Some("tool_use")
                        {
                            active_tool = block
                                .and_then(|value| value.get("name"))
                                .and_then(|name| name.as_str())
                                .map(str::to_string);
                            tool_input.clear();
                        }
                    }
                    let is_delta = event_type == Some("content_block_delta");
                    if is_delta {
                        let delta = ev.and_then(|e| e.get("delta"));
                        if delta.and_then(|d| d.get("type")).and_then(|t| t.as_str())
                            == Some("input_json_delta")
                        {
                            if let Some(partial) = delta
                                .and_then(|d| d.get("partial_json"))
                                .and_then(|value| value.as_str())
                            {
                                tool_input.push_str(partial);
                            }
                        }
                        let is_text = delta.and_then(|d| d.get("type")).and_then(|t| t.as_str())
                            == Some("text_delta");
                        if is_text {
                            if let Some(txt) =
                                delta.and_then(|d| d.get("text")).and_then(|t| t.as_str())
                            {
                                if spec_discovery && !writing_announced {
                                    writing_announced = true;
                                    let _ = app.emit(
                                        "ai:progress",
                                        serde_json::json!({
                                            "key": key,
                                            "provider": "claude",
                                            "phase": "writing",
                                            "message": "Repository mapped; drafting the spec",
                                        }),
                                    );
                                }
                                full.push_str(txt);
                                let _ = app.emit(
                                    "ai:chunk",
                                    serde_json::json!({ "key": key, "delta": txt }),
                                );
                            }
                        }
                    }
                    if event_type == Some("content_block_stop") {
                        if let Some(name) = active_tool.take() {
                            let input = serde_json::from_str::<serde_json::Value>(&tool_input)
                                .unwrap_or_else(|_| serde_json::json!({}));
                            let _ = app.emit(
                                "ai:progress",
                                serde_json::json!({
                                    "key": key,
                                    "provider": "claude",
                                    "phase": "exploring",
                                    "message": claude_tool_progress(&name, &input),
                                }),
                            );
                            tool_input.clear();
                        }
                    }
                }
                Some("result") => {
                    if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
                        if !r.is_empty() {
                            full = r.to_string();
                        }
                    }
                    cost = v.get("total_cost_usd").and_then(|c| c.as_f64());
                    let usage = v.get("usage");
                    let _ = app.emit(
                        "ai:progress",
                        serde_json::json!({
                            "key": key,
                            "provider": "claude",
                            "phase": "complete",
                            "message": "Draft generated",
                            "sessionId": v.get("session_id").and_then(|x| x.as_str()),
                            "inputTokens": usage.and_then(|u| u.get("input_tokens")).and_then(|x| x.as_u64()),
                            "outputTokens": usage.and_then(|u| u.get("output_tokens")).and_then(|x| x.as_u64()),
                            "cachedTokens": usage.and_then(|u| u.get("cache_read_input_tokens")).and_then(|x| x.as_u64()),
                            "costUsd": cost,
                            "durationMs": v.get("duration_ms").and_then(|x| x.as_u64()),
                            "turns": v.get("num_turns").and_then(|x| x.as_u64()),
                        }),
                    );
                }
                _ => {}
            }
        }
        Ok::<(), AppError>(())
    };

    read.await?;
    let status = child.wait().await.ok();
    let stderr = stderr_task.await.unwrap_or_default();
    if noise.len() < 1000 && !stderr.is_empty() {
        noise.push_str(&String::from_utf8_lossy(&stderr));
    }
    if let Some(status) = status.as_ref() {
        if !status.success() {
            return Err(cli_error("claude", &exit_code(status), noise.trim()));
        }
    }
    if full.is_empty() {
        let code = status
            .map(|s| exit_code(&s))
            .unwrap_or_else(|| "?".to_string());
        return Err(cli_error("claude", &code, noise.trim()));
    }
    Ok((full, cost))
}

/// Codex's JSONL is an activity stream rather than token deltas. We surface its
/// stable lifecycle and usage fields, then emit only the clean final answer.
/// Unknown event shapes are deliberately ignored so a CLI update cannot break a run.
async fn stream_codex(
    app: &AppHandle,
    key: &str,
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<(String, Option<f64>)> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut out_path = std::env::temp_dir();
    out_path.push(format!("reviewly-codex-stream-{nanos}.md"));

    let mut cmd = cli_command("codex");
    cmd.arg("exec")
        .arg("--skip-git-repo-check")
        .arg("-s")
        .arg("read-only")
        .arg("--json")
        .arg("--output-last-message")
        .arg(&out_path);
    add_model(&mut cmd, "-m", model);
    cmd.arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn codex: {e}")))?;
    feed_stdin(&mut child, prompt);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("codex: no stdout".into()))?;
    let mut stderr = child.stderr.take();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(ref mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes).await;
        }
        bytes
    });
    let mut lines = BufReader::new(stdout).lines();

    let idle = resolve_timeout(timeout_secs, run_timeout(cwd));
    let read = async {
        loop {
            let line = match tokio::time::timeout(idle, lines.next_line()).await {
                Ok(result) => result
                    .map_err(|e| AppError::Other(format!("read codex: {e}")))?,
                Err(_) => {
                    return Err(AppError::Other(format!(
                        "Codex produced no activity for {}s and was stopped. Try again, or increase the AI inactivity limit in Settings.",
                        idle.as_secs()
                    )))
                }
            };
            let Some(line) = line else { break };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            match v.get("type").and_then(|x| x.as_str()) {
                Some("thread.started") => {
                    let _ = app.emit(
                        "ai:progress",
                        serde_json::json!({
                            "key": key,
                            "provider": "codex",
                            "phase": "thinking",
                            "message": "Session ready; analyzing the current specs",
                            "model": model,
                            "sessionId": v.get("thread_id").and_then(|x| x.as_str()),
                        }),
                    );
                }
                Some("turn.started") => {
                    let _ = app.emit(
                        "ai:progress",
                        serde_json::json!({
                            "key": key,
                            "provider": "codex",
                            "phase": "writing",
                            "message": "Generating the structured spec draft",
                            "model": model,
                        }),
                    );
                }
                Some("turn.completed") => {
                    let usage = v.get("usage");
                    let _ = app.emit(
                        "ai:progress",
                        serde_json::json!({
                            "key": key,
                            "provider": "codex",
                            "phase": "complete",
                            "message": "Draft generated",
                            "model": model,
                            "inputTokens": usage.and_then(|u| u.get("input_tokens")).and_then(|x| x.as_u64()),
                            "outputTokens": usage.and_then(|u| u.get("output_tokens")).and_then(|x| x.as_u64()),
                            "cachedTokens": usage.and_then(|u| u.get("cached_input_tokens")).and_then(|x| x.as_u64()),
                        }),
                    );
                }
                _ => {}
            }
        }
        Ok::<(), AppError>(())
    };

    if let Err(error) = read.await {
        let _ = tokio::fs::remove_file(&out_path).await;
        return Err(error);
    }
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("wait codex: {e}")))?;
    let stderr = stderr_task.await.unwrap_or_default();
    if !status.success() {
        let _ = tokio::fs::remove_file(&out_path).await;
        return Err(cli_error(
            "codex",
            &exit_code(&status),
            &String::from_utf8_lossy(&stderr),
        ));
    }
    let text = tokio::fs::read_to_string(&out_path)
        .await
        .unwrap_or_default();
    let _ = tokio::fs::remove_file(&out_path).await;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(cli_error(
            "codex",
            &exit_code(&status),
            &String::from_utf8_lossy(&stderr),
        ));
    }
    let _ = app.emit("ai:chunk", serde_json::json!({ "key": key, "delta": text }));
    Ok((text, None))
}

/// Antigravity CLI in non-interactive streaming mode (`agy -p --output-format stream-json`).
/// Streams incremental tokens and parses run telemetry in real time.
async fn stream_agy(
    app: &AppHandle,
    key: &str,
    prompt: &str,
    cwd: Option<&str>,
    model: Option<&str>,
    timeout_secs: Option<u64>,
) -> AppResult<(String, Option<f64>)> {
    let mut cmd = cli_command("agy");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--dangerously-skip-permissions")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    add_model(&mut cmd, "--model", model);
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn agy: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("agy: no stdout".into()))?;
    let mut stderr = child.stderr.take();
    let stderr_task = tauri::async_runtime::spawn(async move {
        let mut bytes = Vec::new();
        if let Some(ref mut stream) = stderr {
            let _ = stream.read_to_end(&mut bytes).await;
        }
        bytes
    });
    let mut lines = BufReader::new(stdout).lines();

    let mut full = String::new();
    let idle = resolve_timeout(timeout_secs, run_timeout(cwd));
    let read = async {
        loop {
            let line = match tokio::time::timeout(idle, lines.next_line()).await {
                Ok(result) => result.map_err(|e| AppError::Other(format!("read agy: {e}")))?,
                Err(_) => {
                    return Err(AppError::Other(format!(
                        "Antigravity produced no activity for {}s and was stopped. Try again, or increase the AI inactivity limit in Settings.",
                        idle.as_secs()
                    )))
                }
            };
            let Some(line) = line else { break };
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            match v.get("event").and_then(|x| x.as_str()) {
                Some("init") => {
                    let _ = app.emit(
                        "ai:progress",
                        serde_json::json!({
                            "key": key,
                            "provider": "agy",
                            "phase": "starting",
                            "message": "Antigravity session initialized",
                            "model": model,
                        }),
                    );
                }
                Some("step_update") => {
                    if let Some(step) = v.get("step_update") {
                        if let Some(delta) = step.get("text_delta").and_then(|d| d.as_str()) {
                            if !delta.is_empty() {
                                full.push_str(delta);
                                let _ = app.emit(
                                    "ai:chunk",
                                    serde_json::json!({ "key": key, "delta": delta }),
                                );
                            }
                        }
                        if step.get("state").and_then(|s| s.as_str()) == Some("ACTIVE") {
                            let _ = app.emit(
                                "ai:progress",
                                serde_json::json!({
                                    "key": key,
                                    "provider": "agy",
                                    "phase": "writing",
                                    "message": "Generating response",
                                    "model": model,
                                }),
                            );
                        }
                        if let Some(usage) = step.get("usage") {
                            let _ = app.emit(
                                "ai:progress",
                                serde_json::json!({
                                    "key": key,
                                    "provider": "agy",
                                    "phase": "writing",
                                    "message": "Generating response",
                                    "model": model,
                                    "inputTokens": usage.get("input_tokens").and_then(|x| x.as_u64()),
                                    "outputTokens": usage.get("output_tokens").and_then(|x| x.as_u64()),
                                    "cachedTokens": usage.get("cache_read_tokens").and_then(|x| x.as_u64()),
                                }),
                            );
                        }
                    }
                }
                Some("result") => {
                    if let Some(res) = v.get("result") {
                        if full.is_empty() {
                            if let Some(resp) = res.get("response").and_then(|r| r.as_str()) {
                                full = resp.to_string();
                            }
                        }
                        let usage = res.get("usage");
                        let _ = app.emit(
                            "ai:progress",
                            serde_json::json!({
                                "key": key,
                                "provider": "agy",
                                "phase": "complete",
                                "message": "Response complete",
                                "model": model,
                                "inputTokens": usage.and_then(|u| u.get("input_tokens")).and_then(|x| x.as_u64()),
                                "outputTokens": usage.and_then(|u| u.get("output_tokens")).and_then(|x| x.as_u64()),
                                "cachedTokens": usage.and_then(|u| u.get("cache_read_tokens")).and_then(|x| x.as_u64()),
                                "turns": res.get("num_turns").and_then(|x| x.as_u64()),
                            }),
                        );
                    }
                }
                _ => {}
            }
        }
        Ok::<(), AppError>(())
    };

    read.await?;
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::Other(format!("wait agy: {e}")))?;
    let stderr = stderr_task.await.unwrap_or_default();
    if !status.success() {
        return Err(cli_error(
            "agy",
            &exit_code(&status),
            &String::from_utf8_lossy(&stderr),
        ));
    }
    let trimmed = full.trim().to_string();
    if trimmed.is_empty() {
        return Err(cli_error(
            "agy",
            &exit_code(&status),
            &String::from_utf8_lossy(&stderr),
        ));
    }
    Ok((trimmed, None))
}

async fn stream_openai(
    app: &AppHandle,
    key: &str,
    prompt: &str,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
    timeout_secs: Option<u64>,
) -> AppResult<(String, Option<f64>)> {
    let base = base_url.unwrap_or_default();
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::Other(
            "No endpoint configured — set a Base URL in Settings → AI review.".into(),
        ));
    }
    let model = model.unwrap_or_default();
    let model = model.trim();
    if model.is_empty() {
        return Err(AppError::Other(
            "No model configured — set a Model in Settings → AI review.".into(),
        ));
    }
    let url = format!("{base}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
        "stream": true,
        "temperature": 0.2,
    });
    let client = reqwest::Client::builder()
        .timeout(resolve_timeout(timeout_secs, AI_TIMEOUT))
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?;
    // Retry only before streaming begins. Once a token has been emitted, an
    // automatic retry could duplicate part of the answer in the UI.
    let mut attempt = 0u32;
    let mut res = loop {
        let mut req = client.post(&url).json(&body);
        if let Some(k) = api_key.as_deref() {
            if !k.trim().is_empty() {
                req = req.bearer_auth(k.trim());
            }
        }
        match req.send().await {
            Ok(response)
                if (response.status().as_u16() == 429 || response.status().is_server_error())
                    && attempt < 2 =>
            {
                let wait = response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(1u64 << attempt)
                    .clamp(1, 15);
                tokio::time::sleep(Duration::from_secs(wait)).await;
                attempt += 1;
            }
            Ok(response) => break response,
            Err(error) if attempt < 2 && (error.is_timeout() || error.is_connect()) => {
                tokio::time::sleep(Duration::from_millis(500 * (1u64 << attempt))).await;
                attempt += 1;
            }
            Err(error) => {
                return Err(AppError::Other(format!(
                    "request to {base} failed after {} attempt(s): {error}",
                    attempt + 1
                )))
            }
        }
    };
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(AppError::Other(format!(
            "{base} returned {status}: {}",
            text.chars().take(300).collect::<String>()
        )));
    }

    let mut full = String::new();
    let mut buf = String::new();
    let mut completed = false;
    // Server-Sent Events: lines of `data: {json}` ending with `data: [DONE]`.
    while let Some(bytes) = res
        .chunk()
        .await
        .map_err(|e| AppError::Other(format!("stream error: {e}")))?
    {
        buf.push_str(&String::from_utf8_lossy(&bytes));
        if buf.len() > 1_048_576 {
            return Err(AppError::Other(
                "The model stream sent more than 1 MB without a complete event.".into(),
            ));
        }
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf.drain(..=nl);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() {
                continue;
            }
            if data == "[DONE]" {
                completed = true;
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(message) = v
                    .get("error")
                    .and_then(|e| e.get("message").or(Some(e)))
                    .and_then(|m| m.as_str())
                {
                    return Err(AppError::Other(format!("The model stopped: {message}")));
                }
                if v.get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("finish_reason"))
                    .is_some_and(|r| !r.is_null())
                {
                    completed = true;
                }
                if let Some(delta) = v
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                {
                    if !delta.is_empty() {
                        full.push_str(delta);
                        let _ = app.emit(
                            "ai:chunk",
                            serde_json::json!({ "key": key, "delta": delta }),
                        );
                    }
                }
            }
        }
    }
    if full.is_empty() {
        return Err(AppError::Other(
            "Endpoint returned no message content.".into(),
        ));
    }
    if !completed {
        return Err(AppError::Other(
            "The model connection closed before the answer completed. The partial answer was kept; retry to start a clean run."
                .into(),
        ));
    }
    Ok((full, None))
}

#[tauri::command]
pub fn path_is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}
