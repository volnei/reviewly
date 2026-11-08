import { expect, test } from "bun:test";

import {
  environmentPrompt,
  environmentSourcePaths,
  parseEnvironmentProposal,
} from "../src/features/environments/ai";

test("only includes manifests, project docs and current OpenSpec specs", () => {
  expect(
    environmentSourcePaths([
      ".env",
      ".env.local",
      "../README.md",
      "package.json",
      "openspec/specs/auth/spec.md",
      "openspec/changes/new/spec.md",
      "node_modules/a/package.json",
    ]),
  ).toEqual(["package.json", "openspec/specs/auth/spec.md"]);
});
const proposal = {
  name: "Development",
  variables: [{ key: "CAL_ENV_PREFIX" }],
  commands: [{ name: "Test", command: "bun test", workingDirectory: "" }],
  skills: [
    { name: "Auth", paths: ["src/**"], instructions: "Check the documented session cutoff." },
  ],
};
test("accepts key-only variables without inventing values", () => {
  expect(parseEnvironmentProposal(JSON.stringify(proposal)).variables).toEqual([
    { key: "CAL_ENV_PREFIX" },
  ]);
  expect(environmentPrompt([], ["CAL_ENV_PREFIX"])).toContain("empty values are valid");
});
test("rejects malformed output and directories outside the project", () => {
  expect(() => parseEnvironmentProposal("{}")).toThrow();
  expect(() =>
    parseEnvironmentProposal(
      JSON.stringify({
        ...proposal,
        commands: [{ name: "Test", command: "bun test", workingDirectory: "../other" }],
      }),
    ),
  ).toThrow();
});
