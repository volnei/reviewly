import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** A local clone bound to its remote `owner/repo` — the join between the
 * GitHub-Desktop workspace and the PR base/analytics. */
export interface LocalRepo {
  /** Absolute path to the clone on disk. */
  path: string;
  owner: string;
  repo: string;
  remoteUrl: string;
}

interface State {
  repos: LocalRepo[];
  add: (r: LocalRepo) => void;
  remove: (path: string) => void;
}

export const useLocalRepos = create<State>()(
  persist(
    (set, get) => ({
      repos: [],
      add: (r) => set({ repos: [...get().repos.filter((x) => x.path !== r.path), r] }),
      remove: (path) => set({ repos: get().repos.filter((x) => x.path !== path) }),
    }),
    { name: "reviewly.local-repos", storage: sqlStorage<State>() },
  ),
);

/** Extract `owner/repo` from a git remote (`git@github.com:o/r.git` or
 * `https://github.com/o/r(.git)`). */
export function parseGitRemote(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}
