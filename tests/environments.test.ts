import { describe, expect, test } from "bun:test";

import { personalSecretKeysToDelete } from "../src/features/environments/store";

describe("personal environments", () => {
  test("deletes Keychain values when secrets are removed or made public", () => {
    const previous = [
      { key: "REMOVED", secret: true },
      { key: "MADE_PUBLIC", secret: true },
      { key: "KEPT", secret: true },
      { key: "PLAIN", secret: false },
    ];
    const current = [
      { key: "MADE_PUBLIC", secret: false },
      { key: "KEPT", secret: true },
      { key: "PLAIN", secret: false },
    ];

    expect(personalSecretKeysToDelete(previous, current)).toEqual(["REMOVED", "MADE_PUBLIC"]);
  });
});
