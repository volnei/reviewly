/** Minutes a careful read takes, from size alone: a minute per 60 changed lines, a minute per four files, never under one. */
export function readingMinutes(additions: number, deletions: number, files: number): number {
  return Math.max(1, Math.round((additions + deletions) / 60 + files / 4));
}
