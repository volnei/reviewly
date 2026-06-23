import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-java";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-shell-session";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-docker";

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  go: "go",
  py: "python",
  rb: "ruby",
  java: "java",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  md: "markdown",
  mdx: "markdown",
  sql: "sql",
  css: "css",
  scss: "scss",
  graphql: "graphql",
  gql: "graphql",
  prisma: "graphql",
};

const FILENAME_TO_LANG: Record<string, string> = {
  dockerfile: "docker",
  makefile: "bash",
};

export function detectLanguage(filename: string): string {
  const base = filename.split("/").pop()?.toLowerCase() ?? filename;
  if (FILENAME_TO_LANG[base]) return FILENAME_TO_LANG[base];
  const ext = base.split(".").pop();
  if (!ext) return "text";
  return EXT_TO_LANG[ext] ?? "text";
}

/**
 * Highlight a single line of code. Falls back to escaped plain text when
 * the language isn't registered with Prism.
 */
export function highlightLine(code: string, lang: string): string {
  if (!code) return "";
  const grammar = Prism.languages[lang];
  if (!grammar) return escapeHtml(code);
  try {
    return Prism.highlight(code, grammar, lang);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
