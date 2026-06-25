use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::clients::github;
use crate::creds;
use crate::state::AppState;

/// Human title for a notification reason.
fn notif_title(reason: &str) -> &'static str {
    match reason {
        "review_requested" => "Review requested",
        "mention" | "team_mention" => "You were mentioned",
        "comment" => "New comment",
        "ci_activity" => "CI activity",
        "assign" => "Assigned to you",
        "author" => "Activity on your PR",
        _ => "GitHub",
    }
}

/// `owner/repo` from a PR's `repository_url` (`…/repos/owner/repo`).
fn repo_full_name(p: &github::PullSummary) -> Option<String> {
    let url = p.repository_url.as_ref()?;
    let mut it = url.rsplit('/');
    let name = it.next()?;
    let owner = it.next()?;
    Some(format!("{owner}/{name}"))
}

/// Poll GitHub for PRs that need the user's attention — incrementally. Each
/// cycle does a cheap count (ETag-revalidated) plus a *delta* search for only
/// PRs updated since the last cycle, instead of re-listing everything. Emits:
/// - `pr:tick`      — total pending review count (every cycle; drives the tray)
/// - `pr:new`       — ids newly requesting your review (notifications)
/// - `pr:changed`   — count of PRs that changed this cycle (UI refresh trigger)
/// - `repos:changed`— watched `owner/repo`s with any PR movement (local-DB sync)
pub async fn run(app: AppHandle) {
    const BASE: &str = "is:pr is:open review-requested:@me archived:false -is:draft";
    let mut seen: HashSet<u64> = HashSet::new();
    let mut first_pass = true;
    let mut watermark: Option<String> = None;
    // Separate watermark for the watched-repo delta watch (any PR, any author).
    let mut watched_wm: Option<String> = None;
    let mut watched_first = true;
    // Dedup for the notifications-API desktop alerts (thread ids).
    let mut notif_seen: HashSet<String> = HashSet::new();
    let mut notif_first = true;
    let mut prev_notify_on = false;

    loop {
        let interval = app
            .state::<AppState>()
            .notify_poll_secs
            .load(Ordering::Relaxed)
            .clamp(15, 3600);
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let Ok(Some(token)) = creds::load_token() else {
            continue;
        };
        let state = app.state::<AppState>();

        // Accurate total for the tray — per_page=1 + ETag, so this is ~free.
        if let Ok(count) = github::search_count(&state, &token, BASE).await {
            let _ = app.emit("pr:tick", count);
        }

        // Delta: only PRs updated since the last cycle (full list on first pass).
        let query = match &watermark {
            Some(w) => format!("{BASE} updated:>={w}"),
            None => BASE.to_string(),
        };
        let changed = match github::search_prs(&state, &token, &query).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("github poll failed: {e}");
                continue;
            }
        };

        // Advance the watermark to the newest update we saw.
        if let Some(max) = changed.iter().map(|p| p.updated_at).max() {
            watermark = Some(max.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
        }

        let mut new_ids: Vec<u64> = Vec::new();
        for p in &changed {
            if seen.insert(p.id) && !first_pass {
                new_ids.push(p.id);
            }
        }

        if !new_ids.is_empty() {
            // The UI refresh fires here; the OS alert for review requests now
            // flows through the unified Notifications-API pass below (gated by
            // the `review_requested` reason), so we never double-notify.
            let _ = app.emit("pr:new", &new_ids);
        }

        // Nudge the UI to refresh (and re-mirror) only when something changed.
        if !first_pass && !changed.is_empty() {
            let _ = app.emit("pr:changed", changed.len() as u64);
        }
        first_pass = false;

        // Granular desktop notifications. The search above drives the UI; OS
        // alerts come from the Notifications API so every reason
        // (review/mention/comment/CI) passes through one reason filter.
        let notify_on = state.notify_enabled.load(Ordering::Relaxed);
        if notify_on && !prev_notify_on {
            // Just (re)enabled → re-prime so we don't blast the current backlog.
            notif_first = true;
        }
        prev_notify_on = notify_on;
        if notify_on {
            match github::list_notifications(&state, &token, false).await {
                Ok(notes) => {
                    let reasons = state
                        .notify_reasons
                        .lock()
                        .map(|r| r.clone())
                        .unwrap_or_default();
                    for n in &notes {
                        if !n.unread || !reasons.contains(&n.reason) {
                            continue;
                        }
                        // First time we see a thread id is "new"; the priming
                        // pass only seeds the set (no alert for the backlog).
                        if notif_seen.insert(n.id.clone()) && !notif_first {
                            let repo = n
                                .repository
                                .get("full_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default();
                            let body = if repo.is_empty() {
                                n.subject.title.clone()
                            } else {
                                format!("{repo} · {}", n.subject.title)
                            };
                            let _ = app
                                .notification()
                                .builder()
                                .title(notif_title(&n.reason))
                                .body(body)
                                .show();
                        }
                    }
                    notif_first = false;
                }
                Err(e) => tracing::warn!("notifications poll failed: {e}"),
            }
        }

        // Watched-repo delta watch: find any PR movement (any author/state) in
        // the repos the UI is focused on, so the frontend can reconcile just
        // those into the local DB — event-driven, not waiting for focus/interval.
        let watched: Vec<String> = state
            .watched_repos
            .read()
            .map(|w| w.clone())
            .unwrap_or_default();
        if !watched.is_empty() {
            let repo_q = watched
                .iter()
                .map(|r| format!("repo:{r}"))
                .collect::<Vec<_>>()
                .join(" ");
            let wq = match &watched_wm {
                Some(w) => format!("is:pr updated:>={w} {repo_q}"),
                None => format!("is:pr {repo_q}"),
            };
            match github::search_prs(&state, &token, &wq).await {
                Ok(moved) => {
                    if let Some(max) = moved.iter().map(|p| p.updated_at).max() {
                        watched_wm =
                            Some(max.to_rfc3339_opts(chrono::SecondsFormat::Secs, true));
                    }
                    // First observation (or after watched set was empty) just
                    // seeds the watermark — the frontend already full-reconciles
                    // on start / watched change, so don't re-emit the whole list.
                    if !watched_first && !moved.is_empty() {
                        let repos: Vec<String> = moved
                            .iter()
                            .filter_map(repo_full_name)
                            .collect::<HashSet<_>>()
                            .into_iter()
                            .collect();
                        if !repos.is_empty() {
                            let _ = app.emit("repos:changed", &repos);
                        }
                    }
                    watched_first = false;
                }
                Err(e) => tracing::warn!("watched-repo poll failed: {e}"),
            }
        } else {
            // No watched repos → reset so re-watching seeds a fresh watermark.
            watched_first = true;
            watched_wm = None;
        }
    }
}
