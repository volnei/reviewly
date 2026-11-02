import { hasBackend } from "@/effect/Tauri";
import { useEffectQuery } from "@/effect/runtime";
import type { PullStack } from "@/effect/schema";
import { GitHub, splitRepo } from "@/effect/services/GitHub";
import { prId } from "@/effect/services/Inbox";
import type { Ranked } from "@/effect/services/Triage";
import { readStackCutoffs } from "@/lib/prs-db";
import { useQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useMemo } from "react";

type RepositoryStacks = ReadonlyArray<{
  readonly repo: string;
  readonly stacks: ReadonlyArray<PullStack>;
}>;

/** Stack key (`owner/repo#stack`) to the position of its lowest layer closed without merging. */
export type StackCutoffs = ReadonlyMap<string, number>;

const isOpenState = (state: string | undefined, merged = false) =>
  !merged && (state == null || state.toLowerCase() === "open");

/** Closed without merging: the layers above it lost their base. */
const isAbandoned = (state: string | undefined, merged = false) =>
  !merged && state?.toLowerCase() === "closed";

const stackKey = (repo: string, number: number) => `${repo}#${number}`;

/**
 * Attach GitHub's native stack metadata and hide every open layer above a
 * layer that was closed without merging. A merged layer is the normal life of
 * a stack and hides nothing. The closed layer itself stays, so the history
 * view still shows what happened.
 */
export function applyNativeStacks(
  items: ReadonlyArray<Ranked>,
  repositories: RepositoryStacks,
): ReadonlyArray<Ranked> {
  const index = new Map<string, NonNullable<Ranked["stack"]>>();
  const hidden = new Set<string>();
  for (const { repo, stacks } of repositories)
    for (const st of stacks) {
      const cutoff = st.pull_requests.findIndex((pr) => isAbandoned(pr.state, !!pr.merged_at));
      st.pull_requests.forEach((pr, i) => {
        const id = prId(repo, pr.number);
        index.set(id, {
          number: st.number,
          position: i + 1,
          size: st.pull_requests.length,
          base: st.base.ref,
        });
        if (cutoff >= 0 && i > cutoff && isOpenState(pr.state, !!pr.merged_at)) hidden.add(id);
      });
    }
  return items.flatMap((item) => {
    if (hidden.has(item.id)) return [];
    const stack = index.get(item.id);
    return [stack ? { ...item, stack } : item];
  });
}

/**
 * The native list already carries stack membership from SQLite. `cutoffs`
 * comes from the complete mirror, because the open queue on screen never
 * holds the closed layer itself; rows on screen add what they know.
 */
export function applyPersistedStacks(
  items: ReadonlyArray<Ranked>,
  cutoffs?: StackCutoffs,
): ReadonlyArray<Ranked> {
  const cut = new Map<string, number>(cutoffs ?? []);
  for (const item of items) {
    if (!item.stack || !isAbandoned(item.state, !!item.merged)) continue;
    const key = stackKey(item.repo, item.stack.number);
    cut.set(key, Math.min(cut.get(key) ?? Infinity, item.stack.position));
  }
  return items.filter((item) => {
    if (!item.stack || !isOpenState(item.state, !!item.merged)) return true;
    const cutoff = cut.get(stackKey(item.repo, item.stack.number));
    return cutoff === undefined || item.stack.position <= cutoff;
  });
}

/**
 * Put stack-enriched rows back into an Inbox queue. Missing rows were hidden
 * deliberately by the stack policy and must not be restored as standalones.
 */
export function reconcileStackItems(
  source: ReadonlyArray<Ranked>,
  visible: ReadonlyArray<Ranked>,
): ReadonlyArray<Ranked> {
  const byId = new Map(visible.map((item) => [item.id, item]));
  return source.flatMap((item) => {
    const replacement = byId.get(item.id);
    return replacement ? [replacement] : [];
  });
}

/**
 * Which pull requests in a list are layers of a stack. One call per
 * repository present, from GitHub's own stacks, never guessed from branches;
 * the rows then carry "2/4" and the filter can keep only stacked ones.
 */
export function useWithStacks(items: ReadonlyArray<Ranked>): ReadonlyArray<Ranked> {
  const native = hasBackend();
  const repos = useMemo(
    () => [...new Set(items.filter((i) => i.kind === "pr" && i.number).map((i) => i.repo))].sort(),
    [items],
  );
  const q = useEffectQuery(
    ["stacks", repos],
    Effect.forEach(
      repos,
      (full) => {
        const s = splitRepo(full);
        return s
          ? Effect.flatMap(GitHub, (g) => g.repoStacks(s.owner, s.repo)).pipe(
              Effect.map((stacks) => ({ repo: full, stacks })),
              Effect.orElseSucceed(() => ({ repo: full, stacks: [] })),
            )
          : Effect.succeed({ repo: full, stacks: [] });
      },
      { concurrency: 3 },
    ),
    { enabled: !native && repos.length > 0, staleTime: 2 * 60_000 },
  );
  const cutoffs = useQuery({
    queryKey: ["prs", "stack-cutoffs", repos],
    queryFn: () => readStackCutoffs(repos),
    enabled: native && repos.length > 0,
    staleTime: 60_000,
  });
  return useMemo(() => {
    if (native) return applyPersistedStacks(items, cutoffs.data);
    if (!q.data) return items;
    return applyNativeStacks(items, q.data);
  }, [items, native, cutoffs.data, q.data]);
}
