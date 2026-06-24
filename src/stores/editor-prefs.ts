import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface EditorPrefsState {
  /** Last local opener the viewer picked, e.g. "zed" or "cursor". */
  lastTargetId: string | null;
  setLastTargetId: (targetId: string) => void;
}

export const useEditorPrefs = create<EditorPrefsState>()(
  persist(
    (set) => ({
      lastTargetId: null,
      setLastTargetId: (lastTargetId) => set({ lastTargetId }),
    }),
    { name: "reviewly.editor-prefs", storage: sqlStorage<EditorPrefsState>() },
  ),
);
