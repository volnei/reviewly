import type { PullDetail, PullFile } from "@/lib/tauri";

/** Total character budget for the diff portion of the AI context. */
const DIFF_BUDGET = 50_000;

/** Lower rank = more important to show the model first. */
function fileRank(name: string): number {
  const n = name.toLowerCase();
  if (
    /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|go\.sum|poetry\.lock|composer\.lock)$/.test(
      n,
    ) ||
    /\.(lock|min\.js|min\.css|map|snap)$/.test(n) ||
    /(^|\/)(dist|build|vendor|node_modules|__generated__|generated)\//.test(n)
  ) {
    return 3; // generated / lockfiles — least useful to a reviewer
  }
  if (/(\.test\.|\.spec\.|(^|\/)(tests?|__tests__|e2e)\/)/.test(n)) return 1; // tests
  if (/\.(json|ya?ml|toml|ini|cfg|config\.\w+)$/.test(n)) return 2; // config
  return 0; // source
}

/**
 * Build a self-contained AI review context from a PR's metadata + diff.
 * Files are ordered by reviewer-relevance (source → tests → config →
 * generated), big changes first; the diff is budget-bounded with **per-file
 * truncation** (never a silent tail-drop), and what got cut is reported so the
 * model knows it didn't see everything.
 */
export function buildReviewContext(
  detail: PullDetail,
  files: PullFile[],
  repoKey: string,
  number: number,
): string {
  const d = detail;
  const head = [
    `Pull request ${repoKey}#${number}: ${d.title}`,
    `Author: @${d.user.login}`,
    `Branches: ${d.head.ref} → ${d.base.ref}`,
    `Changed files: ${d.changed_files ?? "?"} (+${d.additions ?? "?"} / -${d.deletions ?? "?"})`,
    "",
    "## Description",
    d.body?.trim() || "(no description)",
  ].join("\n");

  const sorted = [...files].sort((a, b) => {
    const r = fileRank(a.filename) - fileRank(b.filename);
    if (r !== 0) return r;
    return b.additions + b.deletions - (a.additions + a.deletions);
  });

  let budget = DIFF_BUDGET;
  const blocks: string[] = [];
  const omitted: string[] = [];
  let truncated = 0;

  for (const f of sorted) {
    const label = `### ${f.filename} (+${f.additions} / -${f.deletions})`;
    if (!f.patch) {
      blocks.push(`${label}\n(no textual diff)`);
      continue;
    }
    const full = `${label}\n\`\`\`diff\n${f.patch}\n\`\`\``;
    if (full.length <= budget) {
      blocks.push(full);
      budget -= full.length;
      continue;
    }
    // Doesn't fit: truncate this file's patch to what's left, rather than
    // dropping it (and everything after) silently.
    const room = budget - label.length - 40;
    if (room > 400) {
      const cut = f.patch.slice(0, room);
      blocks.push(`${label}\n\`\`\`diff\n${cut}\n… (diff truncated)\n\`\`\``);
      truncated++;
      budget = 0;
    } else {
      omitted.push(f.filename);
    }
  }

  const notes: string[] = [];
  if (truncated > 0) notes.push(`${truncated} file(s) had their diff truncated for length.`);
  if (omitted.length > 0) {
    const shown = omitted.slice(0, 10).join(", ");
    notes.push(
      `${omitted.length} file(s) omitted for length (not shown to you): ${shown}${omitted.length > 10 ? ", …" : ""}.`,
    );
  }
  const footer = notes.length > 0 ? `\n\n## Note\n${notes.join(" ")}` : "";

  return `${head}\n\n## Diff\n\n${blocks.join("\n\n")}${footer}`;
}
