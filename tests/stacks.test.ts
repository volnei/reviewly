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
const nativeStack = (foundationState: string): PullStack => ({
  number: 42,
  base: { ref: "main" },
  open: true,
  pull_requests: [
    { number: 1, state: foundationState, head: { ref: "one" } },
    { number: 2, state: "open", head: { ref: "two" } },
  ],
});

describe("Native stack visibility", () => {
  test("keeps and annotates the stack while layer 1 is open", () => {
    const items = applyNativeStacks(
      [pr("pr:owner/repo#1"), pr("pr:owner/repo#2")],
      [{ repo: "owner/repo", stacks: [nativeStack("open")] }],
    );
    expect(items.map((item) => item.stack?.position)).toEqual([1, 2]);
  });

  test("hides every layer when layer 1 is no longer open", () => {
    const unrelated = pr("pr:owner/repo#9");
    const items = applyNativeStacks(
      [pr("pr:owner/repo#1"), pr("pr:owner/repo#2"), unrelated],
      [{ repo: "owner/repo", stacks: [nativeStack("closed")] }],
    );
    expect(items).toEqual([unrelated]);
  });

  test("keeps a partial queue when GitHub says layer 1 is open", () => {
    const unrelated = pr("pr:owner/repo#9");
    const items = applyNativeStacks(
      [pr("pr:owner/repo#2"), unrelated],
      [{ repo: "owner/repo", stacks: [nativeStack("open")] }],
    );
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

  test("uses the complete SQLite foundation snapshot for a partial queue", () => {
    const dependent = pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2));
    const unrelated = pr("pr:owner/repo#9");

    expect(applyPersistedStacks([dependent, unrelated], new Set(["owner/repo#42"]))).toEqual([
      dependent,
      unrelated,
    ]);
    expect(applyPersistedStacks([dependent, unrelated], new Set())).toEqual([unrelated]);
  });

  test("hides the entire persisted stack when its foundation is closed", () => {
    const foundation = {
      ...pr("pr:owner/repo#1", "owner/repo", stack(42, 1, 2)),
      state: "closed",
    };
    const dependent = pr("pr:owner/repo#2", "owner/repo", stack(42, 2, 2));
    const unrelated = pr("pr:owner/repo#9");

    expect(applyPersistedStacks([foundation, dependent, unrelated])).toEqual([unrelated]);
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
