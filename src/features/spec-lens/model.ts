import { isNative } from "@/effect/Tauri";
import { useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import { Effect } from "effect";
import { useMemo } from "react";

export type SpecStage = "proposal" | "specs" | "tasks" | "apply" | "verify";
export type SpecSeverity = "blocking" | "warning" | "note";

export interface SpecTask {
  label: string;
  done: boolean;
}

export interface SpecRequirement {
  name: string;
  kind: "added" | "modified" | "removed" | "renamed" | "specified";
  capability: string;
  file: string;
  scenarios: string[];
}

export interface SpecIssue {
  severity: SpecSeverity;
  title: string;
  detail: string;
  file: string | null;
}

export interface SpecChange {
  id: string;
  title: string;
  summary: string;
  stage: SpecStage;
  proposal_file: string | null;
  design_file: string | null;
  tasks_file: string | null;
  tasks_total: number;
  tasks_done: number;
  tasks: SpecTask[];
  requirements: SpecRequirement[];
  issues: SpecIssue[];
  ready_to_archive: boolean;
  worktree_path?: string | null;
  branch?: string | null;
}

export interface OpenSpecScan {
  root: string;
  config_file: string | null;
  source_specs: number;
  source_spec_files: string[];
  changes: SpecChange[];
}

export interface SpecWorkspace {
  owner: string;
  repo: string;
  path: string;
  scan: OpenSpecScan;
}

export interface SpecWorktreeScan {
  path: string;
  branch: string;
  scan: OpenSpecScan;
}

export function mergeSpecWorktreeChanges(
  primary: OpenSpecScan,
  worktrees: ReadonlyArray<SpecWorktreeScan>,
): OpenSpecScan {
  const isolated = worktrees.flatMap(({ path, branch, scan }) =>
    scan.changes
      .filter(
        (change) =>
          branch === `spec/${change.id}` ||
          branch.startsWith(`spec/${change.id}/`),
      )
      .map((change) => ({
        ...change,
        worktree_path: path,
        branch,
      })),
  );
  const isolatedIds = new Set(isolated.map((change) => change.id));
  return {
    ...primary,
    changes: [
      ...isolated,
      ...primary.changes.filter((change) => !isolatedIds.has(change.id)),
    ],
  };
}

export function useSpecWorkspaces(): ReadonlyArray<SpecWorkspace> {
  const paths = usePrefs((prefs) => prefs.localRepos);
  // The browser build is Reviewly's design fixture. Give it one believable
  // workspace so this Labs screen can be exercised without a native folder
  // picker; the Tauri app always scans only repositories the user added.
  const candidates = paths.length || isNative() ? paths : ["/fixture/reviewly"];
  const query = useEffectQuery(
    ["openspec-workspaces", candidates],
    Effect.forEach(
      candidates,
      (path) =>
        Effect.flatMap(Git, (git) =>
          Effect.gen(function* () {
            const [info, value, linked] = yield* Effect.all([
              git.repoInfo(path),
              git.openSpecScan(path),
              git.worktrees(path),
            ]);
            const primary = value as OpenSpecScan | null;
            if (!primary) return null;
            const worktreeScans = yield* Effect.forEach(
              linked.filter(
                (worktree) =>
                  worktree.path !== path &&
                  worktree.branch?.startsWith("spec/"),
              ),
              (worktree) =>
                git.openSpecScan(worktree.path).pipe(
                  Effect.map((worktreeValue) => {
                    const scan = worktreeValue as OpenSpecScan | null;
                    return scan && worktree.branch
                      ? {
                          path: worktree.path,
                          branch: worktree.branch,
                          scan,
                        }
                      : null;
                  }),
                  Effect.orElseSucceed(() => null),
                ),
              { concurrency: 4 },
            );
            const scan = mergeSpecWorktreeChanges(
              primary,
              worktreeScans.filter(
                (item): item is SpecWorktreeScan => item !== null,
              ),
            );
            const remote = info.remote_url?.match(
              /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/,
            );
            const fallback =
              path.split(/[\\/]/).filter(Boolean).at(-1) ?? "repository";
            return {
              owner: remote?.[1] ?? "local",
              repo: remote?.[2] ?? fallback,
              path,
              scan,
            } satisfies SpecWorkspace;
          }).pipe(Effect.orElseSucceed(() => null)),
        ),
      { concurrency: 2 },
    ),
    { staleTime: 10 * 60_000, enabled: candidates.length > 0 },
  );
  return useMemo(
    () =>
      (query.data ?? []).filter((item): item is SpecWorkspace => item !== null),
    [query.data],
  );
}

export const actionableIssueCount = (workspace: SpecWorkspace): number =>
  workspace.scan.changes.reduce(
    (total, change) =>
      total + change.issues.filter((issue) => issue.severity !== "note").length,
    0,
  );

export function buildSpecBrief(
  workspace: SpecWorkspace,
  change: SpecChange,
): string {
  const openTasks = change.tasks.filter((task) => !task.done);
  return [
    `# OpenSpec review: ${change.title}`,
    "",
    `Repository: ${workspace.owner}/${workspace.repo}`,
    `Change: ${change.id}`,
    `Stage: ${change.stage}`,
    `Tasks: ${change.tasks_done}/${change.tasks_total}`,
    "",
    "## Intent",
    change.summary,
    "",
    "## Requirements",
    ...change.requirements.map(
      (item) =>
        `- [${item.kind}] ${item.capability}: ${item.name} (${item.scenarios.length} scenario${item.scenarios.length === 1 ? "" : "s"})`,
    ),
    "",
    "## Next actions",
    ...(change.issues.length
      ? change.issues.map((issue) => `- ${issue.title}: ${issue.detail}`)
      : ["- Validate implementation evidence, then archive the change."]),
    ...openTasks.map((task) => `- Task: ${task.label}`),
  ].join("\n");
}
