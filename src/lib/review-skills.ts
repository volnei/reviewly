import type { ReviewSkill } from "@/effect/services/Prefs";
import { matchesFastLanePath } from "@/features/fast-lane";

export type ReviewSkillTemplate = Omit<ReviewSkill, "id" | "enabled">;

export const REVIEW_SKILL_TEMPLATES: ReadonlyArray<ReviewSkillTemplate> = [
  {
    name: "Security",
    repositories: [],
    paths: ["**/auth/**", "**/security/**", "**/permissions/**", "**/*auth*"],
    instructions:
      "Review authentication and authorization boundaries. Look for privilege escalation, cross-tenant access, unsafe defaults, secret exposure, and missing negative tests. Only raise findings grounded in the changed code.",
  },
  {
    name: "Database migrations",
    repositories: [],
    paths: ["**/migrations/**", "**/*.sql", "**/schema/**"],
    instructions:
      "Check that migrations are safe for existing data, reversible where practical, compatible with rolling deploys, and do not introduce long locks. Verify constraints, backfills, indexes, and rollback behavior.",
  },
  {
    name: "Public API compatibility",
    repositories: [],
    paths: ["**/api/**", "**/routes/**", "**/public/**", "**/openapi/**"],
    instructions:
      "Look for breaking request or response changes, altered defaults, missing validation, ambiguous errors, and compatibility risks for existing clients. Ask for contract tests when behavior changes.",
  },
  {
    name: "UI accessibility",
    repositories: [],
    paths: ["**/components/**", "**/screens/**", "**/pages/**", "**/views/**"],
    instructions:
      "Review keyboard access, focus behavior, semantics, labels, contrast, reduced motion, responsive layout, and loading, empty, error, and disabled states. Prefer concrete issues visible in the changed implementation.",
  },
];

const normalizedLines = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  values.map((value) => value.trim()).filter(Boolean);

export function reviewSkillRepositoryMatches(skill: ReviewSkill, repository: string): boolean {
  const repositories = normalizedLines(skill.repositories);
  return (
    repositories.length === 0 ||
    repositories.some((pattern) =>
      matchesFastLanePath(repository.toLowerCase(), pattern.toLowerCase()),
    )
  );
}

export function scopeReviewSkillsToRepositories(
  skills: ReadonlyArray<ReviewSkill>,
  repositories: ReadonlyArray<string>,
): ReviewSkill[] {
  const available = [
    ...new Set(repositories.map((repository) => repository.trim()).filter(Boolean)),
  ];
  if (!available.length) return [...skills];

  return skills.flatMap((skill) => {
    const configured = normalizedLines(skill.repositories);
    const isExactProject =
      configured.length === 1 &&
      available.some((repository) => repository.toLowerCase() === configured[0].toLowerCase());
    if (isExactProject) return [skill];

    const matches = available.filter((repository) =>
      reviewSkillRepositoryMatches(skill, repository),
    );
    if (!matches.length) return [skill];
    return matches.map((repository, index) => ({
      ...skill,
      id: index === 0 ? skill.id : `${skill.id}:${repository}`,
      repositories: [repository],
    }));
  });
}

export function reviewSkillMatches(
  skill: ReviewSkill,
  repository: string,
  changedPaths: ReadonlyArray<string>,
): boolean {
  if (!skill.enabled || !skill.name.trim() || !skill.instructions.trim()) return false;
  if (!reviewSkillRepositoryMatches(skill, repository)) return false;
  const paths = normalizedLines(skill.paths);
  return (
    paths.length === 0 ||
    changedPaths.some((path) => paths.some((pattern) => matchesFastLanePath(path, pattern)))
  );
}

export function selectReviewSkills(
  skills: ReadonlyArray<ReviewSkill>,
  repository: string,
  changedPaths: ReadonlyArray<string>,
): ReadonlyArray<ReviewSkill> {
  return skills.filter((skill) => reviewSkillMatches(skill, repository, changedPaths));
}

export function reviewSkillsInstructions(skills: ReadonlyArray<ReviewSkill>): string {
  if (!skills.length) return "";
  return skills
    .map((skill) => `## Review skill: ${skill.name.trim()}\n${skill.instructions.trim()}`)
    .join("\n\n");
}

export function reviewInstructions(general: string, skills: ReadonlyArray<ReviewSkill>): string {
  return [general.trim(), reviewSkillsInstructions(skills)].filter(Boolean).join("\n\n");
}
