import { describe, expect, test } from "bun:test";
import type { Ranked } from "../src/effect/services/Triage";
import { activityWindow, queueAge, queueRepos, queueStatus } from "../src/features/home/model";

const now = Date.parse("2026-10-26T15:00:00Z");
const item = (patch: Partial<Ranked> = {}): Ranked => ({
  id: "a",
  kind: "pr",
  repo: "calcom/cal.com",
  title: "Review",
  mine: false,
  verdict: "yours",
  why: "Requested",
  ...patch,
});

describe("Home metrics", () => {
  test("fills sparse GitHub days and excludes data outside the calendar window", () => {
    expect(
      activityWindow(
        [
          { date: "2026-10-20", count: 40 },
          { date: "2026-10-24", count: 2 },
          { date: "2026-10-26", count: 3 },
          { date: "2026-10-27", count: 10 },
        ],
        3,
        now,
      ),
    ).toEqual([
      { date: "2026-10-24", count: 2 },
      { date: "2026-10-25", count: 0 },
      { date: "2026-10-26", count: 3 },
    ]);
  });
  test("compares equal calendar periods rather than equal numbers of active days", () => {
    const days = activityWindow(
      [
        { date: "2026-10-22", count: 5 },
        { date: "2026-10-26", count: 2 },
      ],
      6,
      now,
    );
    expect(days.slice(0, 3).reduce((n, d) => n + d.count, 0)).toBe(5);
    expect(days.slice(-3).reduce((n, d) => n + d.count, 0)).toBe(2);
  });
  test("handles year boundaries using UTC dates", () => {
    expect(activityWindow([], 2, Date.parse("2026-01-01T00:10:00Z")).map((d) => d.date)).toEqual([
      "2025-12-31",
      "2026-01-01",
    ]);
  });
  test("unknown dates stay unknown and exact age boundaries are consistent", () => {
    const day = 86_400_000;
    const items = [
      item(),
      item({ createdAt: "bad date" }),
      ...[0, 1, 3, 7].map((n) => item({ createdAt: new Date(now - n * day).toISOString() })),
    ];
    expect(queueAge(items, now).map((b) => b.count)).toEqual([1, 1, 1, 1, 2]);
  });
  test("same repository names under different owners stay separate", () => {
    expect(
      queueRepos([
        item({ repo: "alice/app" }),
        item({ repo: "bob/app" }),
        item({ repo: "alice/app" }),
      ]),
    ).toEqual([
      { label: "alice/app", count: 2 },
      { label: "bob/app", count: 1 },
    ]);
  });
  test("queue distribution counts each tracked item exactly once", () => {
    const verdicts = ["risky", "yours", "routine", "mergeable", "waiting", "unsorted"] as const;
    expect(queueStatus(verdicts.map((verdict) => item({ verdict }))).map((g) => g.count)).toEqual([
      2, 1, 1, 2,
    ]);
  });
});
