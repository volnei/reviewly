import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { runtime } from "@/effect/runtime";
import { Ai } from "@/effect/services/Ai";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import { ListHead, Nothing } from "@/features/list/list";
import {
  type SpecChange,
  type SpecIssue,
  type SpecStage,
  type SpecWorkspace,
  buildSpecBrief,
  useSpecWorkspaces,
} from "@/features/spec-lens/model";
import { SpecSearch } from "@/features/spec-lens/search";
import {
  buildStoredSpecImplementationPrompt,
  parseSpecExecutionResult,
} from "@/features/spec-lens/ai";
import { toLocalId } from "@/lib/local-id";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  FileText,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";
import { Effect } from "effect";
import { useState } from "react";

const STAGES: ReadonlyArray<{ key: SpecStage; label: string }> = [
  { key: "proposal", label: "Proposal" },
  { key: "specs", label: "Specs" },
  { key: "tasks", label: "Tasks" },
  { key: "apply", label: "Apply" },
  { key: "verify", label: "Verify" },
];

export function SpecLensScreen() {
  useTitleSlot(
    <span className="text-[13px] text-ink-2">Labs / Spec Lens</span>,
    "desk",
  );
  const paths = usePrefs((prefs) => prefs.localRepos);
  const workspaces = useSpecWorkspaces();
  const queryClient = useQueryClient();
  const [workspacePath, setWorkspacePath] = useState("");
  const workspace =
    workspaces.find((item) => item.path === workspacePath) ??
    workspaces[0] ??
    null;
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["openspec-workspaces"] });

  return (
    <div className="screen-enter h-full overflow-y-auto bg-desk scrollbar-thin">
      <div className="flex items-baseline justify-between pr-5">
        <ListHead title="Spec Lens">
          {workspace
            ? `${workspace.owner}/${workspace.repo} · ${workspace.scan.changes.length} active change${workspace.scan.changes.length === 1 ? "" : "s"}.`
            : "OpenSpec changes translated into concrete review actions."}
        </ListHead>
        <Button variant="ghost" size="sm" onClick={refresh}>
          <RefreshCw className="size-3.5" /> Scan again
        </Button>
      </div>

      {workspace ? (
        <main className="mx-auto max-w-[1380px] px-5 pb-14">
          {workspaces.length > 1 ? (
            <div
              className="mb-5 flex gap-5 border-b border-hair"
              aria-label="OpenSpec workspaces"
            >
              {workspaces.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setWorkspacePath(item.path)}
                  className={cn(
                    "relative h-9 text-[12.5px] text-ink-3 hover:text-ink",
                    item.path === workspace.path &&
                      "text-ink after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-px after:bg-workspace",
                  )}
                >
                  {item.owner}/{item.repo}
                </button>
              ))}
            </div>
          ) : null}
          <SpecSearch key={workspace.path} workspace={workspace} />
          {workspace.scan.changes.length ? (
            <LensWorkspace key={workspace.path} workspace={workspace} />
          ) : (
            <Nothing detail="The OpenSpec workspace is valid, but it has no active changes under openspec/changes. Archived and source specs stay untouched.">
              No active OpenSpec changes
            </Nothing>
          )}
        </main>
      ) : (
        <Nothing
          detail={
            paths.length
              ? "None of your local repositories contains an openspec/ directory yet. This Lab appears automatically when Reviewly detects one."
              : "Add a local repository first. Reviewly enables this Lab automatically when it finds openspec/."
          }
        >
          No OpenSpec workspace detected
        </Nothing>
      )}
    </div>
  );
}

function LensWorkspace({ workspace }: { workspace: SpecWorkspace }) {
  const [selectedId, setSelectedId] = useState(
    workspace.scan.changes[0]?.id ?? "",
  );
  const change =
    workspace.scan.changes.find((item) => item.id === selectedId) ??
    workspace.scan.changes[0];
  const ready = workspace.scan.changes.filter(
    (item) => item.ready_to_archive,
  ).length;
  const requirements = workspace.scan.changes.reduce(
    (total, item) => total + item.requirements.length,
    0,
  );
  const blocking = workspace.scan.changes.reduce(
    (total, item) =>
      total +
      item.issues.filter((issue) => issue.severity === "blocking").length,
    0,
  );

  if (!change) return null;
  return (
    <section className="overflow-hidden rounded-lg border border-hair bg-page">
      <div className="grid min-h-[34rem] grid-cols-[280px_minmax(0,1fr)] max-[900px]:grid-cols-1">
        <aside className="border-r border-hair max-[900px]:border-r-0 max-[900px]:border-b">
          <div className="grid grid-cols-3 border-b border-hair px-4 py-3.5">
            <Metric label="Changes" value={workspace.scan.changes.length} />
            <Metric label="Requirements" value={requirements} />
            <Metric label="Ready" value={ready} />
          </div>
          {blocking ? (
            <p className="border-b border-hair px-4 py-2.5 text-[11.5px] text-ink-3">
              {blocking} blocking action{blocking === 1 ? "" : "s"} across this
              workspace
            </p>
          ) : null}
          <div className="p-2" aria-label="Active OpenSpec changes">
            {workspace.scan.changes.map((item) => (
              <ChangeRow
                key={item.id}
                change={item}
                selected={item.id === change.id}
                onSelect={() => setSelectedId(item.id)}
              />
            ))}
          </div>
          <p className="px-4 pt-2 pb-4 text-[11px] text-ink-3">
            {workspace.scan.source_specs} source spec
            {workspace.scan.source_specs === 1 ? "" : "s"}
            {workspace.scan.config_file ? " · configured" : " · default schema"}
          </p>
        </aside>
        <ChangeDetail
          key={`${change.worktree_path ?? workspace.path}:${change.id}`}
          workspace={workspace}
          change={change}
        />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-mono text-[15px] tabular-nums text-ink">{value}</p>
      <p className="text-[10.5px] text-ink-3">{label}</p>
    </div>
  );
}

function ChangeRow({
  change,
  selected,
  onSelect,
}: {
  change: SpecChange;
  selected: boolean;
  onSelect: () => void;
}) {
  const actionable = change.issues.filter(
    (issue) => issue.severity !== "note",
  ).length;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "mb-1 w-full rounded-md px-3 py-3 text-left transition-colors hover:bg-raise/55",
        selected && "bg-raise",
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {change.title}
          </span>
          <span className="mt-1 block truncate font-mono text-[10.5px] text-ink-3">
            {change.id}
          </span>
          {change.branch ? (
            <span className="mt-1 block truncate text-[10px] text-ink-3">
              Isolated · {change.branch}
            </span>
          ) : null}
        </span>
        {change.ready_to_archive ? (
          <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-add" />
        ) : actionable ? (
          <span className="font-mono text-[11px] tabular-nums text-amber">
            {actionable}
          </span>
        ) : null}
      </span>
      <span className="mt-2 flex items-center justify-between text-[10.5px] text-ink-3">
        <span>{stageLabel(change.stage)}</span>
        <span className="font-mono tabular-nums">
          {change.tasks_done}/{change.tasks_total} tasks
        </span>
      </span>
    </button>
  );
}

function ChangeDetail({
  workspace,
  change,
}: {
  workspace: SpecWorkspace;
  change: SpecChange;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [implementing, setImplementing] = useState(false);
  const [implementationError, setImplementationError] = useState<string | null>(
    null,
  );
  const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
  const nextIssue =
    change.issues.find((issue) => issue.severity === "blocking") ??
    change.issues.find((issue) => issue.severity === "warning") ??
    change.issues[0] ??
    null;
  const incomplete = change.tasks.filter((task) => !task.done);
  const completeRequirements = change.requirements.filter(
    (item) => item.scenarios.length > 0,
  ).length;
  const progress = change.tasks_total
    ? Math.round((change.tasks_done / change.tasks_total) * 100)
    : 0;

  const openFile = (file: string | null) => {
    if (!file) return;
    const sourcePath = change.worktree_path ?? workspace.path;
    void navigate({
      to: "/local/$id",
      params: { id: toLocalId(sourcePath) },
      search: { file, from: "spec-lens" },
    });
  };

  const copyBrief = () => {
    navigator.clipboard
      .writeText(buildSpecBrief(workspace, change))
      .then(() =>
        toast.say(
          "Review brief copied",
          "Intent, requirements and next actions are ready.",
        ),
      )
      .catch(() => toast.fail("Couldn’t copy the review brief"));
  };

  const implementChange = async () => {
    const worktreePath = change.worktree_path;
    if (!worktreePath || implementing) return;
    setImplementing(true);
    setImplementationError(null);
    try {
      const output = await runtime.runPromise(
        Effect.flatMap(Ai, (service) =>
          service.apply(
            buildStoredSpecImplementationPrompt(change),
            worktreePath,
          ),
        ),
      );
      const result = parseSpecExecutionResult(output);
      if (!result) {
        throw new Error("The agent finished without a verifiable result.");
      }
      if (!result.ok) {
        throw new Error(result.summary || "The implementation did not finish.");
      }
      const status = await runtime.runPromise(
        Effect.flatMap(Git, (git) => git.status(worktreePath)),
      );
      if (!status.staged.length && !status.unstaged.length) {
        throw new Error(
          "The agent reported success but left no changes to publish.",
        );
      }
      let baseBranch: string | null = null;
      try {
        const branches = await runtime.runPromise(
          Effect.flatMap(Git, (git) => git.branches(workspace.path)),
        );
        baseBranch = branches.default || null;
      } catch {
        // gh can still select the repository's default branch when omitted.
      }
      await runtime.runPromise(
        Effect.flatMap(Git, (git) => git.stage(worktreePath, null)),
      );
      await runtime.runPromise(
        Effect.flatMap(Git, (git) =>
          git.commit(worktreePath, `feat: ${change.title}`),
        ),
      );
      const url = await runtime.runPromise(
        Effect.flatMap(Git, (git) =>
          git.createPr(
            worktreePath,
            change.title,
            [
              `Implements OpenSpec change \`${change.id}\`.`,
              "",
              change.summary,
              "",
              "## Implementation",
              result.summary,
              "",
              "## Validation",
              result.tests,
              "",
              "_Created from Spec Lens._",
            ].join("\n"),
            baseBranch,
          ),
        ),
      );
      setPullRequestUrl(url);
      await queryClient.invalidateQueries({
        queryKey: ["openspec-workspaces"],
      });
      toast.say("Pull request opened", change.title);
    } catch (cause) {
      setImplementationError(
        cause instanceof Error
          ? cause.message
          : "The implementation did not finish.",
      );
    } finally {
      setImplementing(false);
    }
  };

  return (
    <div className="min-w-0">
      <header className="border-b border-hair px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="mb-1 font-mono text-[10.5px] text-ink-3">
              {change.id}
            </p>
            {change.branch ? (
              <p className="mb-1 text-[10.5px] text-ink-3">
                Isolated worktree ·{" "}
                <span className="font-mono">{change.branch}</span>
              </p>
            ) : null}
            <h2 className="truncate text-[18px] font-medium tracking-[-0.02em] text-ink">
              {change.title}
            </h2>
            <p className="mt-1.5 max-w-3xl text-[12.5px] leading-5 text-ink-2">
              {change.summary}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={copyBrief}>
              <Copy className="size-3.5" /> Copy review brief
            </Button>
            {change.worktree_path ? (
              pullRequestUrl ? (
                <Button
                  size="sm"
                  onClick={() => void safeOpenUrl(pullRequestUrl)}
                >
                  <ExternalLink className="size-3.5" /> Open pull request
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => void implementChange()}
                  disabled={implementing}
                >
                  {implementing ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  {implementing ? "Implementing…" : "Implement & open PR"}
                </Button>
              )
            ) : null}
          </div>
        </div>
        {implementationError ? (
          <div className="mt-3 flex items-start justify-between gap-4 rounded-md bg-del/8 px-3 py-2.5 text-[11.5px] leading-4 text-del">
            <span>{implementationError}</span>
            <button
              type="button"
              className="shrink-0 font-medium text-ink hover:text-del"
              onClick={() => void implementChange()}
            >
              Retry
            </button>
          </div>
        ) : implementing ? (
          <p className="mt-3 text-[11.5px] text-ink-2">
            The agent is editing and validating this isolated worktree. It will
            commit, push and open the pull request only after the checks pass.
          </p>
        ) : null}
        <StageLine change={change} />
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_310px] max-[1100px]:grid-cols-1">
        <div className="min-w-0 px-6 py-5">
          <section aria-labelledby="next-action">
            <p
              id="next-action"
              className="mb-2 text-[11px] font-medium text-ink-3"
            >
              Next action
            </p>
            {nextIssue ? (
              <button
                type="button"
                onClick={() => openFile(nextIssue.file ?? fallbackFile(change))}
                className="group flex w-full items-start gap-3 rounded-md bg-sink px-4 py-3.5 text-left hover:bg-raise/70"
              >
                <CircleAlert
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    nextIssue.severity === "blocking"
                      ? "text-del"
                      : "text-amber",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-ink">
                    {nextIssue.title}
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-[18px] text-ink-2">
                    {nextIssue.detail}
                  </span>
                </span>
                <ChevronRight className="mt-1 size-3.5 shrink-0 text-ink-3 group-hover:text-ink" />
              </button>
            ) : (
              <div className="flex items-start gap-3 rounded-md bg-sink px-4 py-3.5">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-add" />
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    Ready for archive review
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-2">
                    All declared tasks are complete and every requirement has a
                    scenario.
                  </p>
                </div>
              </div>
            )}
          </section>

          <section className="mt-6" aria-labelledby="requirements-title">
            <div className="mb-2 flex items-baseline justify-between">
              <h3
                id="requirements-title"
                className="text-[12px] font-medium text-ink"
              >
                Behavior delta
              </h3>
              <span className="font-mono text-[10.5px] tabular-nums text-ink-3">
                {completeRequirements}/{change.requirements.length}{" "}
                scenario-backed
              </span>
            </div>
            <div className="border-y border-hair">
              {change.requirements.length ? (
                change.requirements.map((requirement, index) => (
                  <button
                    type="button"
                    key={`${requirement.file}:${requirement.name}`}
                    onClick={() => openFile(requirement.file)}
                    className={cn(
                      "group grid w-full grid-cols-[82px_minmax(0,1fr)_90px_18px] items-center gap-3 py-3 text-left hover:bg-raise/35",
                      index > 0 && "border-t border-hair",
                    )}
                  >
                    <span className="pl-2 text-[10.5px] capitalize text-ink-3">
                      {requirement.kind}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-ink">
                        {requirement.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-3">
                        {requirement.capability}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "text-right font-mono text-[10.5px] tabular-nums",
                        requirement.scenarios.length
                          ? "text-ink-3"
                          : "text-amber",
                      )}
                    >
                      {requirement.scenarios.length
                        ? `${requirement.scenarios.length} scenario${requirement.scenarios.length === 1 ? "" : "s"}`
                        : "Missing"}
                    </span>
                    <ChevronRight className="size-3 text-ink-3 opacity-0 group-hover:opacity-100" />
                  </button>
                ))
              ) : (
                <p className="px-2 py-4 text-[11.5px] text-ink-3">
                  No requirement delta found under this change’s specs
                  directory.
                </p>
              )}
            </div>
          </section>

          {change.issues.length > 1 ? (
            <section className="mt-6" aria-labelledby="readiness-title">
              <h3
                id="readiness-title"
                className="mb-2 text-[12px] font-medium text-ink"
              >
                Readiness checks
              </h3>
              <div className="space-y-1">
                {change.issues.map((issue) => (
                  <IssueRow
                    key={`${issue.severity}:${issue.title}`}
                    issue={issue}
                    openFile={openFile}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="border-l border-hair px-5 py-5 max-[1100px]:border-t max-[1100px]:border-l-0">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[12px] font-medium text-ink">
              Implementation tasks
            </h3>
            <span className="font-mono text-[10.5px] tabular-nums text-ink-3">
              {progress}%
            </span>
          </div>
          <div className="mt-2 h-0.5 overflow-hidden bg-raise">
            <div
              className="h-full bg-workspace"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 space-y-0.5">
            {change.tasks.length ? (
              change.tasks.map((task) => (
                <button
                  type="button"
                  key={task.label}
                  onClick={() => openFile(change.tasks_file)}
                  className="flex w-full items-start gap-2 rounded px-1 py-1.5 text-left hover:bg-raise/45"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                      task.done
                        ? "border-add/40 bg-add/12 text-add"
                        : "border-edge",
                    )}
                  >
                    {task.done ? <Check className="size-2.5" /> : null}
                  </span>
                  <span
                    className={cn(
                      "text-[11.5px] leading-[18px]",
                      task.done ? "text-ink-3" : "text-ink-2",
                    )}
                  >
                    {task.label}
                  </span>
                </button>
              ))
            ) : (
              <p className="py-2 text-[11.5px] text-ink-3">
                No checkable tasks yet.
              </p>
            )}
          </div>

          <h3 className="mt-7 mb-2 text-[12px] font-medium text-ink">
            Artifacts
          </h3>
          <div className="border-y border-hair">
            <Artifact
              label="Proposal"
              file={change.proposal_file}
              openFile={openFile}
            />
            <Artifact
              label="Design"
              file={change.design_file}
              openFile={openFile}
            />
            <Artifact
              label="Tasks"
              file={change.tasks_file}
              openFile={openFile}
            />
          </div>
          {incomplete.length ? (
            <p className="mt-4 text-[10.5px] leading-4 text-ink-3">
              Finish {incomplete.length} task
              {incomplete.length === 1 ? "" : "s"} before archive review.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function StageLine({ change }: { change: SpecChange }) {
  const active = STAGES.findIndex((stage) => stage.key === change.stage);
  return (
    <div
      className="mt-5 flex items-center"
      aria-label={`Current stage: ${stageLabel(change.stage)}`}
    >
      {STAGES.map((stage, index) => {
        const reached = index <= active;
        return (
          <div
            key={stage.key}
            className="flex flex-1 items-center last:flex-none"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  reached ? "bg-workspace" : "bg-raise",
                  index === active && "ring-2 ring-workspace/20",
                )}
              />
              <span
                className={cn(
                  "text-[10.5px]",
                  reached ? "text-ink-2" : "text-ink-3",
                )}
              >
                {stage.label}
              </span>
            </div>
            {index < STAGES.length - 1 ? (
              <span
                className={cn(
                  "mx-3 h-px flex-1",
                  index < active ? "bg-workspace/40" : "bg-hair",
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function IssueRow({
  issue,
  openFile,
}: {
  issue: SpecIssue;
  openFile: (file: string | null) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => openFile(issue.file)}
      disabled={!issue.file}
      className="flex w-full items-start gap-2.5 rounded px-2 py-2 text-left enabled:hover:bg-raise/40"
    >
      <span
        className={cn(
          "mt-[7px] size-1.5 shrink-0 rounded-full",
          issue.severity === "blocking"
            ? "bg-del"
            : issue.severity === "warning"
              ? "bg-amber"
              : "bg-ink-3",
        )}
      />
      <span className="min-w-0">
        <span className="block text-[11.5px] text-ink-2">{issue.title}</span>
        <span className="block truncate text-[10.5px] text-ink-3">
          {issue.detail}
        </span>
      </span>
    </button>
  );
}

function Artifact({
  label,
  file,
  openFile,
}: {
  label: string;
  file: string | null;
  openFile: (file: string | null) => void;
}) {
  return (
    <button
      type="button"
      disabled={!file}
      onClick={() => openFile(file)}
      className="flex w-full items-center gap-2 border-b border-hair px-1 py-2.5 text-left last:border-b-0 enabled:hover:bg-raise/35"
    >
      <FileText className="size-3.5 text-ink-3" />
      <span className="flex-1 text-[11.5px] text-ink-2">{label}</span>
      <span className={cn("text-[10.5px]", file ? "text-ink-3" : "text-amber")}>
        {file ? "Open" : "Missing"}
      </span>
    </button>
  );
}

function fallbackFile(change: SpecChange): string | null {
  return (
    change.proposal_file ??
    change.tasks_file ??
    change.requirements[0]?.file ??
    null
  );
}

function stageLabel(stage: SpecStage): string {
  return STAGES.find((item) => item.key === stage)?.label ?? stage;
}
