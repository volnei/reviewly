import { describe, expect, test } from "bun:test";
import type { Ranked } from "../src/effect/services/Triage";
import {
  EMPTY_FILTER,
  applyFilter,
  applyFilterWithStacks,
  deserializeFilter,
  isFiltering,
  savedViewPath,
  serializeFilter,
} from "../src/features/list/filters";

const pr = (id: string, patch: Partial<Ranked> = {}): Ranked => ({
  id,
  title: id,
  repo: "one/app",
  kind: "pr",
  mine: false,
  author: "alice",
  verdict: "yours",
  why: "Requested",
  ...patch,
});

describe("Shared list filters", () => {
  test("combines OR within authors with AND across fields and all included labels", () => {
    const filter = {
      ...EMPTY_FILTER,
      authors: new Set(["alice", "bob"]),
      repos: new Set(["one/app"]),
      labels: new Map([
        ["bug", "in"],
        ["backend", "in"],
        ["blocked", "out"],
      ] as const),
    };
    const items = [
      pr("match", { author: "bob", labels: ["bug", "backend"] }),
      pr("excluded", { labels: ["bug", "backend", "blocked"] }),
      pr("missing-label", { labels: ["bug"] }),
      pr("other-repo", { repo: "two/app", labels: ["bug", "backend"] }),
      pr("other-author", { author: "carol", labels: ["bug", "backend"] }),
    ];
    expect(applyFilter(items, filter).map((i) => i.id)).toEqual(["match"]);
  });
  test("not-failing CI includes pending and unknown checks, matching the previous behavior", () => {
    const items = [
      pr("failed", { ci: "failure" }),
      pr("green", { ci: "success" }),
      pr("pending", { ci: "pending" }),
      pr("unknown"),
    ];
    expect(
      applyFilter(items, { ...EMPTY_FILTER, ciStatus: "not-failing" }).map(
        (i) => i.id,
      ),
    ).toEqual(["green", "pending", "unknown"]);
    expect(
      applyFilter(items, { ...EMPTY_FILTER, ciStatus: "failing" }).map(
        (i) => i.id,
      ),
    ).toEqual(["failed"]);
    expect(
      applyFilter(items, { ...EMPTY_FILTER, ciFailing: true }).map((i) => i.id),
    ).toEqual(["failed"]);
  });
  test("filters pull requests by any requested code owner", () => {
    const items = [
      pr("payments", { codeOwners: ["@acme/payments", "@alice"] }),
      pr("web", { codeOwners: ["@acme/web"] }),
      pr("unowned"),
    ];
    const filter = {
      ...EMPTY_FILTER,
      codeOwners: new Set(["@acme/payments", "@acme/infra"]),
    };
    expect(applyFilter(items, filter).map((item) => item.id)).toEqual([
      "payments",
    ]);
  });
  test("combines pull request statuses and keeps drafts distinct from open", () => {
    const items = [
      pr("open", { state: "open" }),
      pr("draft", { state: "open", draft: true }),
      pr("merged", { state: "closed", merged: true }),
      pr("closed", { state: "closed" }),
    ];
    const filter = {
      ...EMPTY_FILTER,
      statuses: new Set(["open", "draft"] as const),
    };
    expect(applyFilter(items, filter).map((item) => item.id)).toEqual([
      "open",
      "draft",
    ]);
  });
  test("old saved views migrate their CI flag and preserve label exclusions", () => {
    const serialized = serializeFilter({
      ...EMPTY_FILTER,
      ciFailing: true,
      labels: new Map([["blocked", "out"]]),
    });
    const restored = deserializeFilter({ ...serialized, ciStatus: undefined });
    expect(restored.ciStatus).toBe("failing");
    expect(restored.labels.get("blocked")).toBe("out");
    expect(restored.statuses.size).toBe(0);
    expect(isFiltering(restored)).toBe(true);
  });
  test("saved views round-trip multi-selects, search, CI and exclusions", () => {
    const filter = {
      ...EMPTY_FILTER,
      q: "#42",
      repos: new Set(["one/app", "two/app"]),
      authors: new Set(["alice", "bob"]),
      codeOwners: new Set(["@one/payments"]),
      statuses: new Set(["draft", "merged"] as const),
      ciStatus: "not-failing" as const,
      labels: new Map([["blocked", "out"]] as const),
      hideBots: true,
      stacked: true,
    };
    const restored = deserializeFilter(
      JSON.parse(JSON.stringify(serializeFilter(filter))),
    );
    expect(serializeFilter(restored)).toEqual(serializeFilter(filter));
  });
  test("saved views return to the list that created them, including workspace-scoped views", () => {
    expect(savedViewPath({ list: "prs:all" })).toBe("/prs");
    expect(savedViewPath({ list: "prs:acme/web" })).toBe("/prs");
    expect(savedViewPath({ list: "mentions:all" })).toBe("/mentions");
    expect(savedViewPath({ list: "unknown:all" })).toBe("/inbox");
  });
  test("bots and stacks can be combined without losing the rest of the selection", () => {
    const stack = { number: 1, position: 1, size: 2, base: "main" };
    const items = [
      pr("match", { stack }),
      pr("bot", { stack, author: "dependabot[bot]" }),
      pr("not-stacked"),
    ];
    expect(
      applyFilter(items, {
        ...EMPTY_FILTER,
        hideBots: true,
        stacked: true,
      }).map((i) => i.id),
    ).toEqual(["match"]);
  });
  test("a matching stack layer keeps foundations that do not match the filter", () => {
    const foundation = {
      number: 91,
      position: 1,
      size: 2,
      base: "main",
    };
    const feature = { ...foundation, position: 2 };
    const items = [
      pr("foundation", {
        title: "Add shared storage foundation",
        author: "bob",
        labels: ["infrastructure"],
        stack: foundation,
      }),
      pr("feature", {
        title: "Add passkey settings",
        author: "alice",
        labels: ["frontend"],
        stack: feature,
      }),
      pr("unrelated", {
        title: "Add another settings page",
        author: "alice",
        labels: ["frontend"],
      }),
    ];
    const filter = {
      ...EMPTY_FILTER,
      q: "passkey",
      authors: new Set(["alice"]),
      labels: new Map([["frontend", "in"]] as const),
    };
    expect(applyFilterWithStacks(items, filter).map((item) => item.id)).toEqual(
      ["foundation", "feature"],
    );
  });
  test("clearing filters removes search, selected values and operators", () => {
    expect(isFiltering(EMPTY_FILTER)).toBe(false);
    expect(applyFilter([pr("a"), pr("b")], EMPTY_FILTER)).toHaveLength(2);
  });
});
