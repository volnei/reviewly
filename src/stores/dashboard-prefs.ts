import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DashboardPeriod = "3d" | "7d" | "30d" | "90d" | "all";

interface State {
  /** Selected trend/metric window — survives navigation + restart. */
  period: DashboardPeriod;
  setPeriod: (p: DashboardPeriod) => void;
}

export const useDashboardPrefs = create<State>()(
  persist(
    (set) => ({
      period: "30d",
      setPeriod: (period) => set({ period }),
    }),
    { name: "reviewly.dashboard-prefs", storage: sqlStorage<State>() },
  ),
);
