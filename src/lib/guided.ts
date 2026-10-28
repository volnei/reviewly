import { extractObjects, firstString, stripFence, toArray, toInt, tryJson } from "@/lib/ai/json";

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
type GuidedVerdict = "approve" | "request_changes" | "comment";

export interface GuidedPlan {
  /** One sentence: what this PR does. */
  summary: string;
  /** The reading strategy — where to start and why this order (markdown). */
  tour: string;
  /** Optional overall recommendation after the walkthrough. */
  verdict?: GuidedVerdict;
  /** One-sentence justification for the verdict (why approve / what blocks). */
  verdictReason?: string;
  steps: GuidedStep[];
}

/** Coerce a raw verdict string to a known value, or undefined. */
function toVerdict(v: unknown): GuidedVerdict | undefined {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return s === "approve" || s === "request_changes" || s === "comment" ? s : undefined;
}

const KINDS = new Set<StepKind>(["orient", "concern", "question", "praise"]);

/** Near-miss kind words → canonical. A genuinely-unknown *non-empty* kind
 * defaults to "concern" (below) so a flagged risk is never silently downgraded
 * to a neutral orientation stop with no warning color and no "Check with AI". */
const KIND_SYNONYMS: Record<string, StepKind> = {
  warning: "concern",
  issue: "concern",
  bug: "concern",
  risk: "concern",
  problem: "concern",
  caution: "concern",
  nit: "concern",
  ask: "question",
  clarify: "question",
  clarification: "question",
  good: "praise",
  nice: "praise",
  kudos: "praise",
  positive: "praise",
  overview: "orient",
  context: "orient",
  note: "orient",
  info: "orient",
  intro: "orient",
};

function toKind(raw: unknown): StepKind {
  const s = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  if (KINDS.has(s as StepKind)) return s as StepKind;
  if (s && s in KIND_SYNONYMS) return KIND_SYNONYMS[s];
  // Empty/missing → neutral orient; unknown-but-present → concern (over-flag,
  // never hide).
  return s ? "concern" : "orient";
}

/** Normalize one raw step object → GuidedStep, or null if it lacks a usable
 * path + line anchor. Tolerant of numeric-string lines and near-miss kinds. */
function toStep(p: unknown): GuidedStep | null {
  if (typeof p !== "object" || p === null) return null;
  const o = p as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path.trim()) return null;
  const parsedLine = toInt(o.line);
  if (parsedLine === null) return null;
  const line = Math.max(1, parsedLine);
  const parsedEnd = toInt(o.endLine);
  const endLine = parsedEnd !== null && parsedEnd >= line ? parsedEnd : undefined;
  const suggestion =
    typeof o.suggestion === "string" && o.suggestion.trim() ? o.suggestion : undefined;
  return {
    path: o.path,
    line,
    endLine,
    kind: toKind(o.kind),
    title: typeof o.title === "string" && o.title.trim() ? o.title : o.path,
    detail: typeof o.detail === "string" ? o.detail : "",
    suggestion,
  };
}

/** Last-ditch recovery when the reply isn't valid JSON: scrape the steps array
 * and the top-level summary/tour by hand so a near-complete tour still renders.
 * summary/tour are scraped only from the HEADER (before the steps array) so a
 * nested step key named `summary`/`tour` can't masquerade as the plan header. */
function salvage(content: string): { summary: string; tour: string; steps: unknown[] } | null {
  const m = content.match(/"(?:steps|points)"\s*:\s*[[{]/);
  if (!m || m.index === undefined) return null;
  // The last char of the match is the opening `[` or `{` of the steps container.
  const bracketIdx = m.index + m[0].length - 1;
  const header = content.slice(0, m.index);
  const steps = extractObjects(content.slice(bracketIdx + 1));
  if (steps.length === 0) return null;
  return {
    summary: firstString(header, "summary"),
    tour: firstString(header, "tour"),
    steps,
  };
}

/** Pull the JSON guided-tour plan out of the model's reply. Defense-in-depth so
 * imperfect model output degrades gracefully instead of discarding the tour:
 * strips a wrapping ```json fence, prefers the LAST balanced {…} that carries
 * steps (robust to trailing prose / a second illustrative object), repairs
 * trailing commas, coerces a steps-map to an array and string lines to numbers,
 * normalizes near-miss kinds, salvages a truncated array, and de-dups. Accepts
 * both the `steps` and the older `points` shape. */
export function parseGuided(content: string): GuidedPlan | null {
  // De-fence a wrapping ```json … ``` while leaving internal markdown fences
  // (inside a step's `detail`) intact.
  const s = stripFence(content);

  let summary = "";
  let tour = "";
  let verdict: GuidedVerdict | undefined;
  let verdictReason = "";
  let rawSteps: unknown[] = [];

  // Prefer the LAST balanced top-level {…} that actually carries steps — robust
  // to trailing prose, a banner line, or a second illustrative JSON object.
  const objs = extractObjects(s);
  const planObj = [...objs].reverse().find((o) => {
    if (!o || typeof o !== "object") return false;
    const r = o as Record<string, unknown>;
    return toArray(r.steps).length > 0 || toArray(r.points).length > 0;
  }) as Record<string, unknown> | undefined;

  const obj =
    planObj ??
    (() => {
      const start = s.indexOf("{");
      const end = s.lastIndexOf("}");
      return start >= 0 && end > start ? tryJson(s.slice(start, end + 1)) : undefined;
    })();

  if (obj && typeof obj === "object") {
    const r = obj as Record<string, unknown>;
    rawSteps = toArray(r.steps);
    if (rawSteps.length === 0) rawSteps = toArray(r.points);
    summary = typeof r.summary === "string" ? r.summary : "";
    tour = typeof r.tour === "string" ? r.tour : "";
    verdict = toVerdict(r.verdict);
    verdictReason = typeof r.verdictReason === "string" ? r.verdictReason : "";
  }

  // Salvage: the object was unparseable, or valid but carried no steps. A failed
  // salvage is NOT fatal on its own — a legitimate "nothing to walk through"
  // tour (summary + verdict, no stops) is accepted at the end.
  if (rawSteps.length === 0) {
    const recovered = salvage(s);
    if (recovered) {
      rawSteps = recovered.steps;
      if (!summary) summary = recovered.summary;
      if (!tour) tour = recovered.tour;
    }
  }
  // Scrape verdict / reason from the header if the structured parse missed them.
  if (!verdict || !verdictReason) {
    const arrIdx = s.search(/"(?:steps|points)"\s*:/);
    const header = arrIdx > 0 ? s.slice(0, arrIdx) : s;
    if (!verdict) verdict = toVerdict(firstString(header, "verdict"));
    if (!verdictReason) verdictReason = firstString(header, "verdictReason");
  }

  // Normalize + de-dup by path:line:title so redundant stops don't clutter the
  // timeline.
  const seen = new Set<string>();
  const steps: GuidedStep[] = [];
  for (const p of rawSteps) {
    const step = toStep(p);
    if (!step) continue;
    const sig = `${step.path}:${step.line}:${step.title}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    steps.push(step);
  }
  // A "clean bill of health" tour has no stops but still a real summary and an
  // explicit verdict — render it rather than failing. Require BOTH so a garbled
  // reply with only a stray "summary" isn't mistaken for a no-op tour.
  if (steps.length === 0) {
    if (summary.trim() && verdict) return { summary, tour, verdict, verdictReason, steps: [] };
    return null;
  }
  return { summary, tour, verdict, verdictReason, steps };
}

/** One stop's identity across runs of the same plan: where it is. */
export const stepKey = (s: Pick<GuidedStep, "path" | "line">): string => `${s.path}:${s.line}`;

/** What the model found when asked to verify one stop against the clone. */
export interface CheckResult {
  verdict: "resolved" | "valid";
  finding: string;
}

/** Ask the model to verify ONE concern against the repository it runs in. */
export function checkPrompt(step: GuidedStep): string {
  const loc = `${step.path}:${step.line}${step.endLine ? `-${step.endLine}` : ""}`;
  return [
    "You are verifying ONE code-review concern against the actual repository in this working directory. Read the relevant files to check it — don't guess.",
    "",
    `Concern (${step.kind}) at ${loc}`,
    `Title: ${step.title}`,
    step.detail ? `Details: ${step.detail}` : "",
    step.suggestion ? `Proposed review comment: ${step.suggestion}` : "",
    "",
    "Decide:",
    '- "resolved": NOT worth raising — false alarm, already handled, or not actually an issue.',
    '- "valid": a real concern worth a comment.',
    "",
    "Reply with ONLY a single-line JSON object — no prose, no code fences:",
    '{"verdict":"resolved"|"valid","finding":"<1-2 sentences; if valid, a sharp ready-to-post comment>"}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** The verdict out of a possibly chatty reply. Unreadable output counts as valid: nothing is dismissed on a guess. */
export function parseCheckResult(out: string): CheckResult {
  const m = out.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]) as { verdict?: unknown; finding?: unknown };
      return {
        verdict: o.verdict === "resolved" ? "resolved" : "valid",
        finding: typeof o.finding === "string" && o.finding.trim() ? o.finding.trim() : out.trim(),
      };
    } catch {
      /* fall through */
    }
  }
  return { verdict: "valid", finding: out.trim() };
}
