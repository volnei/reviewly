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
  if (policy.blockedPaths.length > 0) return null;
  return `${bot} dependency update · team policy matched`;
}

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");

/** Git-style path globs used by team policy. Paths are always repository-relative. */
export function matchesFastLanePath(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/^\.\//, "");
  const normalizedPattern = pattern.trim().replace(/^\.\//, "").replace(/^\//, "");
  if (!normalizedPattern) return false;

  let source = "";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    if (char === "*" && normalizedPattern[index + 1] === "*") {
      const followedBySlash = normalizedPattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`).test(normalizedPath);
}

export function isFastLane(
  item: Ranked,
  policy: FastLanePolicy,
  changedPaths?: ReadonlyArray<string> | null,
): boolean {
  const basePolicy = policy.blockedPaths.length ? { ...policy, blockedPaths: [] } : policy;
  if (fastLaneReason(item, basePolicy) === null) return false;
  if (!policy.blockedPaths.length) return true;
  if (!changedPaths) return false;
  return !changedPaths.some((path) =>
    policy.blockedPaths.some((pattern) => matchesFastLanePath(path, pattern)),
  );
}
