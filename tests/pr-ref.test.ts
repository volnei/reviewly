import { describe, expect, test } from "bun:test";

import { parsePrRef } from "../src/lib/pr-ref";

describe("parsePrRef", () => {
  test("accepts a PR on the active enterprise host", () => {
    expect(
      parsePrRef("https://github.company.test/platform/api/pull/42", "github.company.test"),
    ).toEqual({ owner: "platform", repo: "api", number: 42 });
  });

  test("rejects a PR URL from another server", () => {
    expect(parsePrRef("https://github.com/platform/api/pull/42", "github.company.test")).toBeNull();
  });

  test("keeps owner/repo shorthand host-independent", () => {
    expect(parsePrRef("platform/api#42", "github.company.test")).toEqual({
      owner: "platform",
      repo: "api",
      number: 42,
    });
  });
});
