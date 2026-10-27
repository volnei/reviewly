import type * as S from "@/effect/schema";
import { providerName } from "@/effect/services/Ai";
import {
  type LayerPlan,
  RISK_LABEL,
  type ReviewLayer,
  heuristicLayers,
  isPlanStale,
  layerStats,
  parseLayers,
  reconcileLayers,
} from "@/lib/layers";
import { buildPackagePlan } from "@/lib/monorepo";
import type { PullFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useCallback, useMemo, useState } from "react";
import {
  type PromptOpts,
  cancelBackground,
  layeredPrompt,
  startBackground,
  useBackgroundRun,
} from "./ai";
import { FileRow } from "./file-row";
import { forgetLayers, saveLayers, useLayersEntry } from "./plans-store";
import { useWorkspace } from "./workspace";

/**
 * Layered review: the PR cut into a handful of slices read in dependency
 * order. The plan comes from the model or from the paths alone, is kept per
 * PR, and is reconciled against the real file list every time it is read.
 */
export function useLayers(
  prKey: string,
  files: ReadonlyArray<S.PullFile>,
  context: string,
  opts: { headSha: string; cwd: string | null } & PromptOpts,
) {
  const entry = useLayersEntry(prKey);
  const key = `layers:${prKey}`;
  const run = useBackgroundRun(key);
  const [active, setActive] = useState<string | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const plan = useMemo(
    () => (entry ? reconcileLayers(entry.plan, [...files] as unknown as PullFile[]) : null),
    [entry, files],
  );
  const { headSha, cwd, instructions, hasClone } = opts;
  const workspace = useWorkspace(cwd);
  const planWithModel = useCallback(() => {
    if (!context) return;
    setShapeError(null);
    startBackground(
      key,
      layeredPrompt(context, files, { instructions, hasClone }),
      cwd,
      "Cutting it into layers",
      (text) => {
        const p = parseLayers(text);
        if (p) saveLayers(prKey, p, headSha, "model");
        else setShapeError("The model answered, but not in the shape asked. Try once more.");
      },
    );
  }, [key, context, files, cwd, instructions, hasClone, prKey, headSha]);
  const splitByStructure = useCallback(
    () =>
      saveLayers(prKey, heuristicLayers([...files] as unknown as PullFile[]), headSha, "structure"),
    [prKey, files, headSha],
  );
  /** The Turborepo's own graph: one layer per package, in dependency order. */
  const splitByPackage = useCallback(() => {
    if (!workspace) return;
    saveLayers(
      prKey,
      buildPackagePlan([...files] as unknown as PullFile[], workspace),
      headSha,
      "package",
    );
  }, [prKey, files, headSha, workspace]);
  const stale = !!entry && (entry.headSha !== headSha || (plan ? isPlanStale(plan) : false));
  return {
    plan,
    source: entry?.source ?? null,
    stale,
    running: run?.running ?? false,
    streamed: run?.text.length ?? 0,
    error: run?.error ?? shapeError,
    planWithModel,
    splitByStructure,
    splitByPackage,
    /** The clone is a Turborepo: a split by package is on offer. */
    workspace,
    cancel: () => cancelBackground(key),
    forget: () => forgetLayers(prKey),
    active: active ?? plan?.layers[0]?.id ?? null,
    setActive,
  };
}
export type Layers = ReturnType<typeof useLayers>;

/** The files in plan order, flat — what the read pane and j/k walk. */
export function orderByLayers(
  plan: LayerPlan,
  files: ReadonlyArray<S.PullFile>,
): ReadonlyArray<S.PullFile> {
  const byPath = new Map(files.map((f) => [f.filename, f]));
  return plan.layers.flatMap((l) => l.files.flatMap((p) => byPath.get(p) ?? []));
}

/** The files column in layer order: each slice, its progress, its files. */
export function LayersColumn({
  layers,
  files,
  viewed,
  threadsByPath,
  draftsByPath,
  current,
  onSelect,
  provider,
}: {
  layers: Layers;
  files: ReadonlyArray<S.PullFile>;
  viewed: ReadonlySet<string>;
  threadsByPath: ReadonlyMap<string, number>;
  draftsByPath: ReadonlyMap<string, number>;
  current: string | null;
  onSelect: (path: string) => void;
  provider: string;
}) {
  const name = providerName(provider);
  if (layers.running) {
    return (
      <div className="grid gap-2 px-4 pt-3 text-[12.5px] text-ink-2">
        <p className="flex items-center gap-2">
          <span className="ai-dot size-1.5 animate-pulse rounded-full" />
          Cutting it into layers with {name}…
        </p>
        <p className="tnum text-ink-3">{layers.streamed} characters so far</p>
        <button
          type="button"
          onClick={layers.cancel}
          className="h-7 w-fit rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
        >
          Stop
        </button>
      </div>
    );
  }
  if (!layers.plan) {
    return (
      <div className="grid gap-2 px-4 pt-3 text-[12.5px] text-ink-2">
        {layers.error ? <p className="text-del">{layers.error}</p> : null}
        <p>Read it in slices: foundations first, then what builds on them.</p>
        <button
          type="button"
          onClick={layers.splitByStructure}
          className="h-7 w-fit rounded-md border border-edge px-2.5 text-ink-2 hover:bg-raise hover:text-ink"
        >
          Split by structure
        </button>
        <p className="text-ink-3">Instant, from the paths alone.</p>
        {layers.workspace ? (
          <>
            <button
              type="button"
              onClick={layers.splitByPackage}
              className="h-7 w-fit rounded-md border border-edge px-2.5 text-ink-2 hover:bg-raise hover:text-ink"
            >
              Split by package
            </button>
            <p className="text-ink-3">
              From the Turborepo’s own graph in your clone, in dependency order.
            </p>
          </>
        ) : null}
        <button
          type="button"
          onClick={layers.planWithModel}
          className="ai-button h-7 w-fit px-3 font-medium"
        >
          Plan with {name}
        </button>
        <p className="text-ink-3">Reads the diff; one idea per layer.</p>
      </div>
    );
  }
  const viewedRec: Record<string, true> = {};
  for (const p of viewed) viewedRec[p] = true;
  const byPath = new Map(files.map((f) => [f.filename, f]));
  return (
    <div className="pb-2">
      {layers.stale ? (
        <div className="mx-4 mt-3 rounded-md bg-sink px-2.5 py-2 text-[12px] text-ink-2">
          The PR moved since this plan.{" "}
          <button
            type="button"
            onClick={
              layers.source === "structure"
                ? layers.splitByStructure
                : layers.source === "package"
                  ? layers.splitByPackage
                  : layers.planWithModel
            }
            className="text-ink underline decoration-ink-3 underline-offset-2"
          >
            Redo it
          </button>
        </div>
      ) : null}
      {layers.plan.layers.map((l, i) => (
        <LayerGroup
          key={l.id}
          layer={l}
          index={i}
          active={layers.active === l.id}
          stats={layerStats(l, [...files] as unknown as PullFile[], viewedRec)}
          onPick={() => {
            layers.setActive(l.id);
            if (l.files[0]) onSelect(l.files[0]);
          }}
        >
          {l.files.map((path) => {
            const f = byPath.get(path);
            if (!f) return null;
            return (
              <FileRow
                key={path}
                f={f}
                read={viewed.has(path)}
                threads={threadsByPath.get(path) ?? 0}
                drafts={draftsByPath.get(path) ?? 0}
                current={path === current}
                quiet={l.risk === "low"}
                onSelect={() => {
                  layers.setActive(l.id);
                  onSelect(path);
                }}
              />
            );
          })}
        </LayerGroup>
      ))}
      <p className="px-4 pt-3 text-[11.5px] text-ink-3">
        {layers.source === "structure"
          ? "Split by structure"
          : layers.source === "package"
            ? "Split by package"
            : `Planned by your local ${name}`}
        {" · "}
        <button
          type="button"
          onClick={layers.source === "model" ? layers.splitByStructure : layers.planWithModel}
          className="hover:text-ink"
        >
          {layers.source === "model" ? "split by structure instead" : `plan with ${name} instead`}
        </button>
        {layers.workspace && layers.source !== "package" ? (
          <>
            {" · "}
            <button type="button" onClick={layers.splitByPackage} className="hover:text-ink">
              by package
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

function LayerGroup({
  layer,
  index,
  active,
  stats,
  onPick,
  children,
}: {
  layer: ReviewLayer;
  index: number;
  active: boolean;
  stats: ReturnType<typeof layerStats>;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 px-4 pt-3 pb-1 text-left",
          active ? "text-ink" : "text-ink-2 hover:text-ink",
        )}
      >
        <span className="truncate text-[12px] font-medium">
          {index + 1}. {layer.title}
        </span>
        <span className="tnum text-[11px] text-ink-3">
          {stats.done ? "read" : `${stats.viewed}/${stats.files}`} · {RISK_LABEL[layer.risk]}
        </span>
      </button>
      {children}
    </div>
  );
}

/** Above the first file of a layer in the read: where you are, what it changes, what to check. */
export function LayerHeading({
  layer,
  index,
  total,
  read,
  onDone,
}: {
  layer: ReviewLayer;
  index: number;
  total: number;
  /** Files of the layer already read, of how many. */
  read?: { viewed: number; files: number };
  /** Mark every file of the layer read and go on to the next one. */
  onDone?: () => void;
}) {
  return (
    <div className="pt-2">
      <p className="tnum flex items-center gap-2 text-[12px] text-ink-3">
        <span>
          Layer {index + 1} of {total} · {RISK_LABEL[layer.risk]}
          {read ? ` · ${read.viewed}/${read.files} read` : ""}
        </span>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="h-6 rounded-md border border-edge px-2 text-[12px] text-ink-2 hover:bg-raise hover:text-ink"
          >
            {index + 1 < total ? "Layer read · next layer" : "Layer read · decide"}
          </button>
        ) : null}
      </p>
      <h2 className="mt-0.5 text-[15px] font-semibold tracking-[-0.01em] text-ink">
        {layer.title}
      </h2>
      {layer.intent ? (
        <p className="mt-1 max-w-[760px] text-[13px] text-ink-2">{layer.intent}</p>
      ) : null}
      {layer.focus.length ? (
        <ul className="mt-1.5 max-w-[760px] list-disc pl-5 text-[12.5px] text-ink-2">
          {layer.focus.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
