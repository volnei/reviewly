import { describe, expect, test } from "bun:test";
import { isReviewablePull } from "../src/features/pr/model";

describe("pull request final state", () => {
  test("only an open, unmerged pull request can receive another review", () => {
    expect(isReviewablePull({ state: "open", merged: false })).toBe(true);
    expect(isReviewablePull({ state: "open", merged: null })).toBe(true);
    expect(isReviewablePull({ state: "closed", merged: false })).toBe(false);
    expect(isReviewablePull({ state: "closed", merged: true })).toBe(false);
  });

  test("a merged flag wins even if GitHub briefly reports the old open state", () => {
    expect(isReviewablePull({ state: "open", merged: true })).toBe(false);
  });
});
