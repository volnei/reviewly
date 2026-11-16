import { describe, expect, test } from "bun:test";

import type { PullFile } from "../src/effect/schema";
import {
  estimateFileHeight,
  findDiffHits,
  hunkStarts,
  LARGE_DIFF_LINES,
  lineFraction,
  shouldFoldLargeDiff,
} from "../src/features/pr/virtual-diff";

const file = (patch: string, filename = "src/example.ts") =>
  ({
    filename,
    patch,
    status: "modified",
    additions: 2,
    deletions: 1,
    changes: 3,
  }) as PullFile;

describe("virtual diff model", () => {
  const changed = file("@@ -10,3 +10,4 @@\n same\n-old value\n+new value\n+find me\n tail");

  test("searches unmounted patches by path, side and line", () => {
    expect(findDiffHits(changed, "value")).toEqual([
      { path: "src/example.ts", side: "L", line: 11 },
      { path: "src/example.ts", side: "R", line: 11 },
    ]);
    expect(findDiffHits(changed, "find me")).toEqual([
      { path: "src/example.ts", side: "R", line: 12 },
    ]);
  });

  test("provides stable estimated geometry for navigation and the minimap", () => {
    expect(hunkStarts(changed)).toEqual([{ path: "src/example.ts", side: "R", line: 10 }]);
    expect(lineFraction(changed, "R", 12)).toBeGreaterThan(0);
    expect(lineFraction(changed, "R", 12)).toBeLessThan(1);
    expect(estimateFileHeight(changed, false)).toBeGreaterThan(estimateFileHeight(changed, true));
  });

  test("folds a pathological single-file diff before it can monopolize the UI thread", () => {
    const huge = file(
      `@@ -1,1 +1,${LARGE_DIFF_LINES + 1} @@\n${Array.from(
        { length: LARGE_DIFF_LINES + 1 },
        (_, index) => `+line ${index}`,
      ).join("\n")}`,
    );
    expect(shouldFoldLargeDiff(huge)).toBe(true);
    expect(shouldFoldLargeDiff(changed)).toBe(false);
  });
});
