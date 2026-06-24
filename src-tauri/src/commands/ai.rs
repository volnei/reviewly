use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

/// Hard cap on how long an AI CLI may run before we give up and kill it.
/// Generous enough for a full-diff review, short enough to never hang forever.
const AI_TIMEOUT: Duration = Duration::from_secs(180);

/// CLI binary for a provider id. Unknown ids fall back to Claude.
fn provider_bin(provider: &str) -> &str {
    match provider {
        "codex" => "codex",
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
) -> AppResult<String> {
    match provider {
        "codex" => run_codex(prompt, cwd).await,
        "gemini" => run_gemini(prompt, cwd).await,
        "openai" => run_openai_compatible(prompt, base_url, model, api_key).await,
        _ => run_claude(prompt, cwd).await,
    }
}

/// Run the AI CLI inside the PR's local clone (when one exists) so the agent can
/// actually grep/read the repo — not just the embedded diff. Ignored if the path
/// is missing or not a directory, so callers can always pass it optimistically.
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
fn cli_command(bin: &str) -> Command {
    let mut cmd = Command::new(bin);
    cmd.env("PATH", cli_path());
    cmd
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
) -> AppResult<String> {
    run_provider(&provider, &prompt, cwd.as_deref(), base_url, model, api_key).await
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
) -> AppResult<()> {
    {
        let mut set = state.ai_inflight.lock().unwrap();
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
        let result =
            run_provider(&provider, &prompt, cwd.as_deref(), base_url, model, api_key).await;
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
        let mut t = state.ai_tasks.lock().unwrap();
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

async fn run_claude(prompt: &str, cwd: Option<&str>) -> AppResult<String> {
    let mut cmd = cli_command("claude");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--output-format")
        .arg("text")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, cwd);
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn claude: {e}")))?;

    let output = match tokio::time::timeout(AI_TIMEOUT, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait claude: {e}")))?,
        // On timeout the dropped future kills the child (kill_on_drop).
        Err(_) => {
            return Err(AppError::Other(format!(
                "Claude took longer than {}s and was stopped. Try again, or pick a smaller PR.",
                AI_TIMEOUT.as_secs()
            )))
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

async fn run_codex(prompt: &str, cwd: Option<&str>) -> AppResult<String> {
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
        .arg(&out_path)
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn codex: {e}")))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| AppError::Other(format!("write codex stdin: {e}")))?;
        // Dropping stdin here closes it, signalling EOF.
    }

    let output = match tokio::time::timeout(AI_TIMEOUT, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait codex: {e}")))?,
        Err(_) => {
            let _ = tokio::fs::remove_file(&out_path).await;
            return Err(AppError::Other(format!(
                "Codex took longer than {}s and was stopped. Try again, or pick a smaller PR.",
                AI_TIMEOUT.as_secs()
            )));
        }
    };

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&out_path).await;
        return Err(AppError::Other(format!(
            "codex exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let text = tokio::fs::read_to_string(&out_path)
        .await
        .unwrap_or_else(|_| String::from_utf8_lossy(&output.stdout).to_string());
    let _ = tokio::fs::remove_file(&out_path).await;
    Ok(text.trim().to_string())
}

/// Gemini CLI in non-interactive mode (`gemini -p`). Drop-in like Claude/Codex;
/// runs inside the PR clone when present so it can read the repo.
async fn run_gemini(prompt: &str, cwd: Option<&str>) -> AppResult<String> {
    let mut cmd = cli_command("gemini");
    cmd.arg("-p")
        .arg(prompt)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, cwd);
    let child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn gemini: {e}")))?;
    let output = match tokio::time::timeout(AI_TIMEOUT, child.wait_with_output()).await {
        Ok(res) => res.map_err(|e| AppError::Other(format!("wait gemini: {e}")))?,
        Err(_) => {
            return Err(AppError::Other(format!(
                "Gemini took longer than {}s and was stopped. Try again, or pick a smaller PR.",
                AI_TIMEOUT.as_secs()
            )))
        }
    };
    if !output.status.success() {
        return Err(AppError::Other(format!(
            "gemini exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Any OpenAI-compatible chat endpoint: Ollama / LM Studio (local), OpenRouter,
/// DeepSeek, Groq, etc. Pure HTTP — no CLI, no repo access (reasons over the
/// embedded diff only). `base_url` is the API root (…/v1); the key is optional.
async fn run_openai_compatible(
    prompt: &str,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
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
        .timeout(AI_TIMEOUT)
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
        _ => Err(AppError::Other("Endpoint returned no message content.".into())),
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
) -> AppResult<()> {
    {
        let mut set = state.ai_inflight.lock().unwrap();
        if set.contains(&key) {
            return Ok(());
        }
        set.insert(key.clone());
    }
    let inflight = state.ai_inflight.clone();
    let tasks = state.ai_tasks.clone();
    let task_key = key.clone();
    let handle = tauri::async_runtime::spawn(async move {
        let result = stream_provider(
            &app,
            &task_key,
            &provider,
            &prompt,
            cwd.as_deref(),
            base_url,
            model,
            api_key,
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

/// Returns (full_text, cost_usd). Claude and OpenAI-compatible stream live;
/// codex/gemini have no clean token stream, so they run once and the whole
/// result is emitted as a single chunk.
async fn stream_provider(
    app: &AppHandle,
    key: &str,
    provider: &str,
    prompt: &str,
    cwd: Option<&str>,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
) -> AppResult<(String, Option<f64>)> {
    match provider {
        "claude" => stream_claude(app, key, prompt, cwd).await,
        "openai" => stream_openai(app, key, prompt, base_url, model, api_key).await,
        other => {
            let text = run_provider(other, prompt, cwd, base_url, model, api_key).await?;
            let _ = app.emit("ai:chunk", serde_json::json!({ "key": key, "delta": text }));
            Ok((text, None))
        }
    }
}

async fn stream_claude(
    app: &AppHandle,
    key: &str,
    prompt: &str,
    cwd: Option<&str>,
) -> AppResult<(String, Option<f64>)> {
    let mut cmd = cli_command("claude");
    cmd.arg("-p")
        .arg(prompt)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_cwd(&mut cmd, cwd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Other(format!("failed to spawn claude: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("claude: no stdout".into()))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut full = String::new();
    let mut cost: Option<f64> = None;

    let read = async {
        while let Some(line) = lines
            .next_line()
            .await
            .map_err(|e| AppError::Other(format!("read claude: {e}")))?
        {
            if line.is_empty() {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            match v.get("type").and_then(|t| t.as_str()) {
                Some("stream_event") => {
                    let ev = v.get("event");
                    let is_delta = ev.and_then(|e| e.get("type")).and_then(|t| t.as_str())
                        == Some("content_block_delta");
                    if is_delta {
                        let delta = ev.and_then(|e| e.get("delta"));
                        let is_text = delta.and_then(|d| d.get("type")).and_then(|t| t.as_str())
                            == Some("text_delta");
                        if is_text {
                            if let Some(txt) = delta.and_then(|d| d.get("text")).and_then(|t| t.as_str())
                            {
                                full.push_str(txt);
                                let _ = app
                                    .emit("ai:chunk", serde_json::json!({ "key": key, "delta": txt }));
                            }
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
                }
                _ => {}
            }
        }
        Ok::<(), AppError>(())
    };

    match tokio::time::timeout(AI_TIMEOUT, read).await {
        Ok(r) => r?,
        Err(_) => {
            return Err(AppError::Other(format!(
                "Claude took longer than {}s and was stopped. Try again, or pick a smaller PR.",
                AI_TIMEOUT.as_secs()
            )))
        }
    }
    let _ = child.wait().await;
    if full.is_empty() {
        return Err(AppError::Other("claude returned no output".into()));
    }
    Ok((full, cost))
}

async fn stream_openai(
    app: &AppHandle,
    key: &str,
    prompt: &str,
    base_url: Option<String>,
    model: Option<String>,
    api_key: Option<String>,
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
        .timeout(AI_TIMEOUT)
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?;
    let mut req = client.post(&url).json(&body);
    if let Some(k) = api_key.as_deref() {
        if !k.trim().is_empty() {
            req = req.bearer_auth(k.trim());
        }
    }
    let mut res = req
        .send()
        .await
        .map_err(|e| AppError::Other(format!("request to {base} failed: {e}")))?;
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
    // Server-Sent Events: lines of `data: {json}` ending with `data: [DONE]`.
    while let Some(bytes) = res
        .chunk()
        .await
        .map_err(|e| AppError::Other(format!("stream error: {e}")))?
    {
        buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(nl) = buf.find('\n') {
            let line = buf[..nl].trim().to_string();
            buf.drain(..=nl);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(delta) = v
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|c| c.as_str())
                {
                    if !delta.is_empty() {
                        full.push_str(delta);
                        let _ =
                            app.emit("ai:chunk", serde_json::json!({ "key": key, "delta": delta }));
                    }
                }
            }
        }
    }
    if full.is_empty() {
        return Err(AppError::Other("Endpoint returned no message content.".into()));
    }
    Ok((full, None))
}

#[tauri::command]
pub fn path_is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}
