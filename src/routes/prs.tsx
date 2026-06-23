import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Menu, PopoverItem, PopoverSection } from "@/components/popover";
import { PrRowLink, type PrState, STATE_META, prState } from "@/components/pr-row";
import { Segmented } from "@/components/segmented";
import { TooltipFor } from "@/components/tooltip-for";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { type ListState, readPrs } from "@/lib/prs-db";
import { ensureBackfilled } from "@/lib/sync";
import type { CiStatus, Label, PullSummary } from "@/lib/tauri";
import { invoke, parseRepoUrl } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { type GroupBy, type PrScope, type SortKey, usePrFilters } from "@/stores/pr-filters";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowDown01,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUp01,
  ArrowUpNarrowWide,
  Check,
  Filter,
  FolderGit2,
  GitPullRequest,
  Inbox,
  List,
  type LucideIcon,
  Minus,
  PenLine,
  RefreshCw,
  RotateCw,
  Search,
  SlidersHorizontal,
  User,
  Users,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
  icon: LucideIcon;
}

const SORT_OPTIONS: Option<SortKey>[] = [
  { value: "updated-desc", label: "Recently updated", icon: ArrowDownWideNarrow },
  { value: "updated-asc", label: "Least recently updated", icon: ArrowUpNarrowWide },
  { value: "created-desc", label: "Newest", icon: ArrowDown01 },
  { value: "created-asc", label: "Oldest", icon: ArrowUp01 },
  { value: "title", label: "Title (A–Z)", icon: ArrowDownAZ },
];

const GROUP_OPTIONS: Option<GroupBy>[] = [
  { value: "none", label: "None", icon: List },
  { value: "repo", label: "Repository", icon: FolderGit2 },
  { value: "author", label: "Author", icon: User },
];

const SCOPE_OPTIONS: Option<PrScope>[] = [
  { value: "review-requested", label: "Review requested", icon: Inbox },
  { value: "created", label: "Created", icon: PenLine },
  { value: "involved", label: "Involved", icon: Users },
];

const STATE_ORDER: PrState[] = ["open", "draft", "merged", "closed"];

function repoOf(p: PullSummary): string {
  const r = parseRepoUrl(p.repository_url);
  return r ? `${r.owner}/${r.repo}` : "unknown";
}

/** A flattened virtual-list row: either a group header or a PR. */
type PrListRow =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "pr"; key: number; pr: PullSummary };

export function PRsPage() {
  // Filters live in a persisted store so they survive navigation + restarts.
  const query = usePrFilters((s) => s.query);
  const sort = usePrFilters((s) => s.sort);
  const groupBy = usePrFilters((s) => s.groupBy);
  const labelStates = usePrFilters((s) => s.labelStates);
  const repos = usePrFilters((s) => s.repos);
  const states = usePrFilters((s) => s.states);
  const setQuery = usePrFilters((s) => s.setQuery);
  const setSort = usePrFilters((s) => s.setSort);
  const setGroupBy = usePrFilters((s) => s.setGroupBy);
  const toggleRepo = usePrFilters((s) => s.toggleRepo);
  const clearRepos = usePrFilters((s) => s.clearRepos);
  const cycleLabel = usePrFilters((s) => s.cycleLabel);
  const clearLabels = usePrFilters((s) => s.clearLabels);
  const toggleState = usePrFilters((s) => s.toggleState);
  const clearStates = usePrFilters((s) => s.clearStates);
  const ciFailing = usePrFilters((s) => s.ciFailing);
  const toggleCiFailing = usePrFilters((s) => s.toggleCiFailing);
  const scope = usePrFilters((s) => s.scope);
  const setScope = usePrFilters((s) => s.setScope);
  const scrollPos = usePrFilters((s) => s.scrollPos);
  const setScrollPos = usePrFilters((s) => s.setScrollPos);

  const watched = useWatchedRepos((s) => s.repos);

  // `/` focuses the filter input; Escape-to-clear lives on the input itself.
  const filterInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return; // don't hijack `/` while the user is already typing
      e.preventDefault();
      filterInputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Watched repos → the COMPLETE queue, served LOCAL-FIRST from the `prs` table
  // (instant, offline); the sync engine reconciles GitHub → DB. No watched
  // repos → the scope-based global search (network, live).
  const allOpen = watched.length > 0;
  const watchedKey = useMemo(() => [...watched].sort().join(","), [watched]);
  // Open is the fast default; pull merged/closed only when the state filter
  // asks for them (a repo's closed history can be tens of thousands).
  const includeClosed = states.includes("merged") || states.includes("closed");
  const listState: ListState = includeClosed ? "all" : "open";

  // The search query that backs the list when no repos are watched.
  const searchQuery = useMemo(() => {
    const who =
      scope === "created"
        ? "author:@me"
        : scope === "involved"
          ? "involves:@me"
          : "review-requested:@me";
    return `is:pr ${who} archived:false`;
  }, [scope]);

  const forMe = useQuery({
    queryKey: allOpen ? ["prs", "db", watchedKey, listState] : ["prs", "list", scope],
    // All-open reads from the local DB (instant); the sync owns freshness.
    staleTime: allOpen ? Number.POSITIVE_INFINITY : undefined,
    queryFn: async () => {
      if (!allOpen) {
        // No watched repos → live scope-based search (no local cache layer).
        return invoke<PullSummary[]>("gh_search", { query: searchQuery });
      }
      // Selecting Merged/Closed → make sure that history is loaded before the
      // read, so the list shows a load → the PRs (not an empty flash).
      if (listState === "all") await ensureBackfilled(watched);
      return readPrs(watched, listState);
    },
  });

  // CI rollup per PR (one GraphQL call) for the row badges — only for the
  // bounded search modes; skipped for the (potentially huge) all-open queue.
  const ci = useQuery({
    queryKey: ["prs", "ci", scope],
    queryFn: () => invoke<CiStatus[]>("gh_pr_ci", { query: searchQuery }),
    enabled: !allOpen,
    staleTime: 2 * 60_000,
  });
  const ciMap = useMemo(() => new Map((ci.data ?? []).map((s) => [s.number, s.state])), [ci.data]);

  // Scope the whole page to the user's watched repos (Settings). Empty = all.
  const prs = useMemo(() => {
    const data = forMe.data ?? [];
    if (watched.length === 0) return data;
    const ws = new Set(watched);
    return data.filter((p) => ws.has(repoOf(p)));
  }, [forMe.data, watched]);

  const allLabels = useMemo(() => {
    const byName = new Map<string, Label>();
    for (const p of prs) for (const l of p.labels) byName.set(l.name, l);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [prs]);

  const allRepos = useMemo(() => {
    const set = new Set<string>();
    for (const p of prs) set.add(repoOf(p));
    return [...set].sort();
  }, [prs]);

  const stateCounts = useMemo(() => {
    const m = new Map<PrState, number>();
    for (const p of prs) {
      const s = prState(p);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [prs]);

  // Cheap, accurate per-state totals for the watched repos (via total_count),
  // so the State filter shows a count for every state — not just the loaded
  // ones. Independent of the (lazy) merged/closed list fetch.
  const repoQual = useMemo(() => watched.map((r) => `repo:${r}`).join(" "), [watched]);
  const stateTotals = useQuery({
    queryKey: ["prs", "state-totals", watchedKey],
    enabled: allOpen && watched.length > 0,
    staleTime: 2 * 60_000,
    queryFn: async () => {
      const base = `${repoQual} archived:false`;
      const [open, draft, merged, closed] = await Promise.all([
        invoke<number>("gh_search_count", { query: `is:pr is:open draft:false ${base}` }),
        invoke<number>("gh_search_count", { query: `is:pr is:open draft:true ${base}` }),
        invoke<number>("gh_search_count", { query: `is:pr is:merged ${base}` }),
        invoke<number>("gh_search_count", { query: `is:pr is:closed is:unmerged ${base}` }),
      ]);
      return { open, draft, merged, closed };
    },
  });
  // What the State filter shows: accurate totals in the all-open queue, else the
  // loaded-data counts (search modes load their full result set).
  const filterStateCounts = useMemo<Map<PrState, number>>(() => {
    if (allOpen && stateTotals.data) {
      const d = stateTotals.data;
      return new Map<PrState, number>([
        ["open", d.open],
        ["draft", d.draft],
        ["merged", d.merged],
        ["closed", d.closed],
      ]);
    }
    return stateCounts;
  }, [allOpen, stateTotals.data, stateCounts]);

  // Defer the query used for FILTERING so typing stays responsive on the big
  // queue — the input itself is still driven by the live `query` value.
  const deferredQuery = useDeferredValue(query);

  const displayed = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const includeLabels = Object.entries(labelStates)
      .filter(([, s]) => s === "include")
      .map(([n]) => n);
    const excludeLabels = Object.entries(labelStates)
      .filter(([, s]) => s === "exclude")
      .map(([n]) => n);

    // Match title, author, or PR number (bare `1234` or `#1234`).
    const qNum = q.replace(/^#/, "");
    const filtered = prs.filter((p) => {
      if (
        q &&
        !(
          p.title.toLowerCase().includes(q) ||
          p.user.login.toLowerCase().includes(q) ||
          (qNum !== "" && String(p.number).includes(qNum))
        )
      ) {
        return false;
      }
      if (states.length > 0 && !states.includes(prState(p))) return false;
      if (repos.length > 0 && !repos.includes(repoOf(p))) return false;
      if (ciFailing && ciMap.get(p.number) !== "failure") return false;
      const names = new Set(p.labels.map((l) => l.name));
      if (includeLabels.some((n) => !names.has(n))) return false;
      if (excludeLabels.some((n) => names.has(n))) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case "updated-asc":
          return +new Date(a.updated_at) - +new Date(b.updated_at);
        case "created-desc":
          return +new Date(b.created_at) - +new Date(a.created_at);
        case "created-asc":
          return +new Date(a.created_at) - +new Date(b.created_at);
        case "title":
          return a.title.localeCompare(b.title);
        default:
          return +new Date(b.updated_at) - +new Date(a.updated_at);
      }
    });
  }, [prs, deferredQuery, labelStates, repos, states, sort, ciFailing, ciMap]);

  const grouped = useMemo(() => groupPrs(displayed, groupBy), [displayed, groupBy]);

  // Flatten groups → a single row list (headers + PRs) for the virtualizer.
  const rows = useMemo<PrListRow[]>(() => {
    const out: PrListRow[] = [];
    for (const g of grouped) {
      if (groupBy !== "none") {
        out.push({ kind: "header", key: g.label, label: g.label, count: g.items.length });
      }
      for (const p of g.items) out.push({ kind: "pr", key: p.id, pr: p });
    }
    return out;
  }, [grouped, groupBy]);

  // In the watched/all-open queue, always offer every state so the user can
  // select Merged/Closed to pull them in (they aren't loaded by default).
  const presentStates = allOpen
    ? STATE_ORDER
    : STATE_ORDER.filter((s) => (stateCounts.get(s) ?? 0) > 0);
  const filterCount =
    states.length + repos.length + Object.keys(labelStates).length + (ciFailing ? 1 : 0);

  function clearAllFilters() {
    clearStates();
    clearRepos();
    clearLabels();
    if (ciFailing) toggleCiFailing();
  }

  // Empty-state CTAs reset the text query too (not just the structured filters),
  // so "Clear all filters" / "Adjust filters" truly empties everything.
  function clearAllFiltersAndQuery() {
    clearAllFilters();
    setQuery("");
  }

  // Active filters as removable chips (Linear-style).
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  for (const s of states)
    chips.push({ key: `s:${s}`, label: STATE_META[s].label, onRemove: () => toggleState(s) });
  for (const r of repos) chips.push({ key: `r:${r}`, label: r, onRemove: () => toggleRepo(r) });
  for (const [name, st] of Object.entries(labelStates)) {
    chips.push({
      key: `l:${name}`,
      label: st === "exclude" ? `−${name}` : name,
      // cycle order is off → include → exclude → off
      onRemove: () => {
        cycleLabel(name);
        if (st === "include") cycleLabel(name);
      },
    });
  }
  if (ciFailing) chips.push({ key: "ci", label: "CI failing", onRemove: toggleCiFailing });

  const filtering = query.trim().length > 0 || filterCount > 0;
  const scopeLabel =
    scope === "created"
      ? "you opened"
      : scope === "involved"
        ? "involving you"
        : "review requested";
  const subtitle = forMe.isLoading
    ? "Loading…"
    : filtering
      ? `${displayed.length} of ${prs.length} shown`
      : allOpen
        ? `${prs.length} ${includeClosed ? "PRs" : "open"} · ${watched.length} repo${watched.length === 1 ? "" : "s"}`
        : `${prs.length} ${scopeLabel}`;

  // Scroll position is restored per list scope so each queue keeps its place.
  const scrollKey = allOpen ? `db:${watchedKey}:${listState}` : `list:${scope}`;

  // A single announcement for the aria-live region that covers counts AND the
  // empty/error outcomes (not just "N shown").
  const announce = forMe.isLoading
    ? "Loading pull requests"
    : forMe.isError
      ? "Could not load pull requests. Retry available."
      : prs.length === 0
        ? "No pull requests"
        : displayed.length === 0
          ? "No pull requests match your filters"
          : `${displayed.length} pull requests shown`;

  // Manual refresh + freshness, only meaningful for the network-backed search
  // list (the all-open queue is owned by the background sync engine).
  const showRefresh = !allOpen;
  const refresh = useCallback(() => {
    forMe.refetch();
    ci.refetch();
  }, [forMe.refetch, ci.refetch]);

  // Badge sources that can silently go stale — surface (non-blocking) when they
  // fail so the State filter counts / CI dots aren't trusted as fresh. Retry
  // refetches whichever source actually failed.
  const badgeStale: { message: string; retry: () => void } | null = stateTotals.isError
    ? { message: "State counts unavailable", retry: () => stateTotals.refetch() }
    : ci.isError
      ? { message: "CI status unavailable", retry: () => ci.refetch() }
      : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Pull requests" subtitle={subtitle} />
      {/* Announce counts AND empty/error outcomes to screen readers. */}
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>

      {/* Filter bar — scope + search up front, everything else behind Filter/Display. */}
      <div className="flex items-center gap-2 border-b border-hairline px-6 py-2">
        {!allOpen && (
          <Segmented
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(s) => {
              setScope(s);
              setQuery(""); // scopes are exclusive — a stale text filter only confuses
            }}
          />
        )}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            ref={filterInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the filter (or blurs once already empty).
              if (e.key === "Escape") {
                if (query) {
                  e.preventDefault();
                  setQuery("");
                } else {
                  e.currentTarget.blur();
                }
              }
            }}
            placeholder="Filter by title, author, or #number…  (press / to focus)"
            aria-label="Filter pull requests"
            spellCheck={false}
            className="h-7 w-full rounded-md bg-transparent pl-8 pr-7 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-foreground/[0.04] focus:bg-foreground/[0.06] focus:ring-1 focus:ring-primary/30"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                filterInputRef.current?.focus();
              }}
              aria-label="Clear filter"
              className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {showRefresh && (
          <RefreshControl
            onRefresh={refresh}
            isFetching={forMe.isFetching || ci.isFetching}
            updatedAt={forMe.dataUpdatedAt}
          />
        )}
        <FilterMenu
          presentStates={presentStates}
          stateCounts={filterStateCounts}
          states={states}
          onToggleState={toggleState}
          allRepos={allRepos}
          repos={repos}
          onToggleRepo={toggleRepo}
          allLabels={allLabels}
          labelStates={labelStates}
          onCycleLabel={cycleLabel}
          ciFailing={ciFailing}
          onToggleCiFailing={toggleCiFailing}
          activeCount={filterCount}
          onClearAll={clearAllFilters}
        />
        <DisplayMenu sort={sort} onSort={setSort} groupBy={groupBy} onGroup={setGroupBy} />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-6 pb-2">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onRemove}
              className="group inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-xs text-foreground/80 ring-1 ring-foreground/[0.06] transition-colors hover:bg-foreground/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {c.label}
              <X className="size-3 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-0.5 border-l border-hairline pl-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Non-blocking: a badge data source went stale (counts/CI). */}
      {badgeStale && (
        <output
          className="flex items-center gap-1.5 px-6 pb-2 text-xs text-warning"
          aria-live="polite"
        >
          <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.5} />
          <span>{badgeStale.message} — badges may be out of date.</span>
          <button
            type="button"
            onClick={badgeStale.retry}
            className="underline-offset-2 hover:underline"
          >
            Retry
          </button>
        </output>
      )}

      {forMe.isLoading ? (
        <div className="flex-1 space-y-1.5 p-4">
          {allOpen && includeClosed && (
            <p className="px-1 pb-1 text-xs text-muted-foreground">
              Loading merged &amp; closed history…
            </p>
          )}
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex h-[50px] items-center gap-2.5 rounded-lg px-3">
              <Skeleton className="size-4 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-9 shrink-0 rounded" />
              <Skeleton className="h-3.5 min-w-0 flex-1 rounded" />
              <Skeleton className="size-5 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      ) : forMe.isError ? (
        <div role="alert" aria-live="assertive">
          <EmptyState
            icon={AlertTriangle}
            title="Couldn’t load pull requests"
            description="Something went wrong fetching this list. Check your connection and try again."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => forMe.refetch()}
                loading={forMe.isFetching}
              >
                <RotateCw />
                Retry
              </Button>
            }
          />
        </div>
      ) : prs.length === 0 ? (
        <EmptyState
          icon={GitPullRequest}
          title="No pull requests"
          description={
            allOpen
              ? "No open pull requests in your watched repos."
              : scope === "created"
                ? "Pull requests you open will show up here."
                : scope === "involved"
                  ? "Pull requests you're involved in will show up here."
                  : "When teammates request your review, they show up here."
          }
          action={
            watched.length === 0 && !filtering ? (
              <Button variant="outline" size="sm" render={<Link to="/settings" />}>
                <FolderGit2 />
                Watch repositories
              </Button>
            ) : filtering ? (
              <Button variant="outline" size="sm" onClick={clearAllFiltersAndQuery}>
                Adjust filters
              </Button>
            ) : undefined
          }
        />
      ) : displayed.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description="No pull requests match your filters."
          action={
            <Button variant="outline" size="sm" onClick={clearAllFiltersAndQuery}>
              Clear all filters
            </Button>
          }
        />
      ) : (
        <PrVirtualList
          rows={rows}
          groupBy={groupBy}
          ciMap={ciMap}
          scrollKey={scrollKey}
          initialScroll={scrollPos[scrollKey] ?? 0}
          onScrollPos={setScrollPos}
        />
      )}
    </div>
  );
}

/** Virtualized PR list — renders only on-screen rows so thousands stay smooth. */
function PrVirtualList({
  rows,
  groupBy,
  ciMap,
  scrollKey,
  initialScroll,
  onScrollPos,
}: {
  rows: PrListRow[];
  groupBy: GroupBy;
  ciMap: Map<number, CiStatus["state"]>;
  scrollKey: string;
  initialScroll: number;
  onScrollPos: (key: string, top: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === "header" ? 36 : 50),
    overscan: 14,
    getItemKey: (i) => {
      const r = rows[i];
      return r.kind === "header" ? `h:${r.key}` : `p:${r.key}`;
    },
  });

  // Indices of the PR rows (skip group headers) for j/k roving navigation.
  const prIndices = useMemo(
    () => rows.map((r, i) => (r.kind === "pr" ? i : -1)).filter((i) => i >= 0),
    [rows],
  );
  // The index INTO `prIndices` that is currently "roved" (-1 = none yet).
  const [activePos, setActivePos] = useState(-1);
  // Clamp the active position if the list shrinks under it (filtering, etc).
  useEffect(() => {
    setActivePos((p) => (p >= prIndices.length ? prIndices.length - 1 : p));
  }, [prIndices.length]);
  const activeRowIndex = activePos >= 0 ? prIndices[activePos] : -1;

  // Restore the saved scroll position on mount / when the list scope changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only on scope change
  useEffect(() => {
    const el = parentRef.current;
    if (el && initialScroll > 0) el.scrollTop = initialScroll;
    setActivePos(-1);
  }, [scrollKey]);

  // Persist scroll position as the user scrolls, throttled to one write per
  // animation frame so the sqlStorage-backed store isn't spammed.
  const rafRef = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = parentRef.current;
      if (el) onScrollPos(scrollKey, el.scrollTop);
    });
  }, [onScrollPos, scrollKey]);
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // j/k move the active row, Enter opens it. Only when not typing in an input.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (prIndices.length === 0) return;

      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setActivePos((p) => {
          const next =
            e.key === "j"
              ? Math.min((p < 0 ? -1 : p) + 1, prIndices.length - 1)
              : Math.max((p < 0 ? prIndices.length : p) - 1, 0);
          virt.scrollToIndex(prIndices[next], { align: "auto" });
          return next;
        });
      } else if (e.key === "Enter") {
        if (activePos < 0) return;
        const el = parentRef.current?.querySelector<HTMLAnchorElement>(
          `[data-pr-row="${prIndices[activePos]}"] a`,
        );
        if (el) {
          e.preventDefault();
          el.click();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prIndices, activePos, virt]);

  // Move DOM focus onto the active row's link once it's rendered.
  useEffect(() => {
    if (activeRowIndex < 0) return;
    const el = parentRef.current?.querySelector<HTMLAnchorElement>(
      `[data-pr-row="${activeRowIndex}"] a`,
    );
    el?.focus();
  }, [activeRowIndex]);

  return (
    <div ref={parentRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pb-6">
      <div style={{ height: virt.getTotalSize(), position: "relative", width: "100%" }}>
        {virt.getVirtualItems().map((vi) => {
          const row = rows[vi.index];
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              data-pr-row={row.kind === "pr" ? vi.index : undefined}
              ref={virt.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.kind === "header" ? (
                <h2 className="px-6 pt-4 pb-1 text-xs font-semibold text-muted-foreground">
                  {row.label} <span className="text-muted-foreground/60">· {row.count}</span>
                </h2>
              ) : (
                <div className="px-3">
                  <PrRowLink
                    pr={row.pr}
                    showRepo={groupBy !== "repo"}
                    ciState={ciMap.get(row.pr.number)}
                    className={
                      vi.index === activeRowIndex
                        ? "ring-1 ring-primary/40 bg-foreground/[0.04]"
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Manual refresh + "updated Xm ago" for the network-backed search list. The
 * timestamp re-renders on a slow tick so it stays roughly current without churn.
 */
function RefreshControl({
  onRefresh,
  isFetching,
  updatedAt,
}: {
  onRefresh: () => void;
  isFetching: boolean;
  updatedAt: number;
}) {
  // Re-render every 30s so "updated Xm ago" doesn't go stale on screen.
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const label = updatedAt ? `Updated ${relativeTime(updatedAt)}` : "Not yet loaded";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
        {label}
      </span>
      <TooltipFor label={label}>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          aria-label="Refresh pull requests"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
        </button>
      </TooltipFor>
    </div>
  );
}

function DisplayMenu({
  sort,
  onSort,
  groupBy,
  onGroup,
}: {
  sort: SortKey;
  onSort: (v: SortKey) => void;
  groupBy: GroupBy;
  onGroup: (v: GroupBy) => void;
}) {
  return (
    <Menu label="Display" icon={SlidersHorizontal} width="w-56">
      <PopoverSection title="Ordering">
        {SORT_OPTIONS.map((o) => (
          <PopoverItem
            key={o.value}
            icon={o.icon}
            checked={sort === o.value}
            onClick={() => onSort(o.value)}
          >
            {o.label}
          </PopoverItem>
        ))}
      </PopoverSection>
      <PopoverSection title="Grouping">
        {GROUP_OPTIONS.map((o) => (
          <PopoverItem
            key={o.value}
            icon={o.icon}
            checked={groupBy === o.value}
            onClick={() => onGroup(o.value)}
          >
            {o.label}
          </PopoverItem>
        ))}
      </PopoverSection>
    </Menu>
  );
}

function FilterMenu({
  presentStates,
  stateCounts,
  states,
  onToggleState,
  allRepos,
  repos,
  onToggleRepo,
  allLabels,
  labelStates,
  onCycleLabel,
  ciFailing,
  onToggleCiFailing,
  activeCount,
  onClearAll,
}: {
  presentStates: PrState[];
  stateCounts: Map<PrState, number>;
  states: PrState[];
  onToggleState: (s: PrState) => void;
  allRepos: string[];
  repos: string[];
  onToggleRepo: (r: string) => void;
  allLabels: Label[];
  labelStates: Record<string, "include" | "exclude">;
  onCycleLabel: (name: string) => void;
  ciFailing: boolean;
  onToggleCiFailing: () => void;
  activeCount: number;
  onClearAll: () => void;
}) {
  return (
    <Menu label="Filter" icon={Filter} count={activeCount} width="w-72">
      <div className="max-h-[60vh] overflow-y-auto">
        <PopoverSection title="Status">
          <PopoverItem icon={AlertTriangle} checked={ciFailing} onClick={onToggleCiFailing}>
            CI failing
          </PopoverItem>
        </PopoverSection>

        {presentStates.length > 0 && (
          <PopoverSection title="State">
            {presentStates.map((s) => (
              <PopoverItem
                key={s}
                icon={STATE_META[s].icon}
                checked={states.includes(s)}
                count={stateCounts.get(s)}
                onClick={() => onToggleState(s)}
              >
                {STATE_META[s].label}
              </PopoverItem>
            ))}
          </PopoverSection>
        )}

        {allRepos.length > 0 && (
          <PopoverSection title="Repository">
            {allRepos.map((r) => (
              <PopoverItem
                key={r}
                icon={FolderGit2}
                checked={repos.includes(r)}
                onClick={() => onToggleRepo(r)}
              >
                {r}
              </PopoverItem>
            ))}
          </PopoverSection>
        )}

        {allLabels.length > 0 && (
          <PopoverSection title="Labels">
            <p className="px-2 pb-1 text-[11px] text-muted-foreground/50">
              Click to cycle: include → exclude → off
            </p>
            {allLabels.map((l) => {
              const st = labelStates[l.name];
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onCycleLabel(l.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.05]"
                >
                  {st === "include" ? (
                    <Check className="size-3 shrink-0 text-primary" />
                  ) : st === "exclude" ? (
                    <Minus className="size-3 shrink-0 text-destructive" />
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `#${(l.color || "888888").replace(/^#/, "")}` }}
                    aria-hidden
                  />
                  <span className={cn("truncate", st === "exclude" && "line-through opacity-70")}>
                    {l.name}
                  </span>
                </button>
              );
            })}
          </PopoverSection>
        )}
      </div>
      {activeCount > 0 && (
        <div className="mt-1 flex justify-end border-t border-hairline pt-1">
          <button
            type="button"
            onClick={onClearAll}
            className="px-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        </div>
      )}
    </Menu>
  );
}

function groupPrs(prs: PullSummary[], by: GroupBy): { label: string; items: PullSummary[] }[] {
  if (by === "none") return [{ label: "All", items: prs }];
  const map = new Map<string, PullSummary[]>();
  for (const p of prs) {
    const key = by === "repo" ? repoOf(p) : p.user.login;
    const arr = map.get(key) ?? [];
    arr.push(p);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, items]) => ({ label, items }));
}
