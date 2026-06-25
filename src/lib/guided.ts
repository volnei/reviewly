/** What a stop on the guided tour is about. */
export type StepKind = "orient" | "concern" | "question" | "praise";

/** One stop on the guided reading tour of a PR. */
export interface GuidedStep {
  path: string;
  /** New-file line the step anchors to. */
  line: number;
  /** Optional last line of the relevant range (for multi-line stops). */
  endLine?: number;
  kind: StepKind;
  title: string;
  /** Narration: what this code does / why we're here, in the flow (markdown). */
  detail: string;
  /** Optional ready-to-post review comment (only when the stop deserves one). */
  suggestion?: string;
}

/** The tour's overall recommendation, surfaced as a suggested review verdict. */
export type GuidedVerdict = "approve" | "request_changes" | "comment";

export interface GuidedPlan {
  /** One sentence: what this PR does. */
  summary: string;
  /** The reading strategy — where to start and why this order (markdown). */
  tour: string;
  /** Optional overall recommendation after the walkthrough. */
  verdict?: GuidedVerdict;
  steps: GuidedStep[];
}

/** Coerce a raw verdict string to a known value, or undefined. */
function toVerdict(v: unknown): GuidedVerdict | undefined {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "approve" || s === "request_changes" || s === "comment" ? s : undefined;
}

const KINDS = new Set<StepKind>(["orient", "concern", "question", "praise"]);

/** Normalize one raw step object → GuidedStep, or null if it lacks an anchor. */
function toStep(p: unknown): GuidedStep | null {
  if (typeof p !== "object" || p === null) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.line !== "number") return null;
  const line = Math.round(o.line);
  const endLine =
    typeof o.endLine === "number" && o.endLine >= line ? Math.round(o.endLine) : undefined;
  const suggestion =
    typeof o.suggestion === "string" && o.suggestion.trim() ? o.suggestion : undefined;
  return {
    path: o.path,
    line,
    endLine,
    kind: KINDS.has(o.kind as StepKind) ? (o.kind as StepKind) : "orient",
    title: typeof o.title === "string" ? o.title : o.path,
    detail: typeof o.detail === "string" ? o.detail : "",
    suggestion,
  };
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** Pull every top-level balanced `{…}` object out of `src`, parsing each on its
 * own. A trailing object that's truncated/garbled is simply skipped — so a tour
 * whose JSON got cut off mid-array still yields all the complete steps. */
function extractObjects(src: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let startIdx = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
      if (depth === 0 && startIdx >= 0) {
        const parsed = tryJson(src.slice(startIdx, i + 1));
        if (parsed !== undefined) out.push(parsed);
        startIdx = -1;
      }
    }
  }
  return out;
}

function firstString(content: string, key: string): string {
  const m = content.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1];
  }
}

/** Last-ditch recovery when the reply isn't valid JSON: scrape the steps array
 * and top-level summary/tour by hand so a near-complete tour still renders. */
function salvage(content: string): { summary: string; tour: string; steps: unknown[] } | null {
  const keyIdx = content.search(/"(?:steps|points)"\s*:\s*\[/);
  if (keyIdx < 0) return null;
  const arrStart = content.indexOf("[", keyIdx);
  if (arrStart < 0) return null;
  const steps = extractObjects(content.slice(arrStart + 1));
  if (steps.length === 0) return null;
  return {
    summary: firstString(content, "summary"),
    tour: firstString(content, "tour"),
    steps,
  };
}

/** Pull the JSON guided-tour plan out of the model's reply (tolerant of
 * surrounding prose / code fences). Accepts the new `steps` shape and the
 * older `points` shape so cached/old replies still render. Salvages valid
 * steps when the JSON is truncated or slightly malformed. */
export function parseGuided(content: string): GuidedPlan | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  // Fast path: a well-formed JSON object.
  let summary = "";
  let tour = "";
  let verdict: GuidedVerdict | undefined;
  let rawSteps: unknown[] = [];
  const obj = tryJson(content.slice(start, end + 1));
  if (typeof obj === "object" && obj !== null) {
    const r = obj as Record<string, unknown>;
    rawSteps = Array.isArray(r.steps) ? r.steps : Array.isArray(r.points) ? r.points : [];
    summary = typeof r.summary === "string" ? r.summary : "";
    tour = typeof r.tour === "string" ? r.tour : "";
    verdict = toVerdict(r.verdict);
  }

  // Salvage path: parse failed, or the object was valid but carried no steps
  // (e.g. the array itself was truncated and dropped during JSON.parse).
  if (rawSteps.length === 0) {
    const recovered = salvage(content);
    if (!recovered) return null;
    rawSteps = recovered.steps;
    if (!summary) summary = recovered.summary;
    if (!tour) tour = recovered.tour;
  }
  if (!verdict) verdict = toVerdict(firstString(content, "verdict"));

  const steps: GuidedStep[] = [];
  for (const p of rawSteps) {
    const s = toStep(p);
    if (s) steps.push(s);
  }
  if (steps.length === 0) return null;
  return { summary, tour, verdict, steps };
}
