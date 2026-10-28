mod auth;
mod clients;
mod commands;
mod creds;
mod error;
mod github_instance;
mod state;
mod tray;
mod workers;

use state::AppState;
use tauri::menu::{MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "reviewly_lib=info,warn".into()),
        )
        .with_target(false)
        .init();

    let migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "kv + review_drafts",
            sql: r#"
            CREATE TABLE IF NOT EXISTS kv (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );
            CREATE TABLE IF NOT EXISTS review_drafts (
                pr_key      TEXT PRIMARY KEY,
                body        TEXT NOT NULL DEFAULT '',
                comments    TEXT NOT NULL DEFAULT '[]',
                updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "pr_cache (local PR mirror)",
            sql: r#"
            CREATE TABLE IF NOT EXISTS pr_cache (
                scope       TEXT NOT NULL,
                pr_id       INTEGER NOT NULL,
                updated_at  TEXT NOT NULL DEFAULT '',
                state       TEXT NOT NULL DEFAULT '',
                data        TEXT NOT NULL,
                synced_at   INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
                PRIMARY KEY (scope, pr_id)
            );
            CREATE INDEX IF NOT EXISTS pr_cache_scope_updated
                ON pr_cache (scope, updated_at DESC);
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "pull_requests (accumulating per-id base for lists + analytics)",
            sql: r#"
            CREATE TABLE IF NOT EXISTS pull_requests (
                id           INTEGER PRIMARY KEY,
                repo         TEXT NOT NULL DEFAULT '',
                author       TEXT NOT NULL DEFAULT '',
                state        TEXT NOT NULL DEFAULT '',
                created_at   TEXT,
                merged_at    TEXT,
                closed_at    TEXT,
                last_seen    INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );
            CREATE INDEX IF NOT EXISTS pull_requests_created ON pull_requests (created_at);
            CREATE INDEX IF NOT EXISTS pull_requests_merged  ON pull_requests (merged_at);
            CREATE INDEX IF NOT EXISTS pull_requests_closed  ON pull_requests (closed_at);
            CREATE INDEX IF NOT EXISTS pull_requests_repo    ON pull_requests (repo);
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "pull_requests.is_draft (drafts trend series)",
            sql: "ALTER TABLE pull_requests ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0;",
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 5,
            description: "prs (local-first list source) + repo_sync (per-repo watermark)",
            sql: r#"
            CREATE TABLE IF NOT EXISTS prs (
                id             INTEGER PRIMARY KEY,
                repo           TEXT NOT NULL,
                number         INTEGER NOT NULL,
                title          TEXT NOT NULL DEFAULT '',
                state          TEXT NOT NULL DEFAULT 'open',
                draft          INTEGER NOT NULL DEFAULT 0,
                merged_at      TEXT,
                author_login   TEXT NOT NULL DEFAULT '',
                author_avatar  TEXT NOT NULL DEFAULT '',
                author_url     TEXT NOT NULL DEFAULT '',
                author_id      INTEGER NOT NULL DEFAULT 0,
                created_at     TEXT NOT NULL DEFAULT '',
                updated_at     TEXT NOT NULL DEFAULT '',
                html_url       TEXT NOT NULL DEFAULT '',
                repository_url TEXT,
                body           TEXT,
                labels         TEXT NOT NULL DEFAULT '[]',
                head_ref       TEXT,
                base_ref       TEXT,
                synced_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
            );
            CREATE INDEX IF NOT EXISTS prs_repo_state   ON prs (repo, state);
            CREATE INDEX IF NOT EXISTS prs_repo_updated ON prs (repo, updated_at DESC);
            CREATE INDEX IF NOT EXISTS prs_merged       ON prs (merged_at);

            CREATE TABLE IF NOT EXISTS repo_sync (
                repo           TEXT PRIMARY KEY,
                open_synced_at INTEGER,
                updated_high   TEXT,
                all_backfilled INTEGER NOT NULL DEFAULT 0,
                last_error     TEXT
            );
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 6,
            description: "consolidate: drop pull_requests + pr_cache (prs is the single source)",
            sql: r#"
            DROP TABLE IF EXISTS pull_requests;
            DROP TABLE IF EXISTS pr_cache;
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 7,
            description: "preserve requested reviewers and teams in the local PR mirror",
            sql: r#"
            ALTER TABLE prs ADD COLUMN requested_reviewers TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE prs ADD COLUMN requested_teams TEXT NOT NULL DEFAULT '[]';
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 8,
            description: "persist inbox signals in the canonical PR mirror",
            sql: r#"
            ALTER TABLE prs ADD COLUMN inbox_incoming INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE prs ADD COLUMN inbox_mine INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE prs ADD COLUMN ci TEXT NOT NULL DEFAULT 'none';
            ALTER TABLE prs ADD COLUMN conflicting INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE prs ADD COLUMN review_decision TEXT;
            ALTER TABLE prs ADD COLUMN issue_comment_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE prs ADD COLUMN review_thread_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE prs ADD COLUMN unresolved_thread_count INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE prs ADD COLUMN code_owners TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE prs ADD COLUMN dashboard_synced_at INTEGER;
            CREATE INDEX IF NOT EXISTS prs_inbox_incoming ON prs (inbox_incoming, state);
            CREATE INDEX IF NOT EXISTS prs_inbox_mine ON prs (inbox_mine, state);
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 9,
            description: "persist native stack membership in the PR mirror",
            sql: r#"
            ALTER TABLE prs ADD COLUMN stack_number INTEGER;
            ALTER TABLE prs ADD COLUMN stack_position INTEGER;
            ALTER TABLE prs ADD COLUMN stack_size INTEGER;
            ALTER TABLE prs ADD COLUMN stack_base TEXT;
            CREATE INDEX IF NOT EXISTS prs_stack ON prs (repo, stack_number, stack_position);
        "#,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    let builder = tauri::Builder::default()
        // Keep this plugin first so a second launch can only activate the
        // already-running app instead of creating another tray process.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::bring_to_front(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    // The App Store edition updates through the store and can't write a
    // LaunchAgent from the sandbox.
    #[cfg(feature = "direct")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--reviewly-autostart")
                .build(),
        );

    let app = builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:reviewly.db", migrations)
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == tray::TRAY_WINDOW {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        let _ = window.hide();
                    }
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
                return;
            }
            // Close-to-tray: the red traffic light / ⌘W hides the window instead
            // of quitting. The app keeps running in the menu-bar tray; only
            // "Quit Reviewly" (tray menu) or ⌘Q actually exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        // Custom app menu so "About Reviewly" opens our branded panel instead of
        // the generic native one. Standard Edit/Window items are kept so
        // copy/paste/undo and minimize still work.
        .menu(|handle| {
            let about = MenuItem::with_id(handle, "about", "About Reviewly", true, None::<&str>)?;
            let app_menu = SubmenuBuilder::new(handle, "Reviewly")
                .item(&about)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::hide_others(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(handle, None)?)
                .build()?;
            let edit_menu = SubmenuBuilder::new(handle, "Edit")
                .item(&PredefinedMenuItem::undo(handle, None)?)
                .item(&PredefinedMenuItem::redo(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(handle, None)?)
                .item(&PredefinedMenuItem::copy(handle, None)?)
                .item(&PredefinedMenuItem::paste(handle, None)?)
                .item(&PredefinedMenuItem::select_all(handle, None)?)
                .build()?;
            let window_menu = SubmenuBuilder::new(handle, "Window")
                .item(&PredefinedMenuItem::minimize(handle, None)?)
                .item(&PredefinedMenuItem::close_window(handle, None)?)
                .build()?;
            MenuBuilder::new(handle)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "about" {
                let _ = app.emit("menu:about", ());
            }
        })
        .setup(|app| {
            app.manage(AppState::new());

            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_mica(&window, Some(true));
                }
            }

            if let Err(e) = tray::build(app.handle()) {
                tracing::warn!("tray build failed: {e}");
            }

            // Only a login launch may start hidden. A normal Dock/Finder launch
            // must always show Reviewly, even when "start in tray" is enabled.
            let launched_by_autostart = std::env::args().any(|arg| arg == "--reviewly-autostart");
            if launched_by_autostart && commands::app::should_start_in_tray(app.handle()) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                workers::start_all(handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // auth
            commands::auth::auth_status,
            commands::auth::auth_device_start,
            commands::auth::auth_device_poll,
            commands::auth::auth_sign_out,
            commands::auth::auth_gh_available,
            commands::auth::auth_use_gh_cli,
            commands::auth::auth_use_token,
            // search
            commands::search::gh_review_requested,
            commands::search::gh_created,
            commands::search::gh_involves,
            commands::search::gh_search,
            commands::search::gh_search_count,
            commands::search::gh_pr_ci,
            commands::search::gh_dashboard,
            commands::search::gh_list_repo_pulls,
            commands::search::gh_list_repos_open_prs,
            commands::search::gh_list_repo_pulls_delta,
            commands::search::set_watched_repos,
            // pulls
            commands::pulls::gh_get_pull,
            commands::pulls::gh_list_pull_files,
            commands::pulls::gh_list_commits,
            commands::pulls::gh_list_checks,
            commands::pulls::gh_check_annotations,
            commands::pulls::gh_actions_job,
            commands::pulls::gh_rerun_job,
            commands::pulls::gh_rerun_failed_jobs,
            commands::pulls::gh_required_contexts,
            commands::pulls::gh_rerun_check,
            commands::pulls::gh_get_file_content,
            commands::pulls::gh_compare,
            commands::git::git_blame_lines,
            commands::stacks::gh_pr_stack,
            commands::stacks::gh_merge_async,
            commands::stacks::gh_merge_async_status,
            commands::stacks::gh_repo_stacks,
            // local git workspace
            commands::monorepo::monorepo_workspace,
            commands::monorepo::monorepo_scan,
            commands::openspec::openspec_scan,
            commands::openspec::openspec_create_change,
            commands::git::git_repo_info,
            commands::git::git_clone,
            commands::git::list_dir,
            commands::git::read_file,
            commands::git::read_file_data_url,
            commands::git::git_branches,
            commands::git::git_checkout,
            commands::git::git_worktrees,
            commands::git::git_create_worktree,
            commands::git::git_merge_lab,
            commands::git::gh_pr_create,
            commands::git::gh_dependabot_ai_fix_bg,
            commands::git::dependabot_inflight,
            commands::git::gh_list_branches,
            commands::git::gh_resolve_conflicts_ai,
            commands::git::gh_pr_checkout,
            commands::git::git_status,
            commands::git::git_stage,
            commands::git::git_unstage,
            commands::git::git_discard,
            commands::git::git_diff_file,
            commands::git::git_staged_diff,
            commands::git::git_commit,
            commands::git::git_create_branch,
            commands::git::git_delete_branch,
            commands::git::git_show,
            commands::git::git_log,
            commands::git::git_fetch,
            commands::git::git_pull,
            commands::git::git_push,
            commands::git::git_ls_files,
            commands::git::git_grep,
            commands::git::git_file_activity,
            commands::git::git_branch_changes,
            commands::git::local_editor_targets,
            commands::git::open_local_editor,
            // reviews
            commands::reviews::gh_list_reviews,
            commands::reviews::gh_submit_review,
            // comments
            commands::comments::gh_list_review_comments,
            commands::comments::gh_list_issue_comments,
            commands::comments::gh_create_issue_comment,
            commands::comments::gh_reply_review_comment,
            commands::comments::gh_create_review_comment,
            // notifications
            commands::notifications::set_notifications_enabled,
            commands::notifications::set_notification_reasons,
            commands::notifications::set_poll_interval,
            commands::notifications::gh_list_notifications,
            commands::notifications::gh_mark_notification_read,
            commands::actions::gh_mark_all_notifications_read,
            // app behavior
            commands::app::set_launch_at_login,
            commands::app::get_launch_at_login,
            commands::app::set_start_in_tray,
            commands::app::set_app_icon,
            commands::app::app_edition,
            // attachments
            commands::attachments::gh_fetch_attachment,
            // actions (mutations: reactions, labels, reviewers, merge, etc.)
            commands::actions::gh_list_reactions,
            commands::actions::gh_react,
            commands::actions::gh_unreact,
            commands::actions::gh_repo_labels,
            commands::actions::gh_set_pr_labels,
            commands::actions::gh_remove_pr_label,
            commands::actions::gh_request_reviewers,
            commands::actions::gh_remove_reviewers,
            commands::actions::gh_get_requested_reviewers,
            commands::actions::gh_repo_collaborators,
            commands::actions::gh_set_pr_state,
            commands::actions::gh_update_pr,
            commands::actions::gh_merge_pr,
            commands::actions::gh_enable_auto_merge,
            commands::actions::gh_disable_auto_merge,
            commands::actions::gh_dependabot_alerts,
            commands::actions::gh_list_repos,
            commands::actions::gh_user,
            commands::actions::gh_update_branch,
            commands::actions::gh_set_draft,
            commands::actions::gh_resolve_thread,
            commands::actions::gh_edit_issue_comment,
            commands::actions::gh_delete_issue_comment,
            commands::actions::gh_edit_review_comment,
            commands::actions::gh_delete_review_comment,
            commands::actions::gh_pr_node_id,
            commands::actions::gh_list_review_threads,
            commands::actions::gh_activity,
            // ai
            commands::ai::ai_available,
            commands::ai::ai_review,
            commands::ai::ai_review_bg,
            commands::ai::ai_stream,
            commands::ai::ai_apply,
            commands::ai::ai_inflight,
            commands::ai::ai_cancel,
            commands::ai::path_is_dir,
            // tray
            tray::tray_open,
            tray::tray_quit,
            tray::tray_status,
            tray::tray_set_inbox_count,
            tray::tray_set_title,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            tray::bring_to_front(app);
        }
    });
}
