import { describe, expect, it } from "bun:test";
import { PR_ORIGINS, parsePrOrigin } from "@/lib/pr-navigation";

describe("PR navigation origin", () => {
  it("accepts every supported origin", () => {
    for (const origin of Object.keys(PR_ORIGINS)) expect(parsePrOrigin(origin)).toBe(origin);
  });

  it("rejects missing, unknown, and inherited object keys", () => {
    expect(parsePrOrigin(undefined)).toBeUndefined();
    expect(parsePrOrigin("settings")).toBeUndefined();
    expect(parsePrOrigin("constructor")).toBeUndefined();
    expect(parsePrOrigin("toString")).toBeUndefined();
  });
});
