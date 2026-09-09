import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { PopoverItem, PopoverPanel, PopoverSection } from "@/components/popover";
import { TooltipFor } from "@/components/tooltip-for";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import type { Dashboard, DashboardPr, DependabotAlert, Notification } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { type RepoHealth, buildReport, copyReport, scanAll } from "@/lib/turbo-health";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useDependabotRepo } from "@/stores/dependabot";
import { useLayers } from "@/stores/layers";
import { useLocalRepos } from "@/stores/local-repos";
import { type SnoozeKind, getPrSnooze, isPrSnoozed, usePrSnoozes } from "@/stores/pr-snoozes";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  GitCommitHorizontal,
  MoreHorizontal,
  RefreshCw,
  TimerReset,
  X,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * The desk. One screen for everything that used to be five: the review queue
 * (PRs waiting on you, then yours), an inbox for the notifications that are
 * not already a row in the queue, and the health of the repos you have on
 * disk — Turborepo findings and Dependabot alerts side by side.
 *
 * Every row says WHY it is here in plain words; colour appears only where it
 * carries meaning (checks, conflicts, findings).
 */

const DAY = 86_400_000;

interface Item extends DashboardPr {
  owner: string;
  repoName: string;
  blocked: boolean;
  waitingDays: number;
}

function ageDays(iso?: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - +new Date(iso)) / DAY));
}

function isBlocked(pr: DashboardPr): boolean {
  return (
    pr.ci === "failure" ||
    pr.conflicting ||
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.unresolvedThreadCount > 0
  );
}

function toItem(m: DashboardPr): Item {
  const [owner, repo] = m.repo.split("/");
  return {
    ...m,
    owner: owner ?? "",
    repoName: repo ?? "",
    blocked: isBlocked(m),
    waitingDays: ageDays(m.updatedAt ?? m.createdAt),
  };
}

/** Blocked first, then longest-waiting first — the top of the list is what is
 * costing the most right now. */
function byUrgency(a: Item, b: Item): number {
  return Number(b.blocked) - Number(a.blocked) || b.waitingDays - a.waitingDays;
}

/** Your own PRs: fix → merge → wait → draft. */
function mineRank(m: Item): number {
  if (m.isDraft) return 3;
  if (m.blocked) return 0;
  if (m.reviewDecision === "APPROVED") return 1;
  return 2;
}

type Tone = "muted" | "success" | "warning" | "destructive";

const TONE: Record<Tone, string> = {
  muted: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

interface Signal {
  text: string;
  tone: Tone;
}

/** What is going on with a PR, as words rather than icons. */
function signalsFor(pr: Item): Signal[] {
  const out: Signal[] = [];
  if (pr.conflicting) out.push({ text: "merge conflicts", tone: "destructive" });
  if (pr.reviewDecision === "CHANGES_REQUESTED")
    out.push({ text: "changes requested", tone: "warning" });
  if (pr.unresolvedThreadCount > 0)
    out.push({
      text: `${pr.unresolvedThreadCount} unresolved thread${pr.unresolvedThreadCount === 1 ? "" : "s"}`,
      tone: "warning",
    });
  if (pr.ci === "failure") out.push({ text: "CI failing", tone: "destructive" });
  else if (pr.ci === "pending") out.push({ text: "CI running", tone: "muted" });
  else if (pr.ci === "success" && out.length === 0)
    out.push({ text: "checks passing", tone: "success" });
  return out;
}

function incomingLead(pr: Item): Signal {
  const when = relativeTime(pr.updatedAt ?? pr.createdAt ?? Date.now());
  return {
    text: `review requested${pr.author ? ` by ${pr.author}` : ""} — ${when}`,
    tone: "muted",
  };
}

function mineLead(pr: Item): Signal {
  if (pr.isDraft) return { text: "draft", tone: "muted" };
  if (pr.blocked) return { text: "needs your attention", tone: "warning" };
  if (pr.reviewDecision === "APPROVED")
    return { text: "approved — ready to merge", tone: "success" };
  return {
    text: `awaiting review — ${relativeTime(pr.updatedAt ?? pr.createdAt ?? Date.now())}`,
    tone: "muted",
  };
}

/** Parse a notification subject API url into an in-app PR target, if it's a PR. */
function prTarget(url?: string | null): { owner: string; repo: string; number: string } | null {
  if (!url) return null;
  const m = url.match(/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: m[3] } : null;
}

const REASON_LABELS: Record<string, string> = {
  review_requested: "Review requested",
  mention: "Mentioned you",
  team_mention: "Team mention",
  comment: "New comment",
  assign: "Assigned to you",
  author: "Activity on yours",
  ci_activity: "CI activity",
  manual: "Subscribed",
  state_change: "State changed",
  subscribed: "Subscribed",
};

const reasonLabel = (reason: string) =>
  REASON_LABELS[reason] ?? reason.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const viewer = useAuth((s) => s.viewer);
  const watched = useWatchedRepos((s) => s.repos);
  const snoozes = usePrSnoozes((s) => s.snoozes);
  const repoQual = useMemo(() => watched.map((r) => `repo:${r}`).join(" "), [watched]);

  const dashboard = useQuery({
    queryKey: ["dashboard", repoQual],
    queryFn: () => invoke<Dashboard>("gh_dashboard", { repoQualifier: repoQual }),
    // Short so returning focus (after merging on GitHub) refetches; in-app
    // actions + poller events invalidate it directly via ["dashboard"].
    staleTime: 60_000,
  });
  const notifs = useQuery({
    queryKey: ["notifications"],
    queryFn: () => invoke<Notification[]>("gh_list_notifications", { all: false }),
    staleTime: 60_000,
  });

  const incoming = useMemo(
    () => (dashboard.data?.incoming ?? []).map(toItem).sort(byUrgency),
    [dashboard.data],
  );
  const mine = useMemo(
    () =>
      (dashboard.data?.mine ?? [])
        .map(toItem)
        .sort((a, b) => mineRank(a) - mineRank(b) || byUrgency(a, b)),
    [dashboard.data],
  );
  const snoozedOf = (list: Item[]) => list.filter((i) => isPrSnoozed(i, getPrSnooze(snoozes, i)));
  const activeOf = (list: Item[]) => list.filter((i) => !isPrSnoozed(i, getPrSnooze(snoozes, i)));
  const toReview = activeOf(incoming);
  const yours = activeOf(mine);
  // A PR can be in both lists (you review your own team's PR); keep one row.
  const snoozed = [
    ...new Map([...snoozedOf(incoming), ...snoozedOf(mine)].map((i) => [i.id, i])).values(),
  ];

  // Inbox = unread notifications that are not already a queue row. A PR you
  // are asked to review is in "To review"; its notification would be noise.
  const inbox = useMemo(() => {
    const inQueue = new Set([...incoming, ...mine].map((p) => `${p.repo}#${p.number}`));
    return (notifs.data ?? []).filter((n) => {
      const t = prTarget(n.subject.url);
      return !(t && inQueue.has(`${t.owner}/${t.repo}#${t.number}`));
    });
  }, [notifs.data, incoming, mine]);

  // Repo health — Turborepo scans for every clone, Dependabot for the tracked repo.
  const localRepos = useLocalRepos((s) => s.repos);
  const health = useQuery({
    queryKey: ["turborepo-health", localRepos.map((r) => r.path).join(":")],
    queryFn: () => scanAll(localRepos),
    enabled: localRepos.length > 0,
    staleTime: 5 * 60_000,
  });
  const dependabotRepo = useDependabotRepo((s) => s.repo);
  const [depOwner, depName] = dependabotRepo.split("/");
  const alerts = useQuery({
    queryKey: ["dependabot-alerts", dependabotRepo],
    queryFn: () =>
      invoke<DependabotAlert[]>("gh_dependabot_alerts", { owner: depOwner, repo: depName }),
    enabled: Boolean(depOwner && depName),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const refreshing =
    dashboard.isFetching || notifs.isFetching || health.isFetching || alerts.isFetching;
  const refreshAll = () => {
    dashboard.refetch();
    notifs.refetch();
    if (localRepos.length > 0) health.refetch();
    if (depOwner && depName) alerts.refetch();
  };

  const openPr = (it: Item) =>
    navigate({
      to: "/prs/$owner/$repo/$number",
      params: { owner: it.owner, repo: it.repoName, number: String(it.number) },
    });

  async function markRead(n: Notification) {
    qc.setQueryData<Notification[]>(["notifications"], (p) => p?.filter((x) => x.id !== n.id));
    try {
      await invoke("gh_mark_notification_read", { id: n.id });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.error(`Couldn't mark read — ${String(e)}`);
    }
  }
  async function markAllRead() {
    try {
      await invoke("gh_mark_all_notifications_read");
      qc.setQueryData<Notification[]>(["notifications"], []);
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e) {
      toast.error(`Couldn't mark all read — ${String(e)}`);
    }
  }

  const loading = dashboard.isLoading;
  const ready = yours.filter((m) => !m.isDraft && !m.blocked && m.reviewDecision === "APPROVED");
  const subtitle = loading
    ? "Your desk"
    : toReview.length === 0 && ready.length === 0 && inbox.length === 0
      ? "All clear — nothing needs you."
      : [
          toReview.length > 0 ? `${toReview.length} waiting on you` : null,
          ready.length > 0 ? `${ready.length} ready to merge` : null,
          inbox.length > 0 ? `${inbox.length} in your inbox` : null,
        ]
          .filter(Boolean)
          .join(", ");
  const queueEmpty = !loading && toReview.length === 0 && yours.length === 0 && inbox.length === 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={viewer ? `Hey, ${viewer.name ?? viewer.login}` : "Home"}
        subtitle={subtitle}
        actions={
          <>
            {dashboard.dataUpdatedAt > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                Synced {relativeTime(dashboard.dataUpdatedAt)}
              </span>
            )}
            <IconButton
              label="Refresh"
              icon={RefreshCw}
              loading={refreshing}
              onClick={refreshAll}
            />
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <ScrollArea className="min-h-0">
          <div className="px-6 pb-10 pt-2">
            {loading ? (
              <div className="space-y-2 pt-2">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-md" />
                ))}
              </div>
            ) : queueEmpty ? (
              <div className="py-12">
                <EmptyState
                  icon={CheckCheck}
                  title="You're all caught up"
                  description="No reviews waiting on you, nothing of yours needs attention, and the inbox is clear."
                />
              </div>
            ) : (
              <>
                <Section title="To review" count={toReview.length}>
                  {toReview.length === 0 ? (
                    <Quiet>Nothing waiting on you.</Quiet>
                  ) : (
                    toReview.map((it) => (
                      <PrRow
                        key={it.id}
                        item={it}
                        lead={incomingLead(it)}
                        onOpen={() => openPr(it)}
                      />
                    ))
                  )}
                </Section>

                {yours.length > 0 && (
                  <Section title="Yours" count={yours.length}>
                    {yours.map((it) => (
                      <PrRow key={it.id} item={it} lead={mineLead(it)} onOpen={() => openPr(it)} />
                    ))}
                  </Section>
                )}

                {snoozed.length > 0 && (
                  <Section title="Snoozed" count={snoozed.length}>
                    {snoozed.map((it) => (
                      <PrRow
                        key={it.id}
                        item={it}
                        lead={{ text: "snoozed", tone: "muted" }}
                        onOpen={() => openPr(it)}
                        dim
                      />
                    ))}
                  </Section>
                )}

                <Section
                  title="Inbox"
                  count={inbox.length}
                  action={
                    inbox.length > 0 ? (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        Mark all read
                      </button>
                    ) : undefined
                  }
                >
                  {inbox.length === 0 ? (
                    <Quiet>Inbox zero.</Quiet>
                  ) : (
                    inbox.slice(0, 8).map((n) => (
                      <InboxRow
                        key={n.id}
                        n={n}
                        onOpen={() => {
                          const t = prTarget(n.subject.url);
                          if (t) navigate({ to: "/prs/$owner/$repo/$number", params: t });
                          else navigate({ to: "/notifications" });
                        }}
                        onRead={() => markRead(n)}
                      />
                    ))
                  )}
                  {inbox.length > 8 && (
                    <button
                      type="button"
                      onClick={() => navigate({ to: "/notifications" })}
                      className="mt-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {inbox.length - 8} more in Notifications
                    </button>
                  )}
                </Section>
              </>
            )}
          </div>
        </ScrollArea>

        <HealthColumn
          repos={health.data ?? []}
          scanning={localRepos.length > 0 && health.isLoading}
          hasClones={localRepos.length > 0}
          dependabotRepo={dependabotRepo}
          alerts={alerts.data ?? []}
          alertsError={alerts.isError}
          scannedAt={health.dataUpdatedAt}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pt-5">
      <div className="mb-1 flex items-baseline gap-1.5">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground/60 tabular-nums">{count}</span>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="py-2 text-xs text-muted-foreground">{children}</p>;
}

function PrRow({
  item,
  lead,
  onOpen,
  dim = false,
}: {
  item: Item;
  lead: Signal;
  onOpen: () => void;
  dim?: boolean;
}) {
  const signals = signalsFor(item);
  // Where you stopped, if this PR has a layer plan — the desk remembers.
  const entry = useLayers((s) => s.byPr[`${item.repo}#${item.number}`]);
  const layerNote = useMemo(() => {
    if (!entry || entry.plan.layers.length < 2) return null;
    const idx = Math.max(
      0,
      entry.plan.layers.findIndex((l) => l.id === entry.active),
    );
    return `layer ${idx + 1} of ${entry.plan.layers.length}`;
  }, [entry]);

  return (
    <div
      className={cn(
        "group -mx-3 flex items-start gap-2 rounded-md px-3 py-2.5 transition-colors hover:bg-foreground/[0.03]",
        dim && "opacity-60",
      )}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="font-mono text-[11.5px] text-muted-foreground/80">
          {item.repo} #{item.number}
        </p>
        <p className="mt-px truncate text-sm font-medium text-foreground">{item.title}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs">
          <span className={TONE[lead.tone]}>{lead.text}</span>
          {signals.map((s) => (
            <span key={s.text} className={TONE[s.tone]}>
              {s.text}
            </span>
          ))}
          {layerNote && <span className="text-muted-foreground">{layerNote}</span>}
        </p>
      </button>
      <SnoozeMenu item={item} />
    </div>
  );
}

function InboxRow({
  n,
  onOpen,
  onRead,
}: {
  n: Notification;
  onOpen: () => void;
  onRead: () => void;
}) {
  return (
    <div className="group -mx-3 flex items-start gap-2 rounded-md px-3 py-2 transition-colors hover:bg-foreground/[0.03]">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm text-foreground">
          <span className="font-medium">{reasonLabel(n.reason)}</span>
          <span className="text-muted-foreground"> — {n.subject.title}</span>
        </p>
        <p className="mt-0.5 flex gap-3 text-xs text-muted-foreground">
          <span className="font-mono text-[11.5px]">{n.repository.full_name}</span>
          <span>{relativeTime(n.updated_at)}</span>
        </p>
      </button>
      <TooltipFor label="Mark read">
        <button
          type="button"
          aria-label="Mark read"
          onClick={onRead}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/[0.05] hover:text-foreground group-hover:opacity-100"
        >
          <Check className="size-3.5" />
        </button>
      </TooltipFor>
    </div>
  );
}

function SnoozeMenu({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const snooze = usePrSnoozes((s) => s.snooze);
  const unsnooze = usePrSnoozes((s) => s.unsnooze);
  const current = usePrSnoozes((s) => getPrSnooze(s.snoozes, item));
  const snoozed = isPrSnoozed(item, current);

  const apply = (kind: SnoozeKind) => {
    const entry = snooze(item, kind);
    setOpen(false);
    toast("Snoozed", {
      description: `${item.repo} #${item.number}`,
      action: { label: "Undo", onClick: () => unsnooze(entry.key) },
    });
  };

  return (
    <div className="relative shrink-0">
      <TooltipFor label="Snooze">
        <button
          type="button"
          aria-label="Snooze"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          data-open={open}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-foreground/[0.05] hover:text-foreground group-hover:opacity-100 data-[open=true]:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </TooltipFor>
      {open && (
        <PopoverPanel onClose={() => setOpen(false)} width="w-44">
          <PopoverSection title="Snooze">
            <PopoverItem icon={Clock} onClick={() => apply("later-today")}>
              Later today
            </PopoverItem>
            <PopoverItem icon={TimerReset} onClick={() => apply("tomorrow")}>
              Tomorrow
            </PopoverItem>
            <PopoverItem icon={GitCommitHorizontal} onClick={() => apply("next-week")}>
              Next week
            </PopoverItem>
            <PopoverItem icon={RefreshCw} onClick={() => apply("until-ci-changes")}>
              Until CI changes
            </PopoverItem>
            {snoozed && (
              <PopoverItem
                icon={X}
                onClick={() => {
                  unsnooze(item);
                  setOpen(false);
                }}
              >
                Unsnooze
              </PopoverItem>
            )}
          </PopoverSection>
        </PopoverPanel>
      )}
    </div>
  );
}

function HealthColumn({
  repos,
  scanning,
  hasClones,
  dependabotRepo,
  alerts,
  alertsError,
  scannedAt,
}: {
  repos: RepoHealth[];
  scanning: boolean;
  hasClones: boolean;
  dependabotRepo: string;
  alerts: DependabotAlert[];
  alertsError: boolean;
  scannedAt: number;
}) {
  const navigate = useNavigate();
  const openAlerts = alerts.filter((a) => a.state === "open");
  const bySeverity = new Map<string, number>();
  for (const a of openAlerts) {
    const s = a.security_advisory.severity;
    bySeverity.set(s, (bySeverity.get(s) ?? 0) + 1);
  }
  const severityLine = ["critical", "high", "medium", "low"]
    .filter((s) => bySeverity.has(s))
    .map((s) => `${bySeverity.get(s)} ${s}`)
    .join(", ");
  const nothingTracked = !hasClones && !dependabotRepo;

  return (
    <aside className="flex min-h-0 flex-col overflow-y-auto border-t border-hairline px-5 pb-6 pt-5 lg:border-l lg:border-t-0">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Repo health</h2>
        {repos.length > 0 && (
          <TooltipFor label="Copy every workspace's findings as a prompt for your agent">
            <button
              type="button"
              onClick={() => copyReport(repos.map(buildReport).join("\n\n---\n\n"), "Full report")}
              className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Copy className="size-3" />
              Copy for your agent
            </button>
          </TooltipFor>
        )}
      </div>

      {nothingTracked ? (
        <p className="text-xs text-muted-foreground">
          Clone a repository, or pick one for Dependabot, and its findings show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {scanning && <p className="text-xs text-muted-foreground">Scanning workspaces…</p>}
          {repos.map((r) => (
            <div key={r.path}>
              <p className="mb-0.5 font-mono text-[11.5px] text-muted-foreground/80">
                {r.owner}/{r.repo}
              </p>
              <TurboRows r={r} onOpen={() => navigate({ to: "/turborepo" })} />
            </div>
          ))}
          {hasClones && !scanning && repos.length === 0 && (
            <p className="text-xs text-muted-foreground">
              None of your clones is a Turborepo workspace.
            </p>
          )}
          {dependabotRepo && (
            <div>
              <p className="mb-0.5 font-mono text-[11.5px] text-muted-foreground/80">
                {dependabotRepo}
              </p>
              {alertsError ? (
                <p className="py-1 text-xs text-muted-foreground">
                  Dependabot alerts unavailable — the token may lack security access.
                </p>
              ) : openAlerts.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">No open Dependabot alerts.</p>
              ) : (
                <HealthRow
                  text={`${openAlerts.length} open Dependabot alert${openAlerts.length === 1 ? "" : "s"}`}
                  detail={severityLine}
                  source="dependabot"
                  onClick={() => navigate({ to: "/dependabot" })}
                />
              )}
            </div>
          )}
        </div>
      )}

      {scannedAt > 0 && (
        <p className="mt-auto pt-6 text-xs text-muted-foreground/70">
          Scanned {relativeTime(scannedAt)} — open Turborepo for the full report.
        </p>
      )}
    </aside>
  );
}

/** One row per finding kind, leading with the count and the first example. */
function TurboRows({ r, onOpen }: { r: RepoHealth; onOpen: () => void }) {
  const rows: { text: string; detail?: string }[] = [];
  if (r.cycles.length > 0) {
    const first = r.cycles[0];
    rows.push({
      text: `${r.cycles.length} dependency cycle${r.cycles.length === 1 ? "" : "s"}`,
      detail: first.length === 2 ? first.join(" ↔ ") : `${first[0]} → … → ${first[0]}`,
    });
  }
  if (r.phantoms.length > 0) {
    const first = r.phantoms[0];
    rows.push({
      text: `${r.phantoms.length} phantom dependenc${r.phantoms.length === 1 ? "y" : "ies"}`,
      detail: `${first.from_pkg} imports ${first.target} without declaring it`,
    });
  }
  if (r.mismatches.length > 0) {
    const first = r.mismatches[0];
    rows.push({
      text: `${r.mismatches.length} version mismatch${r.mismatches.length === 1 ? "" : "es"}`,
      detail: `${first.name} on ${first.versions.length} versions`,
    });
  }
  if (r.scan.crossings.length > 0) {
    rows.push({
      text: `${r.scan.crossings.length} boundary crossing${r.scan.crossings.length === 1 ? "" : "s"}`,
      detail: "imports reaching into another package's internals",
    });
  }
  if (rows.length === 0) return <p className="py-1 text-xs text-muted-foreground">No findings.</p>;
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <HealthRow
          key={row.text}
          text={row.text}
          detail={row.detail}
          source="turbo"
          onClick={onOpen}
        />
      ))}
    </div>
  );
}

function HealthRow({
  text,
  detail,
  source,
  onClick,
}: {
  text: string;
  detail?: string;
  source: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group -mx-2 flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/[0.03]"
    >
      <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
      <span className="min-w-0 flex-1">
        <span className="text-foreground">{text}</span>
        {detail && <span className="text-muted-foreground"> — {detail}</span>}
      </span>
      <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground/60">{source}</span>
    </button>
  );
}
