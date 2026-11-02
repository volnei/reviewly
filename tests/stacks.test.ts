import { describe, expect, test } from "bun:test";
import type { PullStack } from "../src/effect/schema";
import type { Ranked } from "../src/effect/services/Triage";
import { blocksOf } from "../src/features/list/stack-model";
import {
  applyNativeStacks,
  applyPersistedStacks,
  reconcileStackItems,
} from "../src/features/list/stacks";

const pr = (id: string, repo = "owner/repo", stack?: Ranked["stack"]): Ranked => ({
  id,
  repo,
  stack,
  kind: "pr",
  title: id,
  mine: false,
  verdict: "yours",
  why: "Review requested",
});
const stack = (number: number, position: number, size = 3) => ({
  number,
  position,
  size,
  base: "main",
});
type Layer = { state: string; merged?: boolean };
const open: Layer = { state: "open" };
const closed: Layer = { state: "closed" };
const merged: Layer = { state: "closed", merged: true };
const nativeStack = (layers: ReadonlyArray<Layer>): PullStack => ({
  number: 42,
  base: { ref: "main" },
  open: true,
  pull_requests: layers.map((layer, i) => ({
    number: i + 1,
    state: layer.state,
    merged_at: layer.merged ? "2026-10-29T11:48:48Z" : null,
    head: { ref: `layer-${i + 1}` },
  })),
});
const repoStacks = (layers: ReadonlyArray<Layer>) => [
  { repo: "owner/repo", stacks: [nativeStack(layers)] },
];

describe("Native stack visibility", () => {
  test("keeps and annotates the stack while every layer is open", () => {
    const items = applyNativeStacks(
      [pr("pr:owner/repo#1"), pr("pr:owner/repo#2")],
      repoStacks([open, open]),
    );
    expect(items.map((item) => item.stack?.position)).toEqual([1, 2]);
  });

  test("hides the open layers above a layer 1 closed without merging", () => {
    const unrelated = pr("pr:owner/repo#9");
    const items = applyNativeStacks(
      [pr("pr:owner/repo#2"), pr("pr:owner/repo#3"), unrelated],
      repoStacks([closed, open, open]),
    );
    expect(items).toEqual([unrelated]);
  });

  test("keeps the closed layer itself for the history view", () => {
    const items = applyNativeStacks(
      [pr("pr:owner/repo#1"), pr("pr:owner/repo#2")],
      repoStacks([closed, open]),
    );
    expect(items.map((item) => [item.id, item.stack?.position])).toEqual([["pr:owner/repo#1", 1]]);
  });

  test("keeps the rest of the stack when layer 1 merged", () => {
    const items = applyNativeStacks(
      [pr("pr:owner/repo#2"), pr("pr:owner/repo#3")],
      repoStacks([merged, open, open]),
    );
    expect(items.map((item) => item.stack?.position)).toEqual([2, 3]);
  });

  test("a closed middle layer hides only what sits above it", () => {
    const items = applyNativeStacks(
      [pr("pr:owner/repo#1"), pr("pr:owner/repo#3"), pr("pr:owner/repo#4")],
      repoStacks([open, closed, open, open]),
    );
    expect(items.map((item) => [item.id, item.stack?.position])).toEqual([["pr:owner/repo#1", 1]]);
  });

  test("keeps a partial queue when GitHub says every layer is open", () => {
    const unrelated = pr("pr:owner/repo#9");
    const items = applyNativeStacks([pr("pr:owner/repo#2"), unrelated], repoStacks([open, open]));
    expect(items.map((item) => item.stack?.position)).toEqual([2, undefined]);
  });
});

describe("Persisted stack visibility", () => {
  test("uses the SQLite membership when the foundation is present", () => {
    const items = applyPersistedStacks([
      pr("pr:owner/repo#1", "owner/repo", stack(42, 1, 2)),
      pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2)),
    ]);
    expect(items.map((item) => item.stack?.position)).toEqual([1, 2]);
  });

  test("keeps persisted dependent layers when the partial queue omits the foundation", () => {
    const unrelated = pr("pr:owner/repo#9");
    expect(
      applyPersistedStacks([pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2)), unrelated]),
    ).toEqual([pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2)), unrelated]);
  });

  test("uses the complete SQLite cutoff snapshot for a partial queue", () => {
    const below = pr("pr:owner/repo#1", "owner/repo", stack(42, 1, 3));
    const above = pr("pr:owner/repo#3", "owner/repo", stack(42, 3, 3));
    const unrelated = pr("pr:owner/repo#9");

    const cutoffs = new Map([["owner/repo#42", 2]]);
    expect(applyPersistedStacks([below, above, unrelated], cutoffs)).toEqual([below, unrelated]);
    expect(applyPersistedStacks([below, above, unrelated], new Map())).toEqual([
      below,
      above,
      unrelated,
    ]);
  });

  test("hides the open layers above a foundation closed without merging", () => {
    const foundation = {
      ...pr("pr:owner/repo#1", "owner/repo", stack(42, 1, 2)),
      state: "closed",
    };
    const dependent = pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2));
    const unrelated = pr("pr:owner/repo#9");

    expect(applyPersistedStacks([foundation, dependent, unrelated])).toEqual([
      foundation,
      unrelated,
    ]);
  });

  test("keeps the rest of the persisted stack when the foundation merged", () => {
    const foundation = {
      ...pr("pr:owner/repo#1", "owner/repo", stack(42, 1, 2)),
      state: "closed",
      merged: true,
    };
    const dependent = pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2));

    expect(applyPersistedStacks([foundation, dependent])).toEqual([foundation, dependent]);
  });

  test("a closed middle layer on screen hides only what sits above it", () => {
    const first = pr("pr:owner/repo#1", "owner/repo", stack(42, 1, 3));
    const middle = { ...pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 3)), state: "closed" };
    const top = pr("pr:owner/repo#3", "owner/repo", stack(42, 3, 3));

    expect(applyPersistedStacks([first, middle, top])).toEqual([first, middle]);
  });

  test("does not restore hidden stack layers as standalone Inbox rows", () => {
    const dependent = pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2));
    const unrelated = pr("pr:owner/repo#9");

    expect(reconcileStackItems([dependent, unrelated], [unrelated])).toEqual([unrelated]);
  });
});

describe("Stack list grouping", () => {
  test("groups the chain where its first prioritized PR appeared and orders by dependency", () => {
    const blocks = blocksOf([
      pr("second", undefined, stack(1, 2)),
      pr("single"),
      pr("first", undefined, stack(1, 1)),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind).toBe("stack");
    if (blocks[0].kind === "stack")
      expect(blocks[0].items.map((i) => i.id)).toEqual(["first", "second"]);
    expect(blocks[1].kind).toBe("one");
  });
  test("stacks with the same base remain separate by stack identity and repository", () => {
    const blocks = blocksOf([
      pr("a", "owner/repo", stack(1, 1)),
      pr("b", "owner/repo", stack(2, 1)),
      pr("c", "other/repo", stack(1, 1)),
    ]);
    expect(blocks).toHaveLength(3);
    expect(new Set(blocks.filter((b) => b.kind === "stack").map((b) => b.key)).size).toBe(3);
  });
  test("partial stacks retain their real positions and total size", () => {
    const block = blocksOf([
      pr("third", undefined, stack(1, 3)),
      pr("first", undefined, stack(1, 1)),
    ])[0];
    if (block.kind !== "stack") throw new Error("Expected a stack");
    expect(block.size).toBe(3);
    expect(block.items.map((i) => i.stack?.position)).toEqual([1, 3]);
    expect(block.items).toHaveLength(2);
  });
  test("a single visible layer remains identifiable as part of its full stack", () => {
    const block = blocksOf([pr("second", undefined, stack(7, 2, 4))])[0];
    expect(block.kind).toBe("stack");
    if (block.kind === "stack") {
      expect(block.size).toBe(4);
      expect(block.items[0].stack?.position).toBe(2);
    }
  });
});
