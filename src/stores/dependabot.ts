import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface State {
  /** Repository to show Dependabot alerts for, as "owner/repo". */
  repo: string;
  setRepo: (repo: string) => void;
}

export const useDependabotRepo = create<State>()(
  persist(
    (set) => ({
      repo: "",
      setRepo: (repo) => set({ repo: repo.trim() }),
    }),
    { name: "reviewly.dependabot", storage: sqlStorage<State>() },
  ),
);
