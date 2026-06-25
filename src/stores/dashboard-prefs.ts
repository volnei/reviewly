import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DashboardPeriod = "3d" | "7d" | "30d" | "90d" | "all";
export type DashboardViewMode = "compact" | "kanban";

interface State {
  /** Selected trend/metric window — survives navigation + restart. */
  period: DashboardPeriod;
  /** Dashboard section layout density. */
  viewMode: DashboardViewMode;
  /** Board-only: keep empty status columns visible as collapsed headers. */
  kanbanShowEmptyStatuses: boolean;
  /** Board-only: show CI/review/comment signals on cards. */
  kanbanShowCardSignals: boolean;
  setPeriod: (p: DashboardPeriod) => void;
  setViewMode: (mode: DashboardViewMode) => void;
  setKanbanShowEmptyStatuses: (show: boolean) => void;
  setKanbanShowCardSignals: (show: boolean) => void;
}

export const useDashboardPrefs = create<State>()(
  persist(
    (set) => ({
      period: "30d",
      viewMode: "compact",
      kanbanShowEmptyStatuses: true,
      kanbanShowCardSignals: true,
      setPeriod: (period) => set({ period }),
      setViewMode: (viewMode) => set({ viewMode }),
      setKanbanShowEmptyStatuses: (kanbanShowEmptyStatuses) => set({ kanbanShowEmptyStatuses }),
      setKanbanShowCardSignals: (kanbanShowCardSignals) => set({ kanbanShowCardSignals }),
    }),
    {
      name: "reviewly.dashboard-prefs",
      storage: sqlStorage<State>(),
      version: 1,
      migrate: (persisted) => {
        const state = persisted as {
          period?: DashboardPeriod;
          viewMode?: DashboardViewMode | "normal" | "grid";
          kanbanShowEmptyStatuses?: boolean;
          kanbanShowCardSignals?: boolean;
        };
        return {
          ...state,
          viewMode:
            state.viewMode === "normal" || state.viewMode === "grid"
              ? "compact"
              : (state.viewMode ?? "compact"),
          kanbanShowEmptyStatuses: state.kanbanShowEmptyStatuses ?? true,
          kanbanShowCardSignals: state.kanbanShowCardSignals ?? true,
        } as State;
      },
    },
  ),
);
