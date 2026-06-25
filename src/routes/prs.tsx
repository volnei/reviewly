import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Menu, PopoverItem, PopoverPanel, PopoverSection } from "@/components/popover";
import { PrRowLink, type PrState, STATE_META } from "@/components/pr-row";
import { Segmented } from "@/components/segmented";
import { TooltipFor } from "@/components/tooltip-for";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { type ListState, readPrs } from "@/lib/prs-db";
import { ensureBackfilled } from "@/lib/sync";
import type { CiStatus, Label, PullSummary } from "@/lib/tauri";
import { invoke, parseRepoUrl } from "@/lib/tauri";
import { safeOpenUrl, toastRetry } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useLocalRepos } from "@/stores/local-repos";
import { type GroupBy, type PrScope, type SortKey, usePrFilters } from "@/stores/pr-filters";
import { usePrView } from "@/stores/pr-view";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  ArrowDown01,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUp01,
  ArrowUpNarrowWide,
  Check,
  ChevronDown,
  Filter,
  FolderGit2,
  GitPullRequest,
  Inbox,
  List,
  ListFilter,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type ActiveFilterChip,
  type ActiveFilterOption,
  type AuthorFilterOption,
  repoOf,
  usePrFilterModel,
} from "./pr-filter-model";

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

/** A flattened virtual-list row: either a group header or a PR. */
type PrListRow =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "pr"; key: number; pr: PullSummary };

const PR_LIST_TOP_INSET = 8;

export function PRsPage() {
  // Filters live in a persisted store so they survive navigation + restarts.
  const query = usePrFilters((s) => s.query);
  const sort = usePrFilters((s) => s.sort);
  const groupBy = usePrFilters((s) => s.groupBy);
  const statesForFetch = usePrFilters((s) => s.states);
  const setQuery = usePrFilters((s) => s.setQuery);
  const setSort = usePrFilters((s) => s.setSort);
  const setGroupBy = usePrFilters((s) => s.setGroupBy);
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
  const includeClosed = statesForFetch.includes("merged") || statesForFetch.includes("closed");
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

  const filters = usePrFilterModel({
    prs,
    allOpen,
    stateTotals: stateTotals.data,
    query,
    sort,
    ciMap,
  });
  const displayed = filters.displayed;

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

  const filtering = query.trim().length > 0 || filters.filterCount > 0;
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
          presentStates={filters.presentStates}
          stateCounts={filters.filterStateCounts}
          states={filters.states}
          onSelectState={filters.selectStateFilter}
          allRepos={filters.allRepos}
          repos={filters.repos}
          onToggleRepo={filters.toggleRepo}
          allAuthors={filters.allAuthors}
          authors={filters.authors}
          onToggleAuthor={filters.toggleAuthor}
          allLabels={filters.allLabels}
          labelStates={filters.labelStates}
          onCycleLabel={filters.cycleLabel}
          ciFailing={filters.ciFailing}
          onToggleCiFailing={filters.toggleCiFailing}
          activeCount={filters.filterCount}
          onClearAll={filters.clearAllFilters}
        />
        <DisplayMenu sort={sort} onSort={setSort} groupBy={groupBy} onGroup={setGroupBy} />
      </div>

      {filters.chips.length > 0 && (
        <ActiveFilters chips={filters.chips} onClearAll={filters.clearAllFilters} />
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
              <Button variant="outline" size="sm" onClick={filters.clearAllFiltersAndQuery}>
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
            <Button variant="outline" size="sm" onClick={filters.clearAllFiltersAndQuery}>
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

function ActiveFilters({
  chips,
  onClearAll,
}: {
  chips: ActiveFilterChip[];
  onClearAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline/70 bg-foreground/[0.018] px-6 py-1.5">
      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 pr-1 text-[11px] font-medium text-muted-foreground/80">
        <Filter className="size-3.5" strokeWidth={1.75} />
        Filters
      </span>
      {chips.map((c) => (
        <ActiveFilterToken key={c.key} chip={c} />
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="size-3" />
        Clear
      </button>
    </div>
  );
}

function ActiveFilterToken({ chip }: { chip: ActiveFilterChip }) {
  const [open, setOpen] = useState<"operator" | "value" | null>(null);
  const operator = chip.operator ?? "is";
  return (
    <div className="relative inline-flex h-7 max-w-[min(34rem,100%)] items-stretch rounded-lg border border-hairline bg-popover/70 text-xs text-foreground/85 shadow-xs">
      <div className="inline-flex shrink-0 items-center gap-1.5 rounded-l-lg px-2 text-muted-foreground">
        <Filter className="size-3.5" strokeWidth={1.75} />
        <span className="font-medium">{chip.field}</span>
      </div>
      <div className="w-px bg-hairline" />
      <button
        type="button"
        onClick={() => chip.operatorOptions && setOpen("operator")}
        disabled={!chip.operatorOptions}
        className="inline-flex shrink-0 items-center gap-1 px-2 text-foreground transition-colors enabled:hover:bg-foreground/[0.05] disabled:cursor-default"
        aria-label={`Change ${chip.field} operator`}
      >
        {operator}
        {chip.operatorOptions && <ChevronDown className="size-3 text-muted-foreground" />}
      </button>
      <div className="w-px bg-hairline" />
      <button
        type="button"
        onClick={() => setOpen("value")}
        className="inline-flex min-w-0 items-center gap-1.5 px-2 text-foreground transition-colors hover:bg-foreground/[0.05]"
        aria-label={`Change ${chip.field} value`}
      >
        {chip.valueAvatars && chip.valueAvatars.length > 0 ? (
          <span className="flex shrink-0 items-center -space-x-1">
            {chip.valueAvatars.map((author) => (
              <TooltipFor key={author.login} label={author.login}>
                <img
                  src={author.avatarUrl}
                  alt=""
                  className="size-4 rounded-full bg-background ring-1 ring-background"
                />
              </TooltipFor>
            ))}
            {chip.valueAvatarOverflow ? (
              <TooltipFor label={`${chip.valueAvatarOverflow} more`}>
                <span className="flex size-4 items-center justify-center rounded-full bg-foreground/[0.08] text-[9px] font-medium text-muted-foreground ring-1 ring-background">
                  +{chip.valueAvatarOverflow}
                </span>
              </TooltipFor>
            ) : null}
          </span>
        ) : chip.valueAvatarUrl ? (
          <img
            src={chip.valueAvatarUrl}
            alt=""
            className="size-4 shrink-0 rounded-full ring-1 ring-foreground/10"
          />
        ) : null}
        {!chip.valueAvatars && <span className="min-w-0 truncate">{chip.value}</span>}
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>
      <div className="w-px bg-hairline" />
      <button
        type="button"
        onClick={chip.onRemove}
        className="inline-flex w-7 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
        aria-label={`Remove ${chip.field} ${operator} ${chip.value} filter`}
      >
        <X className="size-3.5" />
      </button>

      {open === "operator" && chip.operatorOptions && (
        <FilterTokenMenu
          options={chip.operatorOptions}
          onClose={() => setOpen(null)}
          onSelect={(value) => {
            chip.onOperatorSelect?.(value);
            setOpen(null);
          }}
        />
      )}
      {open === "value" && (
        <FilterTokenMenu
          options={chip.options}
          onClose={() => setOpen(null)}
          onSelect={chip.onSelect}
          searchPlaceholder={`Search ${chip.field.toLowerCase()}...`}
        />
      )}
    </div>
  );
}

function FilterTokenMenu({
  options,
  onClose,
  onSelect,
  searchPlaceholder = "Search...",
}: {
  options: ActiveFilterOption[];
  onClose: () => void;
  onSelect: (value: string, additive: boolean) => void;
  searchPlaceholder?: string;
}) {
  const [filter, setFilter] = useState("");
  const searchable = options.length > 5;
  const visibleOptions = useMemo(() => {
    if (!searchable || !filter.trim()) return options;
    const q = filter.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(q));
  }, [filter, options, searchable]);

  return (
    <PopoverPanel onClose={onClose} align="left" width="w-64" className="overflow-hidden p-0">
      {searchable && (
        <div className="border-b border-hairline p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              autoFocus
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 w-full rounded-md bg-foreground/[0.04] pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.06] focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto p-2">
        {visibleOptions.length > 0 ? (
          visibleOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={(event) => onSelect(option.value, event.shiftKey)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.05]"
              >
                {option.avatarUrl ? (
                  <img
                    src={option.avatarUrl}
                    alt=""
                    className="size-4 shrink-0 rounded-full ring-1 ring-foreground/10"
                  />
                ) : Icon ? (
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                ) : option.color ? (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `#${option.color.replace(/^#/, "")}` }}
                  />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <Check
                  className={cn("size-3 shrink-0", option.selected ? "text-primary" : "opacity-0")}
                />
              </button>
            );
          })
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No matches</p>
        )}
      </div>
    </PopoverPanel>
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
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const localRepos = useLocalRepos((s) => s.repos);
  const setPrDetailTab = usePrView((s) => s.setTab);
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

  const checkoutLocal = useMutation({
    mutationFn: ({
      path,
      number,
    }: {
      owner: string;
      repo: string;
      path: string;
      number: number;
    }) => invoke("gh_pr_checkout", { path, number }),
    onSuccess: (_data, vars) =>
      toast.success(`Checked out #${vars.number} in ${vars.owner}/${vars.repo}`, {
        description: vars.path,
      }),
    onError: (e, vars) =>
      toastRetry(`Checkout failed — ${String(e)}`, () => checkoutLocal.mutate(vars)),
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
  const activeRowId = activeRowIndex >= 0 ? `pr-row-${rows[activeRowIndex]?.key}` : undefined;

  // Restore the saved scroll position on mount / when the list scope changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run only on scope change
  useEffect(() => {
    const el = parentRef.current;
    if (el && initialScroll > 0) el.scrollTop = initialScroll;
    setActivePos(-1);
  }, [scrollKey]);

  const activePr = useMemo(() => {
    const row = activeRowIndex >= 0 ? rows[activeRowIndex] : null;
    return row?.kind === "pr" ? row.pr : null;
  }, [activeRowIndex, rows]);
  const activePrRepo = activePr ? parseRepoUrl(activePr.repository_url) : null;
  const activeAnnouncement =
    activePr && activePrRepo && activePos >= 0
      ? `Selected ${activePrRepo.owner}/${activePrRepo.repo} pull request ${activePr.number}, ${activePos + 1} of ${prIndices.length}: ${activePr.title}`
      : "";

  const getPrTarget = useCallback((pr: PullSummary) => {
    const repo = parseRepoUrl(pr.repository_url);
    if (!repo) return null;
    return { ...repo, number: pr.number };
  }, []);

  const openPr = useCallback(
    (pr: PullSummary, view?: "diff") => {
      const target = getPrTarget(pr);
      if (!target) return;
      if (view === "diff") {
        setPrDetailTab(`${target.owner}/${target.repo}#${target.number}`, "files");
      }
      navigate({
        to: "/prs/$owner/$repo/$number",
        params: {
          owner: target.owner,
          repo: target.repo,
          number: String(target.number),
        },
      });
    },
    [getPrTarget, navigate, setPrDetailTab],
  );

  const checkoutPr = useCallback(
    (pr: PullSummary) => {
      const target = getPrTarget(pr);
      if (!target) return;
      const localRepo = localRepos.find(
        (repo) => repo.owner === target.owner && repo.repo === target.repo,
      );
      if (!localRepo) {
        toast.info(`Clone ${target.owner}/${target.repo} locally first`, {
          description: "Add it in Repositories so Reviewly can run gh pr checkout.",
        });
        return;
      }
      checkoutLocal.mutate({
        owner: target.owner,
        repo: target.repo,
        path: localRepo.path,
        number: target.number,
      });
    },
    [checkoutLocal, getPrTarget, localRepos],
  );

  const runPrAction = useCallback(
    (action: "open" | "diff" | "github" | "checkout") => {
      if (!activePr) return;
      switch (action) {
        case "open":
          openPr(activePr);
          break;
        case "diff":
          openPr(activePr, "diff");
          break;
        case "github":
          safeOpenUrl(activePr.html_url);
          break;
        case "checkout":
          checkoutPr(activePr);
          break;
      }
    },
    [activePr, checkoutPr, openPr],
  );

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

  const moveActive = useCallback(
    (nextPos: number, align: "auto" | "start" | "end" = "auto") => {
      if (prIndices.length === 0) return;
      const clamped = Math.max(0, Math.min(nextPos, prIndices.length - 1));
      virt.scrollToIndex(prIndices[clamped], { align });
      setActivePos(clamped);
    },
    [prIndices, virt],
  );

  // Arrows/j/k move the active row; row shortcuts act on the active PR only.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (prIndices.length === 0) return;

      if (e.key === "j" || e.key === "ArrowDown" || e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const current =
          activePos < 0
            ? e.key === "j" || e.key === "ArrowDown"
              ? -1
              : prIndices.length
            : activePos;
        moveActive(current + (e.key === "j" || e.key === "ArrowDown" ? 1 : -1));
      } else if (e.key === "Home") {
        e.preventDefault();
        moveActive(0, "start");
      } else if (e.key === "End") {
        e.preventDefault();
        moveActive(prIndices.length - 1, "end");
      } else if (e.key === "PageDown" || e.key === "PageUp") {
        e.preventDefault();
        const pageSize = Math.max(1, Math.floor((parentRef.current?.clientHeight ?? 350) / 50) - 1);
        const current =
          activePos < 0 ? (e.key === "PageDown" ? 0 : prIndices.length - 1) : activePos;
        moveActive(current + (e.key === "PageDown" ? pageSize : -pageSize));
      } else if (e.key === "Enter" || e.key === "ArrowRight") {
        if (!activePr) return;
        e.preventDefault();
        runPrAction("open");
      } else if (e.key === "d") {
        e.preventDefault();
        runPrAction("diff");
      } else if (e.key === "g") {
        e.preventDefault();
        runPrAction("github");
      } else if (e.key === "c") {
        e.preventDefault();
        runPrAction("checkout");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePos, activePr, moveActive, prIndices.length, runPrAction]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={parentRef}
        onScroll={onScroll}
        onFocus={() => {
          if (activePos < 0 && prIndices.length > 0) setActivePos(0);
        }}
        role="listbox"
        tabIndex={0}
        aria-label="Pull requests"
        aria-activedescendant={activeRowId}
        className="h-full overflow-y-auto pb-24 outline-none"
      >
        <div className="sr-only" aria-live="polite">
          {activeAnnouncement}
        </div>
        <div
          style={{
            height: virt.getTotalSize() + PR_LIST_TOP_INSET,
            position: "relative",
            width: "100%",
          }}
        >
          {virt.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            const prPos = row.kind === "pr" ? prIndices.indexOf(vi.index) : -1;
            const active = vi.index === activeRowIndex;
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
                  transform: `translateY(${vi.start + PR_LIST_TOP_INSET}px)`,
                }}
              >
                {row.kind === "header" ? (
                  <h2
                    role="presentation"
                    className="px-6 pt-4 pb-1 text-xs font-semibold text-muted-foreground"
                  >
                    {row.label} <span className="text-muted-foreground/60">· {row.count}</span>
                  </h2>
                ) : (
                  <div
                    id={`pr-row-${row.key}`}
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    className="px-3"
                    onMouseEnter={() => setActivePos(prPos)}
                  >
                    <PrRowLink
                      pr={row.pr}
                      showRepo={groupBy !== "repo"}
                      ciState={ciMap.get(row.pr.number)}
                      tabIndex={-1}
                      className={active ? "ring-1 ring-primary/40 bg-foreground/[0.04]" : undefined}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <PrListCommandBar pr={activePr} worktreeReady={false} />
    </div>
  );
}

function PrListCommandBar({
  pr,
  worktreeReady,
}: {
  pr: PullSummary | null;
  worktreeReady: boolean;
}) {
  const repo = pr ? parseRepoUrl(pr.repository_url) : null;
  if (!pr || !repo) return null;

  return (
    <div
      aria-label={`Keyboard shortcuts for ${repo.owner}/${repo.repo} pull request ${pr.number}`}
      className={cn(
        "pointer-events-none absolute bottom-4 left-1/2 z-10 hidden max-w-[calc(100%-3rem)] -translate-x-1/2 items-center gap-2 rounded-lg border border-hairline bg-popover/95 px-2.5 py-2 text-[11px] text-muted-foreground shadow-2xl backdrop-blur-md lg:flex",
      )}
    >
      <span className="max-w-64 truncate border-r border-hairline pr-2 font-medium text-foreground/80">
        {repo.owner}/{repo.repo}#{pr.number}
      </span>
      <KeyHint keys="↑↓" label="move" />
      <KeyHint keys="Pg" label="page" />
      <KeyHint keys="Home/End" label="jump" />
      <KeyHint keys="→" label="open" />
      <KeyHint keys="d" label="diff" />
      <KeyHint keys="g" label="GitHub" />
      <KeyHint keys="c" label="checkout" />
      {worktreeReady && <KeyHint keys="C" label="worktree" />}
    </div>
  );
}

function KeyHint({
  keys,
  label,
  disabled = false,
}: {
  keys: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap", disabled && "opacity-45")}
    >
      <kbd className="flex h-4 min-w-4 items-center justify-center rounded border border-border/70 bg-foreground/[0.06] px-1 font-mono text-[10px] text-foreground">
        {keys}
      </kbd>
      <span>{label}</span>
    </span>
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
  onSelectState,
  allRepos,
  repos,
  onToggleRepo,
  allAuthors,
  authors,
  onToggleAuthor,
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
  onSelectState: (s: PrState, additive: boolean) => void;
  allRepos: string[];
  repos: string[];
  onToggleRepo: (r: string) => void;
  allAuthors: AuthorFilterOption[];
  authors: string[];
  onToggleAuthor: (author: string) => void;
  allLabels: Label[];
  labelStates: Record<string, "include" | "exclude">;
  onCycleLabel: (name: string) => void;
  ciFailing: boolean;
  onToggleCiFailing: () => void;
  activeCount: number;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fieldQuery, setFieldQuery] = useState("");
  const [activeField, setActiveField] = useState<FilterFieldKey>("state");
  const close = () => setOpen(false);
  const fields = useMemo<FilterField[]>(() => {
    const out: FilterField[] = [
      {
        key: "status",
        label: "CI failing",
        icon: AlertTriangle,
        valueCount: 1,
      },
    ];
    if (presentStates.length > 0) {
      out.push({
        key: "state",
        label: "State",
        icon: GitPullRequest,
        valueCount: presentStates.length,
      });
    }
    if (allRepos.length > 1) {
      out.push({ key: "repo", label: "Repository", icon: FolderGit2, valueCount: allRepos.length });
    }
    if (allAuthors.length > 0) {
      out.push({ key: "author", label: "Author", icon: User, valueCount: allAuthors.length });
    }
    if (allLabels.length > 0) {
      out.push({ key: "label", label: "Label", icon: ListFilter, valueCount: allLabels.length });
    }
    return out;
  }, [allAuthors.length, allLabels.length, allRepos.length, presentStates.length]);
  const visibleFields = useMemo(() => {
    if (!fieldQuery.trim()) return fields;
    const q = fieldQuery.trim().toLowerCase();
    return fields.filter((field) => field.label.toLowerCase().includes(q));
  }, [fieldQuery, fields]);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
          activeCount > 0 || open
            ? "bg-foreground/[0.06] text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        <ListFilter className="size-3.5" />
        Add Filter
        {activeCount > 0 && (
          <span className="rounded-full bg-primary/20 px-1 text-[10px] font-medium tabular-nums text-primary">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <PopoverPanel onClose={close} align="right" width="w-64" className="overflow-visible">
          <div className="relative">
            <div className="pb-1">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <input
                  autoFocus
                  value={fieldQuery}
                  onChange={(event) => setFieldQuery(event.target.value)}
                  placeholder="Filter..."
                  className="h-7 w-full rounded-md bg-transparent pl-7 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.04]"
                />
                <span className="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-md bg-background/80 text-[10px] font-medium text-muted-foreground/80">
                  F
                </span>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {visibleFields.length > 0 ? (
                visibleFields.map((field) => {
                  const Icon = field.icon;
                  const selected = activeField === field.key;
                  return (
                    <button
                      key={field.key}
                      type="button"
                      onMouseEnter={() => setActiveField(field.key)}
                      onFocus={() => setActiveField(field.key)}
                      onClick={() => {
                        setActiveField(field.key);
                        if (field.key === "status") onToggleCiFailing();
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/[0.05]",
                        selected && "bg-foreground/[0.05] text-foreground",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                      <span className="min-w-0 flex-1 truncate">{field.label}</span>
                      {field.key === "status" ? (
                        <Check
                          className={cn(
                            "size-3 shrink-0",
                            ciFailing ? "text-primary" : "opacity-0",
                          )}
                        />
                      ) : (
                        <ChevronDown className="-rotate-90 size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  );
                })
              ) : (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">No filters found</p>
              )}
            </div>
            {activeField !== "status" && (
              <FilterValueFlyout
                field={activeField}
                presentStates={presentStates}
                stateCounts={stateCounts}
                states={states}
                onSelectState={onSelectState}
                allRepos={allRepos}
                repos={repos}
                onToggleRepo={onToggleRepo}
                allAuthors={allAuthors}
                authors={authors}
                onToggleAuthor={onToggleAuthor}
                allLabels={allLabels}
                labelStates={labelStates}
                onCycleLabel={onCycleLabel}
              />
            )}
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
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}

type FilterFieldKey = "status" | "state" | "repo" | "author" | "label";

type FilterField = {
  key: FilterFieldKey;
  label: string;
  icon: LucideIcon;
  valueCount: number;
};

function FilterValueFlyout({
  field,
  presentStates,
  stateCounts,
  states,
  onSelectState,
  allRepos,
  repos,
  onToggleRepo,
  allAuthors,
  authors,
  onToggleAuthor,
  allLabels,
  labelStates,
  onCycleLabel,
}: {
  field: FilterFieldKey;
  presentStates: PrState[];
  stateCounts: Map<PrState, number>;
  states: PrState[];
  onSelectState: (s: PrState, additive: boolean) => void;
  allRepos: string[];
  repos: string[];
  onToggleRepo: (r: string) => void;
  allAuthors: AuthorFilterOption[];
  authors: string[];
  onToggleAuthor: (author: string) => void;
  allLabels: Label[];
  labelStates: Record<string, "include" | "exclude">;
  onCycleLabel: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const config =
    field === "state"
      ? {
          label: "state",
          searchable: presentStates.length > 5,
          count: presentStates.length,
        }
      : field === "repo"
        ? { label: "repository", searchable: allRepos.length > 5, count: allRepos.length }
        : field === "author"
          ? { label: "author", searchable: allAuthors.length > 5, count: allAuthors.length }
          : { label: "label", searchable: allLabels.length > 5, count: allLabels.length };
  const q = query.trim().toLowerCase();
  const visibleRepos = !q ? allRepos : allRepos.filter((repo) => repo.toLowerCase().includes(q));
  const visibleAuthors = !q
    ? allAuthors
    : allAuthors.filter((author) => author.login.toLowerCase().includes(q));
  const visibleLabels = !q
    ? allLabels
    : allLabels.filter((label) => label.name.toLowerCase().includes(q));

  return (
    <div className="absolute right-full top-0 z-40 mr-1 w-64 rounded-lg border border-hairline bg-popover p-2 shadow-xl">
      {config.searchable && (
        <div className="pb-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${config.label}...`}
              className="h-7 w-full rounded-md bg-transparent pl-7 pr-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-foreground/[0.04]"
            />
          </div>
        </div>
      )}
      <div className="max-h-80 overflow-y-auto">
        {field === "state" &&
          presentStates.map((s) => (
            <PopoverItem
              key={s}
              icon={STATE_META[s].icon}
              checked={states.includes(s)}
              count={stateCounts.get(s)}
              onClick={(event) => onSelectState(s, event.shiftKey)}
            >
              {STATE_META[s].label}
            </PopoverItem>
          ))}

        {field === "repo" &&
          (visibleRepos.length > 0 ? (
            visibleRepos.map((repo) => (
              <PopoverItem
                key={repo}
                icon={FolderGit2}
                checked={repos.includes(repo)}
                onClick={() => onToggleRepo(repo)}
              >
                {repo}
              </PopoverItem>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No repositories found</p>
          ))}

        {field === "author" &&
          (visibleAuthors.length > 0 ? (
            visibleAuthors.map((author) => (
              <button
                key={author.login}
                type="button"
                onClick={() => onToggleAuthor(author.login)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.05]"
              >
                <img
                  src={author.avatarUrl}
                  alt=""
                  className="size-4 shrink-0 rounded-full ring-1 ring-foreground/10"
                />
                <span className="min-w-0 flex-1 truncate">{author.login}</span>
                <Check
                  className={cn(
                    "size-3 shrink-0",
                    authors.includes(author.login) ? "text-primary" : "opacity-0",
                  )}
                />
              </button>
            ))
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No authors found</p>
          ))}

        {field === "label" &&
          (visibleLabels.length > 0 ? (
            visibleLabels.map((label) => {
              const st = labelStates[label.name];
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => onCycleLabel(label.name)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.05]"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `#${(label.color || "888888").replace(/^#/, "")}` }}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      st === "exclude" && "line-through opacity-70",
                    )}
                  >
                    {label.name}
                  </span>
                  {st === "include" ? (
                    <Check className="size-3 shrink-0 text-primary" />
                  ) : st === "exclude" ? (
                    <Minus className="size-3 shrink-0 text-destructive" />
                  ) : (
                    <span className="size-3 shrink-0" />
                  )}
                </button>
              );
            })
          ) : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No labels found</p>
          ))}
      </div>
      {config.count > 5 && (
        <p className="mt-1 border-t border-hairline px-1 py-1.5 text-[11px] text-muted-foreground/70">
          {config.count} {config.label}
          {config.count === 1 ? "" : "s"}
        </p>
      )}
    </div>
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
