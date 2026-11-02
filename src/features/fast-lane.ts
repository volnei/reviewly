import type { FastLanePolicy } from "@/effect/schema";
import type { Ranked } from "@/effect/services/Triage";

export interface FastLaneFileFacts {
  readonly paths: ReadonlyArray<string>;
  readonly changedFiles: number;
  readonly changedLines: number;
}

const normalized = (value: string): string => value.replace(/\[bot\]$/i, "").toLowerCase();

const trustedAuthor = (author: string, policy: FastLanePolicy): boolean => {
  const name = normalized(author);
  if (name === "dependabot" && policy.includeDependabot) return true;
  if (name === "renovate" && policy.includeRenovate) return true;
  return policy.trustedAuthors.some((trusted) => normalized(trusted) === name);
};

/**
 * Fast lane is deliberately narrower than the general `routine` verdict.
 * It only moves deterministic dependency-bot PRs with no visible blocker;
 * it never approves, merges, or changes the PR on GitHub.
 */
export function isFastLaneCandidate(item: Ranked, policy: FastLanePolicy): boolean {
  if (!policy.enabled || item.kind !== "pr" || item.mine || !item.author) return false;
  if (!trustedAuthor(item.author, policy)) return false;
  if (policy.requireGreenCi && item.ci !== "success") return false;
  if (policy.excludeDrafts && item.draft) return false;
  if (policy.excludeConflicts && item.conflicting) return false;
  if (policy.excludeChangesRequested && item.reviewDecision === "CHANGES_REQUESTED") return false;
  if (policy.excludeOpenThreads && (item.unresolved ?? 0) > 0) return false;
  const labels = new Set((item.labels ?? []).map((label) => label.toLowerCase()));
  if (policy.requiredLabels.some((label) => !labels.has(label.toLowerCase()))) return false;
  if (policy.blockedLabels.some((label) => labels.has(label.toLowerCase()))) return false;
  return true;
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

export const requiresFastLaneFiles = (policy: FastLanePolicy): boolean =>
  policy.maxChangedFiles !== null ||
  policy.maxChangedLines !== null ||
  policy.allowedPaths.length > 0 ||
  policy.blockedPaths.length > 0;

export function fastLaneReason(
  item: Ranked,
  policy: FastLanePolicy,
  files?: FastLaneFileFacts | null,
): string | null {
  if (!isFastLaneCandidate(item, policy)) return null;
  if (requiresFastLaneFiles(policy)) {
    if (!files) return null;
    if (policy.maxChangedFiles !== null && files.changedFiles > policy.maxChangedFiles) return null;
    if (policy.maxChangedLines !== null && files.changedLines > policy.maxChangedLines) return null;
    if (
      policy.allowedPaths.length > 0 &&
      files.paths.some(
        (path) => !policy.allowedPaths.some((pattern) => matchesFastLanePath(path, pattern)),
      )
    )
      return null;
    if (
      files.paths.some((path) =>
        policy.blockedPaths.some((pattern) => matchesFastLanePath(path, pattern)),
      )
    )
      return null;
  }
  return `${normalized(item.author ?? "automation")} · team policy matched`;
}

export const isFastLane = (
  item: Ranked,
  policy: FastLanePolicy,
  files?: FastLaneFileFacts | null,
): boolean => fastLaneReason(item, policy, files) !== null;
