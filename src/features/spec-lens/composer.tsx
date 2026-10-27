import { settingsCategoryStore } from "@/app/settings-navigation";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { runtime } from "@/effect/runtime";
import { Ai, providerName } from "@/effect/services/Ai";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import {
  cancelBackground,
  startBackground,
  useBackgroundRun,
} from "@/features/pr/ai";
import { Markdown } from "@/features/pr/markdown";
import { safeOpenUrl } from "@/lib/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  buildSpecDraftPrompt,
  buildSpecImplementationPrompt,
  describeSpecDraftFailure,
  parseSpecDraft,
  parseSpecExecutionResult,
  specSourceFiles,
} from "./ai";
import type { SpecWorkspace } from "./model";

type Busy = "branch" | "implement" | null;

const draftRequests = new Map<string, string>();
const draftStartTimes = new Map<string, number>();
const canceledDrafts = new Set<string>();
const EMPTY_RUN = {
  text: "",
  running: false,
  error: null,
  progress: null,
} as const;

export function SpecComposer({
  workspace,
  onClose,
}: {
  workspace: SpecWorkspace;
  onClose: () => void;
}) {
  const draftKey = `spec-draft:${workspace.path}`;
  const [request, setRequest] = useState(
    () => draftRequests.get(workspace.path) ?? "",
  );
  const [draftCanceled, setDraftCanceled] = useState(() =>
    canceledDrafts.has(workspace.path),
  );
  const [draftStartedAt, setDraftStartedAt] = useState<number | null>(
    () => draftStartTimes.get(workspace.path) ?? null,
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const [prUrls, setPrUrls] = useState<ReadonlyArray<string>>([]);
  const [execution, setExecution] = useState<
    ReadonlyArray<{
      title: string;
      summary: string;
      tests: string;
    }>
  >([]);
  const aiPrefs = usePrefs((prefs) => prefs.ai);
  const provider = aiPrefs.provider;
  const ai = useBackgroundRun(draftKey) ?? EMPTY_RUN;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const files = useMemo(() => specSourceFiles(workspace), [workspace]);
  const draft = ai.text && !ai.running ? parseSpecDraft(ai.text) : null;
  const deliveryCount = draft?.delivery.pullRequests.length ?? 1;
  const isStack = deliveryCount > 1;
  const deliveryComplete = draft
    ? prUrls.length === draft.delivery.pullRequests.length
    : false;
  const generatingDraft = ai.running;
  const draftFailure =
    ai.error && !generatingDraft
      ? describeSpecDraftFailure(ai.error, providerName(provider))
      : null;
  const draftIdleTimeoutSeconds =
    aiPrefs.timeoutSecs > 0 ? aiPrefs.timeoutSecs : 900;
  const telemetry = ai.progress;
  const activeStep = created
    ? 3
    : draft || (ai.running && telemetry?.phase === "writing")
      ? 2
      : ai.running
        ? 1
        : 0;
  const journey = [
    { label: "Your idea", detail: "Describe the behavior" },
    { label: `${files.length} app rules`, detail: "Read as constraints" },
    { label: "Spec review", detail: "Proposal, scenarios, tasks" },
    {
      label: isStack ? `${deliveryCount}-PR stack` : "Pull request",
      detail: isStack ? "Ordered by dependency" : "Only after approval",
    },
  ];
  const telemetryItems = [
    telemetry?.model ? { label: "Model", value: telemetry.model } : null,
    telemetry?.inputTokens != null
      ? {
          label: "Input",
          value: `${telemetry.inputTokens.toLocaleString()} tokens`,
        }
      : null,
    telemetry?.cachedTokens != null
      ? {
          label: "Cache",
          value: `${telemetry.cachedTokens.toLocaleString()} tokens`,
        }
      : null,
    telemetry?.outputTokens != null
      ? {
          label: "Output",
          value: `${telemetry.outputTokens.toLocaleString()} tokens`,
        }
      : null,
    telemetry?.costUsd != null
      ? { label: "Cost", value: `$${telemetry.costUsd.toFixed(4)}` }
      : null,
    telemetry?.turns != null
      ? { label: "Turns", value: telemetry.turns.toLocaleString() }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  useEffect(() => {
    if (!generatingDraft || draftStartedAt === null) return;
    const update = () =>
      setElapsedSeconds(Math.floor((Date.now() - draftStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [draftStartedAt, generatingDraft]);

  const generate = () => {
    const intent = request.trim();
    if (!intent || generatingDraft) return;
    setError(null);
    setDraftCanceled(false);
    canceledDrafts.delete(workspace.path);
    const startedAt = Date.now();
    draftStartTimes.set(workspace.path, startedAt);
    setDraftStartedAt(startedAt);
    setElapsedSeconds(0);
    startBackground(
      draftKey,
      buildSpecDraftPrompt(workspace, intent, files),
      workspace.path,
      `Drafting ${workspace.repo} spec`,
      () =>
        toast.say(
          "Spec draft ready",
          "Review the proposal before creating its branch.",
        ),
      "/spec-lens",
    );
  };

  const createSpec = async () => {
    if (!draft || busy) return;
    setBusy("branch");
    setError(null);
    try {
      const info = await runtime.runPromise(
        Effect.flatMap(Git, (git) => git.repoInfo(workspace.path)),
      );
      const isolatedPath = await runtime.runPromise(
        Effect.flatMap(Git, (git) =>
          git.createWorktree(workspace.path, `spec/${draft.id}`),
        ),
      );
      await runtime.runPromise(
        Effect.flatMap(Git, (git) =>
          git.createOpenSpecChange({
            path: isolatedPath,
            id: draft.id,
            proposal: draft.proposal,
            design: draft.design,
            tasks: draft.tasks,
            specs: draft.specs,
          }),
        ),
      );
      setBaseBranch(info.current_branch || null);
      setWorktreePath(isolatedPath);
      setCreated(true);
      await queryClient.invalidateQueries({
        queryKey: ["openspec-workspaces"],
      });
      toast.say(
        "Isolated worktree ready",
        `spec/${draft.id} was created without touching your checkout.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t create the spec branch.",
      );
    } finally {
      setBusy(null);
    }
  };

  const implement = async () => {
    if (!draft || !created || !worktreePath || busy) return;
    setBusy("implement");
    setError(null);
    try {
      const branchFor = (index: number) => {
        const pullRequest = draft.delivery.pullRequests[index];
        return index === 0
          ? `spec/${draft.id}`
          : `spec/${draft.id}/${String(index + 1).padStart(2, "0")}-${pullRequest.id}`;
      };
      const startIndex = prUrls.length;
      let parentBranch =
        startIndex === 0 ? baseBranch : branchFor(startIndex - 1);
      const urls = [...prUrls];
      const completed: Array<{
        title: string;
        summary: string;
        tests: string;
      }> = [...execution];
      for (const [
        index,
        pullRequest,
      ] of draft.delivery.pullRequests.entries()) {
        if (index < startIndex) continue;
        const branch = branchFor(index);
        if (index > 0) {
          const info = await runtime.runPromise(
            Effect.flatMap(Git, (git) => git.repoInfo(worktreePath)),
          );
          if (info.current_branch !== branch) {
            await runtime.runPromise(
              Effect.flatMap(Git, (git) =>
                git.createBranch(worktreePath, branch),
              ),
            );
          }
        }
        const output = await runtime.runPromise(
          Effect.flatMap(Ai, (service) =>
            service.apply(
              buildSpecImplementationPrompt(draft, pullRequest, index),
              worktreePath,
            ),
          ),
        );
        const result = parseSpecExecutionResult(output);
        if (!result)
          throw new Error(
            `PR ${index + 1} finished without a verifiable result.`,
          );
        completed.push({
          title: pullRequest.title,
          summary: result.summary,
          tests: result.tests,
        });
        setExecution([...completed]);
        if (!result.ok) {
          throw new Error(
            result.summary ||
              `PR ${index + 1} implementation or validation did not finish.`,
          );
        }
        const status = await runtime.runPromise(
          Effect.flatMap(Git, (git) => git.status(worktreePath)),
        );
        if (!status.staged.length && !status.unstaged.length) {
          throw new Error(
            `PR ${index + 1} reported success but left no changes to publish.`,
          );
        }
        await runtime.runPromise(
          Effect.flatMap(Git, (git) => git.stage(worktreePath, null)),
        );
        await runtime.runPromise(
          Effect.flatMap(Git, (git) =>
            git.commit(worktreePath, `feat: ${pullRequest.title}`),
          ),
        );
        const url = await runtime.runPromise(
          Effect.flatMap(Git, (git) =>
            git.createPr(
              worktreePath,
              pullRequest.title,
              [
                `Implements OpenSpec change \`${draft.id}\`.`,
                isStack
                  ? `Stack ${index + 1}/${deliveryCount}. Base: \`${parentBranch ?? "default branch"}\`.`
                  : draft.summary,
                "",
                "## Goal",
                pullRequest.goal,
                "",
                "## Implementation",
                result.summary,
                "",
                "## Validation",
                result.tests,
                "",
                "_Created from Spec Lens._",
              ].join("\n"),
              parentBranch,
            ),
          ),
        );
        urls.push(url);
        setPrUrls([...urls]);
        parentBranch = branch;
      }
      await queryClient.invalidateQueries({
        queryKey: ["openspec-workspaces"],
      });
      toast.say(
        isStack ? "Pull request stack opened" : "Pull request opened",
        isStack
          ? `${deliveryCount} dependent PRs are ready for review.`
          : draft.title,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The implementation didn’t finish.",
      );
    } finally {
      setBusy(null);
    }
  };

  const openAiSettings = () => {
    settingsCategoryStore.set("assistant");
    void navigate({ to: "/settings" });
  };

  return (
    <section
      className="mt-3 overflow-hidden rounded-xl bg-card p-4 ring-1 ring-edge/70 shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
      data-ui
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[16px] font-medium tracking-[-0.01em] text-ink">
            Build the change from intent
          </h3>
          <p className="mt-1 text-[11.5px] leading-4 text-ink-3">
            {providerName(provider)} grounds the draft in your current product
            rules. Nothing is written until you review it.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-3 hover:text-ink"
          aria-label="Close spec creator"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <ol
        className="mt-4 grid grid-cols-4 overflow-hidden rounded-lg bg-page/65 max-[1100px]:grid-cols-2"
        aria-label="Spec delivery flow"
      >
        {journey.map((step, index) => (
          <li
            key={step.label}
            className="flex min-w-0 items-center gap-2.5 border-l border-hair px-3 py-2.5 first:border-l-0 max-[1100px]:nth-3:border-t max-[1100px]:nth-3:border-l-0 max-[1100px]:nth-4:border-t"
            aria-current={index === activeStep ? "step" : undefined}
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${
                index < activeStep
                  ? "bg-add"
                  : index === activeStep
                    ? "bg-ink"
                    : "bg-ink-3/35"
              }`}
              aria-hidden="true"
            />
            <span className="min-w-0">
              <span
                className={`block truncate text-[11px] font-medium ${
                  index <= activeStep ? "text-ink" : "text-ink-3"
                }`}
              >
                {step.label}
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {!draft ? (
        <div
          className="mt-4 overflow-hidden rounded-lg bg-page ring-1 ring-input transition-shadow focus-within:ring-2 focus-within:ring-ring/70"
          aria-busy={generatingDraft}
        >
          <label
            htmlFor="spec-lens-request"
            className="block px-3 pt-3 text-[11.5px] font-medium text-ink-2"
          >
            What should change?
          </label>
          <Textarea
            id="spec-lens-request"
            size="sm"
            unstyled
            value={request}
            onChange={(event) => {
              const value = event.target.value;
              draftRequests.set(workspace.path, value);
              setRequest(value);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void generate();
              }
            }}
            disabled={generatingDraft}
            placeholder="For example: let workspace owners revoke one trusted device without ending their current session…"
            aria-label="Describe the product change"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            className="block w-full [&_textarea]:min-h-24 [&_textarea]:px-3 [&_textarea]:pt-2 [&_textarea]:pb-4 [&_textarea]:text-[13px] [&_textarea]:leading-5"
          />
          <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-hair bg-raise/30 px-3 py-2">
            <div className="flex min-w-0 items-center gap-x-4 text-[10.5px] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full bg-add"
                  aria-hidden="true"
                />
                {files.length} current rules ready
              </span>
              <span className="truncate max-[1100px]:hidden">
                Proposal, scenarios and implementation plan
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => void generate()}
              disabled={!request.trim()}
              loading={generatingDraft}
              title="Draft the spec (Command or Control + Enter)"
            >
              {draftFailure ? (
                <>
                  <RotateCcw className="size-3.5" /> Try again
                </>
              ) : (
                <>
                  Draft the spec <ChevronRight className="size-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {generatingDraft ? (
        <div className="mt-3 bg-raise/55 px-3 py-2.5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="ai-dot mt-1 size-1.5 shrink-0 rounded-full" />
              <div aria-live="polite" aria-atomic="true">
                <p className="text-[11.5px] font-medium text-ink">
                  {telemetry?.message
                    ? telemetry.message
                    : ai.text
                      ? `Receiving the draft from ${providerName(provider)}`
                      : `Waiting for ${providerName(provider)}’s first response`}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-4 text-ink-3">
                  {ai.text
                    ? `${ai.text.length.toLocaleString()} characters received so far.`
                    : telemetry?.phase === "exploring"
                      ? "Following the relevant rules, implementation paths and tests."
                      : "It will inspect the repository before writing the proposal, scenarios and tasks."}
                </p>
              </div>
            </div>
            {ai.running ? (
              <button
                type="button"
                onClick={() => {
                  setDraftCanceled(true);
                  canceledDrafts.add(workspace.path);
                  cancelBackground(draftKey);
                }}
                className="shrink-0 text-[10.5px] text-ink-3 hover:text-ink"
              >
                Cancel
              </button>
            ) : null}
          </div>
          {telemetryItems.length ? (
            <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-hair/70 pt-2">
              {telemetryItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-baseline gap-1.5 text-[10.5px]"
                >
                  <dt className="text-ink-3">{item.label}</dt>
                  <dd className="font-mono text-ink-2">{item.value}</dd>
                </div>
              ))}
              {telemetry?.sessionId ? (
                <div className="flex items-baseline gap-1.5 text-[10.5px]">
                  <dt className="text-ink-3">Session</dt>
                  <dd className="font-mono text-ink-2">
                    …{telemetry.sessionId.slice(-8)}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-hair/70 pt-2 text-[10.5px] text-ink-3">
            <span>
              {ai.text
                ? "Draft arriving"
                : telemetry?.phase === "exploring"
                  ? "Repository discovery"
                  : "Model working"}
            </span>
            <span
              className="tabular-nums"
              aria-label="Elapsed time and inactivity protection"
            >
              {Math.floor(elapsedSeconds / 60)}:
              {String(elapsedSeconds % 60).padStart(2, "0")} elapsed ·{" "}
              {Math.floor(draftIdleTimeoutSeconds / 60)}:
              {String(draftIdleTimeoutSeconds % 60).padStart(2, "0")} idle guard
            </span>
          </div>
        </div>
      ) : null}

      {draftCanceled && !ai.running ? (
        <p className="mt-3 text-[11.5px] text-ink-3">
          Draft canceled. Your prompt is still here.
        </p>
      ) : null}

      {ai.text && !ai.running && !draft && !draftCanceled && !ai.error ? (
        <p className="mt-3 text-[11.5px] text-del">
          The model returned an incomplete spec. Try a more concrete prompt.
        </p>
      ) : null}

      {draft ? (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_260px] gap-6 max-[860px]:grid-cols-1">
          <div>
            <p className="font-mono text-[10px] text-ink-3">{draft.id}</p>
            <h4 className="mt-1 text-[15px] font-medium text-ink">
              {draft.title}
            </h4>
            <p className="mt-1 text-[11.5px] leading-[18px] text-ink-2">
              {draft.summary}
            </p>
            {telemetry?.phase === "complete" ? (
              <p className="mt-2 font-mono text-[9.5px] text-ink-3">
                Generated{telemetry.model ? ` by ${telemetry.model}` : ""}
                {telemetry.outputTokens != null
                  ? ` · ${telemetry.outputTokens.toLocaleString()} output tokens`
                  : ""}
                {telemetry.costUsd != null
                  ? ` · $${telemetry.costUsd.toFixed(4)}`
                  : ""}
                {telemetry.durationMs != null
                  ? ` · ${(telemetry.durationMs / 1000).toFixed(1)}s`
                  : ""}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] text-ink-3">
              <span>
                {draft.specs.length} capability delta
                {draft.specs.length === 1 ? "" : "s"}
              </span>
              <span>
                {(draft.tasks.match(/^- \[ \]/gm) ?? []).length} implementation
                tasks
              </span>
              <span>
                {isStack ? `${deliveryCount}-PR stack` : "1 pull request"}
              </span>
            </div>
            <div className="mt-3 border-y border-hair">
              <div className="py-2.5">
                <p className="text-[10.5px] font-medium text-ink-2">
                  {isStack
                    ? `${deliveryCount} pull requests, delivered in order`
                    : "One pull request"}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-4 text-ink-3">
                  {draft.delivery.rationale}
                </p>
              </div>
              {isStack ? (
                <ol className="border-t border-hair">
                  {draft.delivery.pullRequests.map((pullRequest, index) => (
                    <li
                      key={pullRequest.id}
                      className="grid grid-cols-[24px_minmax(0,1fr)] gap-2 border-t border-hair/70 py-2 first:border-t-0"
                    >
                      <span className="pt-0.5 font-mono text-[9.5px] tabular-nums text-ink-3">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[10.5px] font-medium text-ink-2">
                          {pullRequest.title}
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-4 text-ink-3">
                          {pullRequest.goal}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
            <details className="group mt-3 border-y border-hair py-2">
              <summary className="cursor-pointer list-none text-[10.5px] font-medium text-ink-2 marker:hidden">
                <span className="inline-flex items-center gap-1.5">
                  <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                  Review generated spec
                </span>
              </summary>
              <div className="mt-3 space-y-4 pl-4">
                <div>
                  <p className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3">
                    Proposal
                  </p>
                  <Markdown className="spec-document">
                    {draft.proposal}
                  </Markdown>
                </div>
                {draft.design ? (
                  <div>
                    <p className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3">
                      Design
                    </p>
                    <Markdown className="spec-document">
                      {draft.design}
                    </Markdown>
                  </div>
                ) : null}
                {draft.specs.map((spec) => (
                  <div key={spec.capability}>
                    <p className="mb-1 font-mono text-[9.5px] text-ink-3">
                      specs/{spec.capability}/spec.md
                    </p>
                    <Markdown className="spec-document">
                      {spec.content}
                    </Markdown>
                  </div>
                ))}
                <div>
                  <p className="mb-1 text-[9.5px] font-medium uppercase tracking-[0.12em] text-ink-3">
                    Tasks
                  </p>
                  <Markdown className="spec-document">{draft.tasks}</Markdown>
                </div>
              </div>
            </details>
          </div>
          <div className="border-l border-hair pl-5 max-[860px]:border-t max-[860px]:border-l-0 max-[860px]:pt-4 max-[860px]:pl-0">
            {!created ? (
              <>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => void createSpec()}
                  loading={busy === "branch"}
                >
                  Create isolated worktree <ChevronRight className="size-3.5" />
                </Button>
                <p className="mt-2 text-[10px] leading-4 text-ink-3">
                  Creates <span className="font-mono">spec/{draft.id}</span>{" "}
                  beside your checkout. Your current files and branch stay
                  untouched.
                </p>
              </>
            ) : deliveryComplete ? (
              <>
                <p className="flex items-center gap-1.5 text-[11.5px] text-add">
                  <Check className="size-3.5" />
                  {isStack
                    ? `${deliveryCount}-PR stack published`
                    : "Implementation published"}
                </p>
                <div className="mt-2 divide-y divide-hair border-y border-hair">
                  {prUrls.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => safeOpenUrl(url)}
                      className="flex w-full items-center justify-between gap-2 py-2 text-left text-[10.5px] text-ink-2 hover:text-ink"
                    >
                      <span className="truncate">
                        {index + 1}. {draft.delivery.pullRequests[index]?.title}
                      </span>
                      <ArrowUpRight className="size-3 shrink-0" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Button
                  className="w-full"
                  size="sm"
                  onClick={() => void implement()}
                  loading={busy === "implement"}
                >
                  <Play className="size-3.5" />
                  {prUrls.length > 0
                    ? `Resume PR ${prUrls.length + 1} of ${deliveryCount}`
                    : isStack
                      ? `Implement ${deliveryCount}-PR stack`
                      : "Implement & open PR"}
                </Button>
                {worktreePath ? (
                  <p className="mt-2 truncate font-mono text-[9.5px] text-ink-3">
                    {worktreePath}
                  </p>
                ) : null}
                <p className="mt-2 text-[10px] leading-4 text-ink-3">
                  {isStack
                    ? "Each slice is implemented and validated before its dependent PR is opened. The stack stops at the first failure."
                    : "The agent edits code, runs tests, commits, pushes and opens the PR. Publication stops if validation fails."}
                </p>
                {prUrls.length > 0 ? (
                  <p className="mt-2 text-[10px] text-ink-3">
                    {prUrls.length} of {deliveryCount} PRs published.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {execution.length > 0 && !deliveryComplete ? (
        <div className="mt-3 border-t border-hair pt-3 text-[10.5px] text-ink-3">
          <p>{execution.at(-1)?.summary}</p>
          <p className="mt-0.5 font-mono">{execution.at(-1)?.tests}</p>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-[11.5px] text-del">{error}</p> : null}
      {draftFailure ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hair pt-3"
          role="alert"
        >
          <CircleAlert
            className="size-3.5 shrink-0 text-del"
            aria-hidden="true"
          />
          <p className="min-w-56 flex-1 text-[10.5px] leading-4">
            <span className="font-medium text-ink">{draftFailure.title}.</span>{" "}
            <span className="text-ink-3">{draftFailure.detail}</span>
          </p>
          <div className="ml-6 flex shrink-0 items-center gap-3 sm:ml-0">
            {draftFailure.durationSeconds ? (
              <span className="font-mono text-[10px] tabular-nums text-ink-3">
                {Math.floor(draftFailure.durationSeconds / 60)}:
                {String(draftFailure.durationSeconds % 60).padStart(2, "0")}{" "}
                without activity
              </span>
            ) : null}
            {draftFailure.timeout ? (
              <button
                type="button"
                onClick={openAiSettings}
                className="text-[10.5px] font-medium text-ink-2 hover:text-ink"
              >
                Increase idle limit
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
