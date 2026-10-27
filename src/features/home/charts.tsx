import { Button } from "@/components/ui/button";
import { useId, useState } from "react";
import type { ActivityDay } from "./model";

export function ActivityChart({ days }: { days: ActivityDay[] }) {
  const gradient = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const at = Math.min(selected ?? days.length - 1, days.length - 1);
  const current = days[at];
  const x = (i: number) => 4 + (i / Math.max(1, days.length - 1)) * 592;
  const y = (n: number) => 174 - (n / max) * 158;
  const line = days.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.count)}`).join(" ");
  return (
    <div>
      <div className="home-chart-caption" aria-live="polite">
        <span>
          {current
            ? new Date(`${current.date}T12:00:00Z`).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })
            : "No activity"}
        </span>
        <span className="tnum">{current?.count ?? 0} merged</span>
      </div>
      <div className="home-plot">
        <div className="home-y-axis">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>
        <svg
          viewBox="0 0 600 184"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Merged pull requests per day, ${days[0]?.date ?? ""} to ${days.at(-1)?.date ?? ""}. Hover to inspect each day, or use the previous and next day buttons.`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setSelected(
              Math.max(
                0,
                Math.min(
                  days.length - 1,
                  Math.round(((e.clientX - box.left) / box.width) * (days.length - 1)),
                ),
              ),
            );
          }}
        >
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--home-line)" stopOpacity=".22" />
              <stop offset="100%" stopColor="var(--home-line)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[16, 95, 174].map((v) => (
            <line
              key={v}
              x1="0"
              y1={v}
              x2="600"
              y2={v}
              stroke="var(--hair)"
              strokeDasharray="3 5"
            />
          ))}
          {days.length ? (
            <>
              <path d={`${line} L596,174 L4,174 Z`} fill={`url(#${gradient})`} />
              <path
                d={line}
                fill="none"
                stroke="var(--home-line)"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              {current ? (
                <>
                  <line
                    x1={x(at)}
                    x2={x(at)}
                    y1="10"
                    y2="174"
                    stroke="var(--ink-3)"
                    strokeDasharray="3 5"
                  />
                  <circle cx={x(at)} cy={y(current.count)} r="4" fill="var(--home-line)" />
                </>
              ) : null}
            </>
          ) : null}
        </svg>
      </div>
      <div className="home-x-axis">
        <span>{days[0]?.date}</span>
        <span>Daily merged PRs · UTC</span>
        <span>{days.at(-1)?.date}</span>
      </div>
      <div className="home-day-controls">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={at <= 0}
          onClick={() => setSelected(Math.max(0, at - 1))}
          aria-label="Previous day"
        >
          ←
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={at >= days.length - 1}
          onClick={() => setSelected(Math.min(days.length - 1, at + 1))}
          aria-label="Next day"
        >
          →
        </Button>
      </div>
    </div>
  );
}

export function Distribution({
  groups,
}: { groups: { label: string; count: number; color: string }[] }) {
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  let offset = 0;
  return (
    <div className="home-distribution">
      <div className="home-ring">
        <svg
          viewBox="0 0 120 120"
          role="img"
          aria-label={groups.map((g) => `${g.label}: ${g.count}`).join(", ")}
        >
          <circle cx="60" cy="60" r="48" fill="none" stroke="var(--hair)" strokeWidth="10" />
          {groups.map((g) => {
            const size = total ? (g.count / total) * 100 : 0;
            const start = offset;
            offset += size;
            return (
              <circle
                key={g.label}
                cx="60"
                cy="60"
                r="48"
                pathLength="100"
                fill="none"
                stroke={g.color}
                strokeWidth="10"
                strokeDasharray={`${size} ${100 - size}`}
                strokeDashoffset={-start}
                transform="rotate(-90 60 60)"
              />
            );
          })}
        </svg>
        <div>
          <span className="tnum">{total}</span>
          <small>in your queue</small>
        </div>
      </div>
      <div className="home-legend">
        {groups.map((g) => (
          <div key={g.label}>
            <span className="home-swatch" style={{ background: g.color }} />
            <span>{g.label}</span>
            <span className="tnum">{g.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBars({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="home-bars">
      {rows.map((row) => (
        <div key={row.label}>
          <div>
            <span title={row.label}>{row.label}</span>
            <span className="tnum">{row.count}</span>
          </div>
          <div className="home-bar-track">
            <div style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
