import { describe, expect, test } from "bun:test";
import {
  buildSpecDraftPrompt,
  buildSpecImplementationPrompt,
  buildSpecSearchPrompt,
  buildStoredSpecImplementationPrompt,
  describeSpecDraftFailure,
  parseSpecDraft,
  parseSpecExecutionResult,
  parseSpecSearchAnswer,
  specSourceFiles,
} from "../src/features/spec-lens/ai";
import type {
  SpecChange,
  SpecWorkspace,
} from "../src/features/spec-lens/model";
import { mergeSpecWorktreeChanges } from "../src/features/spec-lens/model";

const change: SpecChange = {
  id: "add-passkeys",
  title: "Add passkeys",
  summary: "Add passkey authentication.",
  stage: "apply",
  proposal_file: "openspec/changes/add-passkeys/proposal.md",
  design_file: "openspec/changes/add-passkeys/design.md",
  tasks_file: "openspec/changes/add-passkeys/tasks.md",
  tasks_total: 1,
  tasks_done: 0,
  tasks: [{ label: "Test replay", done: false }],
  requirements: [
    {
      name: "Replay protection",
      kind: "added",
      capability: "auth",
      file: "openspec/changes/add-passkeys/specs/auth/spec.md",
      scenarios: [],
    },
    {
      name: "Known credential",
      kind: "added",
      capability: "auth",
      file: "openspec/changes/add-passkeys/specs/auth/spec.md",
      scenarios: ["Success"],
    },
  ],
  issues: [],
  ready_to_archive: false,
};
const workspace: SpecWorkspace = {
  owner: "acme",
  repo: "web",
  path: "/repo",
  scan: {
    root: "/repo/openspec",
    config_file: null,
    source_specs: 2,
    source_spec_files: [
      "openspec/specs/auth/spec.md",
      "openspec/specs/recovery/spec.md",
      "openspec/specs/auth/spec.md",
    ],
    changes: [change],
  },
};

describe("Spec Lens AI search", () => {
  test("lists the change owned by an isolated spec worktree without duplicating inherited changes", () => {
    const isolated: SpecChange = {
      ...change,
      id: "add-device-trust",
      title: "Add device trust",
    };
    const merged = mergeSpecWorktreeChanges(workspace.scan, [
      {
        path: "/tmp/reviewly-worktrees/web/spec-add-device-trust",
        branch: "spec/add-device-trust/02-settings",
        scan: {
          ...workspace.scan,
          changes: [change, isolated],
        },
      },
    ]);
    expect(merged.changes.map((item) => item.id)).toEqual([
      "add-device-trust",
      "add-passkeys",
    ]);
    expect(merged.changes[0]?.worktree_path).toContain("spec-add-device-trust");
    expect(merged.changes[0]?.branch).toBe("spec/add-device-trust/02-settings");
  });

  test("indexes each OpenSpec artifact once", () => {
    expect(specSourceFiles(workspace)).toEqual([
      "openspec/specs/auth/spec.md",
      "openspec/specs/recovery/spec.md",
    ]);
  });

  test("grounds the question in supplied files", () => {
    const prompt = buildSpecSearchPrompt(
      workspace,
      "What governs authentication?",
      [{ path: "openspec/specs/auth/spec.md", content: "# Authentication" }],
    );
    expect(prompt).toContain("openspec/specs");
    expect(prompt).toContain("Active changes are deliberately excluded");
    expect(prompt).toContain("untrusted reference material");
    expect(prompt).toContain("Question: What governs authentication?");
    expect(prompt).toContain("## FILE: openspec/specs/auth/spec.md");
  });

  test("keeps only citations to indexed artifacts", () => {
    const answer = parseSpecSearchAnswer(
      JSON.stringify({
        answer: "Replay still needs a scenario.",
        sources: [
          { path: "openspec/specs/auth/spec.md", reason: "Current rule" },
          { path: "../../secrets", reason: "Invented" },
          { path: "openspec/specs/auth/spec.md", reason: "Duplicate" },
        ],
      }),
      specSourceFiles(workspace),
    );
    expect(answer.answer).toBe("Replay still needs a scenario.");
    expect(answer.sources).toEqual([
      { path: "openspec/specs/auth/spec.md", reason: "Current rule" },
    ]);
  });
});

describe("Spec Lens AI delivery", () => {
  const draft = {
    id: "add-device-trust",
    title: "Add device trust",
    summary: "Let users recognize and revoke trusted devices.",
    proposal: "# Add device trust\n\nMake active sessions recognizable.",
    design: "# Design\n\nStore a device label beside each session.",
    tasks: "# Tasks\n\n- [ ] Persist device metadata\n- [ ] Add tests",
    specs: [
      {
        capability: "sessions",
        content:
          "## ADDED Requirements\n\n### Requirement: Device visibility\n\n#### Scenario: Show a device\n- **WHEN** settings opens\n- **THEN** the device is visible",
      },
    ],
    delivery: {
      mode: "stack" as const,
      rationale: "The server contract can land before its settings UI.",
      pullRequests: [
        {
          id: "session-foundation",
          title: "Persist trusted session metadata",
          goal: "Add the storage and server-side revocation contract.",
          validation: "Run session model and API integration tests.",
        },
        {
          id: "device-settings",
          title: "Add trusted device settings",
          goal: "Expose device visibility and revocation in settings.",
          validation: "Run settings UI and end-to-end revocation tests.",
        },
      ],
    },
  };

  test("drafts against current app rules without claiming implementation", () => {
    const prompt = buildSpecDraftPrompt(workspace, "Show trusted devices", [
      "openspec/specs/auth/spec.md",
    ]);
    expect(prompt).toContain("current rules");
    expect(prompt).toContain("Search the repository");
    expect(prompt).toContain("Use only read/search tools");
    expect(prompt).toContain("concrete files or modules");
    expect(prompt).toContain('delivery.mode "stack"');
    expect(prompt).toContain("2-5 independently reviewable");
    expect(prompt).toContain("Request: Show trusted devices");
    expect(prompt).toContain("openspec/specs/auth/spec.md");
  });

  test("accepts complete spec drafts and rejects unsafe slugs", () => {
    expect(parseSpecDraft(JSON.stringify(draft))).toEqual(draft);
    expect(
      parseSpecDraft(JSON.stringify({ ...draft, id: "../../escape" })),
    ).toBeNull();
    expect(parseSpecDraft(JSON.stringify({ ...draft, specs: [] }))).toBeNull();
  });

  test("keeps publication outside the implementation agent", () => {
    const prompt = buildSpecImplementationPrompt(
      draft,
      draft.delivery.pullRequests[1],
      1,
    );
    expect(prompt).toContain("Do not commit, push, create a pull request");
    expect(prompt).toContain("openspec/changes/add-device-trust");
    expect(prompt).toContain("delivery 2 of 2");
    expect(prompt).toContain("Expose device visibility and revocation");
    expect(prompt).toContain("do not pull later slices forward");
  });

  test("can resume a persisted isolated spec without the original composer state", () => {
    const prompt = buildStoredSpecImplementationPrompt(change);
    expect(prompt).toContain("openspec/changes/add-passkeys");
    expect(prompt).toContain("PR title: Add passkeys");
    expect(prompt).toContain("Goal: Add passkey authentication.");
    expect(prompt).toContain("Do not commit, push, create a pull request");
  });

  test("falls back to one coherent PR for legacy drafts", () => {
    const { delivery: _delivery, ...legacyDraft } = draft;
    const parsed = parseSpecDraft(JSON.stringify(legacyDraft));
    expect(parsed?.delivery.mode).toBe("single");
    expect(parsed?.delivery.pullRequests).toHaveLength(1);
  });

  test("requires the implementation agent's explicit validation marker", () => {
    expect(
      parseSpecExecutionResult(
        'Done. <reviewly-result>{"ok":true,"summary":"Implemented device trust","tests":"bun test: pass"}</reviewly-result>',
      ),
    ).toEqual({
      ok: true,
      summary: "Implemented device trust",
      tests: "bun test: pass",
    });
    expect(parseSpecExecutionResult("Looks good to me.")).toBeNull();
  });

  test("explains an inactive draft without talking about pull requests", () => {
    const failure = describeSpecDraftFailure(
      "Claude produced no activity for 180s and was stopped. Try again.",
      "Claude",
    );
    expect(failure).toEqual({
      title: "Claude stopped responding",
      detail:
        "No activity arrived during the safety window. Nothing was created and your request is ready to retry.",
      timeout: true,
      durationSeconds: 180,
    });
    expect(failure.detail).not.toContain("PR");
  });
});
