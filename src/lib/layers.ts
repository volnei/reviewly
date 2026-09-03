import { extractObjects, firstString, stripFence, toArray, toStringArray } from "@/lib/ai/json";
import { classify, isTestFile } from "@/lib/focus";
import type { PullFile } from "@/lib/tauri";

/**
 * Layered review: a big PR cut into a handful of coherent slices that are read
 * in dependency order (foundations → consumers → surface → tests), instead of
 * 60 files in alphabetical order all at once.
 *
 * A plan is produced either by the AI (semantic layers) or by `heuristicLayers`
 * (structural layers, instant and offline), and is then RECONCILED against the
 * PR's real file list at read time — see `reconcileLayers`.
 */

/** How much reviewer attention a layer deserves. */
export type LayerRisk = "low" | "medium" | "high";

/** One slice of the PR: a set of files that share an idea, read as a unit. */
export interface ReviewLayer {
  /** Stable within a plan ("l1", "l2", … / a bucket id for the structural split). */
  id: string;
  title: string;
  /** What this layer changes and why it sits at this point in the order. */
  intent: string;
  /** 1-3 concrete things to verify while reading this layer. */
  focus: string[];
  risk: LayerRisk;
  /** Paths, in reading order. Reconciled against the PR before use. */
  files: string[];
}

export interface LayerPlan {
  /** One sentence: what this PR does. */
  summary: string;
  /** 1-2 sentences: why the layers are in this order. */
  strategy: string;
  layers: ReviewLayer[];
}

/** The trailing catch-all layer id — see `reconcileLayers`. */
export const REST_LAYER_ID = "rest";

/**
 * Background-task key prefix for a layer-plan generation. The backend keys AI
 * runs by an opaque string and broadcasts `ai:done` to every listener, so the
 * layered planner and the guided tour MUST use distinct keys for the same PR —
 * otherwise each would try to parse the other's reply and report a failure.
 */
export const LAYERS_KEY_PREFIX = "layers:";

export const layersKey = (prKey: string): string => `${LAYERS_KEY_PREFIX}${prKey}`;

const RISKS = new Set<LayerRisk>(["low", "medium", "high"]);

function toRisk(v: unknown): LayerRisk {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  if (RISKS.has(s as LayerRisk)) return s as LayerRisk;
  // Near-misses, then a neutral default — a layer never disappears over a bad
  // enum value.
  if (s === "critical" || s === "severe" || s === "hot") return "high";
  if (s === "moderate" || s === "med") return "medium";
  if (s === "trivial" || s === "none" || s === "minor") return "low";
  return "medium";
}

/** Normalize a model-supplied path: strip quotes, `./`, and the `a/` / `b/`
 * prefixes that leak in from raw diff headers. */
function normalizePath(raw: string): string {
  return raw
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/^\.\//, "")
    .replace(/^[ab]\//, "")
    .replace(/^\/+/, "");
}

/** Paths out of a raw `files` value. Tolerates the two shapes models produce:
 * a list of strings, and a list of `{path: "…"}` objects. */
function toPaths(v: unknown): string[] {
  const direct = toStringArray(v);
  if (direct.length > 0) return direct;
  return toArray(v)
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const o = item as Record<string, unknown>;
      const p = o.path ?? o.file ?? o.filename;
      return typeof p === "string" ? p.trim() : "";
    })
    .filter(Boolean);
}

/** Normalize one raw layer object, or null when it carries no usable files. */
function toLayer(raw: unknown, idx: number): ReviewLayer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const files = toPaths(o.files ?? o.paths);
  if (files.length === 0) return null;
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : `Layer ${idx + 1}`;
  return {
    id: `l${idx + 1}`,
    title,
    intent: typeof o.intent === "string" ? o.intent.trim() : "",
    // Accept the singular `focus` string too — models collapse one-item lists.
    focus: toStringArray(o.focus ?? o.checks).slice(0, 4),
    risk: toRisk(o.risk),
    files,
  };
}

/**
 * Pull the JSON layer plan out of the model's reply. Same defense-in-depth as
 * the guided tour: de-fence, prefer the LAST balanced {…} that actually carries
 * layers (robust to trailing prose or a second illustrative object), repair
 * trailing commas, accept a layers-map instead of an array, and fall back to
 * scraping individual layer objects out of a truncated array.
 *
 * Shape only — paths are NOT validated here; that's `reconcileLayers`, which
 * needs the PR's file list and re-runs whenever the PR changes.
 */
export function parseLayers(content: string): LayerPlan | null {
  const s = stripFence(content);
  let summary = "";
  let strategy = "";
  let rawLayers: unknown[] = [];

  const objs = extractObjects(s);
  const planObj = [...objs].reverse().find((o) => {
    if (!o || typeof o !== "object") return false;
    const r = o as Record<string, unknown>;
    return toArray(r.layers).length > 0;
  }) as Record<string, unknown> | undefined;

  if (planObj) {
    rawLayers = toArray(planObj.layers);
    summary = typeof planObj.summary === "string" ? planObj.summary : "";
    strategy = typeof planObj.strategy === "string" ? planObj.strategy : "";
  }

  // Salvage a truncated reply: scrape every complete object that follows the
  // `"layers": [` marker, and read the header fields by hand.
  if (rawLayers.length === 0) {
    const m = s.match(/"layers"\s*:\s*[[{]/);
    if (m?.index !== undefined) {
      const header = s.slice(0, m.index);
      // The match ends on the opening `[`/`{` of the array — scan past it.
      rawLayers = extractObjects(s.slice(m.index + m[0].length));
      if (!summary) summary = firstString(header, "summary");
      if (!strategy) strategy = firstString(header, "strategy");
    }
  }

  const layers: ReviewLayer[] = [];
  for (const raw of rawLayers) {
    const layer = toLayer(raw, layers.length);
    if (layer) layers.push(layer);
  }
  // A plan with a single layer is not a layering — it's the PR as-is, which the
  // reviewer already has. Treat it as a failed split so the UI can retry.
  if (layers.length < 2) return null;
  return { summary: summary.trim(), strategy: strategy.trim(), layers };
}

/**
 * Bind a plan to the PR's actual files. Runs at READ time, not at generation
 * time, so a plan stays correct as the PR moves: paths that no longer exist
 * drop out, and files pushed after the plan was made surface in a trailing
 * "Rest of the change" layer instead of silently vanishing from the review.
 *
 * Guarantees: every changed file appears in exactly ONE layer, layers keep the
 * planner's order, and empty layers are dropped.
 */
export function reconcileLayers(plan: LayerPlan, files: PullFile[]): LayerPlan {
  // Exact path first; a lowercase index catches the occasional case slip.
  const byLower = new Map<string, string>();
  const real = new Set<string>();
  for (const f of files) {
    real.add(f.filename);
    byLower.set(f.filename.toLowerCase(), f.filename);
  }
  const resolve = (raw: string): string | null => {
    const p = normalizePath(raw);
    if (real.has(p)) return p;
    return byLower.get(p.toLowerCase()) ?? null;
  };

  const claimed = new Set<string>();
  const layers: ReviewLayer[] = [];
  for (const layer of plan.layers) {
    const resolved: string[] = [];
    for (const raw of layer.files) {
      const path = resolve(raw);
      // First layer to claim a file keeps it — a file the planner listed twice
      // must not be reviewed twice.
      if (!path || claimed.has(path)) continue;
      claimed.add(path);
      resolved.push(path);
    }
    if (resolved.length > 0) layers.push({ ...layer, files: resolved });
  }

  const rest = files.map((f) => f.filename).filter((p) => !claimed.has(p));
  if (rest.length > 0) {
    layers.push({
      id: REST_LAYER_ID,
      title: "Rest of the change",
      intent:
        "Files the plan didn't cover — either pushed after it was made, or left out. Read them last so nothing in the PR goes unreviewed.",
      focus: [],
      risk: "medium",
      files: rest,
    });
  }
  return { ...plan, layers };
}

/** True when reconciliation left nothing but the catch-all — the plan no longer
 * describes this PR, so the UI should offer to redo it. */
export function isPlanStale(plan: LayerPlan): boolean {
  return plan.layers.length === 1 && plan.layers[0].id === REST_LAYER_ID;
}

/* ───────────────────────── structural split (no AI) ───────────────────────── */

interface Bucket {
  id: string;
  title: string;
  intent: string;
  focus: string[];
  risk: LayerRisk;
  /** Position in the final reading order (low = read first). */
  rank: number;
  match: (path: string, file: PullFile) => boolean;
}

const has = (path: string, re: RegExp) => re.test(path);

/**
 * Buckets in CLASSIFICATION order — a file lands in the first one that matches,
 * so the narrow rules (a generated file, a test) come before the broad ones (a
 * `.tsx` is UI). `rank` is the separate READING order they're presented in.
 */
const BUCKETS: Bucket[] = [
  {
    id: "generated",
    title: "Generated & lockfiles",
    intent: "Machine-written output. Skim for surprises rather than reading line by line.",
    focus: ["The lockfile churn matches the dependency change that caused it"],
    risk: "low",
    rank: 80,
    // `classify` is the same rule focus mode uses to hide diff noise.
    match: (_p, f) => {
      const reason = classify(f);
      return reason === "lockfile" || reason === "generated" || reason === "snapshot";
    },
  },
  {
    id: "tests",
    title: "Tests",
    intent: "What the change claims to guarantee. Read after the code it covers.",
    focus: ["Each behaviour changed above has a test", "No test asserts the old behaviour"],
    risk: "low",
    rank: 70,
    match: (p) => isTestFile(p),
  },
  {
    id: "docs",
    title: "Docs",
    intent: "Prose that has to match the code you just read.",
    focus: ["The documented behaviour matches what the code now does"],
    risk: "low",
    rank: 75,
    match: (p) => has(p, /\.(md|mdx|rst|txt|adoc)$/i) || has(p, /(^|\/)docs?\//),
  },
  {
    id: "data",
    title: "Schema & data",
    intent: "The persistence layer everything else builds on — read it first.",
    focus: [
      "The migration is reversible and safe on existing rows",
      "New columns are nullable or backfilled",
    ],
    risk: "high",
    rank: 10,
    match: (p) =>
      has(p, /(^|\/)(migrations?|migrate|schema|prisma|db|database|entities|models)\//) ||
      has(p, /\.sql$/) ||
      has(p, /(^|\/)schema\.[a-z]+$/),
  },
  {
    id: "types",
    title: "Types & contracts",
    intent: "The shapes the rest of the change is written against.",
    focus: ["Every new field is used", "A changed shape doesn't silently break a consumer"],
    risk: "medium",
    rank: 20,
    match: (p) =>
      has(p, /\.d\.ts$/) ||
      has(p, /\.(proto|graphql|gql)$/) ||
      has(p, /(^|\/)types?\//) ||
      has(p, /(^|\/)(openapi|swagger)[^/]*$/i),
  },
  {
    id: "api",
    title: "API & routes",
    intent: "The surface the change exposes to callers.",
    focus: ["Inputs are validated", "Auth and error paths are unchanged unless intended"],
    risk: "high",
    rank: 40,
    match: (p) =>
      has(p, /(^|\/)(api|routes?|controllers?|handlers?|endpoints?|resolvers?|commands?)\//),
  },
  {
    id: "ui",
    title: "UI",
    intent: "What the user ends up seeing.",
    focus: ["Loading, empty, and error states exist", "State updates can't render a stale view"],
    risk: "medium",
    rank: 50,
    match: (p) =>
      has(p, /\.(tsx|jsx|vue|svelte|css|scss|sass|less)$/) ||
      has(p, /(^|\/)(components?|pages?|views?|screens?|styles?|ui)\//),
  },
  {
    id: "config",
    title: "Config & CI",
    intent: "How the change is built, shipped, and configured.",
    focus: ["No secret or environment-specific value is hardcoded"],
    risk: "medium",
    rank: 60,
    match: (p) =>
      has(p, /\.(json|ya?ml|toml|ini|cfg|conf|env|lock)$/i) ||
      has(p, /(^|\/)\.github\//) ||
      has(p, /(^|\/)(Dockerfile|Makefile|Justfile)[^/]*$/i),
  },
  {
    id: "core",
    title: "Core logic",
    intent: "The behaviour this PR is actually about.",
    focus: ["The new path handles the edge cases the old one did"],
    risk: "high",
    rank: 30,
    match: () => true, // fallback — everything else is source
  },
];

/**
 * Split a PR by structure — no AI, no wait. Groups files by the role their path
 * implies and orders the groups the way a reviewer would read them: data →
 * types → core → API → UI → config → tests → docs → generated.
 *
 * Coarser than an AI plan (it reads paths, not code), but it's instant, works
 * with no CLI configured, and is often enough to make a 60-file PR tractable.
 */
export function heuristicLayers(files: PullFile[]): LayerPlan {
  const grouped = new Map<string, string[]>();
  for (const f of files) {
    const bucket = BUCKETS.find((b) => b.match(f.filename, f)) ?? BUCKETS[BUCKETS.length - 1];
    const list = grouped.get(bucket.id);
    if (list) list.push(f.filename);
    else grouped.set(bucket.id, [f.filename]);
  }
  const layers = BUCKETS.filter((b) => grouped.has(b.id))
    .sort((a, b) => a.rank - b.rank)
    .map((b) => ({
      id: b.id,
      title: b.title,
      intent: b.intent,
      focus: b.focus,
      risk: b.risk,
      files: grouped.get(b.id) ?? [],
    }));
  return {
    summary: `${files.length} changed file${files.length === 1 ? "" : "s"}, grouped by what each one is.`,
    strategy:
      "Structural split: foundations first (schema, types), then the logic and the surface it exposes, then tests and generated noise last.",
    layers,
  };
}

/* ──────────────────────────────── progress ──────────────────────────────── */

export interface LayerStats {
  files: number;
  additions: number;
  deletions: number;
  /** Files in this layer already marked viewed. */
  viewed: number;
  /** Every file in the layer has been viewed. */
  done: boolean;
}

/** Size + read-progress for a layer. Progress is derived from the viewed-files
 * store (the same state the `v` / `n` shortcuts drive) rather than a second
 * bookkeeping flag, so the two can never disagree. */
export function layerStats(
  layer: ReviewLayer,
  files: PullFile[],
  viewed: Record<string, true> | undefined,
): LayerStats {
  const byPath = new Map(files.map((f) => [f.filename, f]));
  let additions = 0;
  let deletions = 0;
  let seen = 0;
  for (const path of layer.files) {
    const f = byPath.get(path);
    if (f) {
      additions += f.additions;
      deletions += f.deletions;
    }
    if (viewed?.[path]) seen++;
  }
  return {
    files: layer.files.length,
    additions,
    deletions,
    viewed: seen,
    done: layer.files.length > 0 && seen === layer.files.length,
  };
}

export const RISK_LABEL: Record<LayerRisk, string> = {
  low: "Skim",
  medium: "Read",
  high: "Read closely",
};
