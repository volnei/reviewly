/**
 * Links in a PR body that point at a running build of it: previews, staging,
 * deploy hosts. Shown as chips in the meta line, by host, four at most.
 */
const PREVIEW_HOSTS =
  /preview|deploy|staging|vercel\.app|netlify|ngrok|onrender|render\.com|fly\.dev|pages\.dev|herokuapp|surge\.sh|deno\.dev|railway/i;

export interface PreviewLink {
  readonly url: string;
  readonly host: string;
}

export function previewLinks(body: string | null | undefined): PreviewLink[] {
  if (!body) return [];
  const out: PreviewLink[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/https?:\/\/[^\s)<>"'`]+/g)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (!PREVIEW_HOSTS.test(url)) continue;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    seen.add(host);
    out.push({ url, host });
    if (out.length === 4) break;
  }
  return out;
}

/** A pasted GitHub URL as a markdown link with a name a reviewer reads: `owner/repo#123`, `owner/repo@abc1234`. */
export function githubLinkMarkdown(url: string): string | null {
  const m = url.match(
    /^https?:\/\/[^/\s]+\/([^/\s]+)\/([^/\s]+?)(?:\/(pull|issues|commit)\/([^/\s#?]+))?(?:[/#?].*)?$/,
  );
  if (!m) return null;
  const [, owner, repo, kind, id] = m;
  const label =
    kind === "pull" || kind === "issues"
      ? `${owner}/${repo}#${id}`
      : kind === "commit"
        ? `${owner}/${repo}@${id.slice(0, 7)}`
        : `${owner}/${repo}`;
  return `[${label}](${url})`;
}
