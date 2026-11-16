import type { Prefs } from "@/effect/services/Prefs";

/** Diff-only tokens: changing these must not change CI or other status colors. */
export function diffAppearanceTokens(value: Prefs["diffAppearance"]): Record<string, string> {
  const hex = (color: string, fallback: string) =>
    /^#[\da-f]{6}$/i.test(color) ? color : fallback;
  const custom = value.mode === "custom";
  const strong = value.mode !== "default";
  return {
    "--diff-add": custom
      ? hex(value.added, "#4ade80")
      : strong
        ? "var(--diff-vivid-add)"
        : "var(--add)",
    "--diff-del": custom
      ? hex(value.removed, "#fb7185")
      : strong
        ? "var(--diff-vivid-del)"
        : "var(--del)",
    "--diff-fill": strong ? "22%" : "10%",
    "--diff-word-fill": strong ? "50%" : "34%",
  };
}
