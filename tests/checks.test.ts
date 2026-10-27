import { describe, expect, test } from "bun:test";
import type { CheckRun } from "../src/effect/schema";
import { checkDuration, checkState, groupChecks } from "../src/features/pr/checks-model";

const check = (name: string, patch: Partial<CheckRun> = {}): CheckRun => ({
  id: 1,
  name,
  status: "completed",
  conclusion: "success",
  started_at: null,
  completed_at: null,
  html_url: "https://github.com/owner/repo/actions/runs/1",
  ...patch,
});

describe("Checks view", () => {
  test("distinguishes skipped, cancelled, incomplete and unknown results from passed", () => {
    expect(checkState(check("A"))).toBe("passed");
    expect(checkState(check("A", { conclusion: "skipped" }))).toBe("skipped");
    expect(checkState(check("A", { conclusion: "neutral" }))).toBe("skipped");
    expect(checkState(check("A", { conclusion: "cancelled" }))).toBe("cancelled");
    expect(checkState(check("A", { conclusion: null }))).toBe("other");
    expect(checkState(check("A", { status: "queued", conclusion: null }))).toBe("running");
    expect(checkState(check("A", { conclusion: "timed_out" }))).toBe("failed");
  });
  test("groups numbered shards while preserving matrix and workflow names", () => {
    const groups = groupChecks([
      check("Tests / E2E (10/12)"),
      check("Tests / E2E (2/12)"),
      check("Tests / E2E (1/12)"),
      check("Tests / E2E (node 22)"),
      check("Other / E2E (1/12)"),
    ]);
    const shards = groups.find((g) => g.label === "Tests / E2E");
    expect(groups).toHaveLength(3);
    expect(shards?.runs.map((r) => r.name)).toEqual([
      "Tests / E2E (1/12)",
      "Tests / E2E (2/12)",
      "Tests / E2E (10/12)",
    ]);
    expect(shards?.attention).toBe(false);
  });
  test("failures and running jobs lead the groups and their individual shards", () => {
    const groups = groupChecks([
      check("A"),
      check("Z (1/2)"),
      check("Z (2/2)", { conclusion: "failure" }),
      check("B", { status: "in_progress", conclusion: null }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(["Z", "B", "A"]);
    expect(groups[0].runs[0].name).toBe("Z (2/2)");
    expect(groups.map((g) => g.attention)).toEqual([true, true, false]);
  });
  test("does not merge matching check names from different apps", () => {
    expect(
      groupChecks([
        check("Build (1/2)", { app: { name: "One", slug: "one" } }),
        check("Build (2/2)", { app: { name: "Two", slug: "two" } }),
      ]),
    ).toHaveLength(2);
  });
  test("invalid, negative and missing durations stay unknown", () => {
    expect(checkDuration(check("A"))).toBeNull();
    expect(checkDuration(check("A", { started_at: "bad", completed_at: "bad" }))).toBeNull();
    expect(
      checkDuration(
        check("A", { started_at: "2026-10-26T12:01:00Z", completed_at: "2026-10-26T12:00:00Z" }),
      ),
    ).toBeNull();
    expect(
      checkDuration(
        check("A", { started_at: "2026-10-26T12:00:00Z", completed_at: "2026-10-26T12:01:20Z" }),
      ),
    ).toBe(80000);
  });
});
