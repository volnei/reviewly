import { TooltipFor } from "@/components/tooltip-for";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { type PinnedKind, usePinboard } from "@/stores/pinboard";
import { Link, useRouterState } from "@tanstack/react-router";
import { FileDiff, GitCommit, GitPullRequest, Pin, X } from "lucide-react";
import type { ComponentType } from "react";

const ICON: Record<PinnedKind, ComponentType<{ className?: string }>> = {
  pr: GitPullRequest,
  commit: GitCommit,
  file: FileDiff,
};

const TONE: Record<PinnedKind, string> = {
  pr: "text-primary",
  commit: "text-info",
  file: "text-muted-foreground",
};

export function PinboardBar() {
  const items = usePinboard((s) => s.items);
  const unpin = usePinboard((s) => s.unpin);
  const clear = usePinboard((s) => s.clear);
  const { location } = useRouterState();

  if (items.length === 0) return null;

  return (
    <div className="border-t border-hairline bg-card/40 backdrop-blur-md">
      <div className="flex h-9 items-center gap-2 px-3">
        <Pin className="size-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground shrink-0">Pinned</span>
        <ScrollArea className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 py-1">
            {items
              .slice()
              .sort((a, b) => b.pinnedAt - a.pinnedAt)
              .map((item) => {
                const Icon = ICON[item.kind];
                const active = location.pathname === item.path;
                return (
                  <div key={`${item.kind}:${item.id}`} className="group relative">
                    <Link
                      to={item.path}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 pr-2 text-xs transition-[background-color,color,padding] max-w-[280px] group-hover:pr-6",
                        active
                          ? "bg-primary/20 text-foreground ring-1 ring-primary/30"
                          : "bg-foreground/[0.04] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("size-3 shrink-0", TONE[item.kind])} />
                      <span className="text-xs font-medium text-foreground shrink-0">
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="truncate text-muted-foreground">{item.hint}</span>
                      )}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        unpin(item.kind, item.id);
                      }}
                      className="absolute right-1 top-1/2 -translate-y-1/2 flex size-4 items-center justify-center rounded text-muted-foreground/50 opacity-0 hover:bg-foreground/[0.08] hover:text-destructive group-hover:opacity-100 transition-opacity"
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
        <TooltipFor label="Clear pinned">
          <button
            type="button"
            onClick={clear}
            className="ml-1 shrink-0 inline-flex h-5 items-center rounded px-1.5 text-xs text-muted-foreground/60 hover:text-destructive hover:bg-foreground/[0.04] transition-colors"
          >
            clear
          </button>
        </TooltipFor>
      </div>
    </div>
  );
}
