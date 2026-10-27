import { isNative } from "@/effect/Tauri";
import { useEffectQuery } from "@/effect/runtime";
import type { PullStack } from "@/effect/schema";
import { GitHub, splitRepo } from "@/effect/services/GitHub";
import { prId } from "@/effect/services/Inbox";
import type { Ranked } from "@/effect/services/Triage";
import { Effect } from "effect";
import { useMemo } from "react";

type RepositoryStacks = ReadonlyArray<{
  readonly repo: string;
  readonly stacks: ReadonlyArray<PullStack>;
}>;

const isOpenState = (state: string | undefined, merged = false) =>
  !merged && (state == null || state.toLowerCase() === "open");

/**
 * Attach GitHub's native stack metadata and suppress a stack whose foundation
 * is no longer open or is absent from the loaded queue. A dependent layer
 * must never be presented without layer 1.
 */
export function applyNativeStacks(
  items: ReadonlyArray<Ranked>,
  repositories: RepositoryStacks,
): ReadonlyArray<Ranked> {
  const index = new Map<string, NonNullable<Ranked["stack"]>>();
  const hidden = new Set<string>();
  const present = new Set(items.map((item) => item.id));
  for (const { repo, stacks } of repositories)
    for (const st of stacks) {
      const foundation = st.pull_requests[0];
      const foundationId = foundation ? prId(repo, foundation.number) : null;
      if (
        !foundation ||
        !isOpenState(foundation.state, !!foundation.merged_at) ||
        !foundationId ||
        !present.has(foundationId)
      ) {
        for (const pr of st.pull_requests) hidden.add(prId(repo, pr.number));
        continue;
      }
      st.pull_requests.forEach((pr, i) =>
        index.set(prId(repo, pr.number), {
          number: st.number,
          position: i + 1,
          size: st.pull_requests.length,
          base: st.base.ref,
        }),
      );
    }
  return items.flatMap((item) => {
    if (hidden.has(item.id)) return [];
    const stack = index.get(item.id);
    return [stack ? { ...item, stack } : item];
  });
}

/**
 * The native list already carries stack membership from SQLite. Hide dependent
 * layers when layer 1 is not in the current queue, matching the GitHub graph
 * behavior without another network request.
 */
export function applyPersistedStacks(items: ReadonlyArray<Ranked>): ReadonlyArray<Ranked> {
  const foundations = new Set<string>();
  const stacked = new Map<string, string>();
  for (const item of items) {
    if (!item.stack) continue;
    const key = `${item.repo}#${item.stack.number}`;
    stacked.set(item.id, key);
    if (item.stack.position === 1 && isOpenState(item.state, !!item.merged)) foundations.add(key);
  }
  return items.filter((item) => {
    const key = stacked.get(item.id);
    return !key || foundations.has(key);
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
  const native = isNative();
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
  return useMemo(() => {
    if (native) return applyPersistedStacks(items);
    if (!q.data) return items;
    return applyNativeStacks(items, q.data);
  }, [items, native, q.data]);
}
