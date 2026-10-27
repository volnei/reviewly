import { Context, Effect, Layer, Schema } from "effect";
import { Tauri } from "../Tauri";
import type { AppError } from "../errors";
import * as S from "../schema";

type Fx<A> = Effect.Effect<A, AppError>;

/** The repositories on this machine, through the Rust git commands. */
export class Git extends Context.Service<
  Git,
  {
    readonly repoInfo: (path: string) => Fx<S.RepoInfo>;
    readonly status: (path: string) => Fx<S.WorkingTree>;
    readonly log: (
      path: string,
      limit: number,
    ) => Fx<ReadonlyArray<S.LocalCommit>>;
    readonly isDir: (path: string) => Fx<boolean>;
    /** `gh pr checkout` in that clone. */
    readonly checkoutPr: (path: string, number: number) => Fx<void>;
    readonly editorTargets: Fx<ReadonlyArray<S.EditorTarget>>;
    readonly openEditor: (path: string, targetId: string) => Fx<void>;
    readonly branches: (path: string) => Fx<S.BranchList>;
    /** Runs in the background; the result arrives as a `dependabot:done` event. */
    readonly dependabotFix: (input: {
      key: string;
      path: string;
      pkg: string;
      fixedVersion: string;
      manifestPath: string | null;
      advisory: string;
      base: string | null;
    }) => Fx<void>;
    readonly dependabotInflight: Fx<ReadonlyArray<string>>;
    /* the working tree */
    readonly stage: (path: string, file: string | null) => Fx<void>;
    readonly unstage: (path: string, file: string | null) => Fx<void>;
    readonly diffFile: (
      path: string,
      file: string,
      staged: boolean,
    ) => Fx<string>;
    readonly stagedDiff: (path: string) => Fx<string>;
    readonly commit: (
      path: string,
      message: string,
      amend?: boolean,
    ) => Fx<void>;
    readonly discard: (
      path: string,
      file: string,
      untracked: boolean,
    ) => Fx<void>;
    readonly push: (path: string) => Fx<void>;
    readonly pull: (path: string) => Fx<void>;
    readonly fetch: (path: string) => Fx<void>;
    readonly show: (path: string, hash: string) => Fx<string>;
    readonly localBranches: (path: string) => Fx<S.LocalBranches>;
    readonly checkout: (path: string, branch: string) => Fx<void>;
    readonly createBranch: (path: string, name: string) => Fx<void>;
    readonly worktrees: (path: string) => Fx<ReadonlyArray<S.Worktree>>;
    /** Creates or recovers a branch in an isolated persistent worktree. */
    readonly createWorktree: (path: string, branch: string) => Fx<string>;
    /** Proves a PR sequence inside a disposable detached worktree. */
    readonly mergeLab: (
      path: string,
      prs: ReadonlyArray<number>,
    ) => Fx<S.MergeLabResult>;
    readonly branchChanges: (path: string) => Fx<S.BranchChanges>;
    /** `gh pr create` from that clone; the PR's URL comes back. */
    readonly createPr: (
      path: string,
      title: string,
      body: string,
      base: string | null,
    ) => Fx<string>;
    /** Literal search across the clone: where a symbol is defined or used. */
    readonly grep: (
      path: string,
      query: string,
      limit: number,
    ) => Fx<ReadonlyArray<S.GrepHit>>;
    readonly readFile: (path: string) => Fx<string>;
    /** Who last touched these lines of a file at a commit. */
    readonly blame: (
      path: string,
      file: string,
      start: number,
      end: number,
      rev: string | null,
    ) => Fx<ReadonlyArray<S.BlameLine>>;
    /** The Turborepo scan of a clone, or null when it isn’t one. Shaped like `WorkspaceScan`. */
    readonly workspaceScan: (path: string) => Fx<unknown>;
    /** OpenSpec changes and their structural readiness, or null when the clone has no openspec/. */
    readonly openSpecScan: (path: string) => Fx<unknown>;
    /** Write one reviewed AI draft below openspec/changes without overwriting an existing change. */
    readonly createOpenSpecChange: (input: {
      path: string;
      id: string;
      proposal: string;
      design: string;
      tasks: string;
      specs: ReadonlyArray<{ capability: string; content: string }>;
    }) => Fx<void>;
    /** A clone's packages and the edges between them, or null when it isn’t a Turborepo. Shaped like `Workspace`. */
    readonly workspace: (path: string) => Fx<unknown>;
    /** Every tracked file in the clone, for a quick open. */
    readonly lsFiles: (path: string) => Fx<ReadonlyArray<string>>;
    readonly listDir: (path: string) => Fx<ReadonlyArray<S.DirEntry>>;
    /** An image in the clone, as a data URL. */
    readonly readFileDataUrl: (path: string) => Fx<string>;
    /** Commits per file in the last N days: who touched what, how often. */
    readonly fileActivity: (
      path: string,
      sinceDays: number,
    ) => Fx<ReadonlyArray<S.FileActivity>>;
    readonly deleteBranch: (
      path: string,
      name: string,
      force: boolean,
    ) => Fx<void>;
    /** `git clone` into a folder; the new clone's path comes back. */
    readonly clone: (url: string, parentDir: string) => Fx<string>;
  }
>()("reviewly/Git") {}

export const GitLive = Layer.effect(
  Git,
  Effect.gen(function* () {
    const t = yield* Tauri;
    return {
      repoInfo: (path) => t.invoke("git_repo_info", { path }, S.RepoInfo),
      status: (path) => t.invoke("git_status", { path }, S.WorkingTree),
      log: (path, limit) =>
        t.invoke("git_log", { path, limit }, Schema.Array(S.LocalCommit)),
      isDir: (path) => t.invoke("path_is_dir", { path }, Schema.Boolean),
      checkoutPr: (path, number) =>
        t
          .invoke("gh_pr_checkout", { path, number }, S.Unit)
          .pipe(Effect.asVoid),
      editorTargets: t.invoke(
        "local_editor_targets",
        {},
        Schema.Array(S.EditorTarget),
      ),
      openEditor: (path, targetId) =>
        t
          .invoke("open_local_editor", { path, targetId }, S.Unit)
          .pipe(Effect.asVoid),
      branches: (path) => t.invoke("gh_list_branches", { path }, S.BranchList),
      dependabotFix: (i) =>
        t
          .invoke(
            "gh_dependabot_ai_fix_bg",
            {
              key: i.key,
              path: i.path,
              package: i.pkg,
              fixedVersion: i.fixedVersion,
              manifestPath: i.manifestPath,
              advisory: i.advisory,
              base: i.base,
            },
            S.Unit,
          )
          .pipe(Effect.asVoid),
      dependabotInflight: t.invoke("dependabot_inflight", {}, S.Strings),
      stage: (path, file) =>
        t.invoke("git_stage", { path, file }, S.Unit).pipe(Effect.asVoid),
      unstage: (path, file) =>
        t.invoke("git_unstage", { path, file }, S.Unit).pipe(Effect.asVoid),
      diffFile: (path, file, staged) =>
        t.invoke("git_diff_file", { path, file, staged }, Schema.String),
      stagedDiff: (path) =>
        t.invoke("git_staged_diff", { path }, Schema.String),
      commit: (path, message, amend) =>
        t
          .invoke("git_commit", { path, message, amend: amend ?? null }, S.Unit)
          .pipe(Effect.asVoid),
      discard: (path, file, untracked) =>
        t
          .invoke("git_discard", { path, file, untracked }, S.Unit)
          .pipe(Effect.asVoid),
      push: (path) =>
        t.invoke("git_push", { path }, S.Unit).pipe(Effect.asVoid),
      pull: (path) =>
        t.invoke("git_pull", { path }, S.Unit).pipe(Effect.asVoid),
      fetch: (path) =>
        t.invoke("git_fetch", { path }, S.Unit).pipe(Effect.asVoid),
      show: (path, hash) => t.invoke("git_show", { path, hash }, Schema.String),
      localBranches: (path) =>
        t.invoke("git_branches", { path }, S.LocalBranches),
      checkout: (path, branch) =>
        t.invoke("git_checkout", { path, branch }, S.Unit).pipe(Effect.asVoid),
      createBranch: (path, name) =>
        t
          .invoke("git_create_branch", { path, name }, S.Unit)
          .pipe(Effect.asVoid),
      worktrees: (path) =>
        t.invoke("git_worktrees", { path }, Schema.Array(S.Worktree)),
      createWorktree: (path, branch) =>
        t.invoke("git_create_worktree", { path, branch }, Schema.String),
      mergeLab: (path, prs) =>
        t.invoke("git_merge_lab", { path, prs }, S.MergeLabResult),
      branchChanges: (path) =>
        t.invoke("git_branch_changes", { path }, S.BranchChanges),
      createPr: (path, title, body, base) =>
        t.invoke("gh_pr_create", { path, title, body, base }, Schema.String),
      workspaceScan: (path) =>
        t.invoke("monorepo_scan", { path }, Schema.Unknown),
      openSpecScan: (path) =>
        t.invoke("openspec_scan", { path }, Schema.Unknown),
      createOpenSpecChange: (input) =>
        t.invoke("openspec_create_change", input, S.Unit).pipe(Effect.asVoid),
      workspace: (path) =>
        t.invoke("monorepo_workspace", { path }, Schema.Unknown),
      lsFiles: (path) => t.invoke("git_ls_files", { path }, S.Strings),
      listDir: (path) =>
        t.invoke("list_dir", { path }, Schema.Array(S.DirEntry)),
      readFileDataUrl: (path) =>
        t.invoke("read_file_data_url", { path }, Schema.String),
      fileActivity: (path, sinceDays) =>
        t.invoke(
          "git_file_activity",
          { path, sinceDays },
          Schema.Array(S.FileActivity),
        ),
      deleteBranch: (path, name, force) =>
        t
          .invoke("git_delete_branch", { path, name, force }, S.Unit)
          .pipe(Effect.asVoid),
      clone: (url, parentDir) =>
        t.invoke("git_clone", { url, parentDir }, Schema.String),
      grep: (path, query, limit) =>
        t.invoke("git_grep", { path, query, limit }, Schema.Array(S.GrepHit)),
      readFile: (path) => t.invoke("read_file", { path }, Schema.String),
      blame: (path, file, start, end, rev) =>
        t.invoke(
          "git_blame_lines",
          { path, file, start, end, rev },
          Schema.Array(S.BlameLine),
        ),
    };
  }),
);
