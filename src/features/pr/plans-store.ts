import { persistedStore, useStore } from "@/effect/store";
import type { CheckResult, GuidedPlan } from "@/lib/guided";
import type { LayerPlan } from "@/lib/layers";

/**
 * What the model (or the structural split) made of a pull request, kept per
 * PR and stamped with the head it saw, so a visit later still has the plan and
 * knows when the PR has moved on from it.
 */
export interface GuidedEntry {
  readonly plan: GuidedPlan;
  readonly headSha: string;
  readonly at: number;
  /** Stops you put aside, by `path:line`. */
  readonly dismissed?: ReadonlyArray<string>;
  /** What the model found when it checked a stop in the clone, by `path:line`. */
  readonly checks?: Record<string, CheckResult>;
  /** The PR moved and you chose to keep this plan anyway. */
  readonly staleAck?: string;
}
export interface LayersEntry {
  readonly plan: LayerPlan;
  readonly headSha: string;
  readonly source: "model" | "structure" | "package";
  readonly at: number;
}
interface SummaryEntry {
  readonly text: string;
  readonly headSha: string;
  readonly at: number;
}
interface State {
  readonly guided: Record<string, GuidedEntry>;
  readonly layers: Record<string, LayersEntry>;
  readonly summaries: Record<string, SummaryEntry>;
}

const MAX = 40;
function cap<T extends { at: number }>(r: Record<string, T>): Record<string, T> {
  const keys = Object.keys(r);
  if (keys.length <= MAX) return r;
  const keep = keys.sort((a, b) => r[b].at - r[a].at).slice(0, MAX);
  return Object.fromEntries(keep.map((k) => [k, r[k]]));
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Lenient: an entry is kept when it has the three fields; anything else is dropped. */
function decode(raw: unknown): State {
  const r = isRecord(raw) ? raw : {};
  const pick = <T>(
    src: unknown,
    ok: (v: Record<string, unknown>) => boolean,
  ): Record<string, T> => {
    const out: Record<string, T> = {};
    if (!isRecord(src)) return out;
    for (const [k, v] of Object.entries(src)) if (isRecord(v) && ok(v)) out[k] = v as T;
    return out;
  };
  return {
    guided: pick<GuidedEntry>(
      r.guided,
      (v) => isRecord(v.plan) && typeof v.headSha === "string" && typeof v.at === "number",
    ),
    layers: pick<LayersEntry>(
      r.layers,
      (v) =>
        isRecord(v.plan) &&
        typeof v.headSha === "string" &&
        typeof v.at === "number" &&
        (v.source === "model" || v.source === "structure" || v.source === "package"),
    ),
    summaries: pick<SummaryEntry>(
      r.summaries,
      (v) =>
        typeof v.text === "string" && typeof v.headSha === "string" && typeof v.at === "number",
    ),
  };
}

const plansStore = persistedStore<State>(
  "reviewly.v2.plans",
  { guided: {}, layers: {}, summaries: {} },
  decode,
);

export const useGuidedEntry = (prKey: string) =>
  useStore(plansStore, (s) => s.guided[prKey] ?? null);
export const useLayersEntry = (prKey: string) =>
  useStore(plansStore, (s) => s.layers[prKey] ?? null);

export const saveGuided = (prKey: string, plan: GuidedPlan, headSha: string) =>
  plansStore.update((s) => ({
    ...s,
    guided: cap({ ...s.guided, [prKey]: { plan, headSha, at: Date.now() } }),
  }));
/** Change one PR's tour in place: a dismissal, a check's result, a stale plan kept. */
export const updateGuided = (prKey: string, f: (e: GuidedEntry) => GuidedEntry) =>
  plansStore.update((s) => {
    const e = s.guided[prKey];
    return e ? { ...s, guided: { ...s.guided, [prKey]: f(e) } } : s;
  });
export const saveLayers = (
  prKey: string,
  plan: LayerPlan,
  headSha: string,
  source: LayersEntry["source"],
) =>
  plansStore.update((s) => ({
    ...s,
    layers: cap({ ...s.layers, [prKey]: { plan, headSha, source, at: Date.now() } }),
  }));
export const forgetLayers = (prKey: string) =>
  plansStore.update((s) => {
    const { [prKey]: _, ...rest } = s.layers;
    return { ...s, layers: rest };
  });

export const useSummary = (prKey: string) =>
  useStore(plansStore, (s) => s.summaries[prKey] ?? null);
export const getSummary = (prKey: string) => plansStore.get().summaries[prKey] ?? null;
export const saveSummary = (prKey: string, text: string, headSha: string) =>
  plansStore.update((s) => ({
    ...s,
    summaries: cap({ ...s.summaries, [prKey]: { text, headSha, at: Date.now() } }),
  }));
