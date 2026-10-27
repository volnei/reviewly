import { Context, Effect, Layer } from "effect";
import { isNative } from "../Tauri";
import type { AppError } from "../errors";
import { TauriError } from "../errors";
import type * as S from "../schema";
import { GitHub, splitRepo } from "./GitHub";
import { PrefsService, isSnoozed } from "./Prefs";
import { type Candidate, type Ranked, Triage, compareRanked } from "./Triage";

export interface InboxData {
  /** Your turn, most urgent first. */
  readonly turn: ReadonlyArray<Ranked>;
  /** Ranked under the confidence you set — you decide. */
  readonly unsorted: ReadonlyArray<Ranked>;
  /** Waiting on others, and what you snoozed. */
  readonly later: ReadonlyArray<Ranked>;
  /** Every unread notification, whatever its reason, for the Mentions screen's wider views. */
  readonly notifications: ReadonlyArray<Ranked>;
  /** Whether GitHub let us inspect Dependabot in each watched repository. */
  readonly dependabot: ReadonlyArray<DependabotRepositoryStatus>;
  readonly counts: {
    readonly inbox: number;
    readonly prs: number;
    readonly mentions: number;
    readonly health: number;
  };
  readonly syncedAt: number;
}

export type DependabotRepositoryState = "available" | "disabled" | "forbidden" | "error";

export interface DependabotRepositoryStatus {
  readonly repo: string;
  readonly state: DependabotRepositoryState;
  readonly alertCount: number;
  readonly detail?: string;
}

/** GitHub uses different responses for a disabled feature and missing security access. */
export function dependabotFailure(repo: string, error: unknown): DependabotRepositoryStatus {
  const detail = error instanceof TauriError ? error.message : String(error);
  const state: DependabotRepositoryState = /disabled|not enabled/i.test(detail)
    ? "disabled"
    : /\b40[13]\b|forbidden|admin or security|must have admin|permission/i.test(detail)
      ? "forbidden"
      : "error";
  return { repo, state, alertCount: 0, detail };
}

/** The review queue is PR-only; notifications and findings retain their own sources. */
export function pullRequestInbox(data: InboxData): InboxData {
  const turn = data.turn.filter((i) => i.kind === "pr");
  const unsorted = data.unsorted.filter((i) => i.kind === "pr");
  const later = data.later.filter((i) => i.kind === "pr");
  return {
    ...data,
    turn,
    unsorted,
    later,
    counts: { ...data.counts, inbox: turn.length + unsorted.length },
  };
}

export class Inbox extends Context.Service<
  Inbox,
  {
    readonly load: Effect.Effect<InboxData, AppError>;
  }
>()("reviewly/Inbox") {}

export const prId = (repo: string, number: number) => `pr:${repo}#${number}`;

function fromDashboard(p: S.DashboardPr, mine: boolean): Candidate {
  const split = splitRepo(p.repo);
  return {
    id: prId(p.repo, p.number),
    kind: "pr",
    title: p.title,
    repo: p.repo,
    owner: split?.owner,
    repoName: split?.repo,
    number: p.number,
    url: p.url,
    author: p.author,
    avatar: p.avatar,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    mine,
    draft: p.isDraft,
    ci: p.ci,
    conflicting: p.conflicting,
    reviewDecision: p.reviewDecision,
    unresolved: p.unresolvedThreadCount,
    comments: p.issueCommentCount,
    codeOwners: p.codeOwners,
  };
}

/** A PR as the cache and the search endpoints return it: enough for the full list. */
export function fromSummary(p: S.PullSummary, viewer: string | null): Candidate {
  const repo =
    p.repository_url?.replace(/^.*\/repos\//, "") ??
    p.html_url.replace(/^https:\/\/github\.com\//, "").replace(/\/pull\/\d+.*$/, "");
  const split = splitRepo(repo);
  return {
    id: prId(repo, p.number),
    kind: "pr",
    title: p.title,
    repo,
    owner: split?.owner,
    repoName: split?.repo,
    number: p.number,
    url: p.html_url,
    author: p.user.login,
    avatar: p.user.avatar_url,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    mine: p.inboxMine ?? (viewer != null && viewer === p.user.login),
    draft: p.draft,
    ci: p.ci,
    conflicting: p.conflicting,
    reviewDecision: p.reviewDecision,
    unresolved: p.unresolvedThreadCount,
    comments: p.issueCommentCount,
    state: p.state,
    merged: !!p.pull_request?.merged_at,
    labels: p.labels.map((l) => l.name),
    codeOwners: p.codeOwners?.length
      ? p.codeOwners
      : [
          ...(p.requested_reviewers ?? []).map((reviewer) => `@${reviewer.login}`),
          ...(p.requested_teams ?? []).map((team) =>
            team.organization?.login ? `@${team.organization.login}/${team.slug}` : `@${team.slug}`,
          ),
        ],
    stack: p.stack ?? undefined,
  };
}

/** The native Inbox is a projection of the canonical PR mirror, not another GitHub list. */
export function inboxCandidatesFromPulls(
  pulls: ReadonlyArray<S.PullSummary>,
  viewer: string | null,
): ReadonlyArray<Candidate> {
  return pulls
    .filter((pull) => pull.inboxIncoming || pull.inboxMine)
    .map((pull) => fromSummary(pull, viewer));
}

/** Why a notification exists, in the reviewer's words. */
const REASON_WHY: Record<string, string> = {
  mention: "mentioned you",
  team_mention: "mentioned your team",
  review_requested: "asked for your review",
  comment: "a new comment where you took part",
  author: "activity on something of yours",
  assign: "assigned to you",
  ci_activity: "CI finished on your pull request",
  state_change: "it was closed, merged or reopened",
  subscribed: "you subscribed to it",
  manual: "you subscribed to it",
  security_alert: "a security alert",
  approval_requested: "a deployment waits for your approval",
};

export const isMention = (reason: string) => reason === "mention" || reason === "team_mention";

/** Keep the sidebar badge in lockstep with the Mentions-only view. */
export const countMentions = (items: ReadonlyArray<{ readonly reason?: string }>) =>
  items.filter((item) => isMention(item.reason ?? "")).length;

function notificationCandidate(n: S.Notification): Candidate {
  const m = n.subject.url?.match(/\/(?:pulls|issues)\/(\d+)$/);
  const number = m ? Number(m[1]) : undefined;
  const split = splitRepo(n.repository.full_name);
  return {
    id: `mention:${n.id}`,
    kind: "mention",
    title: n.subject.title,
    repo: n.repository.full_name,
    owner: split?.owner,
    repoName: split?.repo,
    number,
    url: number ? `${n.repository.html_url}/pull/${number}` : n.repository.html_url,
    updatedAt: n.updated_at,
    createdAt: n.updated_at,
    mine: false,
    notificationId: n.id,
    reason: n.reason,
  };
}

function fromNotification(n: S.Notification): Candidate | null {
  if (!isMention(n.reason)) return null;
  const m = n.subject.url?.match(/\/(?:pulls|issues)\/(\d+)$/);
  const number = m ? Number(m[1]) : undefined;
  const split = splitRepo(n.repository.full_name);
  return {
    id: `mention:${n.id}`,
    kind: "mention",
    title: n.subject.title,
    repo: n.repository.full_name,
    owner: split?.owner,
    repoName: split?.repo,
    number,
    url: number ? `${n.repository.html_url}/pull/${number}` : n.repository.html_url,
    updatedAt: n.updated_at,
    createdAt: n.updated_at,
    mine: false,
    notificationId: n.id,
  };
}

function fromAlert(repo: string, a: S.DependabotAlert): Candidate {
  const split = splitRepo(repo);
  const pkg = a.dependency.package?.name ?? "a dependency";
  return {
    id: `alert:${repo}#${a.number}`,
    kind: "finding",
    title: `${pkg} has a known advisory`,
    repo,
    owner: split?.owner,
    repoName: split?.repo,
    number: a.number,
    url: a.html_url,
    createdAt: a.created_at,
    updatedAt: a.created_at,
    mine: false,
    severity: a.security_advisory.severity,
    patched: !!a.security_vulnerability?.first_patched_version,
    author: "dependabot",
    detail: a.security_advisory.summary,
    packageName: pkg,
    patchedVersion: a.security_vulnerability?.first_patched_version?.identifier,
    manifestPath: a.dependency.manifest_path,
  };
}

export const InboxLive = Layer.effect(
  Inbox,
  Effect.gen(function* () {
    const gh = yield* GitHub;
    const prefs = yield* PrefsService;
    const triage = yield* Triage;

    const load = Effect.gen(function* () {
      let p = yield* prefs.get;
      if (p.watchedRepos.length === 0) {
        // Nothing chosen yet: watch the first repositories GitHub lists for you, until Settings says otherwise.
        const repos = yield* gh.repos.pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
        if (repos.length)
          p = yield* prefs.update((q) => ({ ...q, watchedRepos: repos.slice(0, 8) }));
      }
      const qualifier = p.watchedRepos.map((r) => `repo:${r}`).join(" ");
      const [repoPulls, browserDashboard, notifs, dependabot] = yield* Effect.all(
        [
          Effect.forEach(
            p.watchedRepos,
            (repo) => {
              const split = splitRepo(repo);
              return split
                ? gh.repoPulls(split.owner, split.repo).pipe(Effect.orElseSucceed(() => []))
                : Effect.succeed([] as ReadonlyArray<S.PullSummary>);
            },
            { concurrency: 4 },
          ),
          isNative()
            ? Effect.succeed(null)
            : gh
                .dashboard(qualifier)
                .pipe(Effect.map((dashboard) => dashboard as S.Dashboard | null)),
          gh
            .notifications(false)
            .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<S.Notification>)),
          Effect.forEach(
            p.watchedRepos,
            (repo) => {
              const split = splitRepo(repo);
              if (!split)
                return Effect.succeed({
                  candidates: [] as Candidate[],
                  status: {
                    repo,
                    state: "error" as const,
                    alertCount: 0,
                    detail: "The repository name is not valid.",
                  },
                });
              return gh.dependabotAlerts(split.owner, split.repo).pipe(
                Effect.match({
                  onFailure: (error) => ({
                    candidates: [] as Candidate[],
                    status: dependabotFailure(repo, error),
                  }),
                  onSuccess: (as) => ({
                    candidates: as.map((a) => fromAlert(repo, a)),
                    status: {
                      repo,
                      state: "available" as const,
                      alertCount: as.length,
                    },
                  }),
                }),
              );
            },
            { concurrency: 4 },
          ),
        ],
        { concurrency: "unbounded" },
      );

      const cachedPulls = repoPulls.flat();
      const pullCandidates = browserDashboard
        ? [
            ...browserDashboard.incoming.map((x) => fromDashboard(x, false)),
            ...browserDashboard.mine
              .filter(
                (x) =>
                  !browserDashboard.incoming.some(
                    (incoming) => incoming.repo === x.repo && incoming.number === x.number,
                  ),
              )
              .map((x) => fromDashboard(x, true)),
          ]
        : inboxCandidatesFromPulls(cachedPulls, null);
      const alerts = dependabot.flatMap((result) => result.candidates);
      const candidates: Candidate[] = [
        ...pullCandidates,
        ...notifs.map(fromNotification).filter((x): x is Candidate => x !== null),
        ...alerts,
      ];
      const ranked = yield* triage.rank(candidates);
      const done = new Set(p.done);
      const notifications: Ranked[] = notifs
        .map(notificationCandidate)
        .filter((c) => !done.has(c.id))
        .map((c) => ({
          ...c,
          verdict: isMention(c.reason ?? "") ? "yours" : "routine",
          why: REASON_WHY[c.reason ?? ""] ?? (c.reason ?? "").replace(/_/g, " "),
        }));
      const live = ranked.filter((r) => !done.has(r.id));
      const now = Date.now();
      const snoozed = live.filter((r) => isSnoozed(p, r.id, now));
      const awake = live.filter((r) => !isSnoozed(p, r.id, now));
      const turn = awake
        .filter((r) => r.verdict !== "waiting" && r.verdict !== "unsorted")
        .sort(compareRanked);
      const unsorted = awake.filter((r) => r.verdict === "unsorted").sort(compareRanked);
      const later = [...awake.filter((r) => r.verdict === "waiting"), ...snoozed].sort(
        compareRanked,
      );
      return {
        turn,
        unsorted,
        later,
        notifications,
        dependabot: dependabot.map((result) => result.status),
        counts: {
          inbox: [...turn, ...unsorted].filter((i) => i.kind === "pr").length,
          prs: cachedPulls.length,
          mentions: countMentions(notifications),
          health: alerts.length,
        },
        syncedAt: Date.now(),
      } satisfies InboxData;
    }).pipe(Effect.withSpan("Inbox.load"));

    return { load };
  }),
);
