import { describe, expect, test } from "bun:test";
import { parseRepository, scopeInbox } from "../src/app/workspace";
import type { InboxData } from "../src/effect/services/Inbox";
import type { Ranked } from "../src/effect/services/Triage";

const item = (
  id: string,
  repo: string,
  kind: Ranked["kind"] = "pr",
  patch: Partial<Ranked> = {},
): Ranked => ({
  id,
  repo,
  kind,
  title: id,
  verdict: "yours",
  why: "Review requested",
  ...patch,
});
const data: InboxData = {
  turn: [item("a", "calcom/cal.com"), item("b", "volnei/reviewly")],
  unsorted: [item("c", "Calcom/Cal.com", "finding")],
  later: [item("d", "volnei/reviewly")],
  notifications: [
    item("n1", "calcom/cal.com", "mention", { reason: "mention" }),
    item("n2", "volnei/reviewly", "mention", { reason: "team_mention" }),
    item("n3", "calcom/cal.com", "mention", { reason: "review_requested" }),
  ],
  dependabot: [
    { repo: "calcom/cal.com", state: "available", alertCount: 1 },
    { repo: "volnei/reviewly", state: "forbidden", alertCount: 0 },
  ],
  counts: { inbox: 3, prs: 3, mentions: 2, health: 1 },
  syncedAt: 123,
};

describe("repository workspace", () => {
  test("accepts slugs and GitHub URLs, rejects other hosts and paths", () => {
    expect(parseRepository(" calcom/cal.com ")).toBe("calcom/cal.com");
    expect(parseRepository("https://github.com/volnei/reviewly.git/")).toBe("volnei/reviewly");
    for (const input of [
      "",
      "repository",
      "a/b/pull/1",
      "https://example.com/a/b",
      "a/b?tab=readme",
    ]) {
      expect(parseRepository(input)).toBeNull();
    }
  });
  test("all repositories preserves the original data and counts", () => {
    expect(scopeInbox(data, null)).toBe(data);
  });
  test("repairs a stale cached mention count without waiting for GitHub", () => {
    const stale = { ...data, counts: { ...data.counts, mentions: 50 } };
    expect(scopeInbox(stale, null).counts.mentions).toBe(2);
  });
  test("scopes every section and notifications without mutating the global cache", () => {
    const scoped = scopeInbox(data, "calcom/cal.com");
    expect(scoped.turn.map((i) => i.id)).toEqual(["a"]);
    expect(scoped.unsorted.map((i) => i.id)).toEqual(["c"]);
    expect(scoped.later).toEqual([]);
    expect(scoped.notifications.map((i) => i.id)).toEqual(["n1", "n3"]);
    expect(scoped.dependabot.map((status) => status.repo)).toEqual(["calcom/cal.com"]);
    expect(scoped.counts).toEqual({ inbox: 1, prs: 1, mentions: 1, health: 1 });
    expect(scoped.syncedAt).toBe(123);
    expect(data.turn).toHaveLength(2);
    expect(data.notifications).toHaveLength(3);
  });
  test("counts only actual mentions, not every GitHub notification", () => {
    const scoped = scopeInbox(data, "calcom/cal.com");
    expect(scoped.notifications.map((i) => i.id)).toEqual(["n1", "n3"]);
    expect(scoped.counts.mentions).toBe(1);
  });
  test("a newly added empty workspace never falls back to other repositories", () => {
    const scoped = scopeInbox(data, "new/project");
    expect([...scoped.turn, ...scoped.unsorted, ...scoped.later, ...scoped.notifications]).toEqual(
      [],
    );
    expect(scoped.counts).toEqual({ inbox: 0, prs: 0, mentions: 0, health: 0 });
  });
});
