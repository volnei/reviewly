import type { DiffLine, Hunk } from "@/lib/diff";

/** A stretch of characters that changed inside a line. */
export interface Range {
  readonly start: number;
  readonly end: number;
}

const TOKEN = /\w+|\s+|[^\w\s]/g;
const tokens = (s: string): string[] => s.match(TOKEN) ?? [];

const push = (arr: Range[], start: number, end: number) => {
  const last = arr[arr.length - 1];
  if (last && last.end === start) arr[arr.length - 1] = { start: last.start, end };
  else arr.push({ start, end });
};

/**
 * What changed between a deleted line and the added line that replaced it,
 * token by token: the ranges to light on each side. Null when the two lines
 * share too little to be the same line edited.
 */
function intraLine(a: string, b: string): { a: Range[]; b: Range[] } | null {
  const ta = tokens(a);
  const tb = tokens(b);
  const n = ta.length;
  const m = tb.length;
  if (!n || !m || n > 300 || m > 300) return null;
  const w = m + 1;
  const dp = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] =
        ta[i] === tb[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const ra: Range[] = [];
  const rb: Range[] = [];
  let i = 0;
  let j = 0;
  let pa = 0;
  let pb = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      pa += ta[i].length;
      pb += tb[j].length;
      i++;
      j++;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      push(ra, pa, pa + ta[i].length);
      pa += ta[i].length;
      i++;
    } else {
      push(rb, pb, pb + tb[j].length);
      pb += tb[j].length;
      j++;
    }
  }
  for (; i < n; i++) {
    push(ra, pa, pa + ta[i].length);
    pa += ta[i].length;
  }
  for (; j < m; j++) {
    push(rb, pb, pb + tb[j].length);
    pb += tb[j].length;
  }
  const changed =
    ra.reduce((s, r) => s + r.end - r.start, 0) + rb.reduce((s, r) => s + r.end - r.start, 0);
  if (changed > 0.6 * (a.length + b.length)) return null;
  return { a: ra, b: rb };
}

/** Pair each run of deletions with the additions that follow it, line for line. */
export function intraPairs(hunks: ReadonlyArray<Hunk>): Map<DiffLine, Range[]> {
  const out = new Map<DiffLine, Range[]>();
  for (const h of hunks) {
    let i = 0;
    while (i < h.lines.length) {
      if (h.lines[i].kind !== "del") {
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < h.lines.length && h.lines[i].kind === "del") dels.push(h.lines[i++]);
      while (i < h.lines.length && h.lines[i].kind === "add") adds.push(h.lines[i++]);
      const k = Math.min(dels.length, adds.length);
      for (let p = 0; p < k; p++) {
        const r = intraLine(dels[p].text, adds[p].text);
        if (!r) continue;
        if (r.a.length) out.set(dels[p], r.a);
        if (r.b.length) out.set(adds[p], r.b);
      }
    }
  }
  return out;
}

/**
 * Wrap character ranges of a line's highlighted HTML in `<mark>`, counting
 * only text (an entity is one character) and never crossing a tag: a mark
 * closes before a tag and reopens after it, so the markup stays well formed.
 */
export function markRanges(html: string, ranges: ReadonlyArray<Range>): string {
  if (!ranges.length) return html;
  const OPEN = '<mark class="dm">';
  const CLOSE = "</mark>";
  let out = "";
  let pos = 0;
  let ri = 0;
  let open = false;
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "<") {
      const end = html.indexOf(">", i);
      const tag = html.slice(i, end + 1);
      out += open ? CLOSE + tag + OPEN : tag;
      i = end + 1;
      continue;
    }
    let len = 1;
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi > 0 && semi - i <= 8) len = semi - i + 1;
    }
    while (ri < ranges.length && ranges[ri].end <= pos) ri++;
    const inRange = ri < ranges.length && pos >= ranges[ri].start && pos < ranges[ri].end;
    if (inRange && !open) {
      out += OPEN;
      open = true;
    } else if (!inRange && open) {
      out += CLOSE;
      open = false;
    }
    out += html.slice(i, i + len);
    i += len;
    pos++;
  }
  if (open) out += CLOSE;
  return out;
}
