import { expect, test } from "bun:test";
import { nativeInboxBadge } from "../src/app/dock-badge";

test("the native app badge mirrors actionable Inbox work", () => {
  expect(nativeInboxBadge(7)).toBe(7);
  expect(nativeInboxBadge(1)).toBe(1);
  expect(nativeInboxBadge(0)).toBeUndefined();
  expect(nativeInboxBadge(undefined)).toBeUndefined();
});
