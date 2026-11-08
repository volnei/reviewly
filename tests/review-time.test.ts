import { expect, test } from "bun:test";

import { estimateReviewMinutes, reviewTimeLabel } from "../src/features/list/review-time";

test("does not invent a time when stats are missing or invalid", () => {
  for (const stats of [
    {},
    { additions: 0, deletions: null, changedFiles: 1 },
    { additions: -1, deletions: 0, changedFiles: 1 },
    { additions: NaN, deletions: 0, changedFiles: 1 },
  ]) {
    expect(estimateReviewMinutes(stats)).toBeNull();
  }
});
test("accounts for added lines, removed lines and file switching", () => {
  const baseline = { additions: 70, deletions: 0, changedFiles: 1 };
  expect(estimateReviewMinutes(baseline)).toBe(5);
  expect(estimateReviewMinutes({ ...baseline, additions: 350 })).toBeGreaterThan(5);
  expect(estimateReviewMinutes({ ...baseline, deletions: 700 })).toBeGreaterThan(5);
  expect(estimateReviewMinutes({ ...baseline, changedFiles: 20 })).toBeGreaterThan(5);
  expect(estimateReviewMinutes({ additions: 0, deletions: 0, changedFiles: 0 })).toBe(2);
});
test("formats long reviews without a misleading upper cap", () => {
  expect(reviewTimeLabel(8)).toBe("~8 min");
  expect(reviewTimeLabel(60)).toBe("~1h");
  expect(reviewTimeLabel(75)).toBe("~1h 15m");
  expect(
    estimateReviewMinutes({ additions: 10000, deletions: 0, changedFiles: 50 }),
  ).toBeGreaterThan(120);
});
