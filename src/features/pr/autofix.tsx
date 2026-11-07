import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { run } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { Ai, providerName } from "@/effect/services/Ai";
import { Git } from "@/effect/services/Git";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { usePrefs } from "@/effect/services/Prefs";
import { checkState } from "@/features/pr/checks-model";
import { toLocalId } from "@/lib/local-id";
import { APP_STORE } from "@/lib/edition";
import { Effect } from "effect";
import {
  CircleX,
  FolderGit2,
  GitMerge,
  LoaderCircle,
  MessageSquareWarning,
  WandSparkles,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Markdown } from "./markdown";
import type { Thread } from "./model";

type CheckEvidence = {
  run: S.CheckRun;
  annotations: ReadonlyArray<S.Annotation>;
};

const clip = (value: string | null | undefined, limit = 4_000) => {
  const text = value?.trim() ?? "";
  return text.length > limit ? `${text.slice(0, limit)}\n[…truncated]` : text;
};

export function autoFixPrompt(input: {
  ref: PrRef;
  pull: S.PullDetail;
  threads: ReadonlyArray<Thread>;
  reviews: ReadonlyArray<S.Review>;
  checks: ReadonlyArray<CheckEvidence>;
  instructions: string;
}): string {
  const { ref, pull } = input;
  const feedback = input.threads
    .filter((thread) => !thread.resolved)
    .map((thread) => {
      const location = `${thread.path}${thread.line ? `:${thread.line}` : ""}`;
      return [
        `### ${location}`,
        ...thread.comments.map((comment) => `- @${comment.user.login}: ${clip(comment.body, 2_000)}`),
      ].join("\n");
    });
  const reviewBodies = input.reviews
    .filter((review) => review.state === "CHANGES_REQUESTED" && review.body?.trim())
    .map((review) => `- @${review.user.login}: ${clip(review.body, 2_000)}`);
  const failures = input.checks.map(({ run, annotations }) =>
    [
      `### ${run.name}`,
      run.output?.title ? `Title: ${clip(run.output.title)}` : "",
      run.output?.summary ? `Summary:\n${clip(run.output.summary)}` : "",
      run.output?.text ? `Output:\n${clip(run.output.text)}` : "",
      annotations.length
        ? `Annotations:\n${annotations
            .map(
              (annotation) =>
                `- ${annotation.path}:${annotation.start_line} ${annotation.title ? `${annotation.title} — ` : ""}${clip(annotation.message, 1_500)}`,
            )
            .join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const conflicts = pull.mergeable === false;
  return `You are Auto-fix inside Reviewly. Work on pull request ${ref.owner}/${ref.repo}#${ref.number}: ${pull.title}.

Fix the actionable evidence below in the checked-out local branch. Inspect the repository before editing and preserve the pull request's intent.

Rules:
- Address every still-relevant unresolved review comment and every failing CI signal. If evidence is stale or incorrect, do not make a speculative change; explain why.
- ${conflicts ? `The repository has been prepared by merging origin/${pull.base.ref}. Resolve every conflict, remove every conflict marker, and preserve both sides' intent.` : "There is no reported merge conflict; do not merge or rebase."}
- Run the narrowest relevant formatter, typecheck, tests, or build after editing. Fix failures caused by your changes.
- Never commit, push, open or close a pull request, change remotes, or rewrite history. Leave all edits locally for the user to review.
- Do not resolve GitHub threads or rerun CI yourself. Reviewly will do that only after the user inspects and pushes the changes.
${input.instructions.trim() ? `\nProject instructions:\n${input.instructions.trim()}\n` : ""}
## Unresolved review threads
${feedback.length ? feedback.join("\n\n") : "None."}

## Change-request review summaries
${reviewBodies.length ? reviewBodies.join("\n") : "None."}

## Failing CI
${failures.length ? failures.join("\n\n") : "None."}

## Merge conflict
${conflicts ? `GitHub reports conflicts with ${pull.base.ref}; the working tree may be mid-merge.` : "None reported."}

When finished, summarize the files changed, what each fix addressed, and the verification commands with their results.`;
}

export function AutoFixButton({
  prRef,
  pull,
  clone,
  threads,
  reviews,
  checks,
  instructions,
}: {
  prRef: PrRef;
  pull: S.PullDetail;
  clone: string | null;
  threads: ReadonlyArray<Thread>;
  reviews: ReadonlyArray<S.Review>;
  checks: S.CheckRuns | undefined;
  instructions: string;
}) {
  const navigate = useNavigate();
  const provider = usePrefs((prefs) => prefs.ai.provider);
  const unresolved = threads.filter((thread) => !thread.resolved);
  const changeRequests = reviews.filter(
    (review) => review.state === "CHANGES_REQUESTED" && review.body?.trim(),
  );
  const failed = (checks?.check_runs ?? []).filter((run) => checkState(run) === "failed");
  const hasConflicts = pull.mergeable === false;
  const feedback = unresolved.length + changeRequests.length;
  const signals = feedback + failed.length + (hasConflicts ? 1 : 0);
  const available = !APP_STORE && provider !== "openai" && !!clone;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: string; changed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = phase !== null;
  const signalRows = useMemo(
    () => [
      {
        icon: MessageSquareWarning,
        label: "Review feedback",
        value: feedback
          ? `${feedback} unresolved item${feedback === 1 ? "" : "s"}`
          : "No unresolved threads",
        active: feedback > 0,
      },
      {
        icon: CircleX,
        label: "CI failures",
        value: failed.length
          ? `${failed.length} failing check${failed.length === 1 ? "" : "s"}`
          : "No failing checks",
        active: failed.length > 0,
      },
      {
        icon: GitMerge,
        label: "Base branch",
        value: hasConflicts ? `Conflicts with ${pull.base.ref}` : "No merge conflicts",
        active: hasConflicts,
      },
    ],
    [failed.length, feedback, hasConflicts, pull.base.ref],
  );

  const start = async () => {
    if (!clone || !available || !signals || running) return;
    setResult(null);
    setError(null);
    let prepared = false;
    try {
      setPhase("Checking the local clone…");
      const evidence = await run(
        Effect.gen(function* () {
          const github = yield* GitHub;
          return yield* Effect.forEach(
            failed,
            (check) =>
              github.annotations(prRef.owner, prRef.repo, check.id).pipe(
                Effect.map((annotations) => ({ run: check, annotations })),
                Effect.orElseSucceed(() => ({ run: check, annotations: [] })),
              ),
            { concurrency: 4 },
          );
        }),
      );
      setPhase(hasConflicts ? `Preparing the merge with ${pull.base.ref}…` : "Checking out the PR…");
      await run(
        Effect.flatMap(Git, (git) =>
          git.preparePrAutofix(clone, prRef.number, pull.base.ref, hasConflicts),
        ),
      );
      prepared = true;
      setPhase(`${providerName(provider)} is fixing the PR…`);
      const summary = await run(
        Effect.flatMap(Ai, (ai) =>
          ai.apply(
            autoFixPrompt({
              ref: prRef,
              pull,
              threads: unresolved,
              reviews,
              checks: evidence,
              instructions,
            }),
            clone,
          ),
        ),
      );
      setPhase("Validating the result…");
      const validation = await run(
        Effect.gen(function* () {
          const git = yield* Git;
          const unmerged = yield* git.unmergedFiles(clone);
          if (unmerged.length)
            return yield* Effect.fail(
              new Error(`Auto-fix left ${unmerged.length} unresolved conflict${unmerged.length === 1 ? "" : "s"}.`),
            );
          const tree = yield* git.status(clone);
          return new Set([...tree.staged, ...tree.unstaged].map((file) => file.path)).size;
        }),
      );
      setResult({ summary, changed: validation });
      toast.done(
        validation ? `Auto-fix changed ${validation} file${validation === 1 ? "" : "s"}` : "Auto-fix found no safe change",
      );
    } catch (cause) {
      if (prepared && hasConflicts)
        await run(
          Effect.flatMap(Git, (git) => git.abortMerge(clone)).pipe(
            Effect.orElseSucceed(() => undefined),
          ),
        );
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.fail("Auto-fix stopped", cause);
    } finally {
      setPhase(null);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        className="pr-autofix"
        data-actionable={signals ? "" : undefined}
        disabled={!signals}
        onClick={() => setOpen(true)}
        title={signals ? `Inspect and fix ${signals} PR signal${signals === 1 ? "" : "s"}` : "No review feedback, CI failures, or conflicts to fix"}
      >
        <WandSparkles className="size-3.5" aria-hidden />
        Auto-fix
        {signals ? <span className="pr-autofix-count tnum">{signals}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !running && setOpen(next)}>
        <DialogPopup className="max-w-[560px] border-edge bg-popover" showCloseButton={!running}>
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <span className="pr-autofix-mark" aria-hidden>
                <WandSparkles className="size-4" />
              </span>
              <div>
                <DialogTitle className="text-[17px] text-ink">Auto-fix this pull request</DialogTitle>
                <DialogDescription className="mt-1 text-[12.5px] text-ink-3">
                  One local pass across feedback, failing CI, and merge conflicts.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel className="grid gap-4 px-6 pb-5">
            <div className="autofix-signals">
              {signalRows.map(({ icon: Icon, label, value, active }) => (
                <div key={label} className="autofix-signal" data-active={active ? "" : undefined}>
                  <Icon className="size-4" aria-hidden />
                  <span>
                    <strong>{label}</strong>
                    <small>{value}</small>
                  </span>
                </div>
              ))}
            </div>
            {!clone ? (
              <div className="autofix-notice">
                <FolderGit2 className="size-4" aria-hidden />
                <p>
                  Add a local clone of <span className="mono">{prRef.owner}/{prRef.repo}</span> before running Auto-fix.
                </p>
              </div>
            ) : APP_STORE ? (
              <div className="autofix-notice">Auto-fix needs the direct edition because it runs a local coding agent.</div>
            ) : provider === "openai" ? (
              <div className="autofix-notice">Choose Claude, Codex, Antigravity, or Gemini in AI settings to edit locally.</div>
            ) : null}
            {running ? (
              <div className="autofix-running" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                <span>{phase}</span>
              </div>
            ) : null}
            {error ? <p className="autofix-error">{error}</p> : null}
            {result ? (
              <div className="autofix-result">
                <div className="autofix-result-heading">
                  <strong>{result.changed ? `${result.changed} local file${result.changed === 1 ? "" : "s"} changed` : "No local changes needed"}</strong>
                  <span>Nothing was committed or pushed.</span>
                </div>
                <Markdown className="text-ink-2">{result.summary}</Markdown>
              </div>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                Reviewly requires a clean clone, checks out #{pull.number}, and leaves every edit local. It never commits or pushes from this flow.
              </p>
            )}
          </DialogPanel>
          <DialogFooter variant="bare" className="px-6">
            <Button variant="ghost" size="sm" type="button" disabled={running} onClick={() => setOpen(false)}>
              {result ? "Done" : "Cancel"}
            </Button>
            {result && clone ? (
              <Button
                variant="default"
                size="sm"
                type="button"
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/local/$id", params: { id: toLocalId(clone) } });
                }}
              >
                Review local changes
              </Button>
            ) : !clone ? (
              <Button
                variant="default"
                size="sm"
                type="button"
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/local" });
                }}
              >
                <FolderGit2 className="size-3.5" />
                Add local clone
              </Button>
            ) : !result ? (
              <Button variant="default" size="sm" type="button" disabled={!available || running} onClick={() => void start()}>
                {running ? <LoaderCircle className="size-3.5 animate-spin" /> : <WandSparkles className="size-3.5" />}
                Fix locally
              </Button>
            ) : null}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
