import type { PrState } from "@/components/pr-row";
import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type GroupBy = "none" | "repo" | "author";
export type SortKey = "updated-desc" | "updated-asc" | "created-desc" | "created-asc" | "title";
export type LabelState = "include" | "exclude";
export type PrScope = "review-requested" | "created" | "involved";

interface State {
  /** Which PRs the list fetches: awaiting your review, authored, or involved. */
  scope: PrScope;
  setScope: (s: PrScope) => void;
  query: string;
  sort: SortKey;
  groupBy: GroupBy;
  /** label name → include/exclude (absent = ignored). */
  labelStates: Record<string, LabelState>;
  repos: string[];
  states: PrState[];
  ciFailing: boolean;
  /** Last list scrollTop, keyed by list scope (watchedKey or scope) so each queue restores its own position. */
  scrollPos: Record<string, number>;

  setQuery: (q: string) => void;
  setScrollPos: (key: string, top: number) => void;
  setSort: (s: SortKey) => void;
  setGroupBy: (g: GroupBy) => void;
  toggleRepo: (repo: string) => void;
  clearRepos: () => void;
  cycleLabel: (name: string) => void;
  clearLabels: () => void;
  toggleState: (s: PrState) => void;
  clearStates: () => void;
  toggleCiFailing: () => void;
}

const toggle = <T>(arr: T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export const usePrFilters = create<State>()(
  persist(
    (set, get) => ({
      scope: "review-requested",
      setScope: (scope) => set({ scope }),
      query: "",
      sort: "updated-desc",
      groupBy: "none",
      labelStates: {},
      repos: [],
      states: [],
      ciFailing: false,
      scrollPos: {},

      setQuery: (query) => set({ query }),
      setScrollPos: (key, top) => set({ scrollPos: { ...get().scrollPos, [key]: top } }),
      setSort: (sort) => set({ sort }),
      setGroupBy: (groupBy) => set({ groupBy }),
      toggleRepo: (repo) => set({ repos: toggle(get().repos, repo) }),
      clearRepos: () => set({ repos: [] }),
      cycleLabel: (name) => {
        const next = { ...get().labelStates };
        if (!next[name]) next[name] = "include";
        else if (next[name] === "include") next[name] = "exclude";
        else delete next[name];
        set({ labelStates: next });
      },
      clearLabels: () => set({ labelStates: {} }),
      toggleState: (s) => set({ states: toggle(get().states, s) }),
      clearStates: () => set({ states: [] }),
      toggleCiFailing: () => set({ ciFailing: !get().ciFailing }),
    }),
    { name: "reviewly.pr-filters", storage: sqlStorage<State>() },
  ),
);
