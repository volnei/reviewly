import { persistedStore, useStore } from "@/effect/store";
import { Schema } from "effect";

/**
 * What you have done on a pull request before sending anything: files read,
 * comments drafted, the summary half-written, the decision you leaned to.
 * Kept per PR on the machine, so leaving the page loses nothing, and keyed to
 * the head commit, so a push resets the read marks and tells you so.
 */
const ReviewEvent = Schema.Literals(["COMMENT", "REQUEST_CHANGES", "APPROVE"]);
const Draft = Schema.Struct({
  key: Schema.String,
  path: Schema.String,
  side: Schema.Literals(["L", "R"]),
  line: Schema.Number,
  startLine: Schema.optionalKey(Schema.Number),
  body: Schema.String,
});
const PrReview = Schema.Struct({
  headSha: Schema.NullOr(Schema.String),
  /** The head you read last time, while it differs from headSha: "since you last looked". */
  previousHead: Schema.NullOr(Schema.String),
  seenAt: Schema.NullOr(Schema.String),
  /** The head you sent your last review against: the base of "what changed since". */
  reviewedSha: Schema.NullOr(Schema.String),
  viewed: Schema.Array(Schema.String),
  drafts: Schema.Array(Draft),
  body: Schema.String,
  event: Schema.NullOr(ReviewEvent),
  /** Where the read was scrolled to when you left. */
  scrollTop: Schema.optionalKey(Schema.Number),
  updatedAt: Schema.Number,
});
export type PrReview = typeof PrReview.Type;
const State = Schema.Struct({
  prs: Schema.Record(Schema.String, PrReview),
  /** The decision you sent last, anywhere — the dialog opens on it. */
  lastEvent: Schema.NullOr(ReviewEvent),
});
type State = typeof State.Type;

const EMPTY_REVIEW: PrReview = {
  headSha: null,
  previousHead: null,
  seenAt: null,
  reviewedSha: null,
  viewed: [],
  drafts: [],
  body: "",
  event: null,
  updatedAt: 0,
};

const decodeOne = Schema.decodeUnknownSync(PrReview);
const decodeEvent = Schema.decodeUnknownSync(Schema.NullOr(ReviewEvent));

function decode(raw: unknown): State {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as {
    prs?: Record<string, unknown>;
    lastEvent?: unknown;
  };
  const prs: Record<string, PrReview> = {};
  for (const [k, v] of Object.entries(r.prs ?? {})) {
    try {
      prs[k] = decodeOne({ reviewedSha: null, ...(v as object) });
    } catch {
      /* one broken entry, not the store */
    }
  }
  let lastEvent: State["lastEvent"] = null;
  try {
    lastEvent = decodeEvent(r.lastEvent ?? null);
  } catch {
    /* default */
  }
  return { prs, lastEvent };
}

export const reviewStore = persistedStore<State>(
  "reviewly.v2.review",
  { prs: {}, lastEvent: null },
  decode,
);

/** Entries older than this with nothing pending are dropped on write. */
const KEEP_MS = 90 * 24 * 3600_000;
function prune(prs: Record<string, PrReview>): Record<string, PrReview> {
  const cutoff = Date.now() - KEEP_MS;
  const out: Record<string, PrReview> = {};
  for (const [k, r] of Object.entries(prs)) {
    if (r.drafts.length || r.body || r.updatedAt > cutoff) out[k] = r;
  }
  return out;
}

export const getReview = (prKey: string): PrReview => reviewStore.get().prs[prKey] ?? EMPTY_REVIEW;

/** Returning the same object leaves the store untouched. */
export function updateReview(prKey: string, f: (r: PrReview) => PrReview): void {
  const s = reviewStore.get();
  const prev = s.prs[prKey] ?? EMPTY_REVIEW;
  const next = f(prev);
  if (next === prev) return;
  reviewStore.set({ ...s, prs: prune({ ...s.prs, [prKey]: { ...next, updatedAt: Date.now() } }) });
}

export const useReview = (prKey: string): PrReview =>
  useStore(reviewStore, (s) => s.prs[prKey] ?? EMPTY_REVIEW);

export const useLastEvent = () => useStore(reviewStore, (s) => s.lastEvent);
