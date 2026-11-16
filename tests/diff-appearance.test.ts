import { expect, test } from "bun:test";

import { diffAppearanceTokens } from "../src/lib/diff-appearance";

test("default diff colors follow the active theme and reset vivid strength", () => {
  expect(diffAppearanceTokens({ mode: "default", added: "#ffffff", removed: "#ffffff" })).toEqual({
    "--diff-add": "var(--add)",
    "--diff-del": "var(--del)",
    "--diff-fill": "10%",
    "--diff-word-fill": "34%",
  });
});

test("vivid colors adapt to light and dark themes without changing status tokens", () => {
  const tokens = diffAppearanceTokens({ mode: "vivid", added: "", removed: "" });
  expect(tokens["--diff-add"]).toBe("var(--diff-vivid-add)");
  expect(tokens["--diff-fill"]).toBe("22%");
  expect(tokens).not.toHaveProperty("--add");
  expect(tokens).not.toHaveProperty("--del");
});

test("custom colors are independent and invalid stored values fall back safely", () => {
  expect(
    diffAppearanceTokens({ mode: "custom", added: "#00aaff", removed: "#ffaa00" }),
  ).toMatchObject({
    "--diff-add": "#00aaff",
    "--diff-del": "#ffaa00",
  });
  expect(diffAppearanceTokens({ mode: "custom", added: "invalid", removed: "" })).toMatchObject({
    "--diff-add": "#4ade80",
    "--diff-del": "#fb7185",
  });
});
