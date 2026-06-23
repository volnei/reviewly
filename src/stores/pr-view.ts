import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DetailTab = "files" | "conversation" | "commits" | "checks";

/** Per-PR view memory so returning to a PR resumes where you left off. */
interface PrViewState {
  /** Last active tab, keyed by `owner/repo#number`. */
  tabs: Record<string, DetailTab>;
  /**
   * Last active file, keyed by `owner/repo#number@headSha` — head-pinned so a
   * force-push (new sha) doesn't restore a path that may no longer exist.
   */
  files: Record<string, string>;
  setTab: (prKey: string, tab: DetailTab) => void;
  setFile: (prKey: string, headSha: string, path: string) => void;
}

const fileKey = (prKey: string, headSha: string) => `${prKey}@${headSha}`;

export const usePrView = create<PrViewState>()(
  persist(
    (set) => ({
      tabs: {},
      files: {},
      setTab: (prKey, tab) => set((s) => ({ tabs: { ...s.tabs, [prKey]: tab } })),
      setFile: (prKey, headSha, path) =>
        set((s) => ({ files: { ...s.files, [fileKey(prKey, headSha)]: path } })),
    }),
    { name: "reviewly.pr-view", storage: sqlStorage<PrViewState>() },
  ),
);
