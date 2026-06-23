/**
 * Tiny unified-diff parser. GitHub's `pulls/{n}/files` returns a `patch`
 * string with one or more hunks; we split it into typed lines that the
 * diff viewer can iterate over.
 */

export type LineKind = "context" | "add" | "del" | "hunk";

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
