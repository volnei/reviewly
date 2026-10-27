import { useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import { Effect } from "effect";

const matches = (remote: string, owner: string, repo: string) =>
  new RegExp(`[/:]${owner}/${repo}(\\.git)?/?$`, "i").test(remote.trim());

/**
 * The local clone of a repository, if one of the folders in Settings → Local
 * points at it. Resolved from each clone's remote, cached for the session.
 */
export function useLocalClone(owner: string, repo: string): string | null {
  const repos = usePrefs((p) => p.localRepos);
  const q = useEffectQuery(
    ["local-clones", repos],
    Effect.forEach(
      repos,
      (path) =>
        Effect.flatMap(Git, (g) => g.repoInfo(path)).pipe(
          Effect.map((info) => ({ path, remote: info.remote_url as string | null })),
          Effect.orElseSucceed(() => ({ path, remote: null as string | null })),
        ),
      { concurrency: 4 },
    ),
    { staleTime: 5 * 60_000, enabled: repos.length > 0 },
  );
  return q.data?.find((r) => r.remote && matches(r.remote, owner, repo))?.path ?? null;
}
