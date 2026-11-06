import { describe, expect, test } from "bun:test";

import type { ReviewSkill } from "../src/effect/services/Prefs";
import {
  reviewInstructions,
  reviewSkillMatches,
  selectReviewSkills,
} from "../src/lib/review-skills";

const skill = (patch: Partial<ReviewSkill> = {}): ReviewSkill => ({
  id: "security",
  name: "Security",
  enabled: true,
  repositories: [],
  paths: ["src/auth/**"],
  instructions: "Check tenant boundaries.",
  ...patch,
});

describe("Review skills", () => {
  test("matches a skill against repository and changed paths", () => {
    expect(reviewSkillMatches(skill(), "volnei/reviewly", ["src/auth/session.ts"])).toBe(true);
    expect(reviewSkillMatches(skill(), "volnei/reviewly", ["src/home.ts"])).toBe(false);
    expect(
      reviewSkillMatches(skill({ repositories: ["volnei/*"] }), "volnei/reviewly", [
        "src/auth/session.ts",
      ]),
    ).toBe(true);
    expect(
      reviewSkillMatches(skill({ repositories: ["acme/**"] }), "volnei/reviewly", [
        "src/auth/session.ts",
      ]),
    ).toBe(false);
  });

  test("treats empty paths as a repository-wide default skill", () => {
    expect(reviewSkillMatches(skill({ paths: [] }), "volnei/reviewly", ["README.md"])).toBe(true);
  });

  test("ignores disabled or incomplete skills", () => {
    expect(
      reviewSkillMatches(skill({ enabled: false }), "volnei/reviewly", ["src/auth/a.ts"]),
    ).toBe(false);
    expect(
      reviewSkillMatches(skill({ instructions: "" }), "volnei/reviewly", ["src/auth/a.ts"]),
    ).toBe(false);
  });

  test("keeps matching skills in their configured order", () => {
    const selected = selectReviewSkills(
      [skill(), skill({ id: "all", name: "House rules", paths: [] })],
      "volnei/reviewly",
      ["src/auth/a.ts"],
    );
    expect(selected.map(({ id }) => id)).toEqual(["security", "all"]);
  });

  test("adds named skill instructions after the general standards", () => {
    const prompt = reviewInstructions("Keep reviews concise.", [skill()]);
    expect(prompt).toContain("Keep reviews concise.");
    expect(prompt).toContain("## Review skill: Security");
    expect(prompt).toContain("Check tenant boundaries.");
  });
});
