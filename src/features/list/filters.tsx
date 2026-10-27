import { isTyping } from "@/app/keys";
import { useWorkspace } from "@/app/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Verdict } from "@/effect/services/Prefs";
import type { Ranked } from "@/effect/services/Triage";
import { persistedStore, useStore } from "@/effect/store";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  ListFilter as FilterIcon,
  Minus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Filters for a list: a row of chips under the heading, computed from what
 * the list holds, and `/` for text. Each list keeps its own filter for the
 * session, so coming back finds it as you left it.
 */
export type Tri = "in" | "out";
export type PrStatus = "open" | "draft" | "merged" | "closed";

export interface ListFilter {
  readonly q: string;
  readonly repos: ReadonlySet<string>;
  readonly kinds: ReadonlySet<Ranked["kind"]>;
  readonly verdicts: ReadonlySet<Verdict>;
  readonly statuses: ReadonlySet<PrStatus>;
  /** A label present means include; "out" means exclude. Absent is off. */
  readonly labels: ReadonlyMap<string, Tri>;
  readonly authors: ReadonlySet<string>;
  readonly codeOwners: ReadonlySet<string>;
  readonly severities: ReadonlySet<string>;
  readonly hideBots: boolean;
  readonly ciFailing: boolean;
  readonly ciStatus?: "failing" | "not-failing" | null;
  readonly stacked: boolean;
}

export const EMPTY_FILTER: ListFilter = {
  q: "",
  repos: new Set(),
  kinds: new Set(),
  verdicts: new Set(),
  statuses: new Set(),
  labels: new Map(),
  authors: new Set(),
  codeOwners: new Set(),
  severities: new Set(),
  hideBots: false,
  ciFailing: false,
  ciStatus: null,
  stacked: false,
};

const BOT = /\[bot\]$|^(dependabot|renovate|github-actions)$/i;

const stores = new Map<
  string,
  { state: ListFilter; listeners: Set<() => void> }
>();
const storeOf = (key: string) => {
  let s = stores.get(key);
  if (!s) {
    let state = EMPTY_FILTER;
    try {
      const raw = localStorage.getItem(`reviewly.v2.filter.${key}`);
      if (raw) state = deserializeFilter(JSON.parse(raw));
    } catch {
      /* Invalid or unavailable storage starts with an empty filter. */
    }
    s = { state, listeners: new Set() };
    stores.set(key, s);
  }
  return s;
};

export function useListFilter(
  key: string,
): [ListFilter, (patch: Partial<ListFilter>) => void] {
  const workspace = useWorkspace();
  const scopedKey = `${key}:${workspace ?? "all"}`;
  const s = storeOf(scopedKey);
  const state = useSyncExternalStore(
    (l) => {
      s.listeners.add(l);
      return () => void s.listeners.delete(l);
    },
    () => s.state,
    () => s.state,
  );
  const set = (patch: Partial<ListFilter>) => {
    s.state = { ...s.state, ...patch };
    persistFilter(scopedKey, s.state);
    for (const l of s.listeners) l();
  };
  return [state, set];
}

/* ───────────── saved views: a filter with a name, kept on the machine ───────────── */

export interface SavedView {
  readonly id: string;
  readonly list: string;
  readonly name: string;
  readonly filter: {
    readonly q: string;
    readonly repos: ReadonlyArray<string>;
    readonly kinds: ReadonlyArray<Ranked["kind"]>;
    readonly verdicts: ReadonlyArray<Verdict>;
    readonly statuses?: ReadonlyArray<PrStatus>;
    readonly labels: ReadonlyArray<[string, Tri]>;
    readonly authors: ReadonlyArray<string>;
    readonly codeOwners?: ReadonlyArray<string>;
    readonly severities: ReadonlyArray<string>;
    readonly hideBots: boolean;
    readonly ciFailing: boolean;
    readonly ciStatus?: "failing" | "not-failing" | null;
    readonly stacked: boolean;
  };
}
const SAVED_VIEW_PATHS = {
  inbox: "/inbox",
  prs: "/prs",
  mentions: "/mentions",
  health: "/health",
} as const;

/** A saved view may be workspace-scoped (`prs:owner/repo`); its first segment owns the route. */
export function savedViewPath(view: Pick<SavedView, "list">): string {
  const list = view.list.split(":", 1)[0] as keyof typeof SAVED_VIEW_PATHS;
  return SAVED_VIEW_PATHS[list] ?? "/inbox";
}
export const serializeFilter = (f: ListFilter): SavedView["filter"] => ({
  q: f.q,
  repos: [...f.repos],
  kinds: [...f.kinds],
  verdicts: [...f.verdicts],
  statuses: [...f.statuses],
  labels: [...f.labels],
  authors: [...f.authors],
  codeOwners: [...f.codeOwners],
  severities: [...f.severities],
  hideBots: f.hideBots,
  ciFailing: f.ciFailing,
  ciStatus: f.ciStatus ?? (f.ciFailing ? "failing" : null),
  stacked: f.stacked,
});
export const deserializeFilter = (s: SavedView["filter"]): ListFilter => ({
  q: s.q,
  repos: new Set(s.repos),
  kinds: new Set(s.kinds),
  verdicts: new Set(s.verdicts),
  statuses: new Set(s.statuses ?? []),
  labels: new Map(s.labels),
  authors: new Set(s.authors),
  codeOwners: new Set(s.codeOwners ?? []),
  severities: new Set(s.severities),
  hideBots: s.hideBots,
  ciFailing: s.ciFailing,
  ciStatus: s.ciStatus ?? (s.ciFailing ? "failing" : null),
  stacked: s.stacked,
});
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const viewsStore = persistedStore<{ views: ReadonlyArray<SavedView> }>(
  "reviewly.v2.views",
  { views: [] },
  (raw) => ({
    views:
      isRecord(raw) && Array.isArray(raw.views)
        ? raw.views.filter(
            (v): v is SavedView =>
              isRecord(v) &&
              typeof v.id === "string" &&
              typeof v.list === "string" &&
              typeof v.name === "string" &&
              isRecord(v.filter),
          )
        : [],
  }),
);
/** The saved views, of one list or all; the snapshot is the store's own array, so React never loops. */
export function useSavedViews(list?: string): ReadonlyArray<SavedView> {
  const workspace = useWorkspace();
  const scopedList = list ? `${list}:${workspace ?? "all"}` : undefined;
  const views = useStore(viewsStore, (s) => s.views);
  return useMemo(
    () =>
      views.filter((v) =>
        list
          ? v.list === scopedList || (!workspace && v.list === list)
          : v.list.endsWith(`:${workspace ?? "all"}`) ||
            (!workspace && !v.list.includes(":")),
      ),
    [views, list, scopedList, workspace],
  );
}
const saveView = (list: string, name: string, filter: ListFilter) =>
  viewsStore.update((s) => ({
    views: [
      ...s.views,
      {
        id: `${list}:${Date.now()}`,
        list,
        name,
        filter: serializeFilter(filter),
      },
    ],
  }));

export function renameSavedView(id: string, name: string) {
  const nextName = name.trim();
  if (!nextName) return;
  viewsStore.update((s) => ({
    views: s.views.map((view) =>
      view.id === id ? { ...view, name: nextName } : view,
    ),
  }));
}

export function deleteSavedView(id: string) {
  viewsStore.update((s) => ({
    views: s.views.filter((view) => view.id !== id),
  }));
}

/** Put a saved view's filter on its list, from anywhere (the palette). */
export function applyView(view: SavedView) {
  const key = view.list.includes(":") ? view.list : `${view.list}:all`;
  const s = storeOf(key);
  s.state = deserializeFilter(view.filter);
  persistFilter(key, s.state);
  for (const l of s.listeners) l();
}

function persistFilter(key: string, filter: ListFilter) {
  try {
    localStorage.setItem(
      `reviewly.v2.filter.${key}`,
      JSON.stringify(serializeFilter(filter)),
    );
  } catch {
    /* Session filters remain usable without storage. */
  }
}

export const isFiltering = (f: ListFilter): boolean =>
  f.q.trim().length > 0 ||
  f.repos.size > 0 ||
  f.kinds.size > 0 ||
  f.verdicts.size > 0 ||
  f.statuses.size > 0 ||
  f.labels.size > 0 ||
  f.authors.size > 0 ||
  f.codeOwners.size > 0 ||
  f.severities.size > 0 ||
  f.hideBots ||
  f.ciFailing ||
  !!f.ciStatus ||
  f.stacked;

export function applyFilter(
  items: ReadonlyArray<Ranked>,
  f: ListFilter,
): Ranked[] {
  const needle = f.q.trim().toLowerCase();
  const ins = [...f.labels].filter(([, t]) => t === "in").map(([l]) => l);
  const outs = [...f.labels].filter(([, t]) => t === "out").map(([l]) => l);
  return items.filter((r) => {
    if (f.repos.size && !f.repos.has(r.repo)) return false;
    if (f.kinds.size && !f.kinds.has(r.kind)) return false;
    if (f.verdicts.size && !f.verdicts.has(r.verdict)) return false;
    const status = prStatusOf(r);
    if (f.statuses.size && (!status || !f.statuses.has(status))) return false;
    if (f.authors.size && !f.authors.has(r.author ?? "")) return false;
    if (
      f.codeOwners.size &&
      !(r.codeOwners ?? []).some((owner) => f.codeOwners.has(owner))
    )
      return false;
    if (
      f.severities.size &&
      !f.severities.has((r.severity ?? "").toLowerCase())
    )
      return false;
    if (f.hideBots && r.author && BOT.test(r.author)) return false;
    const ci = f.ciStatus ?? (f.ciFailing ? "failing" : null);
    if (ci === "failing" && r.ci !== "failure") return false;
    if (ci === "not-failing" && r.ci === "failure") return false;
    if (f.stacked && !r.stack) return false;
    const labels = r.labels ?? [];
    if (ins.length && !ins.every((l) => labels.includes(l))) return false;
    if (outs.length && outs.some((l) => labels.includes(l))) return false;
    if (needle) {
      const hay =
        `${r.title} ${r.author ?? ""} ${r.repo} #${r.number ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/**
 * A PR filter decides which stacks are relevant, not which dependency layers
 * may disappear. Once one layer matches, keep the complete visible stack so a
 * consumer is never shown without the foundation it depends on.
 */
export function applyFilterWithStacks(
  items: ReadonlyArray<Ranked>,
  f: ListFilter,
): Ranked[] {
  const matches = applyFilter(items, f);
  const matchedIds = new Set(matches.map((item) => item.id));
  const matchedStacks = new Set(
    matches.flatMap((item) =>
      item.stack ? [`${item.repo}#stack${item.stack.number}`] : [],
    ),
  );
  return items.filter(
    (item) =>
      matchedIds.has(item.id) ||
      (item.stack &&
        matchedStacks.has(`${item.repo}#stack${item.stack.number}`)),
  );
}

const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
  const n = new Set(set);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
};

/** Off → include → exclude → off. */
const cycle = (m: ReadonlyMap<string, Tri>, l: string): Map<string, Tri> => {
  const n = new Map(m);
  const cur = n.get(l);
  if (!cur) n.set(l, "in");
  else if (cur === "in") n.set(l, "out");
  else n.delete(l);
  return n;
};

const count = <T, K>(
  xs: ReadonlyArray<T>,
  key: (r: T) => K | null | undefined,
) => {
  const m = new Map<K, number>();
  for (const r of xs) {
    const k = key(r);
    if (k != null && k !== "") m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

const VERDICTS: ReadonlyArray<Verdict> = [
  "risky",
  "yours",
  "routine",
  "mergeable",
  "waiting",
  "unsorted",
];
const KINDS: ReadonlyArray<[Ranked["kind"], string]> = [
  ["pr", "Pull requests"],
  ["mention", "Mentions"],
  ["finding", "Findings"],
  ["local", "Local"],
];
const SEVERITIES = ["critical", "high", "medium", "low"];
export const PR_STATUSES: ReadonlyArray<readonly [PrStatus, string]> = [
  ["open", "Open"],
  ["draft", "Draft"],
  ["merged", "Merged"],
  ["closed", "Closed"],
];

export const prStatusOf = (item: Ranked): PrStatus | null => {
  if (item.kind !== "pr") return null;
  if (item.merged || item.state === "merged") return "merged";
  if (item.state === "closed") return "closed";
  if (item.draft) return "draft";
  return "open";
};

type FilterShow = {
  repos?: boolean;
  kinds?: boolean;
  verdicts?: boolean;
  statuses?: boolean;
  labels?: boolean;
  authors?: boolean;
  codeOwners?: boolean;
  severities?: boolean;
  ci?: boolean;
  bots?: boolean;
  stacks?: boolean;
};
interface FilterOption {
  value: string;
  label: string;
  count?: number;
  avatar?: string;
}
interface FilterField {
  id: string;
  label: string;
  options: FilterOption[];
  values: string[];
  toggle: (value: string) => void;
  remove: (value: string) => void;
}

export function FilterBar({
  id,
  items,
  filter,
  set,
  show,
  children,
  lead,
}: {
  id: string;
  items: ReadonlyArray<Ranked>;
  filter: ListFilter;
  set: (patch: Partial<ListFilter>) => void;
  show: FilterShow;
  children?: ReactNode;
  lead?: ReactNode;
}) {
  const workspace = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const active = isFiltering(filter);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !isTyping(event.target) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", focus);
    return () => document.removeEventListener("keydown", focus);
  }, []);
  const fields = useMemo(() => {
    const out: FilterField[] = [];
    const multi = (
      id: string,
      label: string,
      options: FilterOption[],
      values: ReadonlySet<string>,
      change: (next: Set<string>) => void,
    ) => {
      const all = [...options];
      for (const value of values)
        if (!all.some((o) => o.value === value))
          all.push({ value, label: value, count: 0 });
      if (all.length)
        out.push({
          id,
          label,
          options: all,
          values: [...values],
          toggle: (value) => change(toggle(values, value)),
          remove: (value) =>
            change(new Set([...values].filter((v) => v !== value))),
        });
    };
    if (show.repos)
      multi(
        "repos",
        "Repository",
        count(items, (i) => i.repo).map(([value, n]) => ({
          value,
          label: value,
          count: n,
        })),
        filter.repos,
        (repos) => set({ repos }),
      );
    if (show.authors)
      multi(
        "authors",
        "Author",
        count(items, (i) => i.author).map(([value, n]) => ({
          value,
          label: value,
          count: n,
          avatar: items.find((i) => i.author === value)?.avatar,
        })),
        filter.authors,
        (authors) => set({ authors }),
      );
    if (show.codeOwners)
      multi(
        "codeOwners",
        "Code owner",
        count(
          items.flatMap((item) =>
            (item.codeOwners ?? []).map((owner) => ({ owner })),
          ),
          (item) => item.owner,
        ).map(([value, n]) => ({ value, label: value, count: n })),
        filter.codeOwners,
        (codeOwners) => set({ codeOwners }),
      );
    if (show.labels) {
      const options = count(
        items.flatMap((i) => (i.labels ?? []).map((label) => ({ label }))),
        (i) => i.label,
      ).map(([value, n]) => ({ value, label: value, count: n }));
      for (const value of filter.labels.keys())
        if (!options.some((o) => o.value === value))
          options.push({ value, label: value, count: 0 });
      if (options.length)
        out.push({
          id: "labels",
          label: "Label",
          options,
          values: [...filter.labels.keys()],
          toggle: (value) => set({ labels: cycle(filter.labels, value) }),
          remove: (value) => {
            const labels = new Map(filter.labels);
            labels.delete(value);
            set({ labels });
          },
        });
    }
    if (show.kinds)
      multi(
        "kinds",
        "Type",
        KINDS.filter(([value]) => items.some((i) => i.kind === value)).map(
          ([value, label]) => ({
            value,
            label,
          }),
        ),
        filter.kinds,
        (kinds) => set({ kinds: kinds as Set<Ranked["kind"]> }),
      );
    if (show.verdicts)
      multi(
        "verdicts",
        "Priority",
        VERDICTS.filter((value) => items.some((i) => i.verdict === value)).map(
          (value) => ({
            value,
            label: value,
          }),
        ),
        filter.verdicts,
        (verdicts) => set({ verdicts: verdicts as Set<Verdict> }),
      );
    if (show.statuses) {
      const counts = new Map(count(items, prStatusOf));
      multi(
        "statuses",
        "Status",
        PR_STATUSES.map(([value, label]) => ({
          value,
          label,
          count: counts.get(value) ?? 0,
        })),
        filter.statuses,
        (statuses) => set({ statuses: statuses as Set<PrStatus> }),
      );
    }
    if (show.severities)
      multi(
        "severities",
        "Severity",
        SEVERITIES.filter((value) =>
          items.some((i) => i.severity?.toLowerCase() === value),
        ).map((value) => ({ value, label: value })),
        filter.severities,
        (severities) => set({ severities }),
      );
    if (show.ci) {
      const selected = filter.ciStatus ?? (filter.ciFailing ? "failing" : null);
      const change = (value: string) => {
        const ciStatus =
          selected === value ? null : (value as "failing" | "not-failing");
        set({ ciStatus, ciFailing: ciStatus === "failing" });
      };
      out.push({
        id: "ci",
        label: "CI status",
        options: [
          { value: "failing", label: "Failing" },
          { value: "not-failing", label: "Not failing" },
        ],
        values: selected ? [selected] : [],
        toggle: change,
        remove: () => set({ ciStatus: null, ciFailing: false }),
      });
    }
    if (show.bots)
      out.push({
        id: "bots",
        label: "Bots",
        options: [{ value: "hidden", label: "Hide bots" }],
        values: filter.hideBots ? ["hidden"] : [],
        toggle: () => set({ hideBots: !filter.hideBots }),
        remove: () => set({ hideBots: false }),
      });
    if (show.stacks)
      out.push({
        id: "stacks",
        label: "Stack",
        options: [{ value: "stacked", label: "Stacked PRs only" }],
        values: filter.stacked ? ["stacked"] : [],
        toggle: () => set({ stacked: !filter.stacked }),
        remove: () => set({ stacked: false }),
      });
    return out;
  }, [items, filter, set, show]);
  const tokens = fields.flatMap((field) =>
    field.values.map((value) => ({
      field,
      value,
      label: field.options.find((o) => o.value === value)?.label ?? value,
    })),
  );
  return (
    <div className="list-filterbar">
      <div className="list-filter-toolbar">
        {lead ? <div className="list-filter-scope">{lead}</div> : null}
        <div className="list-filter-search">
          <Search size={14} aria-hidden />
          <Input
            ref={input}
            size="sm"
            unstyled
            value={filter.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Search title, author or #number…"
            aria-label="Search this list"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                set({ q: "" });
                input.current?.blur();
              }
            }}
          />
          {filter.q ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => set({ q: "" })}
            >
              <X size={12} />
            </Button>
          ) : null}
        </div>
        <FilterPicker
          fields={fields}
          filter={filter}
          footer={
            naming ? (
              <form
                className="filter-save-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  saveView(`${id}:${workspace ?? "all"}`, name.trim(), filter);
                  setName("");
                  setNaming(false);
                }}
              >
                <Input
                  size="sm"
                  autoFocus
                  aria-label="View name"
                  placeholder="Name this view"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={!name.trim()}>
                  Save
                </Button>
              </form>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="filter-save-view"
                disabled={!active}
                onClick={() => setNaming(true)}
              >
                Save current filters as view
              </Button>
            )
          }
          trigger={
            <>
              <FilterIcon size={14} />
              Filter
              {tokens.length ? (
                <span className="filter-count tnum">{tokens.length}</span>
              ) : null}
            </>
          }
        />
        {children ? (
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="sm" />}>
              <SlidersHorizontal size={14} />
              Display
            </PopoverTrigger>
            <PopoverPopup align="end" className="w-64">
              <p className="filter-popup-heading">Display</p>
              <div className="filter-display-controls">{children}</div>
            </PopoverPopup>
          </Popover>
        ) : null}
      </div>
      {tokens.length ? (
        <div className="list-filter-tokens">
          {tokens.map(({ field, value, label }) => (
            <div className="filter-token" key={`${field.id}:${value}`}>
              <span className="filter-token-field">{field.label}</span>
              {field.id === "labels" ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="filter-token-operator"
                  aria-label={`Change label ${label} to ${filter.labels.get(value) === "out" ? "include" : "exclude"}`}
                  onClick={() => {
                    const labels = new Map(filter.labels);
                    labels.set(
                      value,
                      labels.get(value) === "out" ? "in" : "out",
                    );
                    set({ labels });
                  }}
                >
                  {filter.labels.get(value) === "out" ? "is not" : "is"}
                </Button>
              ) : null}
              <FilterPicker
                fields={fields}
                filter={filter}
                initial={field.id}
                compact
                trigger={
                  <>
                    <span>{label}</span>
                    <ChevronDown size={11} />
                  </>
                }
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${field.label} ${label} filter`}
                onClick={() => field.remove(value)}
              >
                <X size={11} />
              </Button>
            </div>
          ))}
          <Button variant="ghost" size="xs" onClick={() => set(EMPTY_FILTER)}>
            Clear filters
          </Button>
        </div>
      ) : filter.q ? (
        <div className="list-filter-tokens">
          <Button variant="ghost" size="xs" onClick={() => set(EMPTY_FILTER)}>
            Clear filters
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FilterPicker({
  fields,
  filter,
  trigger,
  footer,
  initial,
  compact = false,
}: {
  fields: FilterField[];
  filter: ListFilter;
  trigger: ReactNode;
  footer?: ReactNode;
  initial?: string;
  compact?: boolean;
}) {
  const [fieldId, setFieldId] = useState(initial ?? "");
  const [query, setQuery] = useState("");
  const field = fields.find((f) => f.id === fieldId) ?? fields[0];
  const options =
    field?.options.filter((o) =>
      o.label.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setFieldId(initial ?? fields[0]?.id ?? "");
          setQuery("");
        }
      }}
    >
      <PopoverTrigger
        disabled={!fields.length}
        render={
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "xs" : "sm"}
          />
        }
      >
        {trigger}
      </PopoverTrigger>
      <PopoverPopup align="start" className="filter-picker-popup">
        <div className="filter-picker-layout">
          <div
            className="filter-field-list"
            role="group"
            aria-label="Filter fields"
          >
            {fields.map((f) => (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                aria-pressed={field?.id === f.id}
                onClick={() => {
                  setFieldId(f.id);
                  setQuery("");
                }}
              >
                <span>{f.label}</span>
                {f.values.length ? (
                  <span className="filter-count tnum">{f.values.length}</span>
                ) : null}
              </Button>
            ))}
          </div>
          <div className="filter-value-panel">
            <p className="filter-popup-heading">{field?.label ?? "Filters"}</p>
            <Input
              size="sm"
              aria-label={`Find ${field?.label ?? "filter"} options`}
              placeholder="Find a value…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {field?.id === "labels" ? (
              <p className="filter-label-hint">
                Click to include, again to exclude.
              </p>
            ) : null}
            <div className="filter-value-list">
              {options.map((option) => {
                const selected = field.values.includes(option.value);
                const excluded =
                  field.id === "labels" &&
                  filter.labels.get(option.value) === "out";
                return (
                  <Button
                    key={option.value}
                    variant="ghost"
                    size="sm"
                    aria-pressed={selected}
                    aria-label={`${option.label}${excluded ? ", excluded" : selected ? ", included" : ""}`}
                    onClick={() => field.toggle(option.value)}
                  >
                    <span className="filter-check">
                      {excluded ? (
                        <Minus size={13} />
                      ) : selected ? (
                        <Check size={13} />
                      ) : null}
                    </span>
                    {option.avatar ? (
                      <img
                        src={option.avatar}
                        alt=""
                        className="size-4 rounded-full"
                      />
                    ) : null}
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-left",
                        excluded && "line-through",
                      )}
                    >
                      {option.label}
                    </span>
                    {option.count !== undefined ? (
                      <span className="tnum text-[10px] text-ink-3">
                        {option.count}
                      </span>
                    ) : null}
                  </Button>
                );
              })}
              {!options.length ? (
                <p className="filter-popup-empty">No matching values.</p>
              ) : null}
            </div>
          </div>
        </div>
        {footer ? <div className="filter-picker-footer">{footer}</div> : null}
      </PopoverPopup>
    </Popover>
  );
}

/** Scope, grouping and sorting all use the same Coss select. */
export function Chips<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <div className="list-choice">
      <span>{label}</span>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger size="sm">
          <SelectValue>
            {options.find(([key]) => key === value)?.[1] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {options.map(([key, text]) => (
            <SelectItem key={key} value={key}>
              {text}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
