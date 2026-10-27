import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { EditorTarget } from "../src/effect/schema";

describe("native editor targets", () => {
  test("decodes the camelCase shape emitted by Rust", () => {
    const decode = Schema.decodeUnknownSync(EditorTarget);
    expect(
      decode({
        id: "zed",
        label: "Zed",
        appName: "Zed",
        command: "zed",
        iconDataUrl: null,
        isDefault: true,
        source: "installed",
      }),
    ).toEqual({ id: "zed", label: "Zed", iconDataUrl: null, isDefault: true });
  });
});
