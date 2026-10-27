import type { Ranked } from "@/effect/services/Triage";

export interface ActivityDay {
  date: string;
  count: number;
}
const DAY = 86_400_000;

/** GitHub returns only dates with merges. Fill calendar days before comparing periods. */
export function activityWindow(
  days: ReadonlyArray<ActivityDay>,
  length: number,
  now = Date.now(),
): ActivityDay[] {
  const end = new Date(now).toISOString().slice(0, 10);
  const midnight = Date.parse(`${end}T00:00:00Z`);
  const counts = new Map(days.map((d) => [d.date, d.count]));
  return Array.from({ length }, (_, i) => {
    const date = new Date(midnight - (length - 1 - i) * DAY).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}

export function queueAge(items: ReadonlyArray<Ranked>, now = Date.now()) {
  const buckets = [
    { label: "Less than a day", count: 0 },
    { label: "1–3 days", count: 0 },
    { label: "3–7 days", count: 0 },
    { label: "Over a week", count: 0 },
    { label: "Unknown age", count: 0 },
  ];
  for (const item of items) {
    const created = Date.parse(item.createdAt ?? "");
    const age = Math.max(0, now - created) / DAY;
    buckets[!Number.isFinite(age) ? 4 : age < 1 ? 0 : age < 3 ? 1 : age < 7 ? 2 : 3].count++;
  }
  return buckets;
}

export function queueRepos(items: ReadonlyArray<Ranked>) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.repo, (counts.get(item.repo) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

export function queueStatus(items: ReadonlyArray<Ranked>) {
  const groups = [
    { label: "Needs attention", count: 0, color: "var(--home-attention)" },
    { label: "Ready to merge", count: 0, color: "var(--home-ready)" },
    { label: "Waiting", count: 0, color: "var(--home-waiting)" },
    { label: "Other", count: 0, color: "var(--home-other)" },
  ];
  for (const item of items) {
    const index =
      item.verdict === "risky" || item.verdict === "yours"
        ? 0
        : item.verdict === "mergeable"
          ? 1
          : item.verdict === "waiting"
            ? 2
            : 3;
    groups[index].count++;
  }
  return groups;
}
