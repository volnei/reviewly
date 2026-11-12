import { describe, expect, test } from "bun:test";

import { cmpVersion, WHATS_NEW } from "../src/lib/whats-new";

describe("release notes", () => {
  test("start with the current release and stay newest first", () => {
    expect(WHATS_NEW[0]?.version).toBe("1.1.7");
    expect(new Set(WHATS_NEW.map(({ version }) => version)).size).toBe(WHATS_NEW.length);
    for (let index = 1; index < WHATS_NEW.length; index += 1) {
      expect(cmpVersion(WHATS_NEW[index - 1].version, WHATS_NEW[index].version)).toBeGreaterThan(0);
    }
  });
});
