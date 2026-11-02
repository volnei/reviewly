import { describe, expect, test } from "bun:test";

import type { Ranked } from "../src/effect/services/Triage";
import { fastLaneReason, isFastLane } from "../src/features/fast-lane";

const policy = {
  enabled: true,
  includeDependabot: true,
  includeRenovate: true,
  requireGreenCi: true,
  excludeDrafts: true,
  excludeConflicts: true,
  excludeChangesRequested: true,
  excludeOpenThreads: true,
} as const;

const pr = (patch: Partial<Ranked> = {}): Ranked => ({
  id: "pr:owner/repo#42",
  kind: "pr",
  repo: "owner/repo",
  number: 42,
  title: "Bump zod from 4.1.2 to 4.1.3",
  author: "dependabot[bot]",
  mine: false,
  draft: false,
  ci: "success",
  conflicting: false,
  unresolved: 0,
  reviewDecision: "REVIEW_REQUIRED",
  verdict: "routine",
  why: "a dependency bump",
  ...patch,
});

describe("Teams Fast lane", () => {
  test("accepts a clean dependency-bot update and explains the placement", () => {
    expect(isFastLane(pr(), policy)).toBe(true);
    expect(fastLaneReason(pr(), policy)).toBe(
      "dependabot dependency update · team policy matched",
    );
    expect(isFastLane(pr({ author: "renovate[bot]" }), policy)).toBe(true);
  });

  test("rejects human PRs and every visible blocker", () => {
    for (const candidate of [
      pr({ author: "sam" }),
      pr({ mine: true }),
      pr({ draft: true }),
      pr({ ci: "failure" }),
      pr({ ci: "pending" }),
      pr({ conflicting: true }),
      pr({ reviewDecision: "CHANGES_REQUESTED" }),
      pr({ unresolved: 1 }),
    ]) {
      expect(isFastLane(candidate, policy)).toBe(false);
    }
  });

  test("never classifies findings or mentions as Fast lane PRs", () => {
    expect(isFastLane(pr({ kind: "finding" }), policy)).toBe(false);
    expect(isFastLane(pr({ kind: "mention" }), policy)).toBe(false);
  });

  test("obeys the team-owned switches instead of hard-coding the rules", () => {
    expect(isFastLane(pr(), { ...policy, enabled: false })).toBe(false);
    expect(isFastLane(pr(), { ...policy, includeDependabot: false })).toBe(false);
    expect(isFastLane(pr({ ci: "failure" }), { ...policy, requireGreenCi: false })).toBe(true);
    expect(isFastLane(pr({ draft: true }), { ...policy, excludeDrafts: false })).toBe(true);
  });
});
