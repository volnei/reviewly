import type { GuidedPlan } from "@/lib/guided";
import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A generated tour plus the metadata needed to trust/resume it. */
export interface GuidedEntry {
  plan: GuidedPlan;
  /** Head SHA the plan was generated against (staleness check). */
  headSha: string;
  /** Which AI produced it ("claude" | "codex"). */
  provider: string;
  /** Epoch ms when generated. */
  generatedAt: number;
  /** Step indices the reviewer has visited. */
  seen: number[];
  /** Step indices the reviewer dismissed (hidden from the tour). */
  dismissed?: number[];
  /** Step index to resume on. */
  lastActive: number;
}

/** Keep at most this many tours so the persisted kv row stays bounded. */
const MAX_ENTRIES = 40;

interface State {
  /** Persisted tours keyed by `${owner}/${repo}#${number}`. */
  byPr: Record<string, GuidedEntry>;
  set: (key: string, plan: GuidedPlan, meta: { headSha: string; provider: string }) => void;
  reset: (key: string) => void;
  markSeen: (key: string, idx: number) => void;
  setLastActive: (key: string, idx: number) => void;
  /** Hide a tour stop (e.g. a question/concern the reviewer has handled). */
  dismiss: (key: string, idx: number) => void;
  /** Bring every dismissed stop back. */
  restoreDismissed: (key: string) => void;
}

/** Drop the oldest entries once we exceed the cap. */
function evict(byPr: Record<string, GuidedEntry>): Record<string, GuidedEntry> {
  const keys = Object.keys(byPr);
  if (keys.length <= MAX_ENTRIES) return byPr;
  const ordered = keys.sort((a, b) => byPr[b].generatedAt - byPr[a].generatedAt);
  const keep = ordered.slice(0, MAX_ENTRIES);
  const next: Record<string, GuidedEntry> = {};
  for (const k of keep) next[k] = byPr[k];
  return next;
}

export const useGuided = create<State>()(
  persist(
    (set, get) => ({
      byPr: {},
      set: (key, plan, meta) =>
        set({
          byPr: evict({
            ...get().byPr,
            [key]: {
              plan,
              headSha: meta.headSha,
              provider: meta.provider,
              generatedAt: Date.now(),
              seen: [],
              dismissed: [],
              lastActive: 0,
            },
          }),
        }),
      reset: (key) => {
        const next = { ...get().byPr };
        delete next[key];
        set({ byPr: next });
      },
      markSeen: (key, idx) => {
        const cur = get().byPr[key];
        if (!cur || cur.seen.includes(idx)) return;
        set({ byPr: { ...get().byPr, [key]: { ...cur, seen: [...cur.seen, idx] } } });
      },
      setLastActive: (key, idx) => {
        const cur = get().byPr[key];
        if (!cur || cur.lastActive === idx) return;
        set({ byPr: { ...get().byPr, [key]: { ...cur, lastActive: idx } } });
      },
      dismiss: (key, idx) => {
        const cur = get().byPr[key];
        if (!cur) return;
        const d = cur.dismissed ?? [];
        if (d.includes(idx)) return;
        set({ byPr: { ...get().byPr, [key]: { ...cur, dismissed: [...d, idx] } } });
      },
      restoreDismissed: (key) => {
        const cur = get().byPr[key];
        if (!cur || (cur.dismissed ?? []).length === 0) return;
        set({ byPr: { ...get().byPr, [key]: { ...cur, dismissed: [] } } });
      },
    }),
    { name: "reviewly.guided", storage: sqlStorage<State>() },
  ),
);
