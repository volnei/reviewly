import { Schema } from "effect";

/**
 * The shapes that cross the Tauri boundary, mirrored from the Rust structs in
 * `src-tauri/src/clients/github.rs` and the GitHub REST payloads the commands
 * forward untouched. Decoding happens once, in `Tauri.invoke`; everything above
 * it works with the `Type` side.
 */

const S = Schema;
const nullable = <A, I>(s: Schema.Codec<A, I>) => S.optionalKey(S.NullOr(s));

export const Viewer = S.Struct({
  login: S.String,
  avatar_url: S.String,
  name: S.NullOr(S.String),
  html_url: S.String,
});
export type Viewer = typeof Viewer.Type;

export const AuthStatus = S.Struct({
  signed_in: S.Boolean,
  viewer: S.NullOr(Viewer),
  host: S.String,
});
export type AuthStatus = typeof AuthStatus.Type;

export const DeviceStart = S.Struct({
  user_code: S.String,
  verification_uri: S.String,
  expires_in: S.Number,
  interval: S.Number,
  device_code: S.String,
});
export type DeviceStart = typeof DeviceStart.Type;

export const UserRef = S.Struct({
  login: S.String,
  avatar_url: S.String,
  html_url: S.String,
  id: S.Number,
});
export type UserRef = typeof UserRef.Type;

export const Label = S.Struct({
  id: S.Number,
  name: S.String,
  color: S.String,
  description: nullable(S.String),
});
export type Label = typeof Label.Type;

const BranchRef = S.Struct({ ref: S.String, sha: S.String, label: S.NullOr(S.String) });
type BranchRef = typeof BranchRef.Type;

/** A PR as the search endpoints return it, and as the local cache stores it. */
export const PullSummary = S.Struct({
  id: S.Number,
  number: S.Number,
  title: S.String,
  state: S.String,
  draft: S.Boolean,
  user: UserRef,
  created_at: S.String,
  updated_at: S.String,
  html_url: S.String,
  repository_url: nullable(S.String),
  body: nullable(S.String),
  labels: S.Array(Label),
  requested_reviewers: S.optionalKey(S.Array(UserRef)),
  requested_teams: S.optionalKey(
    S.Array(
      S.Struct({
        slug: S.String,
        name: S.String,
        organization: S.optionalKey(S.NullOr(S.Struct({ login: S.String }))),
      }),
    ),
  ),
  pull_request: nullable(S.Struct({ merged_at: nullable(S.String) })),
  head: nullable(BranchRef),
  base: nullable(BranchRef),
  /** Signals enriched by the dashboard sync and persisted in the native SQLite mirror. */
  inboxIncoming: S.optionalKey(S.Boolean),
  inboxMine: S.optionalKey(S.Boolean),
  ci: S.optionalKey(S.String),
  conflicting: S.optionalKey(S.Boolean),
  reviewDecision: S.optionalKey(S.NullOr(S.String)),
  issueCommentCount: S.optionalKey(S.Number),
  reviewThreadCount: S.optionalKey(S.Number),
  unresolvedThreadCount: S.optionalKey(S.Number),
  codeOwners: S.optionalKey(S.Array(S.String)),
  stack: S.optionalKey(
    S.NullOr(
      S.Struct({
        number: S.Number,
        position: S.Number,
        size: S.Number,
        base: S.String,
      }),
    ),
  ),
});
export type PullSummary = typeof PullSummary.Type;

export const PullDetail = S.Struct({
  id: S.Number,
  number: S.Number,
  title: S.String,
  state: S.String,
  draft: S.Boolean,
  user: UserRef,
  created_at: S.String,
  updated_at: S.String,
  html_url: S.String,
  body: S.NullOr(S.String),
  head: BranchRef,
  base: BranchRef,
  mergeable: S.NullOr(S.Boolean),
  mergeable_state: S.NullOr(S.String),
  merged: S.NullOr(S.Boolean),
  additions: S.NullOr(S.Number),
  deletions: S.NullOr(S.Number),
  changed_files: S.NullOr(S.Number),
  commits: S.NullOr(S.Number),
  labels: S.Array(Label),
  auto_merge: S.NullOr(
    S.Struct({ merge_method: S.NullOr(S.String), enabled_by: S.NullOr(UserRef) }),
  ),
});
export type PullDetail = typeof PullDetail.Type;

export const PullFile = S.Struct({
  sha: S.NullOr(S.String),
  filename: S.String,
  status: S.String,
  additions: S.Number,
  deletions: S.Number,
  changes: S.Number,
  patch: S.NullOr(S.String),
  previous_filename: S.NullOr(S.String),
});
export type PullFile = typeof PullFile.Type;

/** One review comment; threads are rebuilt from `in_reply_to_id`. */
export const ReviewComment = S.Struct({
  id: S.Number,
  pull_request_review_id: S.NullOr(S.Number),
  diff_hunk: S.NullOr(S.String),
  path: S.String,
  commit_id: S.String,
  user: UserRef,
  body: S.String,
  created_at: S.String,
  updated_at: S.String,
  html_url: S.String,
  line: S.NullOr(S.Number),
  original_line: S.NullOr(S.Number),
  side: S.NullOr(S.String),
  in_reply_to_id: S.NullOr(S.Number),
});
export type ReviewComment = typeof ReviewComment.Type;

export const ReviewThreadGraphQL = S.Struct({
  id: S.String,
  is_resolved: S.Boolean,
  path: S.String,
  line: S.NullOr(S.Number),
  original_line: S.NullOr(S.Number),
  comment_ids: S.Array(S.Number),
});
export type ReviewThreadGraphQL = typeof ReviewThreadGraphQL.Type;

export const Review = S.Struct({
  id: S.Number,
  user: UserRef,
  body: S.NullOr(S.String),
  state: S.String,
  html_url: S.String,
  submitted_at: S.NullOr(S.String),
  commit_id: S.NullOr(S.String),
});
export type Review = typeof Review.Type;

export const IssueComment = S.Struct({
  id: S.Number,
  user: UserRef,
  body: S.String,
  created_at: S.String,
  updated_at: S.String,
  html_url: S.String,
});
export type IssueComment = typeof IssueComment.Type;

/** The REST commit list for a PR (forwarded as-is by `gh_list_commits`). */
export const Commit = S.Struct({
  sha: S.String,
  html_url: nullable(S.String),
  commit: S.Struct({
    message: S.String,
    author: S.NullOr(S.Struct({ name: nullable(S.String), date: nullable(S.String) })),
  }),
  author: nullable(S.Struct({ login: S.String, avatar_url: S.String })),
});
export type Commit = typeof Commit.Type;

export const CheckRun = S.Struct({
  id: S.Number,
  name: S.String,
  status: S.String,
  conclusion: S.NullOr(S.String),
  started_at: S.NullOr(S.String),
  completed_at: S.NullOr(S.String),
  html_url: S.String,
  details_url: nullable(S.String),
  app: nullable(S.Struct({ name: S.String, slug: S.String })),
  check_suite: nullable(S.Struct({ id: S.Number })),
  output: nullable(
    S.Struct({
      title: nullable(S.String),
      summary: nullable(S.String),
      text: nullable(S.String),
      annotations_count: S.optionalKey(S.Number),
    }),
  ),
});
export type CheckRun = typeof CheckRun.Type;

export const CheckRuns = S.Struct({ total_count: S.Number, check_runs: S.Array(CheckRun) });
export type CheckRuns = typeof CheckRuns.Type;

export const DashboardPr = S.Struct({
  id: S.Number,
  number: S.Number,
  title: S.String,
  url: S.String,
  repo: S.String,
  author: S.String,
  avatar: S.String,
  isDraft: S.Boolean,
  reviewDecision: S.NullOr(S.String),
  ci: S.String,
  conflicting: S.Boolean,
  createdAt: S.NullOr(S.String),
  updatedAt: S.NullOr(S.String),
  issueCommentCount: S.Number,
  reviewThreadCount: S.Number,
  unresolvedThreadCount: S.Number,
  codeOwners: S.Array(S.String),
});
export type DashboardPr = typeof DashboardPr.Type;

/** Everything the Inbox needs in one GraphQL call. */
export const Dashboard = S.Struct({
  reviewRequested: S.Number,
  mentions: S.Number,
  opened: S.Number,
  approved: S.Number,
  changesRequested: S.Number,
  awaitingReview: S.Number,
  draft: S.Number,
  ciPass: S.Number,
  ciFail: S.Number,
  ciPending: S.Number,
  stale: S.Number,
  incoming: S.Array(DashboardPr),
  mine: S.Array(DashboardPr),
});
export type Dashboard = typeof Dashboard.Type;

export const Notification = S.Struct({
  id: S.String,
  unread: S.Boolean,
  reason: S.String,
  updated_at: S.String,
  last_read_at: S.NullOr(S.String),
  subject: S.Struct({
    title: S.String,
    url: S.NullOr(S.String),
    latest_comment_url: S.NullOr(S.String),
    type: S.String,
  }),
  repository: S.Struct({ full_name: S.String, html_url: S.String }),
});
export type Notification = typeof Notification.Type;

export const DependabotAlert = S.Struct({
  number: S.Number,
  state: S.String,
  html_url: S.String,
  created_at: S.String,
  dependency: S.Struct({
    package: S.NullOr(S.Struct({ ecosystem: S.String, name: S.String })),
    manifest_path: S.NullOr(S.String),
  }),
  security_advisory: S.Struct({
    summary: S.String,
    severity: S.String,
    ghsa_id: S.String,
    cve_id: S.NullOr(S.String),
  }),
  security_vulnerability: S.NullOr(
    S.Struct({
      severity: S.String,
      vulnerable_version_range: S.NullOr(S.String),
      first_patched_version: S.NullOr(S.Struct({ identifier: S.String })),
    }),
  ),
});
export type DependabotAlert = typeof DependabotAlert.Type;

export const UserProfile = S.Struct({
  login: S.String,
  name: S.NullOr(S.String),
  avatar_url: S.String,
  html_url: S.String,
  bio: S.NullOr(S.String),
  company: S.NullOr(S.String),
  location: S.NullOr(S.String),
  followers: S.Number,
  following: S.Number,
  public_repos: S.Number,
});
export type UserProfile = typeof UserProfile.Type;

export const DraftComment = S.Struct({
  path: S.String,
  body: S.String,
  line: nullable(S.Number),
  side: nullable(S.String),
  start_line: nullable(S.Number),
  start_side: nullable(S.String),
});
export type DraftComment = typeof DraftComment.Type;

/** `git_repo_info` for a local checkout (`src-tauri/src/commands/git.rs`). */
export const RepoInfo = S.Struct({
  remote_url: S.NullOr(S.String),
  current_branch: S.String,
  dirty: S.Boolean,
});
export type RepoInfo = typeof RepoInfo.Type;

/** `git_status`: the working tree, counted. */
export const FileChange = S.Struct({ path: S.String, status: S.String });
export type FileChange = typeof FileChange.Type;

export const WorkingTree = S.Struct({
  branch: S.String,
  upstream: S.Boolean,
  ahead: S.Number,
  behind: S.Number,
  staged: S.Array(FileChange),
  unstaged: S.Array(FileChange),
});
export type WorkingTree = typeof WorkingTree.Type;

export const LocalCommit = S.Struct({
  hash: S.String,
  short: S.String,
  author: S.String,
  date: S.String,
  subject: S.String,
});
export type LocalCommit = typeof LocalCommit.Type;

/** A year of GitHub activity: commit contributions, merged PRs, merged-per-day. */
export const Activity = S.Struct({
  commits: S.Number,
  mergedPrs: S.Number,
  days: S.Array(S.Struct({ date: S.String, count: S.Number })),
});
export type Activity = typeof Activity.Type;

export const Unit = S.Unknown;
export const Strings = S.Array(S.String);

/** A reaction on a comment or review, as GitHub lists them. */
export const Reaction = S.Struct({
  id: S.Number,
  content: S.String,
  user: S.Struct({ login: S.String }),
});
export type Reaction = typeof Reaction.Type;

/** One line a check pointed at: file, lines, what it said. */
export const Annotation = S.Struct({
  path: S.String,
  start_line: S.Number,
  end_line: S.Number,
  annotation_level: S.String,
  message: S.String,
  title: nullable(S.String),
});
export type Annotation = typeof Annotation.Type;

export const RequestedReviewers = S.Struct({
  users: S.Array(UserRef),
  teams: S.Array(S.Struct({ slug: S.String, name: S.String })),
});
export type RequestedReviewers = typeof RequestedReviewers.Type;

/** An editor on this machine the Rust side can hand a folder to. */
export const EditorTarget = S.Struct({
  id: S.String,
  label: S.String,
  /** Rust's `LocalEditorTarget` uses `#[serde(rename_all = "camelCase")]`. */
  isDefault: S.Boolean,
  iconDataUrl: nullable(S.String),
});
export type EditorTarget = typeof EditorTarget.Type;

export const BranchList = S.Struct({ default: S.String, branches: S.Array(S.String) });
export type BranchList = typeof BranchList.Type;

/** The end of a Dependabot fix the Rust side ran in a clone. */
export const DependabotDone = S.Struct({
  key: S.String,
  ok: S.Boolean,
  url: S.optionalKey(S.NullOr(S.String)),
  error: S.optionalKey(S.NullOr(S.String)),
  path: S.optionalKey(S.String),
});
export type DependabotDone = typeof DependabotDone.Type;

export const LocalBranches = S.Struct({ current: S.String, all: S.Array(S.String) });
export type LocalBranches = typeof LocalBranches.Type;
export const Worktree = S.Struct({ path: S.String, branch: S.NullOr(S.String) });
export type Worktree = typeof Worktree.Type;
export const MergeLabResult = S.Struct({
  clean: S.Boolean,
  base: S.String,
  applied: S.Array(S.Number),
  conflicts: S.Array(S.String),
  changedFiles: S.Array(S.String),
  durationMs: S.Number,
});
export type MergeLabResult = typeof MergeLabResult.Type;
const NumstatChange = S.Struct({ path: S.String, additions: S.Number, deletions: S.Number });
export const BranchChanges = S.Struct({ base: S.NullOr(S.String), files: S.Array(NumstatChange) });
export type BranchChanges = typeof BranchChanges.Type;

/** GitHub's native stack: layers in order, bottom first, each one's base the head below it. */
export const StackLayer = S.Struct({
  number: S.Number,
  state: S.String,
  draft: S.optionalKey(S.Boolean),
  merged_at: S.optionalKey(S.NullOr(S.String)),
  head: S.optionalKey(S.Struct({ ref: S.String, sha: S.optionalKey(S.String) })),
});
export type StackLayer = typeof StackLayer.Type;
export const PullStack = S.Struct({
  id: S.optionalKey(S.Number),
  number: S.Number,
  base: S.Struct({ ref: S.String }),
  open: S.optionalKey(S.Boolean),
  pull_requests: S.Array(StackLayer),
});
export type PullStack = typeof PullStack.Type;

export const MergeAsync = S.Struct({
  status: S.optionalKey(S.String),
  message: S.optionalKey(S.NullOr(S.String)),
});
export type MergeAsync = typeof MergeAsync.Type;

export const GrepHit = S.Struct({ file: S.String, line: S.Number, text: S.String });
export type GrepHit = typeof GrepHit.Type;
export const BlameLine = S.Struct({
  line: S.Number,
  hash: S.String,
  short: S.String,
  author: S.String,
  time: S.Number,
  summary: S.String,
});
export type BlameLine = typeof BlameLine.Type;

/** One entry of a folder in a clone. */
export const DirEntry = S.Struct({ name: S.String, is_dir: S.Boolean });
export type DirEntry = typeof DirEntry.Type;

/** How often a file changed lately, and who touched it last. */
export const FileActivity = S.Struct({
  path: S.String,
  last_short: S.String,
  last_author: S.String,
  last_time: S.Number,
  last_subject: S.String,
  /** Commits touching the file inside the window. */
  churn: S.Number,
});
export type FileActivity = typeof FileActivity.Type;

/** A GitHub Actions job: its steps, with their outcome and timing. */
const ActionsStep = S.Struct({
  name: S.String,
  status: S.String,
  conclusion: S.NullOr(S.String),
  number: S.Number,
  started_at: S.optionalKey(S.NullOr(S.String)),
  completed_at: S.optionalKey(S.NullOr(S.String)),
});
export const ActionsJob = S.Struct({
  id: S.Number,
  name: S.String,
  status: S.String,
  conclusion: S.NullOr(S.String),
  html_url: S.optionalKey(S.NullOr(S.String)),
  steps: S.optionalKey(S.Array(ActionsStep)),
});
export type ActionsJob = typeof ActionsJob.Type;
