import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { ciMeta, reviewMeta } from "@/lib/status";
import type { Dashboard, MinePr, PullSummary } from "@/lib/tauri";
import { invoke, parseRepoUrl } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  Clock,
  FilePen,
  GitMerge,
  GitPullRequest,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const DAY = 86_400_000;

interface InboxItem {
  id: number;
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  avatar: string;
  updatedAt: string;
  ci?: MinePr["ci"];
  review?: string | null;
}

function fromSummary(p: PullSummary): InboxItem | null {
  const r = parseRepoUrl(p.repository_url);
  if (!r) return null;
  return {
    id: p.id,
    owner: r.owner,
    repo: r.repo,
    number: p.number,
    title: p.title,
    author: p.user.login,
    avatar: p.user.avatar_url,
    updatedAt: p.updated_at,
  };
}

function fromMine(m: MinePr): InboxItem {
  const [owner, repo] = m.repo.split("/");
  return {
    id: m.id,
    owner: owner ?? "",
    repo: repo ?? "",
    number: m.number,
    title: m.title,
    author: m.author,
    avatar: m.avatar,
    updatedAt: m.updatedAt ?? m.createdAt ?? "",
    ci: m.ci,
    review: m.reviewDecision,
  };
}

function shortAge(iso: string): { label: string; aging: boolean } {
  if (!iso) return { label: "", aging: false };
  const ms = Date.now() - +new Date(iso);
  const d = Math.floor(ms / DAY);
  if (d >= 1) return { label: `${d}d`, aging: d > 7 };
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return { label: `${h}h`, aging: false };
  return { label: "now", aging: false };
}

export function DashboardPage() {
  const viewer = useAuth((s) => s.viewer);
  const watched = useWatchedRepos((s) => s.repos);
  const repoQual = useMemo(() => watched.map((r) => `repo:${r}`).join(" "), [watched]);

  const dashboard = useQuery({
    queryKey: ["dashboard", repoQual],
    queryFn: () => invoke<Dashboard>("gh_dashboard", { repoQualifier: repoQual }),
    // Short so returning focus (after merging on GitHub) refetches; in-app
    // actions + poller events invalidate it directly via ["dashboard"].
    staleTime: 60_000,
  });

  const reviewRequested = useQuery({
    queryKey: ["prs", "review-requested"],
    queryFn: () =>
      invoke<PullSummary[]>("gh_review_requested", { includeDrafts: false, includeClosed: false }),
  });

  // INCOMING — PRs requesting your review, scoped to watched repos, oldest first.
  const incoming = useMemo(() => {
    const ws = new Set(watched);
    return (reviewRequested.data ?? [])
      .map(fromSummary)
      .filter((x): x is InboxItem => !!x && (ws.size === 0 || ws.has(`${x.owner}/${x.repo}`)))
      .sort((a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt));
  }, [reviewRequested.data, watched]);

  // OUTGOING — your open PRs, bucketed by what action they need.
  const buckets = useMemo(() => {
    const mine = (dashboard.data?.mine ?? []).map((m) => ({ raw: m, item: fromMine(m) }));
    const drafts: InboxItem[] = [];
    const needsAttention: InboxItem[] = [];
    const ready: InboxItem[] = [];
    const awaiting: InboxItem[] = [];
    for (const { raw, item } of mine) {
      if (raw.isDraft) {
        drafts.push(item);
      } else if (raw.reviewDecision === "CHANGES_REQUESTED" || raw.ci === "failure") {
        needsAttention.push(item);
      } else if (raw.reviewDecision === "APPROVED") {
        ready.push(item);
      } else {
        awaiting.push(item);
      }
    }
    const byAge = (a: InboxItem, b: InboxItem) => +new Date(a.updatedAt) - +new Date(b.updatedAt);
    return {
      drafts: drafts.sort(byAge),
      needsAttention: needsAttention.sort(byAge),
      ready: ready.sort(byAge),
      awaiting: awaiting.sort(byAge),
    };
  }, [dashboard.data]);

  const agingCount = useMemo(
    () => incoming.filter((i) => shortAge(i.updatedAt).aging).length,
    [incoming],
  );
  const oldest = incoming[0] ? shortAge(incoming[0].updatedAt).label : null;

  // Review backlog bucketed by how long it's been waiting — the hero chart.
  const ageBuckets = useMemo(() => {
    const b = [0, 0, 0, 0]; // ≤1d · 2–3d · 4–7d · >7d
    for (const i of incoming) {
      const days = Math.floor((Date.now() - +new Date(i.updatedAt)) / DAY);
      if (days <= 1) b[0] += 1;
      else if (days <= 3) b[1] += 1;
      else if (days <= 7) b[2] += 1;
      else b[3] += 1;
    }
    return b;
  }, [incoming]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const syncedAt = dashboard.dataUpdatedAt;
  const refreshing = dashboard.isFetching || reviewRequested.isFetching;
  const refreshAll = () => {
    dashboard.refetch();
    reviewRequested.refetch();
  };

  const loadingIn = reviewRequested.isLoading;
  const loadingOut = dashboard.isLoading;
  const hasData = !loadingIn && !loadingOut;
  const totalMine =
    buckets.needsAttention.length +
    buckets.ready.length +
    buckets.awaiting.length +
    buckets.drafts.length;
  const allEmpty = hasData && incoming.length === 0 && totalMine === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={viewer ? `Hey, ${viewer.name ?? viewer.login}` : "Inbox"}
        subtitle={
          hasData
            ? summarize(
                incoming.length,
                oldest,
                buckets.ready.length,
                buckets.needsAttention.length,
              )
            : "Your review inbox"
        }
      />

      <ScrollArea className="flex-1">
        <div className="flex items-center justify-end gap-3 px-6 pt-4 pb-1">
          {syncedAt > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              Synced {relativeTime(syncedAt)}
            </span>
          )}
          <IconButton label="Refresh" icon={RefreshCw} loading={refreshing} onClick={refreshAll} />
        </div>

        {allEmpty ? (
          <div className="px-6 py-16">
            <EmptyState
              icon={CheckCheck}
              title="You're all caught up"
              description="No reviews waiting on you, and nothing of yours needs attention. Enjoy the quiet. 🎉"
            />
          </div>
        ) : (
          <>
            {hasData && (
              <InboxHero
                waiting={incoming.length}
                oldest={oldest}
                aging={agingCount}
                ready={buckets.ready.length}
                needsFixing={buckets.needsAttention.length}
                ageBuckets={ageBuckets}
              />
            )}
            <div className="px-3 pb-8">
              <Section
                title="Needs your review"
                count={incoming.length}
                icon={GitPullRequest}
                tone="primary"
                badge={agingCount > 0 ? `${agingCount} aging` : undefined}
                loading={loadingIn}
                alwaysShow
                emptyText="Inbox zero — nothing waiting on you. 🎉"
                items={incoming}
              />
              <Section
                title="Needs your attention"
                count={buckets.needsAttention.length}
                icon={AlertTriangle}
                tone="destructive"
                loading={loadingOut}
                items={buckets.needsAttention}
              />
              <Section
                title="Ready to merge"
                count={buckets.ready.length}
                icon={GitMerge}
                tone="success"
                loading={loadingOut}
                items={buckets.ready}
              />
              <Section
                title="Awaiting review"
                count={buckets.awaiting.length}
                icon={Clock}
                tone="muted"
                loading={loadingOut}
                items={buckets.awaiting}
              />
              <Section
                title="Drafts"
                count={buckets.drafts.length}
                icon={FilePen}
                tone="muted"
                loading={loadingOut}
                defaultOpen={false}
                items={buckets.drafts}
              />
            </div>
          </>
        )}
      </ScrollArea>
    </div>
  );
}

function summarize(needs: number, oldest: string | null, ready: number, attention: number): string {
  if (needs === 0 && ready === 0 && attention === 0) return "All clear — nothing needs you.";
  const parts: string[] = [];
  parts.push(
    needs === 0
      ? "Nothing waiting on you"
      : `${needs} waiting on you${oldest ? ` · oldest ${oldest}` : ""}`,
  );
  if (ready > 0) parts.push(`${ready} ready to merge`);
  if (attention > 0) parts.push(`${attention} need fixing`);
  return parts.join(" · ");
}

type Tone = "primary" | "success" | "destructive" | "muted";

const TONE: Record<Tone, string> = {
  primary: "text-primary",
  success: "text-success",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

const SECTION_LIMIT = 10;

const DOT: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
};

/** The inbox hero: headline metric, secondary stats as (zero-hiding) chips, and
 * an animated "backlog by age" bar chart. */
function InboxHero({
  waiting,
  oldest,
  aging,
  ready,
  needsFixing,
  ageBuckets,
}: {
  waiting: number;
  oldest: string | null;
  aging: number;
  ready: number;
  needsFixing: number;
  ageBuckets: number[];
}) {
  return (
    <div className="relative mx-6 mb-4 overflow-hidden rounded-2xl border border-hairline bg-gradient-to-br from-primary/[0.07] via-card/20 to-transparent px-5 py-5">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Your review queue
          </p>
          <h2 className="mt-1.5 font-display text-[28px] leading-none tracking-tight text-foreground">
            <span className="bg-gradient-to-r from-primary to-info bg-clip-text tabular-nums text-transparent">
              {waiting}
            </span>{" "}
            {waiting === 1 ? "PR waiting" : "PRs waiting"} on you
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {waiting === 0
              ? "Inbox zero — nothing waiting. 🎉"
              : oldest
                ? `Oldest has waited ${oldest}`
                : "Fresh off the queue"}
          </p>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Chip tone="destructive" value={aging} label="aging" />
            <Chip tone="success" value={ready} label="ready to merge" />
            <Chip tone="destructive" value={needsFixing} label="needs fixing" />
          </div>
        </div>
        <AgeChart buckets={ageBuckets} />
      </div>
    </div>
  );
}

function Chip({ tone, value, label }: { tone: Tone; value: number; label: string }) {
  if (value === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-foreground/[0.05] px-2.5 py-1 text-xs">
      <span className={cn("size-1.5 rounded-full", DOT[tone])} />
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

/** "Backlog by age" bars that grow in on mount. */
function AgeChart({ buckets }: { buckets: number[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const max = Math.max(1, ...buckets);
  const labels = ["≤1d", "2–3d", "4–7d", ">7d"];
  return (
    <div
      className="hidden shrink-0 items-end gap-2.5 sm:flex"
      role="img"
      aria-label="Backlog by age"
    >
      {buckets.map((v, i) => (
        <div key={labels[i]} className="flex w-9 flex-col items-center gap-1.5">
          <span className="h-3 text-[11px] tabular-nums text-muted-foreground/80">{v || ""}</span>
          <div className="relative flex h-20 w-full items-end overflow-hidden rounded-md bg-foreground/[0.04]">
            <div
              className={cn(
                "w-full rounded-md transition-[height] duration-700 ease-out",
                i === 3 ? "bg-destructive/70" : "bg-primary/55",
              )}
              style={{ height: mounted ? `${Math.max(v ? 8 : 0, (v / max) * 100)}%` : "0%" }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground/60">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  tone,
  badge,
  items,
  loading,
  alwaysShow,
  defaultOpen = true,
  emptyText,
}: {
  title: string;
  count: number;
  icon: typeof GitPullRequest;
  tone: Tone;
  badge?: string;
  items: InboxItem[];
  loading?: boolean;
  alwaysShow?: boolean;
  defaultOpen?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="px-3 py-3">
        <Skeleton className="mb-2 h-5 w-40" />
        <div className="space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (!alwaysShow && items.length === 0) return null;

  const shown = items.slice(0, SECTION_LIMIT);

  return (
    <section className="py-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-foreground/[0.03]"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform",
            open && "rotate-90",
          )}
        />
        <Icon className={cn("size-4 shrink-0", TONE[tone])} strokeWidth={1.75} />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-sm tabular-nums text-muted-foreground/70">{count}</span>
        {badge && (
          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
            {badge}
          </span>
        )}
      </button>

      {open &&
        (items.length === 0 ? (
          <p className="px-10 py-3 text-xs text-muted-foreground">{emptyText ?? "Nothing here."}</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5">
            {shown.map((it) => (
              <li key={it.id}>
                <InboxRow
                  item={it}
                  onOpen={() =>
                    navigate({
                      to: "/prs/$owner/$repo/$number",
                      params: { owner: it.owner, repo: it.repo, number: String(it.number) },
                    })
                  }
                />
              </li>
            ))}
            {items.length > shown.length && (
              <li className="px-10 pt-1 text-xs text-muted-foreground">
                +{items.length - shown.length} more
              </li>
            )}
          </ul>
        ))}
    </section>
  );
}

function InboxRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const age = shortAge(item.updatedAt);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 pl-10 text-left transition-colors hover:bg-foreground/[0.04]",
        // PRs that have been waiting on you for over a week get a faint accent.
        age.aging && "bg-destructive/[0.035]",
      )}
    >
      {item.avatar ? (
        <img src={item.avatar} alt="" className="size-5 shrink-0 rounded-full" />
      ) : (
        <span className="size-5 shrink-0 rounded-full bg-foreground/10" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {item.owner}/{item.repo} <span className="text-muted-foreground/60">#{item.number}</span>
          {item.author && <span className="text-muted-foreground/60"> · {item.author}</span>}
        </p>
      </div>
      <ReviewBadge review={item.review} />
      <CiIcon ci={item.ci} />
      <span
        className={cn(
          "w-9 shrink-0 text-right text-xs tabular-nums",
          age.aging ? "font-semibold text-destructive" : "text-muted-foreground/70",
        )}
      >
        {age.label}
      </span>
    </button>
  );
}

function ReviewBadge({ review }: { review?: string | null }) {
  const m = reviewMeta(review);
  if (!m) return null;
  const Icon = m.icon;
  return (
    <Icon className={cn("size-3.5 shrink-0", m.tone)} strokeWidth={2.5} aria-label={m.label} />
  );
}

function CiIcon({ ci }: { ci?: InboxItem["ci"] }) {
  const m = ciMeta(ci);
  if (!m) return null;
  const Icon = m.icon;
  // A passing check is dimmed; failing/pending stay full strength.
  return (
    <Icon
      className={cn("size-3.5 shrink-0", m.tone, ci === "success" && "opacity-70")}
      aria-label={m.label}
    />
  );
}
