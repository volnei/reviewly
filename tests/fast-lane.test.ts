import { describe, expect, test } from "bun:test";

import type { Ranked } from "../src/effect/services/Triage";
import {
  fastLaneReason,
  isFastLane,
  matchesFastLanePath,
} from "../src/features/fast-lane";

const policy = {
  enabled: true,
  includeDependabot: true,
  includeRenovate: true,
  requireGreenCi: true,
  excludeDrafts: true,
  excludeConflicts: true,
  excludeChangesRequested: true,
  excludeOpenThreads: true,
  trustedAuthors: [],
  maxChangedFiles: null,
  maxChangedLines: null,
  allowedPaths: [],
  blockedPaths: [],
  requiredLabels: [],
  blockedLabels: [],
} as const;

const files = (paths: string[], changedLines = 20) => ({
  paths,
  changedFiles: paths.length,
  changedLines,
});

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
      "dependabot · team policy matched",
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

  test("keeps PRs touching blocked paths out of Fast lane", () => {
    const guarded = { ...policy, blockedPaths: ["src/auth/**", "db/migrations/**", "**/*.sql"] };
    expect(isFastLane(pr(), guarded, files(["src/ui/button.tsx"]))).toBe(true);
    expect(isFastLane(pr(), guarded, files(["src/auth/session.ts"]))).toBe(false);
    expect(isFastLane(pr(), guarded, files(["db/schema.sql"]))).toBe(false);
  });

  test("supports trusted internal automation without assuming an ecosystem", () => {
    const custom = { ...policy, trustedAuthors: ["release-bot"] };
    expect(isFastLane(pr({ author: "release-bot" }), custom)).toBe(true);
    expect(isFastLane(pr({ author: "unknown-bot" }), custom)).toBe(false);
  });

  test("enforces universal size, allowlist and label rules", () => {
    const guarded = {
      ...policy,
      maxChangedFiles: 2,
      maxChangedLines: 100,
      allowedPaths: ["docs/**", "config/safe/**"],
      requiredLabels: ["automation"],
      blockedLabels: ["security"],
    };
    const candidate = pr({ labels: ["automation"] });
    expect(isFastLane(candidate, guarded, files(["docs/readme.md"], 40))).toBe(true);
    expect(isFastLane(candidate, guarded, files(["docs/a.md", "docs/b.md", "docs/c.md"]))).toBe(
      false,
    );
    expect(isFastLane(candidate, guarded, files(["docs/readme.md"], 101))).toBe(false);
    expect(isFastLane(candidate, guarded, files(["src/main.rs"]))).toBe(false);
    expect(isFastLane(pr({ labels: ["automation", "security"] }), guarded, files(["docs/a.md"]))).toBe(
      false,
    );
  });

  test("fails closed when changed files cannot be verified", () => {
    expect(isFastLane(pr(), { ...policy, blockedPaths: ["src/auth/**"] })).toBe(false);
    expect(isFastLane(pr(), { ...policy, blockedPaths: ["src/auth/**"] }, null)).toBe(false);
  });

  test("supports repository-relative path globs", () => {
    expect(matchesFastLanePath("src/auth/session.ts", "src/auth/**")).toBe(true);
    expect(matchesFastLanePath("src/auth/nested/token.ts", "src/auth/**")).toBe(true);
    expect(matchesFastLanePath("schema.sql", "**/*.sql")).toBe(true);
    expect(matchesFastLanePath("db/schema.sql", "**/*.sql")).toBe(true);
    expect(matchesFastLanePath("src/auth.ts", "src/auth/**")).toBe(false);
  });
});
