import { cn } from "@/lib/utils";

interface Day {
  /** YYYY-MM-DD (UTC). */
  date: string;
  count: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Empty → most-intense. Green, like the classic contribution graph — reads as
 *  positive activity and stays legible on a dark background. */
const FILL = [
  "bg-foreground/[0.06]",
  "bg-success/30",
  "bg-success/55",
  "bg-success/80",
  "bg-success",
];

/** Bucket a count into a 0–4 intensity level, relative to the busiest day. */
function level(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

/**
 * GitHub-style contribution heatmap — 53 week-columns × 7 day-rows, coloured by
 * intensity. Fed a sparse list of {date, count}; empty days fill in as zero.
 */
export function ContributionHeatmap({
  days,
  label = "Merged pull requests",
}: {
  days: Day[];
  label?: string;
}) {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const max = days.reduce((m, d) => Math.max(m, d.count), 1);

  // 53 weeks ending today; columns = weeks, rows = Sun..Sat (all in UTC so the
  // keys line up with the backend's UTC day buckets).
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const cur = new Date(end);
  cur.setUTCDate(cur.getUTCDate() - 7 * 52);
  cur.setUTCDate(cur.getUTCDate() - cur.getUTCDay());

  const weeks: { key: string; count: number; month: number; future: boolean }[][] = [];
  while (cur <= end) {
    const week: { key: string; count: number; month: number; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const key = cur.toISOString().slice(0, 10);
      week.push({ key, count: byDate.get(key) ?? 0, month: cur.getUTCMonth(), future: cur > end });
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  let peak: Day | null = null;
  for (const d of days) if (!peak || d.count > peak.count) peak = d;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-end justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {peak && (
          <span className="text-xs text-muted-foreground">
            Peak <span className="text-foreground">{formatDay(peak.date)}</span>
          </span>
        )}
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex flex-col gap-1">
          {/* month labels */}
          <div className="flex gap-[3px] text-[10px] text-muted-foreground/80">
            {weeks.map((week, i) => {
              const m = week[0].month;
              const show = m !== (i > 0 ? weeks[i - 1][0].month : -1);
              return (
                <div key={week[0].key} className="relative h-3.5 w-2.5">
                  {show && (
                    <span className="absolute left-0 top-0 whitespace-nowrap">{MONTHS[m]}</span>
                  )}
                </div>
              );
            })}
          </div>
          {/* grid */}
          <div className="flex gap-[3px]">
            {weeks.map((week) => (
              <div key={week[0].key} className="flex flex-col gap-[3px]">
                {week.map((day) => (
                  <div
                    key={day.key}
                    title={day.future ? undefined : `${day.key} · ${day.count} merged`}
                    className={cn(
                      "size-2.5 rounded-[2px] ring-1 ring-inset ring-foreground/[0.04]",
                      day.future ? "opacity-0" : FILL[level(day.count, max)],
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        Less
        {FILL.map((f) => (
          <span
            key={f}
            className={cn("size-2.5 rounded-[2px] ring-1 ring-inset ring-foreground/[0.04]", f)}
          />
        ))}
        More
      </div>
    </div>
  );
}

/** "2026-04-03" → "3 Apr". */
function formatDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
}
