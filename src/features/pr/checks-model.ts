import type { CheckRun } from "@/effect/schema";

export type CheckState = "failed" | "running" | "passed" | "skipped" | "cancelled" | "other";
export function checkState(run: CheckRun): CheckState {
  if (run.status !== "completed") return "running";
  if (
    ["failure", "timed_out", "action_required", "startup_failure", "stale"].includes(
      run.conclusion ?? "",
    )
  )
    return "failed";
  if (run.conclusion === "success") return "passed";
  if (run.conclusion === "skipped" || run.conclusion === "neutral") return "skipped";
  if (run.conclusion === "cancelled") return "cancelled";
  return "other";
}

export const CHECK_LABEL: Record<CheckState, string> = {
  failed: "Failed",
  running: "Running",
  passed: "Passed",
  skipped: "Skipped / neutral",
  cancelled: "Cancelled",
  other: "Unknown",
};
export function checkDuration(run: CheckRun): number | null {
  if (!run.started_at || !run.completed_at) return null;
  const ms = Date.parse(run.completed_at) - Date.parse(run.started_at);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Only collapse explicit shard suffixes; preserve distinct workflow and matrix names. */
export function groupChecks(runs: ReadonlyArray<CheckRun>) {
  const groups = new Map<string, CheckRun[]>();
  for (const run of runs) {
    const name = run.name.replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, "").trim();
    const key = `${run.app?.name ?? ""}:${name}`;
    const members = groups.get(key) ?? [];
    members.push(run);
    groups.set(key, members);
  }
  const priority = (r: CheckRun) =>
    ({ failed: 0, running: 1, cancelled: 2, other: 3, passed: 4, skipped: 5 })[checkState(r)];
  return [...groups.entries()]
    .map(([key, members]) => {
      const sorted = [...members].sort(
        (a, b) =>
          priority(a) - priority(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
      return {
        key,
        label: sorted[0].name.replace(/\s*\(\d+\s*\/\s*\d+\)\s*$/, "").trim(),
        runs: sorted,
        attention: sorted.some((r) => checkState(r) === "failed" || checkState(r) === "running"),
      };
    })
    .sort((a, b) => priority(a.runs[0]) - priority(b.runs[0]) || a.label.localeCompare(b.label));
}
