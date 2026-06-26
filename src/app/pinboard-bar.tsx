import { TooltipFor } from "@/components/tooltip-for";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { PullDetail } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
  type PinnedItem,
  type PinnedKind,
  type PinnedPrState,
  usePinboard,
} from "@/stores/pinboard";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { FileDiff, GitCommit, GitPullRequest, Pin, Trash2, X } from "lucide-react";
import type { ComponentType } from "react";

const ICON: Record<PinnedKind, ComponentType<{ className?: string }>> = {
  pr: GitPullRequest,
  commit: GitCommit,
  file: FileDiff,
};

const TONE: Record<PinnedKind, string> = {
  pr: "text-muted-foreground",
  commit: "text-info",
  file: "text-muted-foreground",
};

const PR_STATE_TONE: Record<PinnedPrState, string> = {
  open: "text-[#3fb950]",
  draft: "text-[#8b949e]",
  merged: "text-[#a371f7]",
  closed: "text-[#f85149]",
};

function prStateFromDetail(detail?: PullDetail): PinnedPrState | undefined {
  if (!detail) return undefined;
  if (detail.merged) return "merged";
  if (detail.state === "closed") return "closed";
  if (detail.draft) return "draft";
  return "open";
}

function cachedPrState(item: PinnedItem, queryClient: ReturnType<typeof useQueryClient>) {
  if (item.kind !== "pr") return undefined;
  const match = /^([^/]+)\/([^#]+)#(\d+)$/.exec(item.id);
  if (!match) return undefined;
  const [, owner, repo, rawNumber] = match;
  return prStateFromDetail(
    queryClient.getQueryData<PullDetail>(["pull", owner, repo, Number(rawNumber)]),
  );
}

export function PinboardBar() {
  const items = usePinboard((s) => s.items);
  const unpin = usePinboard((s) => s.unpin);
  const clear = usePinboard((s) => s.clear);
  const { location } = useRouterState();
  const queryClient = useQueryClient();

  if (items.length === 0) return null;

  return (
    <div className="group/pinbar border-t border-hairline bg-background/95 shadow-[0_-1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      <div className="flex h-8 items-center gap-2 px-2.5">
        <div className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-border/35 bg-foreground/[0.035] px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
          <Pin className="size-3" />
          <span>{items.length}</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <ScrollArea className="min-w-0">
            <div className="flex items-center gap-1.5 py-1">
              {items
                .slice()
                .sort((a, b) => b.pinnedAt - a.pinnedAt)
                .map((item) => {
                  const Icon = ICON[item.kind];
                  const active = location.pathname === item.path;
                  const prState = cachedPrState(item, queryClient) ?? item.prState;
                  const iconTone = prState ? PR_STATE_TONE[prState] : TONE[item.kind];
                  return (
                    <div key={`${item.kind}:${item.id}`} className="group relative">
                      <Link
                        to={item.path}
                        className={cn(
                          "relative inline-flex h-5 max-w-[300px] items-center gap-1.5 overflow-hidden rounded-md border px-2 pr-2 text-xs transition-[border-color,background-color,color,padding] group-hover:pr-6",
                          active
                            ? "border-border/65 bg-foreground/[0.07] text-foreground"
                            : "border-border/35 bg-foreground/[0.025] text-muted-foreground hover:border-border/60 hover:bg-foreground/[0.055] hover:text-foreground",
                        )}
                      >
                        <Icon className={cn("size-3 shrink-0", iconTone)} />
                        <span className="shrink-0 text-[11px] font-medium text-foreground">
                          {item.label}
                        </span>
                        {item.hint && (
                          <span className="truncate text-[11px] text-muted-foreground/75">
                            {item.hint}
                          </span>
                        )}
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          unpin(item.kind, item.id);
                        }}
                        className="absolute right-1 top-1/2 flex size-3.5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/55 opacity-0 transition-opacity hover:bg-foreground/[0.08] hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                        aria-label="Unpin"
                      >
                        <X className="size-2.5" />
                      </button>
                    </div>
                  );
                })}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
        <TooltipFor label="Clear pinned">
          <button
            type="button"
            onClick={clear}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-[background-color,color,opacity] hover:bg-foreground/[0.055] hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 group-hover/pinbar:opacity-100"
            aria-label="Clear pinned"
          >
            <Trash2 className="size-3" />
          </button>
        </TooltipFor>
      </div>
    </div>
  );
}
