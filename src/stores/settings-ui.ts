import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-section collapsed state for the Settings page (persisted so it sticks). */
interface State {
  collapsed: Record<string, boolean>;
  toggle: (id: string) => void;
}

export const useSettingsUi = create<State>()(
  persist(
    (set) => ({
      collapsed: {},
      toggle: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
    }),
    { name: "reviewly.settings-ui", storage: sqlStorage<State>() },
  ),
);
