import { Context, Effect, Layer } from "effect";
import type { Verdict } from "./Prefs";

/**
 * One item of the Inbox before it has a verdict. `kind` is the item's type —
 * a pull request, a question for you, a finding in a workspace, or something
 * on your machine — and never a verdict.
 */
export interface Candidate {
  readonly id: string;
  readonly kind: "pr" | "mention" | "finding" | "local";
  readonly title: string;
  readonly repo: string;
  readonly number?: number;
  readonly url?: string;
  readonly author?: string;
  readonly avatar?: string;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
  readonly mine: boolean;
  readonly draft?: boolean;
  readonly ci?: string;
  readonly conflicting?: boolean;
  readonly reviewDecision?: string | null;
  readonly unresolved?: number;
  readonly comments?: number;
  readonly severity?: string;
  readonly patched?: boolean;
  readonly dirty?: boolean;
  readonly ahead?: number;
  readonly notificationId?: string;
  /** A notification's reason, as GitHub names it: mention, review_requested, comment… */
  readonly reason?: string;
  /** A finding: the advisory in a sentence, the package, the version that fixes it. */
  readonly detail?: string;
  readonly packageName?: string;
  readonly patchedVersion?: string;
  readonly manifestPath?: string | null;
  /** The full list: state beyond open, and labels to filter by. */
  readonly state?: string;
  readonly merged?: boolean;
  readonly labels?: ReadonlyArray<string>;
  /** People or teams currently requested through the repository's ownership rules. */
  readonly codeOwners?: ReadonlyArray<string>;
  /** A layer of one of GitHub's stacks: where in it, and what it lands on. */
  readonly stack?: {
    readonly number: number;
    readonly position: number;
    readonly size: number;
    readonly base: string;
  };
  readonly owner?: string;
  readonly repoName?: string;
}

export interface Ranked extends Candidate {
  readonly verdict: Verdict;
  /** One line, from the reviewer's seat, on why it is where it is. */
  readonly why: string;
  /** Only the hosted model answers with a number; the rules are sure. */
  readonly confidence?: number;
}

export class Triage extends Context.Service<
  Triage,
  {
    readonly rank: (items: ReadonlyArray<Candidate>) => Effect.Effect<ReadonlyArray<Ranked>>;
  }
>()("reviewly/Triage") {}

const BOTS = /\[bot\]$|^(dependabot|renovate|github-actions)/i;

function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  const h = Math.round(ms / 36e5);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "a day ago" : `${d} days ago`;
}

/** The rules engine: paths, state, CI, ownership — nothing leaves the machine. */
export function rankByRules(c: Candidate): Ranked {
  const threads = c.unresolved ?? 0;
  const open = threads ? `${threads} thread${threads > 1 ? "s" : ""} still open` : "";
  if (c.kind === "finding") {
    const sev = (c.severity ?? "").toLowerCase();
    if (sev === "critical" || sev === "high")
      return {
        ...c,
        verdict: "risky",
        why: `${sev} severity${c.patched ? ", and the fix is a patch bump you can ship" : ""}`,
      };
    return {
      ...c,
      verdict: "routine",
      why: `${sev || "low"} severity${c.patched ? ", patch available" : ""}`,
    };
  }
  if (c.kind === "mention")
    return {
      ...c,
      verdict: "yours",
      why: `${c.author ?? "someone"} mentioned you ${ago(c.updatedAt)}`,
    };
  if (c.kind === "local") {
    if (c.dirty)
      return {
        ...c,
        verdict: "yours",
        why: `uncommitted changes${c.ahead ? `, ${c.ahead} commits ahead and never pushed` : ""}`,
      };
    return { ...c, verdict: "waiting", why: `${c.ahead ?? 0} commits ahead, nothing uncommitted` };
  }
  // pull requests
  if (c.mine) {
    if (c.reviewDecision === "CHANGES_REQUESTED")
      return {
        ...c,
        verdict: "yours",
        why: `changes requested on your PR${open ? `, ${open}` : ""}`,
      };
    if (c.draft) return { ...c, verdict: "waiting", why: "a draft — nobody is asked yet" };
    if (c.reviewDecision === "APPROVED" && c.ci === "success" && !c.conflicting)
      return { ...c, verdict: "mergeable", why: "approved, checks green, base is current" };
    if (c.ci === "failure")
      return {
        ...c,
        verdict: "yours",
        why:
          c.reviewDecision === "APPROVED"
            ? "approved, but CI is failing"
            : "CI is failing on your PR",
      };
    if (c.conflicting) return { ...c, verdict: "yours", why: "your PR conflicts with its base" };
    if (threads) return { ...c, verdict: "yours", why: `${open} on your PR` };
    return { ...c, verdict: "waiting", why: `waiting on reviewers, opened ${ago(c.createdAt)}` };
  }
  if (c.author && BOTS.test(c.author))
    return { ...c, verdict: "routine", why: "a dependency bump, no source change" };
  if (c.ci === "failure" && c.conflicting)
    return { ...c, verdict: "yours", why: "CI failing and conflicts with base" };
  if (c.conflicting) return { ...c, verdict: "yours", why: "conflicts with its base" };
  if (c.ci === "failure")
    return { ...c, verdict: "yours", why: `CI failing${open ? `, ${open}` : ""}` };
  if (threads > 2) return { ...c, verdict: "yours", why: `${open}, your turn` };
  return { ...c, verdict: "yours", why: `your review was requested ${ago(c.createdAt)}` };
}

export const TriageRules = Layer.succeed(Triage, {
  rank: (items) => Effect.succeed(items.map(rankByRules)),
});

const ORDER: Record<Verdict, number> = {
  risky: 0,
  yours: 1,
  mergeable: 2,
  routine: 3,
  unsorted: 4,
  waiting: 5,
};

/** Most urgent first: by verdict, then the one that has waited longest. */
export function compareRanked(a: Ranked, b: Ranked): number {
  const d = ORDER[a.verdict] - ORDER[b.verdict];
  if (d) return d;
  const ta = Date.parse(a.createdAt ?? a.updatedAt ?? "") || 0;
  const tb = Date.parse(b.createdAt ?? b.updatedAt ?? "") || 0;
  return ta - tb;
}
