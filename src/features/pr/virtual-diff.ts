import type * as S from "@/effect/schema";
import { type Hunk, parsePatch } from "@/lib/diff";

export interface DiffHit {
  readonly path: string;
  readonly side: "L" | "R";
  readonly line: number;
}

const ROW_HEIGHT = 20;
const FILE_CHROME = 42;
export const LARGE_DIFF_LINES = 2_500;
const parsed = new WeakMap<object, Hunk[]>();
const lineCounts = new WeakMap<object, number>();

const hunksFor = (file: S.PullFile) => {
  const cached = parsed.get(file);
  if (cached) return cached;
  const hunks = parsePatch(file.patch);
  parsed.set(file, hunks);
  return hunks;
};

const patchLineCount = (file: S.PullFile) => {
  const cached = lineCounts.get(file);
  if (cached != null) return cached;
  if (!file.patch) return 0;
  let lines = 1;
  for (let i = 0; i < file.patch.length; i++) if (file.patch.charCodeAt(i) === 10) lines++;
  lineCounts.set(file, lines);
  return lines;
};

export function shouldFoldLargeDiff(file: S.PullFile): boolean {
  return patchLineCount(file) > LARGE_DIFF_LINES;
}

/** A cheap first measurement; TanStack Virtual replaces it with the real height once mounted. */
export function estimateFileHeight(file: S.PullFile, folded: boolean): number {
  if (folded) return 78;
  const patchLines = patchLineCount(file) || 2;
  return FILE_CHROME + Math.max(2, patchLines) * ROW_HEIGHT;
}

/** Approximate a line inside an unmounted file closely enough to order minimap and keyboard targets. */
export function lineFraction(file: S.PullFile, side: "L" | "R", line: number): number {
  const hunks = hunksFor(file);
  let ordinal = 0;
  let total = 0;
  for (const hunk of hunks) {
    for (const diffLine of hunk.lines) {
      if (diffLine.kind === "hunk") continue;
      if ((side === "L" ? diffLine.oldLine : diffLine.newLine) === line) ordinal = total;
      total++;
    }
  }
  return total ? Math.min(1, Math.max(0, ordinal / total)) : 0;
}

/** Search the patch model, not the DOM: virtualized files remain findable. */
export function findDiffHits(file: S.PullFile, needle: string): DiffHit[] {
  const hits: DiffHit[] = [];
  for (const hunk of hunksFor(file)) {
    for (const diffLine of hunk.lines) {
      if (diffLine.kind === "hunk" || !diffLine.text.toLowerCase().includes(needle)) continue;
      const side = diffLine.kind === "del" ? "L" : "R";
      const line = side === "L" ? diffLine.oldLine : diffLine.newLine;
      if (line != null) hits.push({ path: file.filename, side, line });
    }
  }
  return hits;
}

export function hunkStarts(file: S.PullFile): DiffHit[] {
  return hunksFor(file).map((hunk) => ({
    path: file.filename,
    side: "R",
    line: hunk.newStart,
  }));
}
