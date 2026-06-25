import { type PrState, STATE_META, prState } from "@/components/pr-row";
import type { CiStatus, Label, PullSummary } from "@/lib/tauri";
import { parseRepoUrl } from "@/lib/tauri";
import { type SortKey, usePrFilters } from "@/stores/pr-filters";
import { AlertTriangle, FolderGit2, type LucideIcon } from "lucide-react";
import { useDeferredValue, useMemo } from "react";

export const STATE_ORDER: PrState[] = ["open", "draft", "merged", "closed"];

export type ActiveFilterChip = {
  key: string;
  field: string;
  operator?: string;
  operatorOptions?: ActiveFilterOption[];
  value: string;
  valueAvatarUrl?: string;
  valueAvatars?: AuthorFilterOption[];
  valueAvatarOverflow?: number;
  options: ActiveFilterOption[];
  onOperatorSelect?: (value: string) => void;
  onSelect: (value: string, additive: boolean) => void;
  onRemove: () => void;
};

export type ActiveFilterOption = {
  value: string;
  label: string;
  icon?: LucideIcon;
  color?: string;
  avatarUrl?: string;
  selected?: boolean;
};

type StateTotals = Record<PrState, number>;
export type AuthorFilterOption = { login: string; avatarUrl: string };

export function repoOf(p: PullSummary): string {
  const r = parseRepoUrl(p.repository_url);
  return r ? `${r.owner}/${r.repo}` : "unknown";
}

export function usePrFilterModel({
  prs,
  allOpen,
  stateTotals,
  query,
  sort,
  ciMap,
}: {
  prs: PullSummary[];
  allOpen: boolean;
  stateTotals?: StateTotals;
  query: string;
  sort: SortKey;
  ciMap: Map<number, CiStatus["state"]>;
}) {
  const labelStates = usePrFilters((s) => s.labelStates);
  const repos = usePrFilters((s) => s.repos);
  const authors = usePrFilters((s) => s.authors);
  const states = usePrFilters((s) => s.states);
  const setQuery = usePrFilters((s) => s.setQuery);
  const toggleRepo = usePrFilters((s) => s.toggleRepo);
  const clearRepos = usePrFilters((s) => s.clearRepos);
  const toggleAuthor = usePrFilters((s) => s.toggleAuthor);
  const clearAuthors = usePrFilters((s) => s.clearAuthors);
  const cycleLabel = usePrFilters((s) => s.cycleLabel);
  const clearLabels = usePrFilters((s) => s.clearLabels);
  const toggleState = usePrFilters((s) => s.toggleState);
  const clearStates = usePrFilters((s) => s.clearStates);
  const ciFailing = usePrFilters((s) => s.ciFailing);
  const toggleCiFailing = usePrFilters((s) => s.toggleCiFailing);

  const includeClosed = states.includes("merged") || states.includes("closed");

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

  const allAuthors = useMemo<AuthorFilterOption[]>(() => {
    const byLogin = new Map<string, string>();
    for (const p of prs) {
      if (repos.length > 0 && !repos.includes(repoOf(p))) continue;
      byLogin.set(p.user.login, p.user.avatar_url);
    }
    return [...byLogin.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([login, avatarUrl]) => ({ login, avatarUrl }));
  }, [prs, repos]);

  const stateCounts = useMemo(() => {
    const m = new Map<PrState, number>();
    for (const p of prs) {
      const s = prState(p);
      m.set(s, (m.get(s) ?? 0) + 1);
    }
    return m;
  }, [prs]);

  const filterStateCounts = useMemo<Map<PrState, number>>(() => {
    if (allOpen && stateTotals) {
      return new Map<PrState, number>([
        ["open", stateTotals.open],
        ["draft", stateTotals.draft],
        ["merged", stateTotals.merged],
        ["closed", stateTotals.closed],
      ]);
    }
    return stateCounts;
  }, [allOpen, stateTotals, stateCounts]);

  const deferredQuery = useDeferredValue(query);

  const displayed = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const includeLabels = Object.entries(labelStates)
      .filter(([, s]) => s === "include")
      .map(([n]) => n);
    const excludeLabels = Object.entries(labelStates)
      .filter(([, s]) => s === "exclude")
      .map(([n]) => n);

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
      if (authors.length > 0 && !authors.includes(p.user.login)) return false;
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
  }, [prs, deferredQuery, labelStates, repos, authors, states, sort, ciFailing, ciMap]);

  const presentStates = allOpen
    ? STATE_ORDER
    : STATE_ORDER.filter((s) => (stateCounts.get(s) ?? 0) > 0);

  const filterCount =
    states.length +
    repos.length +
    authors.length +
    Object.keys(labelStates).length +
    (ciFailing ? 1 : 0);

  function clearAllFilters() {
    clearStates();
    clearRepos();
    clearAuthors();
    clearLabels();
    if (ciFailing) toggleCiFailing();
  }

  function clearAllFiltersAndQuery() {
    clearAllFilters();
    setQuery("");
  }

  function cycleLabelToOff(name: string, current: "include" | "exclude") {
    cycleLabel(name);
    if (current === "include") cycleLabel(name);
  }

  function applyLabelState(name: string, desired: "include" | "exclude") {
    const current = labelStates[name];
    if (current === desired) return;
    if (current === "include" && desired === "exclude") {
      cycleLabel(name);
      return;
    }
    if (current === "exclude" && desired === "include") {
      cycleLabel(name);
      cycleLabel(name);
      return;
    }
    cycleLabel(name);
    if (desired === "exclude") cycleLabel(name);
  }

  function setAllLabelOperators(desired: "include" | "exclude") {
    for (const [name, current] of Object.entries(labelStates)) {
      if (current !== desired) applyLabelState(name, desired);
    }
  }

  function toggleLabelInGroup(name: string, desired: "include" | "exclude") {
    const current = labelStates[name];
    if (current === desired) cycleLabelToOff(name, current);
    else applyLabelState(name, desired);
  }

  function selectStateFilter(next: PrState, additive: boolean) {
    if (additive) {
      toggleState(next);
      return;
    }
    for (const state of states) {
      if (state !== next) toggleState(state);
    }
    if (!states.includes(next)) toggleState(next);
  }

  const chips: ActiveFilterChip[] = [];
  if (states.length > 0) {
    chips.push({
      key: "states",
      field: "State",
      operator: "is any of",
      value: selectedSummary(states, (state) => STATE_META[state].label),
      options: presentStates.map((state) => ({
        value: state,
        label: STATE_META[state].label,
        icon: STATE_META[state].icon,
        selected: states.includes(state),
      })),
      onSelect: (next, additive) => selectStateFilter(next as PrState, additive),
      onRemove: clearStates,
    });
  }
  if (repos.length > 0) {
    chips.push({
      key: "repos",
      field: "Repo",
      operator: "is any of",
      value: selectedSummary(repos),
      options: allRepos.map((repo) => ({
        value: repo,
        label: repo,
        icon: FolderGit2,
        selected: repos.includes(repo),
      })),
      onSelect: toggleRepo,
      onRemove: clearRepos,
    });
  }
  if (authors.length > 0) {
    chips.push({
      key: "authors",
      field: "Author",
      operator: "is any of",
      value: selectedSummary(authors),
      valueAvatarUrl:
        authors.length === 1
          ? allAuthors.find((author) => author.login === authors[0])?.avatarUrl
          : undefined,
      valueAvatars:
        authors.length > 1
          ? authors
              .map((login) => allAuthors.find((author) => author.login === login))
              .filter((author): author is AuthorFilterOption => Boolean(author))
              .slice(0, 3)
          : undefined,
      valueAvatarOverflow: authors.length > 3 ? authors.length - 3 : undefined,
      options: allAuthors.map((author) => ({
        value: author.login,
        label: author.login,
        avatarUrl: author.avatarUrl,
        selected: authors.includes(author.login),
      })),
      onSelect: toggleAuthor,
      onRemove: clearAuthors,
    });
  }
  const labelEntries = Object.entries(labelStates);
  const selectedLabelOperator =
    labelEntries.length > 0 && labelEntries.every(([, st]) => st === "exclude")
      ? "exclude"
      : "include";
  if (labelEntries.length > 0) {
    chips.push({
      key: "labels",
      field: "Label",
      operator: selectedLabelOperator === "exclude" ? "excludes any of" : "includes all of",
      value: selectedSummary(labelEntries.map(([name]) => name)),
      operatorOptions: [
        {
          value: "include",
          label: "includes all of",
          selected: selectedLabelOperator === "include",
        },
        {
          value: "exclude",
          label: "excludes any of",
          selected: selectedLabelOperator === "exclude",
        },
      ],
      onOperatorSelect: (next) => setAllLabelOperators(next as "include" | "exclude"),
      options: allLabels.map((label) => ({
        value: label.name,
        label: label.name,
        color: label.color,
        selected: label.name in labelStates,
      })),
      onSelect: (next) => toggleLabelInGroup(next, selectedLabelOperator),
      onRemove: clearLabels,
    });
  }
  if (ciFailing) {
    chips.push({
      key: "ci",
      field: "Status",
      value: "CI failing",
      options: [{ value: "ci-failing", label: "CI failing", icon: AlertTriangle, selected: true }],
      onSelect: () => undefined,
      onRemove: toggleCiFailing,
    });
  }

  return {
    labelStates,
    repos,
    authors,
    states,
    ciFailing,
    includeClosed,
    allLabels,
    allRepos,
    allAuthors,
    stateCounts,
    filterStateCounts,
    presentStates,
    displayed,
    filterCount,
    chips,
    clearAllFilters,
    clearAllFiltersAndQuery,
    selectStateFilter,
    toggleRepo,
    toggleAuthor,
    cycleLabel,
    toggleCiFailing,
  };
}

function selectedSummary<T extends string>(
  selected: T[],
  labelFor: (value: T) => string = (v) => v,
) {
  const labels = selected.map(labelFor);
  if (labels.length === 1) return labels[0];
  const visible = labels.slice(0, 3);
  const joined = visible.join(", ");
  if (labels.length <= 3 && joined.length <= 34) return joined;
  if (joined.length <= 30) return `${joined} +${labels.length - visible.length}`;
  return `${selected.length} selected`;
}
