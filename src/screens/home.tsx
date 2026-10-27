import { useTitleSlot } from "@/app/title-slot";
import { usePullRequestInbox, useWorkspace } from "@/app/workspace";
import { Heatmap } from "@/components/heatmap";
import { Button } from "@/components/ui/button";
import { useEffectQuery } from "@/effect/runtime";
import { useAuth } from "@/effect/services/Auth";
import { GitHub } from "@/effect/services/GitHub";
import { usePrefs } from "@/effect/services/Prefs";
import { homeCacheKey, saveHomeSnapshot, useHomeSnapshot } from "@/features/home/cache";
import { ActivityChart, Distribution, HorizontalBars } from "@/features/home/charts";
import { activityWindow, queueAge, queueRepos, queueStatus } from "@/features/home/model";
import { age } from "@/features/list/row";
import { Link } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  CircleDot,
  Clock3,
  GitMerge,
  GitPullRequest,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RefreshButton, useOpenItem } from "./inbox";

export function HomeScreen() {
  useTitleSlot(
    <>
      <span className="text-[12px] text-ink-2">Home</span>
      <span className="flex-1" />
      <RefreshButton />
    </>,
    "desk",
  );
  const auth = useAuth();
  const appearance = usePrefs((p) => p.appearance);
  const workspace = useWorkspace();
  const inbox = usePullRequestInbox();
  const login = auth.viewer?.login ?? "";
  const cacheKey = homeCacheKey(login, workspace);
  const cached = useHomeSnapshot(cacheKey);
  const activity = useEffectQuery(
    ["activity", login],
    Effect.flatMap(GitHub, (g) => g.activity(login)),
    { enabled: !!login, staleTime: 3_600_000 },
  );
  const [period, setPeriod] = useState(30);
  const open = useOpenItem();
  useEffect(() => {
    if (inbox.data) saveHomeSnapshot(cacheKey, { inbox: inbox.data });
  }, [cacheKey, inbox.data]);
  useEffect(() => {
    if (activity.data) saveHomeSnapshot(cacheKey, { activity: activity.data });
  }, [activity.data, cacheKey]);
  const d = inbox.data ?? cached?.inbox ?? null;
  const activityData = activity.data ?? cached?.activity ?? null;
  const queue = useMemo(() => (d ? [...d.turn, ...d.unsorted] : []), [d]);
  const all = useMemo(() => (d ? [...queue, ...d.later] : []), [d, queue]);
  const days = useMemo(
    () => activityWindow(activityData?.days ?? [], period * 2),
    [activityData, period],
  );
  const current = days.slice(-period);
  const total = current.reduce((n, day) => n + day.count, 0);
  const previous = days.slice(0, period).reduce((n, day) => n + day.count, 0);
  const activeDays = current.filter((day) => day.count > 0).length;
  const waiting = d?.later.filter((i) => i.verdict === "waiting").length ?? 0;
  const ready = all.filter((i) => i.verdict === "mergeable");
  const needsFix = queue.filter((i) => i.ci === "failure" || i.conflicting);
  const blocked = all.filter((i) => i.kind === "pr" && (i.ci === "failure" || i.conflicting));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const buckets = queueAge(queue);
  const old = buckets[3].count;
  const heroImage =
    appearance === "sunset"
      ? "/images/home-sunset.png"
      : appearance === "stellarium"
        ? "/images/home-stellarium.png"
        : appearance === "aurora"
          ? "/images/home-aurora.png"
          : appearance === "nature"
            ? "/images/home-nature.png"
            : appearance === "nebula"
              ? "/images/home-nebula.png"
              : appearance === "clouds"
                ? "/images/home-clouds.png"
                : "/images/home-pixel-night-lowres.png";

  return (
    <div className="home-v2 h-full overflow-y-auto bg-desk scrollbar-thin">
      <div className="home-content">
        <section className="home-hero" data-appearance={appearance}>
          <img
            src={heroImage}
            alt=""
            className="home-hero-art"
            draggable={false}
            fetchPriority="high"
          />
          <header className="home-header">
            <div>
              <p className="home-overline">{workspace ?? "All repositories"}</p>
              <h1>
                {greeting}
                {auth.viewer ? `, ${auth.viewer.name?.split(" ")[0] || login}` : ""}.
              </h1>
              <p>Your workspace, at a glance. A good place to start.</p>
            </div>
          </header>
        </section>
        {inbox.isError && !d ? (
          <div className="home-message" role="alert">
            Couldn’t load your workspace.{" "}
            <Button variant="ghost" size="sm" type="button" onClick={() => void inbox.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        <div className="home-metrics">
          <Metric
            to="/inbox"
            label="Needs you"
            value={d ? queue.length : null}
            detail={d ? `${needsFix.length} with failing CI or conflicts` : "Loading your queue…"}
            icon={GitPullRequest}
          />
          <Metric
            to="/prs"
            label="Ready to merge"
            value={d ? ready.length : null}
            detail="Approved and ready to land"
            icon={GitMerge}
          />
          <Metric
            to="/inbox"
            label="Waiting on others"
            value={d ? waiting : null}
            detail="Keep your queue moving"
            icon={Clock3}
          />
          <Metric
            to="/health"
            label="Security findings"
            value={d ? d.counts.health : null}
            detail="Advisories in this workspace"
            icon={ShieldAlert}
          />
        </div>
        <div className="home-main-grid">
          <section className="home-panel home-activity">
            <div className="home-panel-heading">
              <div>
                <h2>Shipping activity</h2>
                <p>Your GitHub account · all repositories</p>
              </div>
              <div className="home-periods" aria-label="Activity period">
                {[14, 30, 90].map((n) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    key={n}
                    aria-pressed={period === n}
                    onClick={() => setPeriod(n)}
                  >
                    {n}d
                  </Button>
                ))}
              </div>
            </div>
            {!activityData && activity.isError ? (
              <div className="home-message">
                Activity is unavailable.{" "}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void activity.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : !activityData ? (
              <div className="home-chart-placeholder">Loading GitHub activity…</div>
            ) : (
              <>
                <div className="home-activity-summary">
                  <span className="tnum">{total}</span>
                  <div>
                    pull requests merged
                    <small>
                      {total - previous >= 0 ? "+" : ""}
                      {total - previous} vs previous {period} days · {activeDays} active days
                    </small>
                  </div>
                </div>
                <ActivityChart key={period} days={current} />
              </>
            )}
          </section>
          <section className="home-panel">
            <div className="home-panel-heading">
              <div>
                <h2>Queue balance</h2>
                <p>Current workspace · includes Later</p>
              </div>
              <CircleDot size={16} className="text-ink-3" />
            </div>
            {d ? (
              <Distribution groups={queueStatus(all)} />
            ) : (
              <div className="home-chart-placeholder">Loading queue…</div>
            )}
          </section>
        </div>
        <div className="home-bottom-grid">
          <section className="home-panel">
            <div className="home-panel-heading">
              <div>
                <h2>Getting older</h2>
                <p>Age since creation · items needing you</p>
              </div>
              <Clock3 size={16} className="text-ink-3" />
            </div>
            {d ? (
              <>
                <HorizontalBars
                  rows={buckets.filter((b) => b.label !== "Unknown age" || b.count > 0)}
                />
                <p className="home-panel-note">
                  {old
                    ? `${old} item${old === 1 ? " is" : "s are"} more than a week old.`
                    : "No items older than a week."}
                </p>
              </>
            ) : (
              <p className="home-panel-note">Loading queue…</p>
            )}
          </section>
          <section className="home-panel">
            <div className="home-panel-heading">
              <div>
                <h2>Up next</h2>
                <p>From your prioritized Inbox</p>
              </div>
              <Link to="/inbox" aria-label="See full Inbox">
                <ArrowUpRight size={17} />
              </Link>
            </div>
            {!d ? (
              <p className="home-panel-note">Loading priorities…</p>
            ) : queue.length ? (
              <div className="home-next">
                {queue.slice(0, 4).map((item) => (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    key={item.id}
                    onClick={() => open(item)}
                  >
                    <GitPullRequest size={16} className="text-workspace" />
                    <div>
                      <span>{item.title}</span>
                      <small>
                        {item.repo}
                        {item.number ? ` #${item.number}` : ""} · {age(item.createdAt)}
                        <br />
                        {item.why}
                      </small>
                    </div>
                    <ArrowUpRight size={14} className="text-ink-3" />
                  </Button>
                ))}
              </div>
            ) : (
              <div className="home-clear">
                <CheckCheck size={24} />
                <p>You’re all caught up.</p>
                <span>New requests will appear here.</span>
              </div>
            )}
          </section>
          <section className="home-panel">
            <div className="home-panel-heading">
              <div>
                <h2>{workspace ? "Needs a look" : "Where work is waiting"}</h2>
                <p>
                  {workspace
                    ? "Pull requests in this workspace"
                    : "Items needing you · by repository"}
                </p>
              </div>
            </div>
            {workspace ? (
              <div className="home-health-links">
                <Link to="/prs">
                  <span>
                    Failing CI or conflicts<small>Among your tracked pull requests</small>
                  </span>
                  <strong className="tnum">{d ? blocked.length : "–"}</strong>
                  <ArrowRight size={14} />
                </Link>
                <Link to="/prs">
                  <span>
                    Ready to land<small>Approved pull requests</small>
                  </span>
                  <strong className="tnum">{d ? ready.length : "–"}</strong>
                  <ArrowRight size={14} />
                </Link>
                <Link to="/mentions">
                  <span>
                    Unread notifications<small>In this repository</small>
                  </span>
                  <strong className="tnum">{d ? d.notifications.length : "–"}</strong>
                  <ArrowRight size={14} />
                </Link>
              </div>
            ) : d ? (
              <HorizontalBars rows={queueRepos(queue).slice(0, 5)} />
            ) : (
              <p className="home-panel-note">Loading repositories…</p>
            )}
          </section>
        </div>
        <section className="home-panel home-year">
          <div className="home-panel-heading">
            <div>
              <h2>A year of shipping</h2>
              <p>Your GitHub account · all repositories</p>
            </div>
          </div>
          {activityData ? (
            <div className="home-heatmap">
              <Heatmap days={[...activityData.days]} />
            </div>
          ) : (
            <p className="home-panel-note">
              {activity.isError ? "GitHub activity is unavailable." : "Loading your year…"}
            </p>
          )}
        </section>
        <footer className="home-footer">
          <span>Queue metrics reflect {workspace ?? "all watched repositories"}.</span>
          <span>
            {d
              ? `Last synced ${new Date(d.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Connecting to GitHub…"}
          </span>
        </footer>
      </div>
    </div>
  );
}

function Metric({
  to,
  label,
  value,
  detail,
  icon: Icon,
}: {
  to: "/inbox" | "/prs" | "/health";
  label: string;
  value: number | null;
  detail: string;
  icon: typeof GitPullRequest;
}) {
  return (
    <Link to={to} className="home-metric">
      <div>
        <span>{label}</span>
        <Icon size={16} />
      </div>
      <strong className="tnum">{value ?? "–"}</strong>
      <p>{detail}</p>
    </Link>
  );
}
