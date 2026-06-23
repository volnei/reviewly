import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-PR + per-head-sha record of which files the user has marked as
 * "viewed". Local only — GitHub's REST API has no equivalent and the
 * GraphQL mutation only persists for the same user signed in to github.com.
 *
 * Key shape: `${owner}/${repo}#${number}@${head_sha}` → Set<path>.
 */
interface State {
  /** Object map: prefer object over Map for JSON-storage compatibility. */
  viewed: Record<string, Record<string, true>>;
  isViewed: (key: string, path: string) => boolean;
  setViewed: (key: string, path: string, viewed: boolean) => void;
  countViewed: (key: string) => number;
  reset: (key: string) => void;
  /**
   * Per-PR record of which folders in the file tree are collapsed.
   * Keyed by viewedKey → { folderPath: true }.
   */
  collapsed: Record<string, Record<string, true>>;
  setCollapsed: (key: string, path: string, collapsed: boolean) => void;
  setCollapsedBulk: (key: string, paths: string[], collapsed: boolean) => void;
  /**
   * Per-PR record of which inter-hunk context gaps the user expanded in the
   * diff, so re-opening a file keeps its expansions. Keyed by
   * viewedKey → filePath → { gapIdx: true }.
   */
  expandedGaps: Record<string, Record<string, Record<string, true>>>;
  setGapExpanded: (key: string, path: string, gapIdx: number) => void;
}

export function viewedKey(owner: string, repo: string, number: number, sha: string): string {
  return `${owner}/${repo}#${number}@${sha}`;
}

export const useViewedFiles = create<State>()(
  persist(
    (set, get) => ({
      viewed: {},
      isViewed: (key, path) => Boolean(get().viewed[key]?.[path]),
      setViewed: (key, path, v) => {
        const current = get().viewed[key] ?? {};
        const next = { ...current };
        if (v) next[path] = true;
        else delete next[path];
        set({ viewed: { ...get().viewed, [key]: next } });
      },
      countViewed: (key) => Object.keys(get().viewed[key] ?? {}).length,
      reset: (key) => {
        const rest = { ...get().viewed };
        delete rest[key];
        set({ viewed: rest });
      },
      collapsed: {},
      setCollapsed: (key, path, c) => {
        const current = get().collapsed[key] ?? {};
        const next = { ...current };
        if (c) next[path] = true;
        else delete next[path];
        set({ collapsed: { ...get().collapsed, [key]: next } });
      },
      setCollapsedBulk: (key, paths, c) => {
        const current = get().collapsed[key] ?? {};
        const next = { ...current };
        for (const path of paths) {
          if (c) next[path] = true;
          else delete next[path];
        }
        set({ collapsed: { ...get().collapsed, [key]: next } });
      },
      expandedGaps: {},
      setGapExpanded: (key, path, gapIdx) => {
        const byKey = get().expandedGaps[key] ?? {};
        const forFile = byKey[path] ?? {};
        const nextFile = { ...forFile, [gapIdx]: true as const };
        set({
          expandedGaps: {
            ...get().expandedGaps,
            [key]: { ...byKey, [path]: nextFile },
          },
        });
      },
    }),
    { name: "reviewly.viewed-files", storage: sqlStorage<State>() },
  ),
);
