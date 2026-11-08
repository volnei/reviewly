/** Reading-time heuristic, not a prediction of correctness or implementation effort. */
export function estimateReviewMinutes(stats: {
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
}): number | null {
  const { additions, deletions, changedFiles } = stats;
  if (
    [additions, deletions, changedFiles].some(
      (value) => typeof value !== "number" || !Number.isFinite(value) || value < 0,
    )
  )
    return null;
  const minutes = 2 + additions! / 35 + deletions! / 70 + changedFiles! * 0.4;
  return minutes < 10 ? Math.ceil(minutes) : Math.ceil(minutes / 5) * 5;
}

export function reviewTimeLabel(minutes: number): string {
  if (minutes < 60) return `~${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `~${hours}h${rest ? ` ${rest}m` : ""}`;
}
