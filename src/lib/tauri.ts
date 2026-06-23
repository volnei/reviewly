import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { type EventCallback, listen } from "@tauri-apps/api/event";

/** Typed wrapper around Tauri commands. Throws on Rust-side errors. */
export async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(cmd, args);
}

export async function subscribe<T>(event: string, handler: EventCallback<T>): Promise<() => void> {
  const unlisten = await listen<T>(event, handler);
  return unlisten;
}

// ─── GitHub domain types (mirror the Rust structs in clients/github.rs) ───

export interface Viewer {
  login: string;
  avatar_url: string;
  name: string | null;
  html_url: string;
}

export interface AuthStatus {
  signed_in: boolean;
  viewer: Viewer | null;
}

export interface DeviceStart {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  device_code: string;
}

/** CI rollup state for one PR (PR list badges). */
export interface CiStatus {
  number: number;
  state: "success" | "failure" | "pending" | "none" | string;
}

/** Everything the dashboard needs in one GraphQL call. */
export interface Dashboard {
  reviewRequested: number;
  mentions: number;
  opened: number;
  approved: number;
  changesRequested: number;
  awaitingReview: number;
  draft: number;
  ciPass: number;
  ciFail: number;
  ciPending: number;
  stale: number;
  /** Your open PRs, enriched with review decision + CI, for the inbox sections. */
  mine: MinePr[];
}

export interface MinePr {
  id: number;
  number: number;
  title: string;
  url: string;
  repo: string;
  author: string;
  avatar: string;
  isDraft: boolean;
  reviewDecision: string | null;
  ci: "success" | "failure" | "pending" | "none";
  createdAt: string | null;
  updatedAt: string | null;
}

/** A GitHub user's public profile (avatar hover mini-card). */
export interface UserProfile {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  twitter_username: string | null;
  hireable: boolean | null;
  created_at: string | null;
  followers: number;
  following: number;
  public_repos: number;
}

export interface UserRef {
  login: string;
  avatar_url: string;
  html_url: string;
  id: number;
}

export interface BranchRef {
  ref: string;
  sha: string;
  label: string | null;
}

export interface Label {
  id: number;
  name: string;
  /** Hex color without the leading `#`. */
  color: string;
  description?: string | null;
}

export interface PullSummary {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  user: UserRef;
  created_at: string;
  updated_at: string;
  html_url: string;
  repository_url?: string | null;
  body?: string | null;
  labels: Label[];
  /** Raw GitHub search `pull_request` object; `merged_at` distinguishes merged from closed. */
  pull_request?: { merged_at?: string | null } | null;
  /** Branch refs — present from the repo pulls endpoint (used for PR stacks), absent from search. */
  head?: BranchRef | null;
  base?: BranchRef | null;
}

export interface CheckRun {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "cancelled"
    | "skipped"
    | "timed_out"
    | "action_required"
    | "stale"
    | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  details_url?: string | null;
  app?: { name: string; slug: string } | null;
  check_suite?: { id: number } | null;
  external_id?: string | null;
  output?: {
    title?: string | null;
    summary?: string | null;
    text?: string | null;
    annotations_count?: number;
  } | null;
}

export interface CheckAnnotation {
  path: string;
  start_line: number | null;
  end_line: number | null;
  annotation_level: "failure" | "warning" | "notice" | string | null;
  message: string | null;
  title: string | null;
  raw_details?: string | null;
}

export interface CheckRunsResponse {
  total_count: number;
  check_runs: CheckRun[];
}

export interface ActionsStep {
  name: string;
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "skipped" | "cancelled" | "neutral" | string | null;
  number: number;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ActionsJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string | null;
  steps?: ActionsStep[];
}

export interface PullDetail {
  id: number;
  number: number;
  title: string;
  state: string;
  draft: boolean;
  user: UserRef;
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string | null;
  head: BranchRef;
  base: BranchRef;
  mergeable: boolean | null;
  mergeable_state: string | null;
  merged: boolean | null;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  commits: number | null;
  labels: Label[];
  auto_merge: { merge_method: string | null; enabled_by: UserRef | null } | null;
}

export interface PullFile {
  sha: string | null;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  previous_filename: string | null;
}

export interface ReviewThread {
  id: number;
  pull_request_review_id: number | null;
  diff_hunk: string | null;
  path: string;
  commit_id: string;
  user: UserRef;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  line: number | null;
  original_line: number | null;
  side: string | null;
  in_reply_to_id: number | null;
}

export interface Review {
  id: number;
  user: UserRef;
  body: string | null;
  state: string;
  html_url: string;
  submitted_at: string | null;
  commit_id: string | null;
}

export interface DependabotAlert {
  number: number;
  state: string;
  html_url: string;
  created_at: string;
  dependency: {
    package: { ecosystem: string; name: string } | null;
    manifest_path: string | null;
  };
  security_advisory: {
    summary: string;
    severity: string;
    ghsa_id: string;
    cve_id: string | null;
  };
  security_vulnerability: {
    severity: string;
    vulnerable_version_range: string | null;
    first_patched_version: { identifier: string } | null;
  } | null;
}

export interface IssueComment {
  id: number;
  user: UserRef;
  body: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export interface Notification {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  last_read_at: string | null;
  subject: {
    title: string;
    url: string | null;
    latest_comment_url: string | null;
    type: string;
  };
  repository: { full_name: string; html_url: string };
}

export interface ReviewThreadGraphQL {
  id: string;
  is_resolved: boolean;
  path: string;
  line: number | null;
  original_line: number | null;
  comment_ids: number[];
}

export interface DraftComment {
  path: string;
  body: string;
  line?: number | null;
  side?: string | null;
  start_line?: number | null;
  start_side?: string | null;
}

/** Parse a PR repository_url (api endpoint) into owner/repo. */
export function parseRepoUrl(
  url: string | null | undefined,
): { owner: string; repo: string } | null {
  if (!url) return null;
  const m = url.match(/repos\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

/** Parse a github.com PR url into owner/repo/number. */
export function parsePullUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}
