import { useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { Layers } from "lucide-react";
import { useCallback, useMemo } from "react";

/**
 * GitHub's native stack, as GitHub keeps it: an ordered series of pull
 * requests where each one's base is the head of the one below. Read from the
 * stacks API, never guessed from branch names.
 */
export function useStack(prRef: PrRef) {
  const navigate = useNavigate();
  const q = useEffectQuery(
    ["stack", prRef.owner, prRef.repo, prRef.number],
    Effect.flatMap(GitHub, (g) => g.stack(prRef)),
    { staleTime: 60_000 },
  );
  const stack = q.data ?? null;
  const layers = stack?.pull_requests ?? [];
  const index = layers.findIndex((l) => l.number === prRef.number);
  const go = useCallback(
    (number: number) =>
      void navigate({
        to: "/pr/$owner/$repo/$number",
        params: { owner: prRef.owner, repo: prRef.repo, number: String(number) },
      }),
    [navigate, prRef.owner, prRef.repo],
  );
  /** `}` goes up the stack (the layer built on this one), `{` down (what this one builds on). */
  const step = useCallback(
    (d: 1 | -1) => {
      const next = layers[index + d];
      if (next) go(next.number);
    },
    [layers, index, go],
  );
  return useMemo(
    () => ({ stack, layers, index, go, step, loading: q.isPending }),
    [stack, layers, index, go, step, q.isPending],
  );
}
export type Stack = ReturnType<typeof useStack>;

const layerState = (l: S.StackLayer) =>
  l.merged_at ? "merged" : l.state === "closed" ? "closed" : l.draft ? "draft" : "open";

/**
 * One line under the meta: where this layer sits, and every other layer as a
 * chip you can click. Bottom of the stack on the left, the way it lands.
 */
export function StackLine({ s }: { s: Stack }) {
  if (!s.stack || s.layers.length < 2) return null;
  const total = s.layers.length;
  const below = s.layers.slice(0, Math.max(0, s.index)).filter((l) => !l.merged_at).length;
  return (
    <div className="pr-meta-control">
      <span className="pr-meta-label">Stack</span>
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <Layers className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span>
          layer <span className="tnum">{s.index + 1}</span> of <span className="tnum">{total}</span>{" "}
          onto <span className="mono">{s.stack.base.ref}</span>
          {below ? `, ${below} unmerged below` : ""}
        </span>
      </span>
      <span className="flex items-center gap-1" role="group" aria-label="Layers">
        {s.layers.map((l, i) => {
          const st = layerState(l);
          const here = i === s.index;
          return (
            <button
              key={l.number}
              type="button"
              aria-current={here ? "page" : undefined}
              disabled={here}
              onClick={() => s.go(l.number)}
              title={`#${l.number} · ${l.head?.ref ?? ""} · ${st} · { } move down and up`}
              className={cn(
                "tnum flex h-5 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px]",
                here
                  ? "bg-raise text-ink"
                  : st === "merged" || st === "closed"
                    ? "text-ink-3 hover:bg-raise/50"
                    : "text-ink-2 hover:bg-raise/50 hover:text-ink",
              )}
            >
              #{l.number}
              {st !== "open" ? <span className="text-[10.5px] text-ink-3">{st}</span> : null}
            </button>
          );
        })}
      </span>
    </div>
  );
}
