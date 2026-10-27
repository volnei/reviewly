import { readRepoPrs } from "@/lib/prs-db";
import { Context, Effect, Layer, Schema } from "effect";
import { Tauri } from "../Tauri";
import { isNative } from "../Tauri";
import { TauriError } from "../errors";
import type { AppError } from "../errors";
import * as S from "../schema";

type Fx<A> = Effect.Effect<A, AppError>;

export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
export type MergeMethod = "merge" | "squash" | "rebase";
export type ReactionTarget = "issue_comment" | "review_comment" | "review" | "issue";

/** GitHub, as the Rust client exposes it. Every method is one command. */
export class GitHub extends Context.Service<
  GitHub,
  {
    readonly dashboard: (repoQualifier: string) => Fx<S.Dashboard>;
    readonly repos: Fx<ReadonlyArray<string>>;
    readonly pull: (ref: PrRef) => Fx<S.PullDetail>;
    readonly files: (ref: PrRef) => Fx<ReadonlyArray<S.PullFile>>;
    readonly reviewComments: (ref: PrRef) => Fx<ReadonlyArray<S.ReviewComment>>;
    readonly reviewThreads: (ref: PrRef) => Fx<ReadonlyArray<S.ReviewThreadGraphQL>>;
    readonly reviews: (ref: PrRef) => Fx<ReadonlyArray<S.Review>>;
    readonly issueComments: (ref: PrRef) => Fx<ReadonlyArray<S.IssueComment>>;
    readonly commits: (ref: PrRef) => Fx<ReadonlyArray<S.Commit>>;
    readonly checks: (owner: string, repo: string, sha: string) => Fx<S.CheckRuns>;
    readonly submitReview: (
      ref: PrRef,
      input: {
        body: string;
        event: ReviewEvent;
        comments: ReadonlyArray<S.DraftComment>;
        commitId?: string;
      },
    ) => Fx<unknown>;
    readonly comment: (ref: PrRef, body: string) => Fx<unknown>;
    /** One inline comment, posted now, outside any review. */
    readonly createReviewComment: (
      ref: PrRef,
      input: { commitId: string; path: string; line: number; side: "LEFT" | "RIGHT"; body: string },
    ) => Fx<unknown>;
    readonly reply: (ref: PrRef, commentId: number, body: string) => Fx<unknown>;
    readonly resolveThread: (threadNodeId: string, resolve: boolean) => Fx<void>;
    readonly notifications: (all: boolean) => Fx<ReadonlyArray<S.Notification>>;
    readonly markNotificationRead: (id: string) => Fx<void>;
    readonly markAllNotificationsRead: Fx<void>;
    readonly dependabotAlerts: (
      owner: string,
      repo: string,
    ) => Fx<ReadonlyArray<S.DependabotAlert>>;
    readonly user: (login: string) => Fx<S.UserProfile>;
    readonly activity: (login: string) => Fx<S.Activity>;
    readonly search: (query: string) => Fx<ReadonlyArray<S.PullSummary>>;
    readonly reposOpenPrs: (repos: ReadonlyArray<string>) => Fx<ReadonlyArray<S.PullSummary>>;
    /** One repo’s pull requests from the local cache: instant, offline, kept fresh by the poller. */
    readonly repoPulls: (
      owner: string,
      repo: string,
      state?: "open" | "all",
    ) => Fx<ReadonlyArray<S.PullSummary>>;
    readonly setLabels: (ref: PrRef, labels: ReadonlyArray<string>) => Fx<ReadonlyArray<S.Label>>;
    readonly repoLabels: (owner: string, repo: string) => Fx<ReadonlyArray<S.Label>>;
    readonly collaborators: (owner: string, repo: string) => Fx<ReadonlyArray<S.UserRef>>;
    readonly requestedReviewers: (ref: PrRef) => Fx<S.RequestedReviewers>;
    readonly requestReviewers: (ref: PrRef, logins: ReadonlyArray<string>) => Fx<void>;
    readonly removeReviewers: (ref: PrRef, logins: ReadonlyArray<string>) => Fx<void>;
    readonly updatePull: (ref: PrRef, patch: { title?: string; body?: string }) => Fx<void>;
    readonly setState: (ref: PrRef, open: boolean) => Fx<void>;
    readonly nodeId: (ref: PrRef) => Fx<string>;
    readonly setDraft: (prNodeId: string, draft: boolean) => Fx<void>;
    readonly merge: (ref: PrRef, method: MergeMethod, commitTitle?: string) => Fx<void>;
    readonly enableAutoMerge: (prNodeId: string, method: MergeMethod) => Fx<void>;
    readonly disableAutoMerge: (prNodeId: string) => Fx<void>;
    readonly updateBranch: (ref: PrRef) => Fx<void>;
    readonly reactions: (
      target: ReactionTarget,
      owner: string,
      repo: string,
      id: number,
      pr?: number,
    ) => Fx<ReadonlyArray<S.Reaction>>;
    readonly react: (
      target: ReactionTarget,
      owner: string,
      repo: string,
      id: number,
      content: string,
      pr?: number,
    ) => Fx<S.Reaction>;
    readonly unreact: (
      target: ReactionTarget,
      owner: string,
      repo: string,
      id: number,
      reactionId: number,
      pr?: number,
    ) => Fx<void>;
    readonly editComment: (
      kind: "issue" | "review",
      owner: string,
      repo: string,
      commentId: number,
      body: string,
    ) => Fx<void>;
    readonly deleteComment: (
      kind: "issue" | "review",
      owner: string,
      repo: string,
      commentId: number,
    ) => Fx<void>;
    readonly requiredContexts: (ref: PrRef) => Fx<ReadonlyArray<string>>;
    readonly annotations: (
      owner: string,
      repo: string,
      checkRunId: number,
    ) => Fx<ReadonlyArray<S.Annotation>>;
    /** One Actions job with its steps, for a check that is one. */
    readonly actionsJob: (owner: string, repo: string, jobId: number) => Fx<S.ActionsJob>;
    readonly rerunJob: (owner: string, repo: string, jobId: number) => Fx<void>;
    readonly rerunFailedJobs: (owner: string, repo: string, runId: number) => Fx<void>;
    readonly rerunCheck: (owner: string, repo: string, checkRunId: number) => Fx<void>;
    readonly resolveConflicts: (path: string, number: number, base: string) => Fx<string>;
    /** The stack this PR is a layer of, or null. GitHub's own model, not a guess from branches. */
    readonly stack: (ref: PrRef) => Fx<S.PullStack | null>;
    /** Every stack in a repository, to mark the layers in a list. */
    readonly repoStacks: (owner: string, repo: string) => Fx<ReadonlyArray<S.PullStack>>;
    /** The merge a stacked PR needs: starts in the background, returns an id to poll. */
    readonly mergeAsync: (
      ref: PrRef,
      method: MergeMethod,
      commitTitle?: string,
    ) => Fx<string | null>;
    readonly mergeAsyncStatus: (ref: PrRef, id: string) => Fx<S.MergeAsync>;
    /** What changed between two commits, as files with patches: since the commit you reviewed. */
    readonly compare: (
      owner: string,
      repo: string,
      base: string,
      head: string,
    ) => Fx<ReadonlyArray<S.PullFile>>;
    /** The whole file at a commit, for unfolding what the patch left out. */
    readonly fileContent: (owner: string, repo: string, path: string, ref: string) => Fx<string>;
  }
>()("reviewly/GitHub") {}

export const GitHubLive = Layer.effect(
  GitHub,
  Effect.gen(function* () {
    const t = yield* Tauri;
    const pr = ({ owner, repo, number }: PrRef) => ({ owner, repo, number });
    const unit = Effect.asVoid;

    return {
      dashboard: (repoQualifier) => t.invoke("gh_dashboard", { repoQualifier }, S.Dashboard),
      repos: t.invoke("gh_list_repos", {}, S.Strings),
      pull: (ref) => t.invoke("gh_get_pull", pr(ref), S.PullDetail),
      files: (ref) => t.invoke("gh_list_pull_files", pr(ref), Schema.Array(S.PullFile)),
      reviewComments: (ref) =>
        t.invoke("gh_list_review_comments", pr(ref), Schema.Array(S.ReviewComment)),
      reviewThreads: (ref) =>
        t.invoke("gh_list_review_threads", pr(ref), Schema.Array(S.ReviewThreadGraphQL)),
      reviews: (ref) => t.invoke("gh_list_reviews", pr(ref), Schema.Array(S.Review)),
      issueComments: (ref) =>
        t.invoke("gh_list_issue_comments", pr(ref), Schema.Array(S.IssueComment)),
      commits: (ref) => t.invoke("gh_list_commits", pr(ref), Schema.Array(S.Commit)),
      checks: (owner, repo, sha) => t.invoke("gh_list_checks", { owner, repo, sha }, S.CheckRuns),
      submitReview: (ref, input) =>
        t.invoke(
          "gh_submit_review",
          {
            ...pr(ref),
            body: input.body || null,
            event: input.event,
            comments: input.comments,
            commitId: input.commitId ?? null,
          },
          S.Unit,
        ),
      comment: (ref, body) => t.invoke("gh_create_issue_comment", { ...pr(ref), body }, S.Unit),
      createReviewComment: (ref, i) =>
        t.invoke(
          "gh_create_review_comment",
          {
            ...pr(ref),
            commitId: i.commitId,
            path: i.path,
            line: i.line,
            side: i.side,
            body: i.body,
          },
          S.Unit,
        ),
      reply: (ref, commentId, body) =>
        t.invoke("gh_reply_review_comment", { ...pr(ref), commentId, body }, S.Unit),
      resolveThread: (threadNodeId, resolve) =>
        t.invoke("gh_resolve_thread", { threadNodeId, resolve }, S.Unit).pipe(Effect.asVoid),
      notifications: (all) =>
        t.invoke("gh_list_notifications", { all }, Schema.Array(S.Notification)),
      markNotificationRead: (id) =>
        t.invoke("gh_mark_notification_read", { id }, S.Unit).pipe(Effect.asVoid),
      markAllNotificationsRead: t
        .invoke("gh_mark_all_notifications_read", {}, S.Unit)
        .pipe(Effect.asVoid),
      dependabotAlerts: (owner, repo) =>
        t.invoke(
          "gh_dependabot_alerts",
          { owner, repo, stateFilter: "open" },
          Schema.Array(S.DependabotAlert),
        ),
      user: (login) => t.invoke("gh_user", { login }, S.UserProfile),
      activity: (login) => t.invoke("gh_activity", { login }, S.Activity),
      search: (query) => t.invoke("gh_search", { query }, Schema.Array(S.PullSummary)),
      repoPulls: (owner, repo, state = "open") =>
        isNative()
          ? Effect.tryPromise({
              try: () => readRepoPrs(`${owner}/${repo}`, state),
              catch: (error) => new TauriError({ cmd: "read_local_prs", message: String(error) }),
            })
          : t.invoke("gh_list_repo_pulls", { owner, repo }, Schema.Array(S.PullSummary)),
      reposOpenPrs: (repos) =>
        t.invoke("gh_list_repos_open_prs", { repos, prState: "open" }, Schema.Array(S.PullSummary)),
      setLabels: (ref, labels) =>
        t.invoke("gh_set_pr_labels", { ...pr(ref), labels }, Schema.Array(S.Label)),
      repoLabels: (owner, repo) =>
        t.invoke("gh_repo_labels", { owner, repo }, Schema.Array(S.Label)),
      collaborators: (owner, repo) =>
        t.invoke("gh_repo_collaborators", { owner, repo }, Schema.Array(S.UserRef)),
      requestedReviewers: (ref) =>
        t.invoke("gh_get_requested_reviewers", pr(ref), S.RequestedReviewers),
      requestReviewers: (ref, logins) =>
        t.invoke("gh_request_reviewers", { ...pr(ref), reviewers: logins }, S.Unit).pipe(unit),
      removeReviewers: (ref, logins) =>
        t.invoke("gh_remove_reviewers", { ...pr(ref), reviewers: logins }, S.Unit).pipe(unit),
      updatePull: (ref, patch) =>
        t
          .invoke(
            "gh_update_pr",
            { ...pr(ref), title: patch.title ?? null, body: patch.body ?? null },
            S.Unit,
          )
          .pipe(unit),
      setState: (ref, open) => t.invoke("gh_set_pr_state", { ...pr(ref), open }, S.Unit).pipe(unit),
      nodeId: (ref) => t.invoke("gh_pr_node_id", pr(ref), Schema.String),
      setDraft: (prNodeId, draft) =>
        t.invoke("gh_set_draft", { prNodeId, draft }, S.Unit).pipe(unit),
      merge: (ref, method, commitTitle) =>
        t
          .invoke(
            "gh_merge_pr",
            { ...pr(ref), method, commitTitle: commitTitle ?? null, commitMessage: null },
            S.Unit,
          )
          .pipe(unit),
      enableAutoMerge: (prNodeId, method) =>
        t.invoke("gh_enable_auto_merge", { prNodeId, method }, S.Unit).pipe(unit),
      disableAutoMerge: (prNodeId) =>
        t.invoke("gh_disable_auto_merge", { prNodeId }, S.Unit).pipe(unit),
      updateBranch: (ref) => t.invoke("gh_update_branch", pr(ref), S.Unit).pipe(unit),
      reactions: (target, owner, repo, id, prNumber) =>
        t.invoke(
          "gh_list_reactions",
          { target, owner, repo, id, pr: prNumber ?? null },
          Schema.Array(S.Reaction),
        ),
      react: (target, owner, repo, id, content, prNumber) =>
        t.invoke(
          "gh_react",
          { target, owner, repo, id, pr: prNumber ?? null, content },
          S.Reaction,
        ),
      unreact: (target, owner, repo, id, reactionId, prNumber) =>
        t
          .invoke(
            "gh_unreact",
            { target, owner, repo, id, pr: prNumber ?? null, reactionId },
            S.Unit,
          )
          .pipe(unit),
      editComment: (kind, owner, repo, commentId, body) =>
        t
          .invoke(
            kind === "issue" ? "gh_edit_issue_comment" : "gh_edit_review_comment",
            { owner, repo, commentId, body },
            S.Unit,
          )
          .pipe(unit),
      deleteComment: (kind, owner, repo, commentId) =>
        t
          .invoke(
            kind === "issue" ? "gh_delete_issue_comment" : "gh_delete_review_comment",
            { owner, repo, commentId },
            S.Unit,
          )
          .pipe(unit),
      requiredContexts: (ref) => t.invoke("gh_required_contexts", pr(ref), S.Strings),
      annotations: (owner, repo, checkRunId) =>
        t.invoke("gh_check_annotations", { owner, repo, checkRunId }, Schema.Array(S.Annotation)),
      actionsJob: (owner, repo, jobId) =>
        t.invoke("gh_actions_job", { owner, repo, jobId }, S.ActionsJob),
      rerunJob: (owner, repo, jobId) =>
        t.invoke("gh_rerun_job", { owner, repo, jobId }, S.Unit).pipe(unit),
      rerunFailedJobs: (owner, repo, runId) =>
        t.invoke("gh_rerun_failed_jobs", { owner, repo, runId }, S.Unit).pipe(unit),
      rerunCheck: (owner, repo, checkRunId) =>
        t.invoke("gh_rerun_check", { owner, repo, checkRunId }, S.Unit).pipe(unit),
      resolveConflicts: (path, number, base) =>
        t.invoke("gh_resolve_conflicts_ai", { path, number, base }, Schema.String),
      stack: (ref) => t.invoke("gh_pr_stack", pr(ref), Schema.NullOr(S.PullStack)),
      repoStacks: (owner, repo) =>
        t.invoke("gh_repo_stacks", { owner, repo }, Schema.Array(S.PullStack)),
      mergeAsync: (ref, method, commitTitle) =>
        t
          .invoke(
            "gh_merge_async",
            { ...pr(ref), method, commitTitle: commitTitle ?? null },
            Schema.Unknown,
          )
          .pipe(Effect.map(findUuid)),
      mergeAsyncStatus: (ref, id) =>
        t.invoke("gh_merge_async_status", { ...pr(ref), id }, S.MergeAsync),
      compare: (owner, repo, base, head) =>
        t.invoke("gh_compare", { owner, repo, base, head }, Schema.Array(S.PullFile)),
      fileContent: (owner, repo, path, ref) =>
        t.invoke("gh_get_file_content", { owner, repo, path, ref }, Schema.String),
    };
  }),
);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The id to poll, wherever the merge-async response put it. */
function findUuid(v: unknown): string | null {
  if (typeof v === "string") return UUID.test(v) ? v : null;
  if (typeof v !== "object" || v === null) return null;
  for (const x of Object.values(v as Record<string, unknown>)) {
    const hit = findUuid(x);
    if (hit) return hit;
  }
  return null;
}

/** "owner/name" → the two halves, or null when it isn't one. */
export function splitRepo(full: string): { owner: string; repo: string } | null {
  const [owner, repo, ...rest] = full.split("/");
  return owner && repo && rest.length === 0 ? { owner, repo } : null;
}
