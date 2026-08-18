import { TooltipFor } from "@/components/tooltip-for";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { buildLayerContext } from "@/lib/ai/context";
import { LAYERED_SYSTEM } from "@/lib/ai/prompts";
import { useAiAvailable } from "@/lib/ai/use-ai-available";
import {
  type LayerPlan,
  type LayerRisk,
  type LayerStats,
  RISK_LABEL,
  type ReviewLayer,
  heuristicLayers,
  isPlanStale,
  layerStats,
  layersKey,
  reconcileLayers,
} from "@/lib/layers";
import { type Workspace, buildPackagePlan } from "@/lib/monorepo";
import type { PullFile } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL, aiInvokeArgs, useAiProvider } from "@/stores/ai";
import { useLayers } from "@/stores/layers";
import { useLayersGen } from "@/stores/layers-gen";
import { useLocalRepos } from "@/stores/local-repos";
import { useReviewPrefs } from "@/stores/review-prefs";
import { useViewedFiles } from "@/stores/viewed-files";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Check,
  Layers,
  RefreshCw,
  SplitSquareVertical,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

/** Everything the review screen needs to scope itself to one layer. */
export interface LayerScope {
  /** Plan reconciled against the PR's current files, or null when there is none. */
  plan: LayerPlan | null;
  /** The layer being read. */
  active: ReviewLayer | null;
  /** Position of `active` in the plan. */
  index: number;
  /** Per-layer size + read progress, aligned with `plan.layers`. */
  stats: LayerStats[];
  /** The active layer's files — what the file tree and `[` / `]` are limited to. */
  scopedFiles: PullFile[];
  /** Jump to a layer. */
  select: (layerId: string) => void;
  /** Move to the next layer that still has unread files (wrapping); null when
   * every layer is read. Reads progress fresh from the store, so it's correct
   * immediately after marking files viewed. */
  advance: () => ReviewLayer | null;
  /** The plan was made against an older head — new commits have landed since. */
  stale: boolean;
}

const EMPTY: LayerScope = {
  plan: null,
  active: null,
  index: -1,
  stats: [],
  scopedFiles: [],
  select: () => {},
  advance: () => null,
  stale: false,
};

/**
 * Bind the stored layer plan to the PR in front of the reviewer.
 *
 * Reconciliation happens HERE, on every read, rather than once at generation:
 * the PR keeps moving (new commits, dropped files) and a plan that silently
 * stopped covering some files would quietly hide them from the review.
 */
export function useLayerScope({
  prKey,
  files,
  enabled,
  headSha,
  viewedKey,
}: {
  prKey: string;
  files: PullFile[];
  /** False in the other review modes — the scope collapses to "everything". */
  enabled: boolean;
  headSha?: string;
  viewedKey: string | null;
}): LayerScope {
  const entry = useLayers((s) => s.byPr[prKey]);
  const setActive = useLayers((s) => s.setActive);
  const viewed = useViewedFiles((s) => (viewedKey ? s.viewed[viewedKey] : undefined));

  const plan = useMemo(
    () => (enabled && entry && files.length > 0 ? reconcileLayers(entry.plan, files) : null),
    [enabled, entry, files],
  );

  const select = useCallback((layerId: string) => setActive(prKey, layerId), [prKey, setActive]);

  const advance = useCallback((): ReviewLayer | null => {
    if (!plan) return null;
    // Fresh progress: the caller has usually just marked a layer's files viewed,
    // and this render's snapshot still shows them unread.
    const fresh = viewedKey ? useViewedFiles.getState().viewed[viewedKey] : undefined;
    const from = Math.max(
      0,
      plan.layers.findIndex((l) => l.id === useLayers.getState().byPr[prKey]?.active),
    );
    for (let step = 1; step <= plan.layers.length; step++) {
      const layer = plan.layers[(from + step) % plan.layers.length];
      if (!layerStats(layer, files, fresh).done) {
        setActive(prKey, layer.id);
        return layer;
      }
    }
    return null;
  }, [plan, prKey, files, viewedKey, setActive]);

  const stats = useMemo(
    () => (plan ? plan.layers.map((l) => layerStats(l, files, viewed)) : []),
    [plan, files, viewed],
  );

  // Memoized as a whole: the review screen puts this object in effect deps
  // (keyboard nav is layer-aware), so a fresh identity every render would
  // re-subscribe the window listeners on every keystroke.
  return useMemo(() => {
    if (!plan || plan.layers.length === 0) return EMPTY;
    // The stored active id can go missing when reconciliation drops a layer
    // whose files all left the PR — fall back to the first one rather than
    // showing none.
    const index = Math.max(
      0,
      plan.layers.findIndex((l) => l.id === entry?.active),
    );
    const active = plan.layers[index];
    const byPath = new Map(files.map((f) => [f.filename, f]));
    return {
      plan,
      active,
      index,
      stats,
      // The layer's own order — the planner puts what you should read first,
      // first — resolved against the PR's files.
      scopedFiles: active.files.map((p) => byPath.get(p)).filter((f): f is PullFile => !!f),
      select,
      advance,
      stale: !!headSha && !!entry?.headSha && entry.headSha !== headSha,
    };
  }, [plan, stats, files, headSha, entry?.active, entry?.headSha, select, advance]);
}

const RISK_CHIP: Record<LayerRisk, string> = {
  low: "text-muted-foreground bg-foreground/[0.06]",
  medium: "text-info bg-info/12",
  high: "text-warning bg-warning/12",
};

interface BarProps {
  scope: LayerScope;
  prKey: string;
  /** Self-contained PR context (metadata + diff) for the planner. */
  context: string;
  files: PullFile[];
  headSha?: string;
  viewedKey: string | null;
  /** Open a file in the diff pane (used when moving between layers). */
  onSelectFile: (path: string) => void;
}

/**
 * The layered-review controller: the strip above the diff that holds the layer
 * stepper, the briefing for the layer you're on, and the way into the next one.
 */
export function LayerBar(props: BarProps) {
  const { scope, prKey, files, headSha, viewedKey, onSelectFile } = props;
  // The PR's local clone, when one exists — detection reads the workspace from
  // disk, so without a clone there is nothing to detect.
  const localRepos = useLocalRepos((s) => s.repos);
  const cwd = useMemo(() => {
    const [owner, repo] = prKey.split("#")[0].split("/");
    return localRepos.find((r) => r.owner === owner && r.repo === repo)?.path ?? null;
  }, [prKey, localRepos]);
  const provider = useAiProvider((s) => s.provider);
  const { available } = useAiAvailable();
  const aiInstructions = useReviewPrefs((s) => s.aiInstructions);
  const entry = useLayers((s) => s.byPr[prKey]);
  const pending = useLayersGen((s) => !!s.inFlight[prKey]);
  const error = useLayersGen((s) => s.error[prKey]);
  const setViewed = useViewedFiles((s) => s.setViewed);
  const aiName = PROVIDER_LABEL[provider];

  // Recover the "planning" state when a background run for this PR is still
  // going after navigating away or refreshing (the Rust task outlives both).
  useEffect(() => {
    invoke<string[]>("ai_inflight")
      .then((keys) => {
        if (keys.includes(layersKey(prKey))) useLayersGen.getState().start(prKey);
      })
      .catch(() => {});
  }, [prKey]);

  const planWithAi = useCallback(() => {
    const custom = aiInstructions.trim()
      ? `\n\n# Reviewer's instructions\n${aiInstructions.trim()}`
      : "";
    useLayersGen.getState().start(prKey);
    invoke("ai_review_bg", {
      key: layersKey(prKey),
      ...aiInvokeArgs(),
      headSha: headSha ?? "",
      // Deliberately no clone: layering only needs the diff and the file list,
      // and handing the agent a checkout turns a ~20s call into a multi-minute
      // agentic run for a plan that wouldn't get better.
      cwd: null,
      prompt: `${LAYERED_SYSTEM}${custom}\n\n# Pull request\n${buildLayerContext(props.context, files)}`,
    }).catch((e) => useLayersGen.getState().fail(prKey, String(e)));
  }, [prKey, headSha, aiInstructions, props.context, files]);

  // Is this repo's local clone a Turborepo? Silent when it isn't: the query
  // returns null and the by-package split simply never appears.
  const workspace = useQuery({
    queryKey: ["monorepo-workspace", cwd],
    queryFn: () => invoke<Workspace | null>("monorepo_workspace", { path: cwd ?? "" }),
    enabled: !!cwd,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const ws = workspace.data ?? null;

  const splitByPackage = useCallback(() => {
    if (!ws) return;
    useLayers
      .getState()
      .set(prKey, buildPackagePlan(files, ws), { headSha: headSha ?? "", source: "turborepo" });
    useLayersGen.getState().clear(prKey);
  }, [prKey, files, headSha, ws]);

  const splitByStructure = useCallback(() => {
    useLayers
      .getState()
      .set(prKey, heuristicLayers(files), { headSha: headSha ?? "", source: "structure" });
    useLayersGen.getState().clear(prKey);
  }, [prKey, files, headSha]);

  const cancel = useCallback(() => {
    invoke("ai_cancel", { key: layersKey(prKey) }).catch(() => {});
    useLayersGen.getState().done(prKey);
  }, [prKey]);

  /** Move to `layer` and open the first file in it the reviewer hasn't read. */
  const enterLayer = useCallback(
    (layer: ReviewLayer) => {
      scope.select(layer.id);
      const viewed = viewedKey ? useViewedFiles.getState().viewed[viewedKey] : undefined;
      const next = layer.files.find((p) => !viewed?.[p]) ?? layer.files[0];
      if (next) onSelectFile(next);
    },
    [scope, viewedKey, onSelectFile],
  );

  /** Mark every file in the current layer viewed, then move on. */
  const completeLayer = useCallback(() => {
    const layer = scope.active;
    if (!layer) return;
    if (viewedKey) {
      for (const path of layer.files) setViewed(viewedKey, path, true);
    }
    const next = scope.advance();
    if (next) {
      enterLayer(next);
      toast.success(`${layer.title} done`, { description: `Next: ${next.title}` });
    } else {
      toast.success("Every layer read", { description: "Open Submit to finish your review" });
    }
  }, [scope, viewedKey, setViewed, enterLayer]);

  const canUseAi = available !== false;

  if (pending) {
    return (
      <Shell>
        <div className="flex items-center gap-2.5">
          <Spinner className="size-3.5 text-muted-foreground" />
          <span className="text-xs text-foreground">
            {aiName} is splitting this PR into layers…
          </span>
          <span className="text-xs text-muted-foreground">
            {files.length} files · runs in the background
          </span>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={cancel}>
            <X className="size-3.5" />
            Stop
          </Button>
        </div>
      </Shell>
    );
  }

  if (!scope.plan) {
    return (
      <Shell>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {error ? "Couldn't split this PR" : "Review this PR in layers"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {error ||
                `Cut ${files.length} changed files into a few coherent slices and read them in dependency order.`}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {ws && (
              <TooltipFor label="Layers from the repo's own package graph, in dependency order">
                <Button size="sm" variant="outline" onClick={splitByPackage}>
                  <Boxes className="size-3.5" />
                  Split by package
                </Button>
              </TooltipFor>
            )}
            <Button size="sm" variant="outline" onClick={splitByStructure}>
              <SplitSquareVertical className="size-3.5" />
              Split by structure
            </Button>
            <TooltipFor
              label={
                canUseAi
                  ? `${aiName} groups the files by what they actually do`
                  : `${aiName} isn't available — set it up in Settings → AI review`
              }
            >
              <Button size="sm" disabled={!canUseAi} onClick={planWithAi}>
                <Layers className="size-3.5" />
                {error ? "Try again" : `Plan with ${aiName}`}
              </Button>
            </TooltipFor>
          </div>
        </div>
      </Shell>
    );
  }

  const { plan, active, index, stats } = scope;
  const activeStats = stats[index];
  const remaining = stats.filter((s) => !s.done).length;
  // The plan stopped describing this PR: everything ended up in the catch-all.
  const unusable = isPlanStale(plan);

  return (
    <Shell>
      <div className="flex items-center gap-2.5">
        <Layers className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Layered review</span>
        <span className="text-xs text-muted-foreground">
          Layer {index + 1} of {plan.layers.length}
          {remaining === 0 ? " · all read" : ` · ${remaining} left`}
          {entry?.source === "structure"
            ? " · structural split"
            : entry?.source === "turborepo"
              ? " · by package"
              : ""}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {(entry?.source === "structure" || entry?.source === "turborepo") && canUseAi && (
            <TooltipFor label="Replace the structural split with a semantic one">
              <Button size="xs" variant="ghost" onClick={planWithAi}>
                Plan with {aiName}
              </Button>
            </TooltipFor>
          )}
          <TooltipFor label="Split this PR again">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Re-split this PR"
              onClick={
                entry?.source === "turborepo"
                  ? splitByPackage
                  : entry?.source === "structure"
                    ? splitByStructure
                    : planWithAi
              }
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </TooltipFor>
        </div>
      </div>

      {(scope.stale || unusable) && (
        <div className="mt-2 flex items-center gap-2 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0">
            {unusable
              ? "This plan no longer matches the PR's files."
              : "New commits have landed since this split."}
          </span>
          <button
            type="button"
            onClick={
              entry?.source === "turborepo"
                ? splitByPackage
                : entry?.source === "structure"
                  ? splitByStructure
                  : planWithAi
            }
            className="ml-auto shrink-0 underline underline-offset-2 hover:no-underline"
          >
            Split again
          </button>
        </div>
      )}

      {/* Stepper — the whole PR at a glance, and the way to move between slices. */}
      <div className="-mx-1 mt-2 flex items-center gap-0.5 overflow-x-auto px-1 pb-0.5">
        {plan.layers.map((layer, i) => {
          const s = stats[i];
          const isActive = i === index;
          return (
            <button
              key={layer.id}
              type="button"
              onClick={() => enterLayer(layer)}
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors",
                isActive
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] tabular-nums",
                  s.done
                    ? "bg-success/15 text-success"
                    : isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground/[0.08] text-muted-foreground",
                )}
              >
                {s.done ? <Check className="size-2.5" /> : i + 1}
              </span>
              <span className="max-w-[11rem] truncate">{layer.title}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground/70">
                {s.viewed}/{s.files}
              </span>
            </button>
          );
        })}
      </div>

      {/* Briefing for the layer in front of the reviewer. */}
      {active && (
        <div className="mt-2 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-xs font-medium text-foreground">{active.title}</h3>
              <span
                className={cn(
                  "rounded px-1.5 py-px text-[10px] font-medium",
                  RISK_CHIP[active.risk],
                )}
              >
                {RISK_LABEL[active.risk]}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {activeStats.files} file{activeStats.files === 1 ? "" : "s"}
                {" · "}
                <span className="text-success">+{activeStats.additions}</span>{" "}
                <span className="text-destructive">−{activeStats.deletions}</span>
              </span>
            </div>
            {active.intent && (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {active.intent}
              </p>
            )}
            {active.focus.length > 0 && (
              <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {active.focus.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground"
                  >
                    <span className="size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button
            size="sm"
            variant={activeStats.done ? "outline" : "default"}
            onClick={completeLayer}
          >
            {activeStats.done ? "Next layer" : "Mark layer reviewed"}
          </Button>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="border-b border-hairline px-5 py-2.5">{children}</div>;
}
