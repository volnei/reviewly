import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MergeMethod = "merge" | "squash" | "rebase";

interface MergePrefsState {
  /** The merge method the viewer last chose — pre-selected next time. */
  method: MergeMethod;
  setMethod: (method: MergeMethod) => void;
}

/**
 * Remembers the viewer's preferred merge method (was hardcoded to "squash") so
 * auto-merge and "Merge now" pre-select what they used last.
 */
export const useMergePrefs = create<MergePrefsState>()(
  persist(
    (set) => ({
      method: "squash",
      setMethod: (method) => set({ method }),
    }),
    { name: "reviewly.merge-prefs", storage: sqlStorage<MergePrefsState>() },
  ),
);
