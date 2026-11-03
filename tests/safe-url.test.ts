import { describe, expect, test } from "bun:test";

import { safeExternalUrl } from "@/lib/ui";

describe("external URL policy", () => {
  test("allows HTTPS and local HTTP development URLs", () => {
    expect(safeExternalUrl("https://github.com/volnei/reviewly")).toBe(
      "https://github.com/volnei/reviewly",
    );
    expect(safeExternalUrl("http://localhost:3001/connect")).toBe("http://localhost:3001/connect");
  });

  test("rejects file, script, custom protocol and credential-bearing URLs", () => {
    expect(safeExternalUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("reviewly://unexpected/action")).toBeNull();
    expect(safeExternalUrl("https://user:secret@example.com/")).toBeNull();
  });
});
