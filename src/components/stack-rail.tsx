import type { PrState } from "@/components/pr-row";
import { TooltipFor } from "@/components/tooltip-for";
import { buildStack, detailToSummary } from "@/lib/stack";
import type { PullDetail, PullSummary } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { useMemo } from "react";

const STATE_DOT: Record<PrState, string> = {
  open: "bg-success",
  draft: "bg-muted-foreground",
  merged: "bg-primary",
  closed: "bg-destructive",
};

/**
 * A horizontal "subway line" of the PR stack the current PR belongs to,
 * bottom-of-stack (closest to the default branch) on the left → tip on the
 * right. Renders nothing unless the PR is part of a stack. Click a node to
 * jump to that PR.
 */
export function StackRail({
  owner,
  repo,
  current,
}: {
  owner: string;
  repo: string;
  current: PullDetail;
}) {
  const navigate = useNavigate();

  const repoPulls = useQuery({
    queryKey: ["repo-pulls", owner, repo],
    queryFn: () => invoke<PullSummary[]>("gh_list_repo_pulls", { owner, repo }),
    staleTime: 5 * 60_000,
    // Stacks are an open-PR workflow — don't fetch the repo's PR list just to
    // render a rail for a closed/merged PR (where it's almost never shown).
    enabled: current.state === "open",
  });

  const chain = useMemo(() => {
    const list = repoPulls.data ?? [];
    const withCurrent = list.some((p) => p.number === current.number)
      ? list
      : [...list, detailToSummary(current)];
    return buildStack(withCurrent, current.number);
  }, [repoPulls.data, current]);

  if (chain.length < 2) return null;

  const pos = chain.findIndex((e) => e.isCurrent) + 1;

  return (
    <div className="flex items-center gap-3 border-b border-hairline px-6 py-2">
      <TooltipFor label="Stacked PRs — merge bottom-up, left to right">
        <span className="inline-flex shrink-0 cursor-default items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Layers className="size-3.5" strokeWidth={1.5} />
          Stack
          <span className="rounded-full bg-foreground/[0.06] px-1.5 py-px text-[10px] tabular-nums text-muted-foreground/80">
            {pos}/{chain.length}
          </span>
        </span>
      </TooltipFor>

      <div className="flex min-w-0 flex-1 items-center overflow-x-auto py-0.5">
        {chain.map((e, i) => (
          <div key={e.number} className="flex shrink-0 items-center">
            {i > 0 && <span className="h-px w-4 shrink-0 bg-border" aria-hidden />}
            <TooltipFor label={e.title}>
              <button
                type="button"
                disabled={e.isCurrent}
                onClick={() =>
                  navigate({
                    to: "/prs/$owner/$repo/$number",
                    params: { owner, repo, number: String(e.number) },
                  })
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  e.isCurrent
                    ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:bg-foreground/[0.04] hover:text-foreground",
                )}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", STATE_DOT[e.state])} />
                <span className="tabular-nums">#{e.number}</span>
              </button>
            </TooltipFor>
          </div>
        ))}
      </div>
    </div>
  );
}
