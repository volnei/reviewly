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
              <div className="grid grid-cols-2 gap-2 px-6 pt-1 pb-2 sm:grid-cols-4">
                <Stat label="Waiting on you" value={incoming.length} tone="primary" />
                <Stat label="Aging" value={agingCount} tone="destructive" />
                <Stat label="Ready to merge" value={buckets.ready.length} tone="success" />
                <Stat
                  label="Needs fixing"
                  value={buckets.needsAttention.length}
                  tone="destructive"
                />
              </div>
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

/** A compact metric tile for the top-of-inbox stats strip. */
function Stat({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  return (
    <div className="rounded-xl border border-hairline bg-card/40 px-3 py-2.5">
      <p
        className={cn(
          "font-display text-2xl leading-none tabular-nums",
          value > 0 ? TONE[tone] : "text-muted-foreground/40",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">{label}</p>
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
