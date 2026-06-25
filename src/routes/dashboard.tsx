import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { PopoverItem, PopoverPanel, PopoverSection } from "@/components/popover";
import { TooltipFor } from "@/components/tooltip-for";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { ciMeta, reviewMeta } from "@/lib/status";
import type { Dashboard, DashboardPr } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { type DashboardViewMode, useDashboardPrefs } from "@/stores/dashboard-prefs";
import { type SnoozeKind, getPrSnooze, isPrSnoozed, usePrSnoozes } from "@/stores/pr-snoozes";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCheck,
  ChevronRight,
  Clock,
  FilePen,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Kanban,
  Layers,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Rows3,
  SlidersHorizontal,
  TimerReset,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const DAY = 86_400_000;

const VIEW_OPTIONS = [
  { value: "compact", label: "Compact", icon: Rows3 },
  { value: "kanban", label: "Board", icon: Kanban },
] satisfies Array<{ value: DashboardViewMode; label: string; icon: typeof Rows3 }>;

type Priority = "critical" | "high" | "normal" | "low";

interface InboxItem extends DashboardPr {
  owner: string;
  repoName: string;
  priority: Priority;
  waitingDays: number;
  blocked: boolean;
}

function fromPr(m: DashboardPr): InboxItem {
  const [owner, repo] = m.repo.split("/");
  const waitingDays = ageDays(m.updatedAt ?? m.createdAt);
  const blocked = isBlocked(m);
  return {
    ...m,
    owner: owner ?? "",
    repoName: repo ?? "",
    priority: priorityFor(m, waitingDays, blocked),
    waitingDays,
    blocked,
  };
}

function ageDays(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - +new Date(iso)) / DAY));
}

function shortAge(iso?: string | null): { label: string; aging: boolean } {
  if (!iso) return { label: "", aging: false };
  const ms = Date.now() - +new Date(iso);
  const d = Math.floor(ms / DAY);
  if (d >= 1) return { label: `${d}d`, aging: d > 7 };
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return { label: `${h}h`, aging: false };
  return { label: "now", aging: false };
}

function isBlocked(pr: DashboardPr): boolean {
  return (
    pr.ci === "failure" ||
    pr.conflicting ||
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.unresolvedThreadCount > 0
  );
}

function priorityFor(
  pr: DashboardPr,
  waitingDays = ageDays(pr.updatedAt ?? pr.createdAt),
  blocked = isBlocked(pr),
): Priority {
  if (waitingDays > 7 || (blocked && waitingDays > 3)) return "critical";
  if (
    pr.ci === "failure" ||
    pr.conflicting ||
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.unresolvedThreadCount > 0 ||
    (waitingDays >= 4 && waitingDays <= 7)
  ) {
    return "high";
  }
  if ((waitingDays >= 1 && waitingDays <= 3) || pr.ci === "pending") return "normal";
  return "low";
}

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function byPriorityThenAge(a: InboxItem, b: InboxItem): number {
  return (
    PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] ||
    +new Date(a.updatedAt ?? a.createdAt ?? 0) - +new Date(b.updatedAt ?? b.createdAt ?? 0)
  );
}

export function DashboardPage() {
  const viewer = useAuth((s) => s.viewer);
  const watched = useWatchedRepos((s) => s.repos);
  const snoozes = usePrSnoozes((s) => s.snoozes);
  const viewMode = useDashboardPrefs((s) => s.viewMode);
  const setViewMode = useDashboardPrefs((s) => s.setViewMode);
  const kanbanShowEmptyStatuses = useDashboardPrefs((s) => s.kanbanShowEmptyStatuses);
  const setKanbanShowEmptyStatuses = useDashboardPrefs((s) => s.setKanbanShowEmptyStatuses);
  const kanbanShowCardSignals = useDashboardPrefs((s) => s.kanbanShowCardSignals);
  const setKanbanShowCardSignals = useDashboardPrefs((s) => s.setKanbanShowCardSignals);
  const repoQual = useMemo(() => watched.map((r) => `repo:${r}`).join(" "), [watched]);

  const dashboard = useQuery({
    queryKey: ["dashboard", repoQual],
    queryFn: () => invoke<Dashboard>("gh_dashboard", { repoQualifier: repoQual }),
    // Short so returning focus (after merging on GitHub) refetches; in-app
    // actions + poller events invalidate it directly via ["dashboard"].
    staleTime: 60_000,
  });

  // INCOMING — PRs requesting your review, oldest first, using the enriched GraphQL rows.
  const allIncoming = useMemo(
    () => (dashboard.data?.incoming ?? []).map(fromPr).sort(byPriorityThenAge),
    [dashboard.data],
  );

  const allMine = useMemo(
    () => (dashboard.data?.mine ?? []).map(fromPr).sort(byPriorityThenAge),
    [dashboard.data],
  );

  const activeIncoming = useMemo(
    () => allIncoming.filter((i) => !isPrSnoozed(i, getPrSnooze(snoozes, i))),
    [allIncoming, snoozes],
  );

  const snoozed = useMemo(() => {
    const byId = new Map<number, InboxItem>();
    for (const item of [...allIncoming, ...allMine]) {
      if (isPrSnoozed(item, getPrSnooze(snoozes, item))) byId.set(item.id, item);
    }
    return [...byId.values()].sort(byPriorityThenAge);
  }, [allIncoming, allMine, snoozes]);

  const blocked = useMemo(() => activeIncoming.filter((i) => i.blocked), [activeIncoming]);
  const stale = useMemo(
    () => activeIncoming.filter((i) => !i.blocked && i.waitingDays > 3),
    [activeIncoming],
  );
  const incoming = useMemo(
    () => activeIncoming.filter((i) => !i.blocked && i.waitingDays <= 3),
    [activeIncoming],
  );

  // OUTGOING — your open PRs, bucketed by what action they need.
  const buckets = useMemo(() => {
    const drafts: InboxItem[] = [];
    const needsAttention: InboxItem[] = [];
    const ready: InboxItem[] = [];
    const awaiting: InboxItem[] = [];
    for (const item of allMine.filter((i) => !isPrSnoozed(i, getPrSnooze(snoozes, i)))) {
      if (item.isDraft) {
        drafts.push(item);
      } else if (
        item.reviewDecision === "CHANGES_REQUESTED" ||
        item.ci === "failure" ||
        item.conflicting ||
        item.unresolvedThreadCount > 0
      ) {
        needsAttention.push(item);
      } else if (item.reviewDecision === "APPROVED") {
        ready.push(item);
      } else {
        awaiting.push(item);
      }
    }
    return {
      drafts: drafts.sort(byPriorityThenAge),
      needsAttention: needsAttention.sort(byPriorityThenAge),
      ready: ready.sort(byPriorityThenAge),
      awaiting: awaiting.sort(byPriorityThenAge),
    };
  }, [allMine, snoozes]);

  const agingCount = useMemo(
    () => activeIncoming.filter((i) => shortAge(i.updatedAt ?? i.createdAt).aging).length,
    [activeIncoming],
  );
  const oldest = activeIncoming[0]
    ? shortAge(activeIncoming[0].updatedAt ?? activeIncoming[0].createdAt).label
    : null;
  const conflictingCount = buckets.needsAttention.filter((i) => i.conflicting).length;

  // Review backlog bucketed by how long it's been waiting — the hero chart.
  const ageBuckets = useMemo(() => {
    const b = [0, 0, 0, 0]; // ≤1d · 2–3d · 4–7d · >7d
    for (const i of activeIncoming) {
      const days = ageDays(i.updatedAt ?? i.createdAt);
      if (days <= 1) b[0] += 1;
      else if (days <= 3) b[1] += 1;
      else if (days <= 7) b[2] += 1;
      else b[3] += 1;
    }
    return b;
  }, [activeIncoming]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const syncedAt = dashboard.dataUpdatedAt;
  const refreshing = dashboard.isFetching;
  const refreshAll = () => {
    dashboard.refetch();
  };

  const loadingIn = dashboard.isLoading;
  const loadingOut = dashboard.isLoading;
  const hasData = !loadingIn && !loadingOut;
  const totalMine =
    buckets.needsAttention.length +
    buckets.ready.length +
    buckets.awaiting.length +
    buckets.drafts.length;
  const totalActiveIncoming = blocked.length + stale.length + incoming.length;
  const allEmpty = hasData && totalActiveIncoming === 0 && totalMine === 0 && snoozed.length === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={viewer ? `Hey, ${viewer.name ?? viewer.login}` : "Inbox"}
        subtitle={
          hasData
            ? summarize(
                totalActiveIncoming,
                oldest,
                buckets.ready.length,
                buckets.needsAttention.length,
              )
            : "Your review inbox"
        }
        actions={
          <>
            {viewMode === "kanban" && (
              <KanbanDisplayMenu
                showEmptyStatuses={kanbanShowEmptyStatuses}
                onShowEmptyStatuses={setKanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
                onShowCardSignals={setKanbanShowCardSignals}
              />
            )}
            <DashboardViewToggle value={viewMode} onChange={setViewMode} />
          </>
        }
      />

      <ScrollArea className="flex-1">
        <div className="flex flex-wrap items-center justify-end gap-3 px-6 pt-4 pb-1">
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
                waiting={totalActiveIncoming}
                oldest={oldest}
                aging={agingCount}
                ready={buckets.ready.length}
                needsFixing={buckets.needsAttention.length}
                conflicting={conflictingCount}
                ageBuckets={ageBuckets}
              />
            )}
            <div
              className={cn(
                "pb-8",
                viewMode === "kanban" ? "flex items-start gap-3 overflow-x-auto px-6" : "px-3",
              )}
            >
              <Section
                title="Blocked"
                count={blocked.length}
                icon={AlertTriangle}
                tone="destructive"
                loading={loadingIn}
                items={blocked}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
              <Section
                title="Stale"
                count={stale.length}
                icon={TimerReset}
                tone="warning"
                loading={loadingIn}
                items={stale}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
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
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
              <Section
                title="Needs your attention"
                count={buckets.needsAttention.length}
                icon={AlertTriangle}
                tone="destructive"
                loading={loadingOut}
                items={buckets.needsAttention}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
              <Section
                title="Ready to merge"
                count={buckets.ready.length}
                icon={GitMerge}
                tone="success"
                loading={loadingOut}
                items={buckets.ready}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
              <Section
                title="Awaiting review"
                count={buckets.awaiting.length}
                icon={Clock}
                tone="muted"
                loading={loadingOut}
                items={buckets.awaiting}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
              <Section
                title="Drafts"
                count={buckets.drafts.length}
                icon={FilePen}
                tone="muted"
                loading={loadingOut}
                defaultOpen={false}
                items={buckets.drafts}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
              />
              <Section
                title="Snoozed"
                count={snoozed.length}
                icon={Clock}
                tone="muted"
                items={snoozed}
                defaultOpen={false}
                viewMode={viewMode}
                showEmptyStatuses={kanbanShowEmptyStatuses}
                showCardSignals={kanbanShowCardSignals}
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

function DashboardViewToggle({
  value,
  onChange,
}: {
  value: DashboardViewMode;
  onChange: (mode: DashboardViewMode) => void;
}) {
  return (
    <div className="inline-flex h-7 shrink-0 items-center rounded-lg bg-foreground/[0.05] p-0.5">
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <TooltipFor key={option.value} label={option.label}>
            <button
              type="button"
              aria-label={option.label}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "inline-flex size-6 items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-card text-foreground shadow-md ring-1 ring-border/40 ring-inset"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          </TooltipFor>
        );
      })}
    </div>
  );
}

function KanbanDisplayMenu({
  showEmptyStatuses,
  onShowEmptyStatuses,
  showCardSignals,
  onShowCardSignals,
}: {
  showEmptyStatuses: boolean;
  onShowEmptyStatuses: (show: boolean) => void;
  showCardSignals: boolean;
  onShowCardSignals: (show: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <TooltipFor label="Board display">
        <button
          type="button"
          aria-label="Board display"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-7 items-center justify-center rounded-lg bg-foreground/[0.05] text-muted-foreground transition-colors hover:text-foreground data-[open=true]:bg-card data-[open=true]:text-foreground data-[open=true]:shadow-md data-[open=true]:ring-1 data-[open=true]:ring-border/40"
          data-open={open}
        >
          <SlidersHorizontal className="size-3.5" />
        </button>
      </TooltipFor>
      {open && (
        <PopoverPanel onClose={() => setOpen(false)} width="w-52">
          <PopoverSection title="Board">
            <PopoverItem
              icon={Layers}
              checked={showEmptyStatuses}
              onClick={() => onShowEmptyStatuses(!showEmptyStatuses)}
            >
              Empty statuses
            </PopoverItem>
            <PopoverItem
              icon={MessageSquare}
              checked={showCardSignals}
              onClick={() => onShowCardSignals(!showCardSignals)}
            >
              Card signals
            </PopoverItem>
          </PopoverSection>
        </PopoverPanel>
      )}
    </div>
  );
}

type Tone = "primary" | "success" | "destructive" | "warning" | "muted";

const TONE: Record<Tone, string> = {
  primary: "text-primary",
  success: "text-success",
  destructive: "text-destructive",
  warning: "text-warning",
  muted: "text-muted-foreground",
};

const SECTION_LIMIT = 10;

const DOT: Record<Tone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  destructive: "bg-destructive",
  warning: "bg-warning",
  muted: "bg-muted-foreground",
};

/** Animate a number from its last value up to `target` on change (easeOutCubic).
 * First mount animates 0 → target, the count-up "wow" when the inbox opens. */
function useCountUp(target: number, ms = 1000): number {
  const [val, setVal] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    let raf = 0;
    let startT: number | null = null;
    const step = (t: number) => {
      if (startT === null) startT = t;
      const p = Math.min(1, (t - startT) / ms);
      const cur = Math.round(from + (target - from) * (1 - (1 - p) ** 3));
      fromRef.current = cur;
      setVal(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

/** The inbox hero — sober and typographic: an oversized count-up number leads,
 * the rest is muted. No colour beyond small semantic dots. */
function InboxHero({
  waiting,
  oldest,
  aging,
  ready,
  needsFixing,
  conflicting,
  ageBuckets,
}: {
  waiting: number;
  oldest: string | null;
  aging: number;
  ready: number;
  needsFixing: number;
  conflicting: number;
  ageBuckets: number[];
}) {
  const n = useCountUp(waiting);
  return (
    <div className="relative mx-6 mb-4 overflow-hidden rounded-2xl border border-hairline bg-card/40 px-8 py-9">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 right-0 size-72 rounded-full bg-foreground/[0.035] blur-3xl"
      />
      <div className="relative flex items-end justify-between gap-8">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground/60">
            Waiting on your review
          </p>
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-display text-[76px] font-medium leading-[0.85] tracking-tighter text-foreground tabular-nums">
              {n}
            </span>
            <span className="pb-1.5 text-base text-muted-foreground">
              {waiting === 1 ? "pull request" : "pull requests"}
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {waiting === 0
              ? "Inbox zero — nothing waiting."
              : oldest
                ? `Oldest has waited ${oldest}`
                : "Fresh off the queue"}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip tone="destructive" value={conflicting} label="with conflicts" />
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

/** "Backlog by age" bars that grow in on mount — muted, single-tone. */
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
          <span className="h-3 text-[11px] tabular-nums text-muted-foreground/70">{v || ""}</span>
          <div className="relative flex h-20 w-full items-end overflow-hidden rounded-md bg-foreground/[0.05]">
            <div
              className={cn(
                "w-full rounded-md transition-[height] duration-1000 ease-out",
                i === 3 ? "bg-destructive/45" : "bg-foreground/25",
              )}
              style={{ height: mounted ? `${Math.max(v ? 10 : 0, (v / max) * 100)}%` : "0%" }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground/55">{labels[i]}</span>
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
  viewMode,
  showEmptyStatuses,
  showCardSignals,
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
  viewMode: DashboardViewMode;
  showEmptyStatuses: boolean;
  showCardSignals: boolean;
}) {
  const isBoard = viewMode === "kanban";
  const [open, setOpen] = useState(() => (isBoard && count === 0 ? false : defaultOpen));
  const navigate = useNavigate();

  useEffect(() => {
    if (!isBoard) return;
    setOpen(count > 0);
  }, [count, isBoard]);

  if (loading) {
    return (
      <div
        className={cn(
          "px-3 py-3",
          isBoard && "min-w-72 max-w-[28rem] flex-[1_0_18rem] rounded-lg bg-card/30",
        )}
      >
        <Skeleton className="mb-2 h-5 w-40" />
        <div className="space-y-1.5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (isBoard && items.length === 0 && !showEmptyStatuses) return null;
  if (!isBoard && !alwaysShow && items.length === 0) return null;

  const shown = items.slice(0, SECTION_LIMIT);

  return (
    <section
      className={cn(
        "py-1",
        isBoard &&
          "min-w-72 max-w-[28rem] flex-[1_0_18rem] rounded-lg border border-hairline bg-card/30 p-1",
      )}
    >
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
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground/70">{count}</span>
        {badge && (
          <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
            {badge}
          </span>
        )}
      </button>

      {open &&
        (items.length === 0 ? (
          <p className={cn("py-3 text-xs text-muted-foreground", isBoard ? "px-3" : "px-10")}>
            {emptyText ?? "Nothing here."}
          </p>
        ) : (
          <ul
            className={cn("mt-1", isBoard ? "space-y-2 px-1 pb-1" : "divide-y divide-hairline/40")}
          >
            {shown.map((it) => (
              <li key={it.id}>
                <InboxRow
                  item={it}
                  viewMode={viewMode}
                  showSignals={!isBoard || showCardSignals}
                  onOpen={() =>
                    navigate({
                      to: "/prs/$owner/$repo/$number",
                      params: { owner: it.owner, repo: it.repoName, number: String(it.number) },
                    })
                  }
                />
              </li>
            ))}
            {items.length > shown.length && (
              <li className={cn("pt-1 text-xs text-muted-foreground", isBoard ? "px-2" : "px-10")}>
                +{items.length - shown.length} more
              </li>
            )}
          </ul>
        ))}
    </section>
  );
}

function InboxRow({
  item,
  viewMode,
  showSignals,
  onOpen,
}: {
  item: InboxItem;
  viewMode: DashboardViewMode;
  showSignals: boolean;
  onOpen: () => void;
}) {
  const age = shortAge(item.updatedAt ?? item.createdAt);
  const snooze = usePrSnoozes((s) => s.snooze);
  const unsnooze = usePrSnoozes((s) => s.unsnooze);
  const currentSnooze = usePrSnoozes((s) => getPrSnooze(s.snoozes, item));
  const snoozed = isPrSnoozed(item, currentSnooze);
  const isCompact = viewMode === "compact";
  const isCard = viewMode === "kanban";
  const applySnooze = (kind: SnoozeKind) => {
    const entry = snooze(item, kind);
    toast("Snoozed", {
      description: `${item.repo} #${item.number}`,
      action: { label: "Undo", onClick: () => unsnooze(entry.key) },
    });
  };

  return (
    <div
      className={cn(
        "group flex w-full transition-colors hover:bg-foreground/[0.03]",
        isCard
          ? "h-40 min-w-0 flex-col items-stretch gap-3 overflow-hidden rounded-lg border border-hairline bg-card/35 p-3 hover:bg-card/55"
          : "items-center gap-3 px-3 pl-10",
        isCompact ? "py-1.5" : !isCard && "py-3",
        // PRs that have been waiting on you for over a week get a faint accent.
        age.aging && "bg-destructive/[0.035]",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex min-w-0 flex-1 gap-3 text-left",
          isCard ? "min-h-0 items-start" : "items-center",
        )}
      >
        {item.avatar ? (
          <img
            src={item.avatar}
            alt=""
            className={cn("shrink-0 rounded-full", isCompact ? "size-5" : "size-6")}
          />
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-full bg-foreground/10",
              isCompact ? "size-5" : "size-6",
            )}
          />
        )}
        <div className={cn("min-w-0 flex-1", isCard && "min-h-0")}>
          <div
            className={cn(
              "flex min-w-0 max-w-full gap-2",
              isCard ? "flex-col items-start" : "items-center",
            )}
          >
            <p
              className={cn(
                "min-w-0 max-w-full font-medium text-foreground",
                isCard
                  ? "line-clamp-2 text-sm leading-snug break-words [overflow-wrap:anywhere]"
                  : "truncate text-sm",
              )}
            >
              {item.title}
            </p>
            <PriorityPill priority={item.priority} />
          </div>
          <p
            className={cn("truncate text-xs text-muted-foreground", isCompact ? "mt-0.5" : "mt-1")}
          >
            {item.repo} <span className="text-muted-foreground/60">#{item.number}</span>
            {item.author && <span className="text-muted-foreground/60"> · {item.author}</span>}
          </p>
        </div>
      </button>
      <div
        className={cn(
          "flex shrink-0 items-center gap-2",
          isCard ? "justify-between border-hairline/60 border-t pt-2" : "justify-end",
        )}
      >
        {showSignals && <RowSignals item={item} />}
        <span
          className={cn(
            "w-9 shrink-0 text-right text-xs tabular-nums",
            age.aging ? "font-semibold text-destructive" : "text-muted-foreground/70",
          )}
        >
          {age.label}
        </span>
        <SnoozeMenu snoozed={snoozed} onSnooze={applySnooze} onUnsnooze={() => unsnooze(item)} />
      </div>
    </div>
  );
}

function PriorityPill({ priority }: { priority: Priority }) {
  if (priority !== "critical" && priority !== "high") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
        priority === "critical"
          ? "bg-destructive/15 text-destructive"
          : "bg-warning/15 text-warning",
      )}
    >
      {priority}
    </span>
  );
}

function RowSignals({ item }: { item: InboxItem }) {
  const commentCount =
    item.unresolvedThreadCount > 0
      ? item.unresolvedThreadCount
      : item.reviewThreadCount + item.issueCommentCount;
  return (
    <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
      {item.conflicting && (
        <SignalTooltip label="Has merge conflicts">
          <GitMerge className="size-3.5 text-destructive" aria-label="Has merge conflicts" />
        </SignalTooltip>
      )}
      <ReviewBadge review={item.reviewDecision} />
      <CiIcon ci={item.ci} />
      {commentCount > 0 && (
        <SignalTooltip
          label={
            item.unresolvedThreadCount > 0
              ? `${item.unresolvedThreadCount} unresolved review ${
                  item.unresolvedThreadCount === 1 ? "thread" : "threads"
                }`
              : `${commentCount} comments`
          }
        >
          <span
            className={cn(
              "inline-flex items-center gap-1 px-1",
              item.unresolvedThreadCount > 0 ? "text-destructive" : "text-muted-foreground/80",
            )}
            aria-label={
              item.unresolvedThreadCount > 0
                ? `${item.unresolvedThreadCount} unresolved review threads`
                : `${commentCount} comments`
            }
          >
            <MessageSquare className="size-3.5" />
            <span className="text-[10px] tabular-nums">{commentCount}</span>
          </span>
        </SignalTooltip>
      )}
    </div>
  );
}

function SignalTooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipFor label={label}>
      <span className="-my-1 inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-foreground/[0.04]">
        {children}
      </span>
    </TooltipFor>
  );
}

function ReviewBadge({ review }: { review?: string | null }) {
  const m = reviewMeta(review);
  if (!m) return null;
  const Icon = m.icon;
  return (
    <SignalTooltip label={m.label}>
      <Icon className={cn("size-3.5 shrink-0", m.tone)} strokeWidth={2.5} aria-label={m.label} />
    </SignalTooltip>
  );
}

function CiIcon({ ci }: { ci?: InboxItem["ci"] }) {
  const m = ciMeta(ci);
  if (!m) return null;
  const Icon = m.icon;
  // A passing check is dimmed; failing/pending stay full strength.
  return (
    <SignalTooltip label={m.label}>
      <Icon
        className={cn("size-3.5 shrink-0", m.tone, ci === "success" && "opacity-55")}
        aria-label={m.label}
      />
    </SignalTooltip>
  );
}

function SnoozeMenu({
  snoozed,
  onSnooze,
  onUnsnooze,
}: {
  snoozed: boolean;
  onSnooze: (kind: SnoozeKind) => void;
  onUnsnooze: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <TooltipFor label="Snooze">
        <button
          type="button"
          aria-label="Snooze"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((v) => !v);
          }}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/[0.05] hover:text-foreground group-hover:opacity-100 data-[open=true]:opacity-100"
          data-open={open}
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </TooltipFor>
      {open && (
        <PopoverPanel onClose={() => setOpen(false)} width="w-44">
          <PopoverSection title="Snooze">
            <SnoozeItem
              icon={Clock}
              onClick={() => {
                onSnooze("later-today");
                setOpen(false);
              }}
            >
              Later today
            </SnoozeItem>
            <SnoozeItem
              icon={TimerReset}
              onClick={() => {
                onSnooze("tomorrow");
                setOpen(false);
              }}
            >
              Tomorrow
            </SnoozeItem>
            <SnoozeItem
              icon={GitCommitHorizontal}
              onClick={() => {
                onSnooze("next-week");
                setOpen(false);
              }}
            >
              Next week
            </SnoozeItem>
            <SnoozeItem
              icon={RefreshCw}
              onClick={() => {
                onSnooze("until-ci-changes");
                setOpen(false);
              }}
            >
              Until CI changes
            </SnoozeItem>
            {snoozed && (
              <SnoozeItem
                icon={X}
                onClick={() => {
                  onUnsnooze();
                  setOpen(false);
                }}
              >
                Unsnooze
              </SnoozeItem>
            )}
          </PopoverSection>
        </PopoverPanel>
      )}
    </div>
  );
}

function SnoozeItem({
  icon,
  onClick,
  children,
}: {
  icon: typeof Clock;
  onClick: () => void;
  children: string;
}) {
  return (
    <PopoverItem
      icon={icon}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </PopoverItem>
  );
}
