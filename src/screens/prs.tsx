import { useTitleSlot } from "@/app/title-slot";
import { useWorkspace, useWorkspaceInbox } from "@/app/workspace";
import { useEffectQuery } from "@/effect/runtime";
import { useAuth } from "@/effect/services/Auth";
import { GitHub, splitRepo } from "@/effect/services/GitHub";
import { fromSummary } from "@/effect/services/Inbox";
import { usePrefs } from "@/effect/services/Prefs";
import { type Ranked, Triage, compareRanked } from "@/effect/services/Triage";
import { type Store, persistedStore, useStore } from "@/effect/store";
import {
  Chips,
  FilterBar,
  applyFilterWithStacks,
  isFiltering,
  prStatusOf,
  useListFilter,
} from "@/features/list/filters";
import { List, ListHead, Nothing, type Section } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { useWithStacks } from "@/features/list/stacks";
import { Effect } from "effect";
import { useMemo, useRef } from "react";
import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "./inbox";
import { PrPeek } from "./pr-peek";

type Group = "none" | "repo" | "author" | "stack";
type Sort = "priority" | "updated" | "updated-asc" | "created" | "created-asc" | "title";
type Display = { group: Group; sort: Sort };
const GROUPS: ReadonlyArray<Group> = ["none", "repo", "author", "stack"];
const SORTS: ReadonlyArray<Sort> = [
  "priority",
  "updated",
  "updated-asc",
  "created",
  "created-asc",
  "title",
];
const DEFAULT_DISPLAY: Display = { group: "none", sort: "priority" };
const decodeDisplay = (raw: unknown): Display => {
  const r = raw as Partial<{ group: unknown; sort: unknown }> | null;
  return {
    group: GROUPS.includes(r?.group as Group) ? (r!.group as Group) : "none",
    sort: SORTS.includes(r?.sort as Sort) ? (r!.sort as Sort) : "priority",
  };
};
// One store per workspace, keyed like the list filter: `<owner/repo>` or `all`.
const displayStores = new Map<string, Store<Display>>();
const displayStoreFor = (workspace: string | null): Store<Display> => {
  const key = `reviewly.v2.prs-display:${workspace ?? "all"}`;
  let s = displayStores.get(key);
  if (!s) {
    s = persistedStore<Display>(key, DEFAULT_DISPLAY, decodeDisplay);
    displayStores.set(key, s);
  }
  return s;
};

/**
 * Every pull request in the repositories you watch, from the local cache, with
 * the ones that involve you on top of it. A row of chips under the heading,
 * never a sidebar: status, repositories, labels (once to require, twice to
 * exclude), authors and CI — grouped by repo or author, sorted, and `/` to type.
 */
export function PrsScreen() {
  const root = useRef<HTMLDivElement>(null);
  useTitleSlot(
    <>
      <TitleSearch />
      <span className="flex-1" />
      <RefreshButton />
    </>,
    "desk",
  );
  const workspace = useWorkspace();
  const auth = useAuth();
  const viewer = auth.viewer?.login ?? null;
  const watched = usePrefs((p) => p.watchedRepos);
  const inbox = useWorkspaceInbox();
  const displayStore = displayStoreFor(workspace);
  const { group, sort } = useStore(displayStore);
  const setGroup = (group: Group) => displayStore.update((d) => ({ ...d, group }));
  const setSort = (sort: Sort) => displayStore.update((d) => ({ ...d, sort }));
  const [filter, setFilter] = useListFilter("prs");
  const includeHistory = filter.statuses.has("merged") || filter.statuses.has("closed");
  const listState = includeHistory ? "all" : "open";
  const cached = useEffectQuery(
    ["prs", watched, viewer, listState],
    Effect.gen(function* () {
      const gh = yield* GitHub;
      const triage = yield* Triage;
      const lists = yield* Effect.forEach(
        watched,
        (full) => {
          const s = splitRepo(full);
          return s
            ? gh.repoPulls(s.owner, s.repo, listState).pipe(Effect.orElseSucceed(() => []))
            : Effect.succeed([]);
        },
        { concurrency: 4 },
      );
      return yield* triage.rank(lists.flat().map((p) => fromSummary(p, viewer)));
    }),
    { enabled: watched.length > 0, staleTime: 60_000 },
  );
  const open = useOpenItem();
  const { snooze, snoozeFor, unsnooze, checkout } = useItemActions();

  // The cache knows every PR; the Inbox knows more about the ones that involve you.
  const all = useMemo(() => {
    const m = new Map<string, Ranked>();
    for (const r of cached.data ?? []) m.set(r.id, r);
    const mine = inbox.data
      ? [...inbox.data.turn, ...inbox.data.unsorted, ...inbox.data.later]
      : [];
    for (const i of mine) if (i.kind === "pr") m.set(i.id, { ...(m.get(i.id) ?? {}), ...i });
    return [...m.values()]
      .filter((r) => !workspace || r.repo.toLowerCase() === workspace.toLowerCase())
      .map((r) =>
        prStatusOf(r) === "merged"
          ? { ...r, verdict: "routine" as const, why: "merged" }
          : prStatusOf(r) === "closed"
            ? {
                ...r,
                verdict: "routine" as const,
                why: "closed without merging",
              }
            : r,
      );
  }, [cached.data, inbox.data, workspace]);

  const filterable = useWithStacks(all);

  const items = useMemo(() => {
    const by: Record<Sort, (a: Ranked, b: Ranked) => number> = {
      priority: compareRanked,
      "updated-asc": (a, b) => (a.updatedAt ?? "").localeCompare(b.updatedAt ?? ""),
      "created-asc": (a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
      updated: (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
      created: (a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
      title: (a, b) => a.title.localeCompare(b.title),
    };
    return applyFilterWithStacks(filterable, filter).sort(by[sort]);
  }, [filterable, filter, sort]);

  const sections = useMemo<Section[]>(() => {
    if (group === "none") return [{ key: "all", items }];
    const m = new Map<string, Ranked[]>();
    const keyOf = (r: Ranked) =>
      group === "repo"
        ? r.repo
        : group === "author"
          ? (r.author ?? "someone")
          : r.stack
            ? `Stack ${r.repo} #${r.stack.number}`
            : "Not in a stack";
    for (const r of items) {
      const k = keyOf(r);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    const entries = [...m.entries()];
    if (group === "stack") {
      entries.sort((a, b) => Number(a[0].startsWith("Not")) - Number(b[0].startsWith("Not")));
      return entries.map(([k, xs]) => {
        const st = xs[0]?.stack;
        const layers = st
          ? [...xs].sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0))
          : xs;
        return {
          key: k,
          items: layers,
          cluster: true,
          head: st ? undefined : (
            <p className="text-[12.5px] text-ink-2">
              Not in a stack <span className="tnum text-ink-3">{xs.length}</span>
            </p>
          ),
        };
      });
    }
    return entries.map(([k, xs]) => ({
      key: k,
      items: xs,
      head: (
        <p className="text-[12.5px] text-ink-2">
          {k} <span className="tnum text-ink-3">{xs.length}</span>
        </p>
      ),
    }));
  }, [items, group]);

  // With watched repositories, the Inbox is only a partial subset. Rendering it
  // while the complete PR query is pending produces stacks with missing layers.
  const loading = watched.length > 0 ? cached.isPending : !inbox.data;
  useKeepScroll("prs", root, !loading);
  return (
    <div
      ref={root}
      className="work-list screen-enter h-full overflow-y-auto bg-desk scrollbar-thin"
    >
      <ListHead title="Pull requests">
        {loading
          ? "Looking at GitHub…"
          : watched.length
            ? `${all.length} in the ${watched.length} repositor${watched.length === 1 ? "y" : "ies"} you watch, from the cache.`
            : `${all.length} that involve you. Watch repositories in Settings for the whole list.`}
      </ListHead>
      <FilterBar
        id="prs"
        items={filterable}
        filter={filter}
        set={setFilter}
        show={{
          repos: !workspace,
          labels: true,
          authors: true,
          codeOwners: true,
          statuses: true,
          ci: true,
          bots: true,
          stacks: true,
        }}
      >
        <Chips
          label="Group"
          value={group}
          onChange={setGroup}
          options={[
            ["none", "No groups"],
            ["repo", "By repo"],
            ["author", "By author"],
            ["stack", "By stack"],
          ]}
        />
        <Chips
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            ["priority", "Needs action first"],
            ["updated", "Recently updated"],
            ["updated-asc", "Least recently updated"],
            ["created", "Newest first"],
            ["created-asc", "Oldest first"],
            ["title", "Title"],
          ]}
        />
      </FilterBar>
      {!loading ? (
        <List
          label="Pull requests"
          sections={sections}
          pageSize={120}
          actions={{ open, snooze, snoozeFor, unsnooze, checkout }}
          renderPeek={(it) =>
            it.kind === "pr" || it.kind === "mention" ? <PrPeek item={it} /> : null
          }
          empty={
            isFiltering(filter) ? (
              <Nothing detail="Try removing a filter or searching for something broader.">
                No pull requests match this view
              </Nothing>
            ) : (
              <Nothing detail="Change the Status filter or watch another repository in Settings.">
                No pull requests here
              </Nothing>
            )
          }
        />
      ) : null}
    </div>
  );
}
