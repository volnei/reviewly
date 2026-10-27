import { describe, expect, test } from "bun:test";
import { TauriError } from "../src/effect/errors";
import type { PullSummary } from "../src/effect/schema";
import {
  type InboxData,
  dependabotFailure,
  inboxCandidatesFromPulls,
  pullRequestInbox,
} from "../src/effect/services/Inbox";
import { type Ranked, rankByRules } from "../src/effect/services/Triage";

const item = (id: string, kind: Ranked["kind"], patch: Partial<Ranked> = {}): Ranked => ({
  id,
  kind,
  repo: "owner/repo",
  title: id,
  mine: false,
  verdict: "yours",
  why: "Requested",
  ...patch,
});

describe("PR-only Inbox", () => {
  const cachedPull = (patch: Partial<PullSummary> = {}): PullSummary => ({
    id: 41,
    number: 41,
    title: "Keep the queue local",
    state: "open",
    draft: false,
    user: { login: "octo", avatar_url: "", html_url: "", id: 1 },
    created_at: "2026-10-25T10:00:00Z",
    updated_at: "2026-10-26T10:00:00Z",
    html_url: "https://github.com/owner/repo/pull/41",
    repository_url: "https://api.github.com/repos/owner/repo",
    body: null,
    labels: [],
    pull_request: null,
    head: null,
    base: null,
    ...patch,
  });

  test("builds the Inbox from persisted PR signals and ignores unrelated open PRs", () => {
    const candidates = inboxCandidatesFromPulls(
      [
        cachedPull({
          inboxIncoming: true,
          ci: "failure",
          conflicting: true,
          unresolvedThreadCount: 2,
          issueCommentCount: 5,
          codeOwners: ["@owner/team"],
        }),
        cachedPull({ id: 42, number: 42, html_url: "https://github.com/owner/repo/pull/42" }),
      ],
      "someone-else",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "pr:owner/repo#41",
      ci: "failure",
      conflicting: true,
      unresolved: 2,
      comments: 5,
      codeOwners: ["@owner/team"],
    });
  });

  test("persists dashboard membership instead of inferring ownership at read time", () => {
    const [candidate] = inboxCandidatesFromPulls(
      [
        cachedPull({
          inboxMine: true,
          user: { login: "octo", avatar_url: "", html_url: "", id: 1 },
        }),
      ],
      null,
    );
    expect(candidate.mine).toBe(true);
  });

  test("removes other item types from every queue without removing their dedicated data", () => {
    const data: InboxData = {
      turn: [item("pr", "pr"), item("mention", "mention"), item("alert", "finding")],
      unsorted: [item("unknown-pr", "pr"), item("unknown-alert", "finding")],
      later: [item("waiting-pr", "pr", { verdict: "waiting" }), item("local", "local")],
      notifications: [item("notification", "mention")],
      dependabot: [],
      counts: { inbox: 5, prs: 3, mentions: 1, health: 2 },
      syncedAt: 123,
    };
    const inbox = pullRequestInbox(data);
    expect(inbox.turn.map((i) => i.id)).toEqual(["pr"]);
    expect(inbox.unsorted.map((i) => i.id)).toEqual(["unknown-pr"]);
    expect(inbox.later.map((i) => i.id)).toEqual(["waiting-pr"]);
    expect(inbox.counts).toEqual({ inbox: 2, prs: 3, mentions: 1, health: 2 });
    expect(inbox.notifications).toBe(data.notifications);
    expect(data.turn).toHaveLength(3);
    expect(inbox.syncedAt).toBe(123);
  });
  test("an Inbox containing only mentions and findings has no PR actions", () => {
    const data: InboxData = {
      turn: [item("alert", "finding"), item("mention", "mention")],
      unsorted: [],
      later: [],
      notifications: [],
      dependabot: [],
      counts: { inbox: 2, prs: 0, mentions: 1, health: 1 },
      syncedAt: 0,
    };
    expect(pullRequestInbox(data).turn).toEqual([]);
    expect(pullRequestInbox(data).counts.inbox).toBe(0);
  });
  test("your failing CI needs action even before approval", () => {
    const ranked = rankByRules(
      item("pr", "pr", { mine: true, ci: "failure", reviewDecision: "REVIEW_REQUIRED" }),
    );
    expect(ranked.verdict).toBe("yours");
    expect(ranked.why).toBe("CI is failing on your PR");
  });
  test("drafts and PRs awaiting review stay in Later, approved green PRs are mergeable", () => {
    expect(
      rankByRules(item("draft", "pr", { mine: true, draft: true, ci: "failure" })).verdict,
    ).toBe("waiting");
    expect(rankByRules(item("waiting", "pr", { mine: true })).verdict).toBe("waiting");
    expect(
      rankByRules(item("ready", "pr", { mine: true, ci: "success", reviewDecision: "APPROVED" }))
        .verdict,
    ).toBe("mergeable");
  });
});

describe("Dependabot coverage", () => {
  const failure = (message: string) =>
    dependabotFailure("owner/repo", new TauriError({ cmd: "gh_dependabot_alerts", message }));

  test("distinguishes a disabled feature from missing security access", () => {
    expect(failure("Dependabot alerts are disabled for this repository").state).toBe("disabled");
    expect(failure("upstream github returned 403: must have admin rights").state).toBe("forbidden");
  });

  test("keeps unexpected GitHub failures visible", () => {
    expect(failure("upstream github returned 500: service unavailable")).toEqual({
      repo: "owner/repo",
      state: "error",
      alertCount: 0,
      detail: "upstream github returned 500: service unavailable",
    });
  });
});

test("PR titles never create a risk classification", () => {
  for (const title of [
    "feat(auth): password change",
    "fix(billing): invoice",
    "security migration breaking payment",
  ]) {
    const result = rankByRules(item("pr", "pr", { title }));
    expect(result.verdict).toBe("yours");
    expect(result.why).not.toContain("title");
  }
});

test("failing checks and conflicts report concrete reasons without a risk score", () => {
  const result = rankByRules(item("pr", "pr", { ci: "failure", conflicting: true }));
  expect(result.verdict).toBe("yours");
  expect(result.why).toBe("CI failing and conflicts with base");
});
