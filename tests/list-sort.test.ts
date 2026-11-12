import { expect, test } from "bun:test";

import type { Ranked } from "../src/effect/services/Triage";
import { compareListItems } from "../src/features/list/sort";
const pr = (id: string, additions?: number): Ranked => ({
  id,
  title: id,
  kind: "pr",
  repo: "a/b",
  mine: false,
  verdict: "waiting",
  why: "",
  additions,
  deletions: 0,
  changedFiles: 1,
});
test("review duration sorts both ways with unknown estimates always last", () => {
  const items = [pr("unknown"), pr("long", 700), pr("short", 35)];
  expect(
    [...items].sort((a, b) => compareListItems("review-short", a, b)).map((p) => p.id),
  ).toEqual(["short", "long", "unknown"]);
  expect([...items].sort((a, b) => compareListItems("review-long", a, b)).map((p) => p.id)).toEqual(
    ["long", "short", "unknown"],
  );
});
test("newest and oldest order use dates while missing dates stay last", () => {
  const items = [
    { ...pr("old"), createdAt: "2026-01-01" },
    { ...pr("new"), createdAt: "2026-11-09" },
    pr("unknown"),
  ];
  expect([...items].sort((a, b) => compareListItems("created", a, b)).map((p) => p.id)).toEqual([
    "new",
    "old",
    "unknown",
  ]);
  expect([...items].sort((a, b) => compareListItems("created-asc", a, b)).map((p) => p.id)).toEqual(
    ["old", "new", "unknown"],
  );
});
