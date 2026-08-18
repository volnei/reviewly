import { PopoverPanel } from "@/components/popover";
import { TooltipFor } from "@/components/tooltip-for";
import {
  type BoundaryCrossing,
  type Workspace,
  boundaryCrossings,
  buildPackagePlan,
  dependentsOf,
  findCycles,
  ownerOf,
} from "@/lib/monorepo";
import type { PullFile } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useLayers } from "@/stores/layers";
import { useUi } from "@/stores/ui";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, Layers } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * What this PR does to the monorepo — the answers the diff cannot give.
 *
 * Renders nothing unless the PR's local clone is a Turborepo, so every other
 * repo pays zero pixels. When it is one, a toolbar button carries a count of
 * findings (dependency cycles + boundary crossings in this diff) and opens a
 * panel with: touched packages and their blast radius, workspace dependency
 * cycles, and each added import that reaches into another package's internals —
 * clickable, straight to the offending line.
 */
export function TurboInsights({
  clonePath,
  prKey,
  headSha,
  files,
  onOpenFile,
}: {
  clonePath: string;
  prKey: string;
  headSha?: string;
  files: PullFile[];
  /** Jump the diff to a file + new-file line. */
  onOpenFile: (path: string, line?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const setView = useUi((s) => s.setDiffView);

  const workspace = useQuery({
    queryKey: ["monorepo-workspace", clonePath],
    queryFn: () => invoke<Workspace | null>("monorepo_workspace", { path: clonePath }),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const ws = workspace.data ?? null;

  const insights = useMemo(() => {
    if (!ws || files.length === 0) return null;
    const touched = new Set<string>();
    for (const f of files) {
      const owner = ownerOf(f.filename, ws);
      if (owner !== null) touched.add(owner);
    }
    return {
      touched: [...touched].sort(),
      blast: [...dependentsOf(touched, ws)].sort(),
      cycles: findCycles(ws),
      crossings: boundaryCrossings(files, ws),
    };
  }, [ws, files]);

  if (!ws || !insights) return null;

  const findings = insights.cycles.length + insights.crossings.length;

  const reviewByPackage = () => {
    useLayers
      .getState()
      .set(prKey, buildPackagePlan(files, ws), { headSha: headSha ?? "", source: "turborepo" });
    setView("layered");
    setOpen(false);
    toast.success("Layers set from the package graph", {
      description: `${insights.touched.length} package${insights.touched.length === 1 ? "" : "s"} in dependency order`,
    });
  };

  return (
    <div className="relative">
      <TooltipFor
        label={
          findings > 0
            ? `Turborepo — ${findings} finding${findings === 1 ? "" : "s"} worth a look`
            : "Turborepo — what this PR affects"
        }
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Turborepo insights"
          aria-pressed={open}
          className={cn(
            "relative flex size-7 items-center justify-center rounded-md transition-colors",
            open
              ? "bg-foreground/[0.08] text-foreground"
              : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
          )}
        >
          <Boxes className="size-3.5" />
          {findings > 0 && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-1 text-[9px] font-medium leading-none text-white ring-2 ring-background tabular-nums">
              {findings > 9 ? "9+" : findings}
            </span>
          )}
        </button>
      </TooltipFor>

      {open && (
        <PopoverPanel onClose={() => setOpen(false)} width="w-96">
          <div className="px-2 pb-2 pt-1.5">
            <p className="text-xs font-medium text-foreground">
              Touches {insights.touched.length} of {ws.packages.length} packages
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {insights.blast.length === 0
                ? "Nothing else in the repo depends on them."
                : `${insights.blast.length} more depend on them: ${insights.blast.slice(0, 4).join(", ")}${insights.blast.length > 4 ? "…" : ""}`}
            </p>
            <button
              type="button"
              onClick={reviewByPackage}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.06] px-2 py-1 text-xs text-foreground transition-colors hover:bg-foreground/[0.1]"
            >
              <Layers className="size-3.5" />
              Review in dependency order
            </button>
          </div>

          <Section
            title={`Dependency cycles · ${insights.cycles.length}`}
            empty="No cycles in the workspace."
            items={insights.cycles}
            render={(cycle: string[]) => (
              <div className="flex min-w-0 items-center gap-1 text-xs text-warning">
                <AlertTriangle className="size-3 shrink-0" />
                <span className="truncate">{[...cycle, cycle[0]].join(" → ")}</span>
              </div>
            )}
          />

          <Section
            title={`Boundary crossings in this diff · ${insights.crossings.length}`}
            empty="No added import reaches into another package's internals."
            items={insights.crossings}
            render={(c: BoundaryCrossing) => (
              <button
                type="button"
                onClick={() => {
                  onOpenFile(c.file, c.line);
                  setOpen(false);
                }}
                className="group flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-foreground/[0.05]"
                title={`${c.file}:${c.line} imports ${c.spec}`}
              >
                <span className="truncate font-mono text-muted-foreground group-hover:text-foreground">
                  {c.file.split("/").pop()}:{c.line}
                </span>
                <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
                <span className="truncate text-warning">{c.target}</span>
              </button>
            )}
          />
        </PopoverPanel>
      )}
    </div>
  );
}

function Section<T>({
  title,
  empty,
  items,
  render,
}: {
  title: string;
  empty: string;
  items: T[];
  render: (item: T) => React.ReactNode;
}) {
  return (
    <div className="border-t border-hairline px-2 py-2">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
          {items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list, no reorder
            <div key={i}>{render(item)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
