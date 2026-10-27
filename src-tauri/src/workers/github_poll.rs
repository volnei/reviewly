use chrono::{DateTime, SecondsFormat, Utc};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::clients::github;
use crate::creds;
use crate::state::AppState;

const MAX_SEEN_PRS: usize = 10_000;
const MAX_SEEN_NOTIFICATIONS: usize = 5_000;

#[derive(Default)]
struct DeltaCursor {
    at: Option<DateTime<Utc>>,
    ids_at_watermark: HashSet<u64>,
}

impl DeltaCursor {
    fn qualifier(&self) -> Option<String> {
        self.at
            .map(|at| at.to_rfc3339_opts(SecondsFormat::Secs, true))
    }

    fn is_fresh(&self, pull: &github::PullSummary) -> bool {
        match self.at {
            None => true,
            Some(at) if pull.updated_at > at => true,
            Some(at) if pull.updated_at == at => !self.ids_at_watermark.contains(&pull.id),
            Some(_) => false,
        }
    }

    fn advance(&mut self, pulls: &[github::PullSummary]) {
        let Some(max) = pulls.iter().map(|pull| pull.updated_at).max() else {
            return;
        };
        if self.at.map_or(true, |at| max > at) {
            self.at = Some(max);
            self.ids_at_watermark = pulls
                .iter()
                .filter(|pull| pull.updated_at == max)
                .map(|pull| pull.id)
                .collect();
        } else if self.at == Some(max) {
            self.ids_at_watermark.extend(
                pulls
                    .iter()
                    .filter(|pull| pull.updated_at == max)
                    .map(|pull| pull.id),
            );
        }
    }

    fn reset(&mut self) {
        self.at = None;
        self.ids_at_watermark.clear();
    }
}

fn remember_pr(seen: &mut HashSet<u64>, order: &mut VecDeque<u64>, id: u64) -> bool {
    if !seen.insert(id) {
        return false;
    }
    order.push_back(id);
    while order.len() > MAX_SEEN_PRS {
        if let Some(oldest) = order.pop_front() {
            seen.remove(&oldest);
        }
    }
    true
}

fn remember_notification(
    seen: &mut HashMap<String, DateTime<Utc>>,
    order: &mut VecDeque<String>,
    id: &str,
    updated_at: DateTime<Utc>,
) -> bool {
    if seen.get(id).is_some_and(|previous| *previous >= updated_at) {
        return false;
    }
    seen.insert(id.to_owned(), updated_at);
    order.retain(|known| known != id);
    order.push_back(id.to_owned());
    while order.len() > MAX_SEEN_NOTIFICATIONS {
        if let Some(oldest) = order.pop_front() {
            seen.remove(&oldest);
        }
    }
    true
}

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

/// `owner/repo#number` from a notification's PR subject url
/// (`…/repos/owner/repo/pulls/123`). Matches `pr_key` so a notification thread
/// can be cross-referenced against the live review-requested set.
fn notif_pr_key(n: &github::Notification) -> Option<String> {
    let url = n.subject.url.as_deref()?;
    let mut it = url.rsplit('/');
    let num = it.next()?; // 123
    let _kind = it.next()?; // pulls | issues
    let repo = it.next()?;
    let owner = it.next()?;
    num.parse::<u64>().ok()?; // sanity: it really is a PR/issue url
    Some(format!("{owner}/{repo}#{num}"))
}

/// `owner/repo#number` for a PR summary, in the same shape as `notif_pr_key`.
fn pr_key(p: &github::PullSummary) -> Option<String> {
    Some(format!("{}#{}", repo_full_name(p)?, p.number))
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
    let mut seen_order: VecDeque<u64> = VecDeque::new();
    let mut first_pass = true;
    let mut cursor = DeltaCursor::default();
    // Separate watermark for the watched-repo delta watch (any PR, any author).
    let mut watched_cursor = DeltaCursor::default();
    let mut previous_watched: Vec<String> = Vec::new();
    let mut watched_first = true;
    // Dedup notifications by thread + update time, so a later comment in an
    // existing thread can still alert while memory remains bounded.
    let mut notif_seen: HashMap<String, DateTime<Utc>> = HashMap::new();
    let mut notif_order: VecDeque<String> = VecDeque::new();
    let mut notif_first = true;
    let mut prev_notify_on = false;

    loop {
        let interval = app
            .state::<AppState>()
            .notify_poll_secs
            .load(Ordering::Relaxed)
            .clamp(15, 3600);
        let Ok(Some(token)) = creds::load_token() else {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            continue;
        };
        let state = app.state::<AppState>();

        // Accurate total for the tray — per_page=1 + ETag, so this is ~free.
        if let Ok(count) = github::search_count(&state, &token, BASE).await {
            let _ = app.emit("pr:tick", count);
        }

        // Delta: only PRs updated since the last cycle (full list on first pass).
        let query = match cursor.qualifier() {
            Some(w) => format!("{BASE} updated:>={w}"),
            None => BASE.to_string(),
        };
        match github::search_prs(&state, &token, &query).await {
            Ok(changed) => {
                let fresh: Vec<&github::PullSummary> = changed
                    .iter()
                    .filter(|pull| cursor.is_fresh(pull))
                    .collect();
                let mut new_ids: Vec<String> = Vec::new();
                for pull in &fresh {
                    if remember_pr(&mut seen, &mut seen_order, pull.id) && !first_pass {
                        if let Some(key) = pr_key(pull) {
                            new_ids.push(key);
                        }
                    }
                }
                cursor.advance(&changed);

                if !new_ids.is_empty() {
                    let _ = app.emit("pr:new", &new_ids);
                }
                if !first_pass && !fresh.is_empty() {
                    let _ = app.emit("pr:changed", fresh.len() as u64);
                }
                first_pass = false;
            }
            Err(error) => tracing::warn!(%error, "github review-request poll failed"),
        }

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
                    // GitHub freezes a thread's `reason` at creation, so a
                    // `review_requested` thread keeps firing for later comments /
                    // CI even after you've already reviewed. Fetch the live
                    // review-requested set (the same truth that drives the tray)
                    // so we can drop those stale alerts — but only when such a
                    // thread is actually in play, to avoid an extra search.
                    let pending: Option<HashSet<String>> = if notes.iter().any(|n| {
                        n.unread && n.reason == "review_requested" && reasons.contains(&n.reason)
                    }) {
                        github::search_prs(&state, &token, BASE)
                            .await
                            .ok()
                            .map(|prs| prs.iter().filter_map(pr_key).collect())
                    } else {
                        None
                    };
                    for n in &notes {
                        if !n.unread || !reasons.contains(&n.reason) {
                            continue;
                        }
                        // Sticky-reason guard: only alert "Review requested"
                        // while the PR is genuinely still awaiting your review.
                        // A thread whose PR has dropped out of the set is stale
                        // post-review activity — skip WITHOUT marking it seen, so
                        // a real re-request can still alert later. Fail open if
                        // the pending lookup was unavailable.
                        if n.reason == "review_requested" {
                            if let (Some(pend), Some(key)) = (&pending, notif_pr_key(n)) {
                                if !pend.contains(&key) {
                                    continue;
                                }
                            }
                        }
                        // A new thread or a newer update is alert-worthy; the
                        // priming pass only seeds state (no backlog blast).
                        if remember_notification(
                            &mut notif_seen,
                            &mut notif_order,
                            &n.id,
                            n.updated_at,
                        ) && !notif_first
                        {
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
        let mut watched: Vec<String> = state
            .watched_repos
            .read()
            .map(|w| w.clone())
            .unwrap_or_default();
        watched.sort();
        watched.dedup();
        if watched != previous_watched {
            previous_watched.clone_from(&watched);
            watched_cursor.reset();
            watched_first = true;
        }
        if !watched.is_empty() {
            let repo_q = watched
                .iter()
                .map(|r| format!("repo:{r}"))
                .collect::<Vec<_>>()
                .join(" ");
            let wq = match watched_cursor.qualifier() {
                Some(w) => format!("is:pr updated:>={w} {repo_q}"),
                None => format!("is:pr {repo_q}"),
            };
            match github::search_prs(&state, &token, &wq).await {
                Ok(moved) => {
                    let fresh: Vec<&github::PullSummary> = moved
                        .iter()
                        .filter(|pull| watched_cursor.is_fresh(pull))
                        .collect();
                    watched_cursor.advance(&moved);
                    // First observation (or after watched set was empty) just
                    // seeds the watermark — the frontend already full-reconciles
                    // on start / watched change, so don't re-emit the whole list.
                    if !watched_first && !fresh.is_empty() {
                        let repos: Vec<String> = fresh
                            .iter()
                            .filter_map(|pull| repo_full_name(pull))
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
            watched_cursor.reset();
        }

        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clients::github::{PullSummary, UserRef};
    use serde_json::Value;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .expect("valid test date")
            .with_timezone(&Utc)
    }

    fn pull(id: u64, updated_at: &str) -> PullSummary {
        PullSummary {
            id,
            number: id,
            title: "test".into(),
            state: "open".into(),
            draft: false,
            user: UserRef {
                login: "octocat".into(),
                avatar_url: String::new(),
                html_url: String::new(),
                id: 1,
            },
            created_at: at("2026-01-01T00:00:00Z"),
            updated_at: at(updated_at),
            html_url: String::new(),
            repository_url: None,
            pull_request: None,
            repository: None,
            body: None,
            head: None,
            base: None,
            labels: Vec::<Value>::new(),
            requested_reviewers: Vec::new(),
            requested_teams: Vec::new(),
        }
    }

    #[test]
    fn cursor_dedupes_seen_items_without_losing_same_second_updates() {
        let first = pull(1, "2026-01-01T12:00:00Z");
        let same_second_new_id = pull(2, "2026-01-01T12:00:00Z");
        let newer = pull(3, "2026-01-01T12:00:01Z");
        let mut cursor = DeltaCursor::default();
        cursor.advance(std::slice::from_ref(&first));

        assert!(!cursor.is_fresh(&first));
        assert!(cursor.is_fresh(&same_second_new_id));
        assert!(cursor.is_fresh(&newer));

        cursor.advance(std::slice::from_ref(&same_second_new_id));
        assert!(!cursor.is_fresh(&same_second_new_id));
    }

    #[test]
    fn remembered_pull_ids_are_bounded() {
        let mut seen = HashSet::new();
        let mut order = VecDeque::new();
        for id in 0..=MAX_SEEN_PRS as u64 {
            assert!(remember_pr(&mut seen, &mut order, id));
        }
        assert_eq!(seen.len(), MAX_SEEN_PRS);
        assert!(!seen.contains(&0));
        assert!(seen.contains(&(MAX_SEEN_PRS as u64)));
    }

    #[test]
    fn notification_updates_alert_once_per_revision() {
        let mut seen = HashMap::new();
        let mut order = VecDeque::new();
        let first = at("2026-01-01T12:00:00Z");
        let newer = at("2026-01-01T12:01:00Z");

        assert!(remember_notification(
            &mut seen, &mut order, "thread", first
        ));
        assert!(!remember_notification(
            &mut seen, &mut order, "thread", first
        ));
        assert!(remember_notification(
            &mut seen, &mut order, "thread", newer
        ));
    }
}
