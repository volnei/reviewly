const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(input: string | number | Date): string {
  const ms = new Date(input).getTime() - Date.now();
  const abs = Math.abs(ms);
  const sec = 1000,
    min = 60 * sec,
    hr = 60 * min,
    day = 24 * hr;

  if (abs < min) return rtf.format(Math.round(ms / sec), "second");
  if (abs < hr) return rtf.format(Math.round(ms / min), "minute");
  if (abs < day) return rtf.format(Math.round(ms / hr), "hour");
  if (abs < 30 * day) return rtf.format(Math.round(ms / day), "day");
  if (abs < 365 * day) return rtf.format(Math.round(ms / (30 * day)), "month");
  return rtf.format(Math.round(ms / (365 * day)), "year");
}

/** Tight relative time for dense rows: "now", "5m", "3h", "6d", "2mo", "1y". */
export function compactTime(input: string | number | Date): string {
  const ms = Date.now() - new Date(input).getTime();
  const sec = 1000;
  const min = 60 * sec;
  const hr = 60 * min;
  const day = 24 * hr;
  if (ms < min) return "now";
  if (ms < hr) return `${Math.round(ms / min)}m`;
  if (ms < day) return `${Math.round(ms / hr)}h`;
  if (ms < 30 * day) return `${Math.round(ms / day)}d`;
  if (ms < 365 * day) return `${Math.round(ms / (30 * day))}mo`;
  return `${Math.round(ms / (365 * day))}y`;
}

export function shortDate(input: string | number | Date): string {
  const d = new Date(input);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function shortSha(sha: string | null | undefined): string {
  if (!sha) return "—";
  return sha.slice(0, 7);
}

/**
 * Extract a short SHA from a Sentry release name. Releases are commonly
 * formatted as `1.2.3-<sha>` or just `<sha>` or `<owner>/<repo>@<sha>`.
 * Returns null when the release doesn't look like it contains a SHA.
 */
export function shaFromRelease(release: string | null | undefined): string | null {
  if (!release) return null;
  // Prefer everything after the LAST `@` or `-`
  const candidate = release.split(/[@-]/).pop() ?? release;
  // Trim to 7 hex chars if it looks like a SHA
  if (/^[a-f0-9]{7,40}$/i.test(candidate)) {
    return candidate.slice(0, 7);
  }
  // Fallback: if the whole release looks short and SHA-like
  if (/^[a-f0-9]{7,40}$/i.test(release)) {
    return release.slice(0, 7);
  }
  return null;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
