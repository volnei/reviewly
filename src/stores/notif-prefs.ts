import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NotifMode = "all" | "reviews" | "mentions";

interface State {
  /** Active notifications filter (All / Reviews / Mentions) — persisted. */
  mode: NotifMode;
  setMode: (m: NotifMode) => void;
}

export const useNotifPrefs = create<State>()(
  persist(
    (set) => ({
      mode: "all",
      setMode: (mode) => set({ mode }),
    }),
    { name: "reviewly.notif-prefs", storage: sqlStorage<State>() },
  ),
);
