import type { FastLanePolicy } from "@/effect/schema";
import type { Ranked } from "@/effect/services/Triage";

const botName = (author: string): "dependabot" | "renovate" | null => {
  const name = author.replace(/\[bot\]$/i, "").toLowerCase();
  return name === "dependabot" || name === "renovate" ? name : null;
};

/**
 * Fast lane is deliberately narrower than the general `routine` verdict.
 * It only moves deterministic dependency-bot PRs with no visible blocker;
 * it never approves, merges, or changes the PR on GitHub.
 */
export function fastLaneReason(item: Ranked, policy: FastLanePolicy): string | null {
  if (!policy.enabled || item.kind !== "pr" || item.mine || !item.author) return null;
  const bot = botName(item.author);
  if (!bot) return null;
  if (bot === "dependabot" && !policy.includeDependabot) return null;
  if (bot === "renovate" && !policy.includeRenovate) return null;
  if (policy.requireGreenCi && item.ci !== "success") return null;
  if (policy.excludeDrafts && item.draft) return null;
  if (policy.excludeConflicts && item.conflicting) return null;
  if (policy.excludeChangesRequested && item.reviewDecision === "CHANGES_REQUESTED") return null;
  if (policy.excludeOpenThreads && (item.unresolved ?? 0) > 0) return null;
  return `${bot} dependency update · team policy matched`;
}

export const isFastLane = (item: Ranked, policy: FastLanePolicy): boolean =>
  fastLaneReason(item, policy) !== null;
