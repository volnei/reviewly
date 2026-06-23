import { parsePatch } from "@/lib/diff";
import type { PullFile } from "@/lib/tauri";

/* ─────────────────────── path-based hide rules ─────────────────────── */

/** A reason a file is hidden by focus mode. */
export type HideReason =
  | "lockfile"
  | "generated"
  | "snapshot"
  | "rename"
  | "format-only"
  | "comment-only"
  | "empty";

const LOCKFILE_BASENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "Pipfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
  "deno.lock",
  "uv.lock",
  "mix.lock",
  "pubspec.lock",
]);

const GENERATED_DIR_PATTERNS = [
  /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|target|node_modules|vendor)(\/|$)/,
];

const GENERATED_FILE_PATTERNS = [
  /\.(generated|gen)\.[a-z]+$/i,
  /\.pb\.(go|ts|js)$/,
  /\.min\.(js|css)$/,
  /\.d\.ts$/, // declarations are often generated
];

const SNAPSHOT_PATTERNS = [/__snapshots__\//, /\.snap$/];

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Identify why a file should be hidden, or null if it has real changes. */
export function classify(file: PullFile): HideReason | null {
  // Pure renames have no content delta.
  if (file.status === "renamed" && file.additions === 0 && file.deletions === 0) {
    return "rename";
  }

  // Empty file additions/deletions.
  if ((file.additions === 0 && file.deletions === 0) || file.changes === 0) {
    return "empty";
  }

  const path = file.filename;
  const base = basename(path);

  if (LOCKFILE_BASENAMES.has(base)) return "lockfile";
  if (SNAPSHOT_PATTERNS.some((r) => r.test(path))) return "snapshot";
  if (GENERATED_DIR_PATTERNS.some((r) => r.test(path))) return "generated";
  if (GENERATED_FILE_PATTERNS.some((r) => r.test(base))) return "generated";

  if (isFormatOnly(file.patch)) return "format-only";
  if (isCommentOnly(file.patch, path)) return "comment-only";

  return null;
}

/* ─────────────────────── format-only detection ─────────────────────── */

/**
 * Normalize a line of code so cosmetic differences collapse to the same
 * string. Catches whitespace, quote-style, trailing comma/semicolon, line
 * ending changes, and key reordering (combined with set comparison).
 */
function normalize(line: string): string {
  return line
    .replace(/\s+/g, "")
    .replace(/['"`]/g, '"')
    .replace(/[,;]+$/, "");
}

/**
 * True when every `+` line has a matching `-` line modulo whitespace and
 * other purely cosmetic changes. Works across all languages.
 */
export function isFormatOnly(patch: string | null | undefined): boolean {
  if (!patch) return false;
  const hunks = parsePatch(patch);
  if (hunks.length === 0) return false;
  for (const h of hunks) {
    const dels = h.lines.filter((l) => l.kind === "del").map((l) => normalize(l.text));
    const adds = h.lines.filter((l) => l.kind === "add").map((l) => normalize(l.text));
    if (dels.length === 0 && adds.length === 0) continue;
    if (dels.length !== adds.length) return false;
    const ds = [...dels].sort();
    const as_ = [...adds].sort();
    for (let i = 0; i < ds.length; i++) {
      if (ds[i] !== as_[i]) return false;
    }
  }
  return true;
}

/* ─────────────────────── comment-only detection ─────────────────────── */

/** Map file extension to its single-line comment prefix (best-effort). */
const COMMENT_PREFIXES: Record<string, string[]> = {
  // C-family
  ts: ["//", "/*", "*"],
  tsx: ["//", "/*", "*"],
  js: ["//", "/*", "*"],
  jsx: ["//", "/*", "*"],
  mjs: ["//", "/*", "*"],
  cjs: ["//", "/*", "*"],
  c: ["//", "/*", "*"],
  cpp: ["//", "/*", "*"],
  cc: ["//", "/*", "*"],
  h: ["//", "/*", "*"],
  hpp: ["//", "/*", "*"],
  cs: ["//", "/*", "*"],
  java: ["//", "/*", "*"],
  kt: ["//", "/*", "*"],
  scala: ["//", "/*", "*"],
  swift: ["//", "/*", "*"],
  go: ["//", "/*", "*"],
  rs: ["//", "/*", "*", "///", "//!"],
  // Hash-comment
  py: ["#"],
  rb: ["#"],
  sh: ["#"],
  bash: ["#"],
  zsh: ["#"],
  yaml: ["#"],
  yml: ["#"],
  toml: ["#"],
  // SQL
  sql: ["--", "/*", "*"],
  // HTML/XML
  html: ["<!--", "-->"],
  xml: ["<!--", "-->"],
  // CSS
  css: ["/*", "*"],
  scss: ["//", "/*", "*"],
};

function isCommentOnly(patch: string | null | undefined, filename: string): boolean {
  if (!patch) return false;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const prefixes = COMMENT_PREFIXES[ext];
  if (!prefixes) return false;
  const hunks = parsePatch(patch);
  if (hunks.length === 0) return false;
  let saw = false;
  for (const h of hunks) {
    for (const line of h.lines) {
      if (line.kind !== "add" && line.kind !== "del") continue;
      const trimmed = line.text.trim();
      if (!trimmed) continue;
      saw = true;
      if (!prefixes.some((p) => trimmed.startsWith(p))) return false;
    }
  }
  return saw;
}

/* ─────────────────────── reason labels ─────────────────────── */

export const HIDE_LABEL: Record<HideReason, string> = {
  lockfile: "lockfile",
  generated: "generated",
  snapshot: "snapshot",
  rename: "rename",
  "format-only": "format",
  "comment-only": "comments",
  empty: "empty",
};

export const HIDE_COLOR: Record<HideReason, string> = {
  lockfile: "text-muted-foreground",
  generated: "text-muted-foreground",
  snapshot: "text-muted-foreground",
  rename: "text-info",
  "format-only": "text-muted-foreground",
  "comment-only": "text-muted-foreground",
  empty: "text-muted-foreground",
};
