interface Day {
  /** YYYY-MM-DD, UTC. */
  date: string;
  count: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Theme-aware activity ramp, empty to busiest. */
const FILL = [
  "heatmap-level-0",
  "heatmap-level-1",
  "heatmap-level-2",
  "heatmap-level-3",
  "heatmap-level-4",
];

function level(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const r = count / max;
  return r <= 0.25 ? 1 : r <= 0.5 ? 2 : r <= 0.75 ? 3 : 4;
}

/**
 * A year of merged pull requests: 53 week columns, 7 day rows, the busiest
 * day darkest. Responsive: the columns share the width, the cells stay square.
 */
export function Heatmap({ days }: { days: Day[] }) {
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const max = days.reduce((m, d) => Math.max(m, d.count), 1);
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
  const monthSpans = weeks.reduce<{ month: number; weeks: number }[]>((spans, week) => {
    const month = week[0].month;
    const last = spans.at(-1);
    if (last?.month === month) last.weeks++;
    else spans.push({ month, weeks: 1 });
    return spans;
  }, []);
  let peak: Day | null = null;
  for (const d of days) if (!peak || d.count > peak.count) peak = d;
  const total = days.reduce((n, d) => n + d.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;
  return (
    <div className="heatmap-shell">
      <div className="heatmap-summary">
        <span className="heatmap-eyebrow">Last 12 months</span>
        <strong className="tnum">{total.toLocaleString()}</strong>
        <p>pull requests merged</p>
        <dl>
          <div>
            <dt>Active days</dt>
            <dd className="tnum">{activeDays}</dd>
          </div>
          {peak && peak.count > 0 ? (
            <div>
              <dt>Busiest day</dt>
              <dd>
                <span className="tnum">{peak.count}</span> · {formatDay(peak.date)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <div className="heatmap-chart-wrap">
        <div className="heatmap-chart">
          <div className="heatmap-months" aria-hidden="true">
            {monthSpans.map((span, index) => (
              <span key={`${span.month}-${index}`} style={{ flexGrow: span.weeks }}>
                {span.weeks >= 3 ? MONTHS[span.month] : ""}
              </span>
            ))}
          </div>
          <div className="heatmap-body">
            <div className="heatmap-weekdays" aria-hidden="true">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
            </div>
            <div
              className="heatmap-grid"
              role="img"
              aria-label={`${total} merged pull requests in the last year`}
            >
              {weeks.map((week) => (
                <div key={week[0].key} className="heatmap-week">
                  {week.map((day) => (
                    <span
                      key={day.key}
                      data-tip={
                        day.future ? undefined : `${formatFullDay(day.key)} · ${day.count} merged`
                      }
                      className={`heatmap-cell ${day.future ? "heatmap-future" : FILL[level(day.count, max)]}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="heatmap-legend" aria-label="Activity intensity, less to more">
            <span>Less</span>
            {FILL.map((fill) => (
              <div aria-hidden="true" key={fill} className={`heatmap-legend-cell ${fill}`} />
            ))}
            <span>More</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const formatDay = (date: string) => {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
};

const formatFullDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
};
