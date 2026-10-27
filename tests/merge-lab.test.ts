import { describe, expect, test } from "bun:test";
import type { PullFile } from "@/effect/schema";
import { type MergeBundle, simulateMerge } from "@/features/merge-lab/model";

const file = (filename: string, changes = 10): PullFile => ({
  sha: null,
  filename,
  status: "modified",
  additions: changes,
  deletions: 0,
  changes,
  patch: null,
  previous_filename: null,
});

const bundle = (
  id: string,
  number: number,
  files: PullFile[],
  extra: Partial<MergeBundle["pull"]> = {},
): MergeBundle => ({
  pull: {
    id,
    repo: "reviewly/reviewly",
    number,
    title: `PR ${number}`,
    ...extra,
  },
  files,
});

describe("merge lab", () => {
  test("finds exact cross-PR file collisions and blocks the set", () => {
    const result = simulateMerge([
      bundle("one", 1, [file("src/app.ts")]),
      bundle("two", 2, [file("src/app.ts"), file("src/new.ts")]),
    ]);

    expect(result.status).toBe("blocked");
    expect(result.files).toBe(2);
    expect(result.findings[0]?.files).toEqual(["src/app.ts"]);
    expect(result.stages.map((stage) => stage.state)).toEqual(["clear", "blocked"]);
    expect(result.stages[1]?.collisions).toEqual(["src/app.ts"]);
    expect(result.stages[1]?.reason).toBe("1 file collides with an earlier PR");
  });

  test("groups monorepo files into real architectural surfaces", () => {
    const result = simulateMerge([
      bundle("one", 1, [file("apps/web/src/a.ts", 20), file("apps/web/src/b.ts", 30)]),
      bundle("two", 2, [file("packages/ui/src/button.tsx", 50)]),
    ]);

    expect(result.surfaces).toEqual([
      { name: "apps/web", files: 2, lines: 50 },
      { name: "packages/ui", files: 1, lines: 50 },
    ]);
    expect(
      result.findings.some((finding) => finding.title.includes("architecture-sensitive")),
    ).toBe(true);
  });

  test("keeps stack layers in merge order", () => {
    const result = simulateMerge([
      bundle("top", 12, [file("src/top.test.ts")], { stackPosition: 2 }),
      bundle("base", 11, [file("src/base.test.ts")], { stackPosition: 1 }),
    ]);

    expect(result.order.map((pull) => pull.id)).toEqual(["base", "top"]);
    expect(result.stages.map((stage) => stage.pull.id)).toEqual(["base", "top"]);
    expect(result.status).toBe("ready");
  });

  test("carries known CI failures into the future verdict", () => {
    const result = simulateMerge([
      bundle("red", 9, [file("src/worker.ts"), file("tests/worker.test.ts")], { ci: "failure" }),
    ]);

    expect(result.status).toBe("blocked");
    expect(result.stages[0]?.state).toBe("blocked");
    expect(result.stages[0]?.reason).toBe("Required checks are failing");
    expect(result.findings.some((finding) => finding.title.includes("failing checks"))).toBe(true);
  });
});
