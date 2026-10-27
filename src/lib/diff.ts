/**
 * Tiny unified-diff parser. GitHub's `pulls/{n}/files` returns a `patch`
 * string with one or more hunks; we split it into typed lines that the
 * diff viewer can iterate over.
 */

type LineKind = "context" | "add" | "del" | "hunk";

export interface DiffLine {
  kind: LineKind;
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export function parsePatch(patch: string | null | undefined): Hunk[] {
  if (!patch) return [];
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      const oldStart = m ? Number(m[1]) : 0;
      const newStart = m ? Number(m[2]) : 0;
      current = { header: raw, oldStart, newStart, lines: [] };
      current.lines.push({ kind: "hunk", oldLine: null, newLine: null, text: raw });
      hunks.push(current);
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+")) {
      current.lines.push({
        kind: "add",
        oldLine: null,
        newLine,
        text: raw.slice(1),
      });
      newLine++;
    } else if (raw.startsWith("-")) {
      current.lines.push({
        kind: "del",
        oldLine,
        newLine: null,
        text: raw.slice(1),
      });
      oldLine++;
    } else {
      // context (space prefix) or empty
      current.lines.push({
        kind: "context",
        oldLine,
        newLine,
        text: raw.startsWith(" ") ? raw.slice(1) : raw,
      });
      oldLine++;
      newLine++;
    }
  }

  return hunks;
}

/**
 * Group adjacent del/add lines into pairs for split view. Stand-alone
 * dels/adds become half-rows.
 */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function toSplit(hunk: Hunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "hunk") {
      rows.push({ left: l, right: l });
      i++;
      continue;
    }
    if (l.kind === "context") {
      rows.push({ left: l, right: l });
      i++;
      continue;
    }
    // collect a block of dels and adds
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "del") {
      dels.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].kind === "add") {
      adds.push(lines[i]);
      i++;
    }
    const max = Math.max(dels.length, adds.length);
    for (let j = 0; j < max; j++) {
      rows.push({ left: dels[j] ?? null, right: adds[j] ?? null });
    }
  }
  return rows;
}

const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * Whitespace-only changes read as context: a block of deleted lines followed
 * by added ones that agree once spaces are gone folds into one unchanged run.
 * Hunks with nothing left in them are dropped.
 */
export function hideWhitespaceOnly(hunks: Hunk[]): Hunk[] {
  const out: Hunk[] = [];
  for (const h of hunks) {
    const lines: DiffLine[] = [];
    let changed = 0;
    let i = 0;
    while (i < h.lines.length) {
      const l = h.lines[i];
      if (l.kind !== "del" && l.kind !== "add") {
        lines.push(l);
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < h.lines.length && h.lines[i].kind === "del") dels.push(h.lines[i++]);
      while (i < h.lines.length && h.lines[i].kind === "add") adds.push(h.lines[i++]);
      const onlySpaces =
        dels.length === adds.length &&
        dels.every((d, j) => squash(d.text) === squash(adds[j].text));
      if (onlySpaces) {
        for (let j = 0; j < dels.length; j++)
          lines.push({
            kind: "context",
            oldLine: dels[j].oldLine,
            newLine: adds[j].newLine,
            text: adds[j].text,
          });
      } else {
        lines.push(...dels, ...adds);
        changed += dels.length + adds.length;
      }
    }
    if (changed > 0) out.push({ ...h, lines });
  }
  return out;
}

export interface Gap {
  readonly fromOld: number;
  readonly fromNew: number;
  /** Inclusive; null means "to the end of the file". */
  readonly toNew: number | null;
}

/** The unchanged stretches a patch leaves out: one before each hunk, one after the last. */
export function gapsOf(hunks: ReadonlyArray<Hunk>): Gap[] {
  const gaps: Gap[] = [];
  let old = 1;
  let nw = 1;
  for (const h of hunks) {
    gaps.push({ fromOld: old, fromNew: nw, toNew: h.newStart - 1 });
    let lastOld = h.oldStart - 1;
    let lastNew = h.newStart - 1;
    for (const l of h.lines) {
      if (l.oldLine != null) lastOld = l.oldLine;
      if (l.newLine != null) lastNew = l.newLine;
    }
    old = lastOld + 1;
    nw = lastNew + 1;
  }
  gaps.push({ fromOld: old, fromNew: nw, toNew: null });
  return gaps;
}

/** The text of the lines `start..end` on one side of a patch, for a suggestion block. */
export function linesText(
  patch: string | null | undefined,
  side: "L" | "R",
  start: number,
  end: number,
): string | null {
  const out: string[] = [];
  for (const h of parsePatch(patch))
    for (const l of h.lines) {
      if (l.kind === "hunk") continue;
      const n = side === "R" ? l.newLine : l.oldLine;
      const skip = side === "R" ? l.kind === "del" : l.kind === "add";
      if (!skip && n != null && n >= start && n <= end) out.push(l.text);
    }
  return out.length ? out.join("\n") : null;
}
