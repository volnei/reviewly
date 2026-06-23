import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface State {
  /**
   * `owner/repo` strings the user wants to focus on. Empty means "show
   * everything" — the feature is opt-in and never hides PRs until you pick.
   */
  repos: string[];
  toggle: (repo: string) => void;
  clear: () => void;
}

export const useWatchedRepos = create<State>()(
  persist(
    (set, get) => ({
      repos: [],
      toggle: (repo) => {
        const cur = get().repos;
        set({ repos: cur.includes(repo) ? cur.filter((r) => r !== repo) : [...cur, repo] });
      },
      clear: () => set({ repos: [] }),
    }),
    { name: "reviewly.watched-repos", storage: sqlStorage<State>() },
  ),
);
