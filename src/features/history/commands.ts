import { recordHistory } from "./store";

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const number = (value: unknown) => (typeof value === "number" ? value : undefined);
const basename = (path?: string) => path?.replace(/\/$/, "").split(/[\\/]/).pop();

function target(args: Record<string, unknown>) {
  const owner = text(args.owner);
  const name = text(args.repo);
  const repo = owner && name ? `${owner}/${name}` : undefined;
  const pr = number(args.number) ?? number(args.pr);
  return { repo, number: pr, detail: repo ? `${repo}${pr ? ` #${pr}` : ""}` : undefined };
}

/** Record a successful native mutation. Read-only calls deliberately return nothing. */
export function recordCompletedCommand(
  command: string,
  args: Record<string, unknown>,
  result?: unknown,
) {
  const pr = target(args);
  const path = text(args.path);
  const local = (title: string, detail?: string) =>
    recordHistory({ source: "local", title, detail: detail ?? basename(path), path });
  const github = (title: string, detail = pr.detail) =>
    recordHistory({ source: "github", title, detail, repo: pr.repo, number: pr.number });

  switch (command) {
    case "gh_submit_review": {
      const event = text(args.event);
      github(
        event === "APPROVE"
          ? "Approved pull request"
          : event === "REQUEST_CHANGES"
            ? "Requested changes"
            : "Submitted review",
      );
      return;
    }
    case "gh_create_issue_comment":
      github("Commented on pull request");
      return;
    case "gh_create_review_comment":
      github(
        "Left an inline comment",
        pr.detail && text(args.path) ? `${pr.detail} · ${args.path}` : pr.detail,
      );
      return;
    case "gh_reply_review_comment":
      github("Replied to a review comment");
      return;
    case "gh_resolve_thread":
      github(args.resolve ? "Resolved conversation" : "Reopened conversation");
      return;
    case "gh_set_pr_labels":
      github("Updated labels");
      return;
    case "gh_request_reviewers":
      github("Requested reviewers");
      return;
    case "gh_remove_reviewers":
      github("Removed reviewers");
      return;
    case "gh_update_pr":
      github("Updated pull request details");
      return;
    case "gh_set_pr_state":
      github(args.open ? "Reopened pull request" : "Closed pull request");
      return;
    case "gh_set_draft":
      github(
        args.draft ? "Converted pull request to draft" : "Marked pull request ready for review",
      );
      return;
    case "gh_merge_pr":
      github(
        "Merged pull request",
        pr.detail ? `${pr.detail} · ${text(args.method) ?? "merge"}` : undefined,
      );
      return;
    case "gh_merge_async":
      github(
        "Started stacked merge",
        pr.detail ? `${pr.detail} · ${text(args.method) ?? "merge"}` : undefined,
      );
      return;
    case "gh_enable_auto_merge":
      github("Enabled auto-merge");
      return;
    case "gh_disable_auto_merge":
      github("Disabled auto-merge");
      return;
    case "gh_update_branch":
      github("Updated pull request branch");
      return;
    case "gh_react":
      github("Added a reaction");
      return;
    case "gh_unreact":
      github("Removed a reaction");
      return;
    case "gh_edit_issue_comment":
    case "gh_edit_review_comment":
      github("Edited a comment");
      return;
    case "gh_delete_issue_comment":
    case "gh_delete_review_comment":
      github("Deleted a comment");
      return;
    case "gh_rerun_job":
    case "gh_rerun_failed_jobs":
    case "gh_rerun_check":
      github("Re-ran checks");
      return;
    case "gh_resolve_conflicts_ai":
      local("Resolved pull request conflicts");
      return;
    case "gh_pr_checkout":
      local("Checked out pull request", `${basename(path) ?? "Repository"} · #${args.number}`);
      return;
    case "gh_pr_create":
      local("Opened pull request", typeof result === "string" ? result : basename(path));
      return;
    case "gh_dependabot_ai_fix_bg":
      local(
        "Started dependency fix",
        `${basename(path) ?? "Repository"} · ${text(args.package) ?? "dependency"}`,
      );
      return;
    case "git_stage":
      local("Staged changes", text(args.file) ?? "All files");
      return;
    case "git_unstage":
      local("Unstaged changes", text(args.file) ?? "All files");
      return;
    case "git_commit":
      local(args.amend ? "Amended commit" : "Created commit", text(args.message));
      return;
    case "git_discard":
      local("Discarded changes", text(args.file));
      return;
    case "git_push":
      local("Pushed branch");
      return;
    case "git_pull":
      local("Pulled branch");
      return;
    case "git_fetch":
      local("Fetched repository");
      return;
    case "git_checkout":
      local("Switched branch", text(args.branch));
      return;
    case "git_create_branch":
      local("Created branch", text(args.name));
      return;
    case "git_delete_branch":
      local("Deleted branch", text(args.name));
      return;
    case "git_clone":
      local("Cloned repository", text(args.url));
      return;
    case "open_local_editor":
      local("Opened repository in editor");
      return;
  }
}
