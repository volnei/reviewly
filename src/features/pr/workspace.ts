import { useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import type { Workspace } from "@/lib/monorepo";
import { Effect } from "effect";

/**
 * The Turborepo workspace of a clone, when it is one: its packages and the
 * edges between them. Null for any other repository, and without a clone.
 */
export function useWorkspace(clone: string | null): Workspace | null {
  const q = useEffectQuery(
    ["workspace", clone ?? ""],
    Effect.flatMap(Git, (g) => g.workspace(clone ?? "")),
    { enabled: !!clone, staleTime: 5 * 60_000, retry: false },
  );
  return (q.data as Workspace | null | undefined) ?? null;
}
