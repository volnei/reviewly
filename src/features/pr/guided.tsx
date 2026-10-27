import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { run } from "@/effect/runtime";
import { providerName } from "@/effect/services/Ai";
import { AppSettings } from "@/effect/services/AppSettings";
import { age } from "@/features/list/row";
import {
  type CheckResult,
  type GuidedStep,
  type StepKind,
  checkPrompt,
  parseCheckResult,
  parseGuided,
  stepKey,
} from "@/lib/guided";
import { cn } from "@/lib/utils";
import { Effect } from "effect";
import { ChevronDown, ChevronUp, MoreHorizontal, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type PromptOpts,
  cancelBackground,
  guidedPrompt,
  startBackground,
  useBackgroundRun,
} from "./ai";
import { Markdown } from "./markdown";
import { saveGuided, updateGuided, useGuidedEntry } from "./plans-store";

/** Whether the chosen CLI answers from this machine, asked once per session. */
const availability = new Map<string, Promise<boolean>>();
function providerAvailable(provider: string): Promise<boolean> {
  let p = availability.get(provider);
  if (!p) {
    p = run(Effect.flatMap(AppSettings, (a) => a.aiAvailable(provider))).catch(() => false);
    availability.set(provider, p);
  }
  return p;
}

/**
 * The model's walkthrough of a PR: a plan kept per PR and stamped with the
 * head it saw, a current stop, stops you put aside, what the clone said when
 * asked about one, and a run that keeps going if you leave.
 */
export function useGuided(
  prKey: string,
  context: string,
  opts: { headSha: string; cwd: string | null; provider: string } & PromptOpts,
) {
  const entry = useGuidedEntry(prKey);
  const key = `guided:${prKey}`;
  const run_ = useBackgroundRun(key);
  const [step, setStep] = useState(0);
  const [kindFilter, setKindFilter] = useState<StepKind | null>(null);
  const [shapeError, setShapeError] = useState<string | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const { headSha, cwd, instructions, hasClone, provider } = opts;
  const at = entry?.at;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new plan starts at its first stop
  useEffect(() => {
    setStep(0);
    setKindFilter(null);
  }, [at]);
  useEffect(() => {
    let on = true;
    void providerAvailable(provider).then((ok) => on && setAvailable(ok));
    return () => {
      on = false;
    };
  }, [provider]);
  const start = useCallback(() => {
    if (!context) return;
    setShapeError(null);
    startBackground(
      key,
      guidedPrompt(context, { instructions, hasClone }),
      cwd,
      "Reading the diff",
      (text) => {
        const p = parseGuided(text);
        if (p) saveGuided(prKey, p, headSha);
        else setShapeError("The model answered, but not in the shape asked. Try once more.");
      },
    );
  }, [key, context, instructions, hasClone, cwd, prKey, headSha]);

  const plan = entry?.plan ?? null;
  const steps = plan?.steps ?? [];
  const dismissed = useMemo(() => new Set(entry?.dismissed ?? []), [entry?.dismissed]);
  const checks = entry?.checks ?? {};
  const isDismissed = useCallback(
    (i: number) => !!steps[i] && dismissed.has(stepKey(steps[i])),
    [steps, dismissed],
  );
  /** A stop you can land on: not put aside, and of the kind in focus. */
  const visible = useCallback(
    (i: number) =>
      !!steps[i] &&
      !dismissed.has(stepKey(steps[i])) &&
      (!kindFilter || steps[i].kind === kindFilter),
    [steps, dismissed, kindFilter],
  );
  const nextIndex = useCallback(
    (from: number, d: 1 | -1): number | null => {
      for (let i = from + d; i >= 0 && i < steps.length; i += d) if (visible(i)) return i;
      return null;
    },
    [steps.length, visible],
  );
  const dismiss = useCallback(
    (i: number) => {
      const s = steps[i];
      if (!s) return;
      updateGuided(prKey, (e) => ({
        ...e,
        dismissed: [...new Set([...(e.dismissed ?? []), stepKey(s)])],
      }));
    },
    [prKey, steps],
  );
  const restore = useCallback(() => updateGuided(prKey, (e) => ({ ...e, dismissed: [] })), [prKey]);
  const check = useCallback(
    (i: number) => {
      const s = steps[i];
      if (!s || !cwd) return;
      startBackground(
        `check:${prKey}:${stepKey(s)}`,
        checkPrompt(s),
        cwd,
        "Checking a stop",
        (text) =>
          updateGuided(prKey, (e) => ({
            ...e,
            checks: { ...(e.checks ?? {}), [stepKey(s)]: parseCheckResult(text) },
          })),
      );
    },
    [prKey, steps, cwd],
  );
  const clearCheck = useCallback(
    (i: number) => {
      const s = steps[i];
      if (!s) return;
      updateGuided(prKey, (e) => {
        const { [stepKey(s)]: _, ...rest } = e.checks ?? {};
        return { ...e, checks: rest };
      });
    },
    [prKey, steps],
  );
  const stale = !!entry && entry.headSha !== headSha;
  return {
    plan,
    /** The PR's head moved after this plan was made, and you haven't said to keep it. */
    stale: stale && entry?.staleAck !== headSha,
    keepStale: () => updateGuided(prKey, (e) => ({ ...e, staleAck: headSha })),
    at: entry?.at ?? null,
    step,
    setStep,
    start,
    cancel: () => cancelBackground(key),
    running: run_?.running ?? false,
    streamed: run_?.text.length ?? 0,
    /** Stops the model has written so far, read off the stream before it is parsed. */
    found: (run_?.text.match(/"path"\s*:/g) ?? []).length,
    error: run_?.error ?? shapeError,
    available,
    provider,
    cwd,
    prKey,
    dismissed,
    isDismissed,
    visible,
    nextIndex,
    dismiss,
    restore,
    kindFilter,
    setKindFilter,
    checks,
    check,
    clearCheck,
  };
}
export type Guided = ReturnType<typeof useGuided>;

const KIND_LABEL: Record<GuidedStep["kind"], string> = {
  orient: "look here",
  concern: "worth a comment",
  question: "a question for the author",
  praise: "nice",
};
const KIND_ORDER: ReadonlyArray<StepKind> = ["concern", "question", "orient", "praise"];

const VERDICT_WORD = {
  approve: "approve",
  request_changes: "request changes",
  comment: "comment",
} as const;

/** The comment a stop offers to lift: its suggestion, else its detail when it is a concern or a question. */
export const liftOf = (s: GuidedStep): string =>
  s.suggestion ?? (s.kind === "concern" || s.kind === "question" ? s.detail : "");

/** Above the description: what the model saw, the reading plan, and where you are in it. */
export function GuidedBanner({
  g,
  provider,
  onJump,
  onDraftAll,
}: {
  g: Guided;
  provider: string;
  onJump: (i: number) => void;
  /** Every stop's comment into your review at once, with the verdict it suggests. */
  onDraftAll?: () => void;
}) {
  const name = providerName(provider);
  if (g.running) {
    return (
      <div data-live className="ai-card mb-5 flex items-center gap-3 px-4 py-3 text-[13px]">
        <span className="ai-dot ai-live-dot size-2 rounded-full" aria-hidden />
        <span className="ai-live-copy flex-1 text-ink-2">
          <span className="ai-live-title">Reading the diff with {name}…</span>{" "}
          <span className="tnum text-ink-3">
            {g.found
              ? `${g.found} stop${g.found === 1 ? "" : "s"} so far`
              : `${g.streamed} characters so far`}
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={g.cancel}
          className="h-6 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
        >
          Stop
        </Button>
      </div>
    );
  }
  if (!g.plan) {
    return (
      <div className="ai-card mb-5 flex items-center gap-3 px-4 py-3 text-[13px]">
        <Sparkles className="ai-spark size-4 shrink-0" strokeWidth={2} aria-hidden />
        <span className="flex-1 text-ink-2">
          {g.error ? <span className="text-del">{g.error} </span> : null}
          {g.available === false ? (
            <>
              The {name} CLI isn’t on this machine. Install it, or pick another provider in
              Settings.
            </>
          ) : (
            <>
              Let {name} walk you through it: the entry point first, then what depends on it, with
              the one thing it would flag.
            </>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={g.start}
          disabled={g.available === false}
          className="ai-button h-7 px-3 text-[12.5px] font-medium disabled:opacity-50"
        >
          Walk me through it
        </Button>
      </div>
    );
  }
  const p = g.plan;
  const live = p.steps.filter((_, i) => !g.isDismissed(i));
  const liftable = live.filter((s) => liftOf(s)).length;
  return (
    <div className="ai-card mb-5 px-4 py-3 text-[13px]">
      <p className="flex items-start gap-2">
        <Sparkles className="ai-spark mt-[3px] size-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="selectable text-ink">{p.summary}</span>
      </p>
      {p.tour ? <Markdown className="mt-1 text-ink-2">{p.tour}</Markdown> : null}
      {p.verdict ? (
        <p className="mt-2 text-[12.5px] text-ink-2">
          Suggests <b className="font-medium text-ink">{VERDICT_WORD[p.verdict]}</b>
          {p.verdictReason ? ` — ${p.verdictReason}` : ""}
        </p>
      ) : null}
      {g.stale ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
          The PR moved since this tour; the stops may have drifted.
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={g.keepStale}
            className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
          >
            Keep it
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={g.start}
            className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
          >
            Walk me through it again
          </Button>
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        {p.steps.length ? (
          <>
            <span className="tnum">
              Stop {Math.min(g.step + 1, p.steps.length)} of {p.steps.length}
              {g.dismissed.size ? ` · ${g.dismissed.size} put aside` : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => onJump(g.step)}
              className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
            >
              Go to stop {Math.min(g.step + 1, p.steps.length)}
            </Button>
            {g.dismissed.size ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={g.restore}
                className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
              >
                Bring them back
              </Button>
            ) : null}
            {liftable && onDraftAll ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={onDraftAll}
                className="ai-button h-6 px-2.5 font-medium"
                title="Every stop's comment becomes a draft, and the review opens on the verdict it suggests"
              >
                Draft the review from it
              </Button>
            ) : null}
          </>
        ) : (
          <span>Nothing to walk through — a small change.</span>
        )}
        <span className="ml-auto">
          by your local {name}
          {g.at ? ` · ${age(new Date(g.at).toISOString())} ago` : ""}
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={g.start}
          className="h-6 rounded-md px-2 text-ink-3 hover:bg-raise hover:text-ink"
        >
          Again
        </Button>
      </div>
    </div>
  );
}

/** What a stop can do: lift its comment, post it, have the clone checked, be put aside. */
export interface StepActions {
  readonly onUse: (step: GuidedStep, body: string) => void;
  readonly onPost: (step: GuidedStep, body: string) => Promise<void>;
}

/** The check's result, if any, and the words for it. */
function CheckBlock({
  result,
  onKeep,
  onDismiss,
}: { result: CheckResult; onKeep: () => void; onDismiss: () => void }) {
  if (result.verdict === "resolved")
    return (
      <div className="mt-2 rounded-md bg-sink px-3 py-2 text-[12.5px]">
        <p className="text-ink">Looked into it in your clone: not worth raising.</p>
        <p className="mt-1 text-ink-2">{result.finding}</p>
        <div className="mt-2 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onKeep}
            className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
          >
            Keep the stop
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={onDismiss}
            className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
          >
            Put it aside
          </Button>
        </div>
      </div>
    );
  return (
    <p className="mt-2 text-[12.5px] text-ink-2">
      <span className="ai-ink font-medium">Checked in your clone</span> — a real concern. The
      comment below is the sharper one.
    </p>
  );
}

/** The comment lives inline: draft first, direct posting and dismissal behind More. */
function StepButtons({
  g,
  index,
  step,
  actions,
}: {
  g: Guided;
  index: number;
  step: GuidedStep;
  actions: StepActions;
}) {
  const key = stepKey(step);
  const result = g.checks[key];
  const checking = useBackgroundRun(`check:${g.prKey}:${key}`)?.running ?? false;
  const [state, setState] = useState<"idle" | "drafted" | "posting" | "posted" | "failed">("idle");
  const lift = result?.verdict === "valid" ? result.finding : liftOf(step);
  const canCheck =
    !!g.cwd && (step.kind === "concern" || step.kind === "question") && !result && !checking;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {lift ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={state === "drafted" || state === "posting"}
          onClick={() => {
            actions.onUse(step, lift);
            setState("drafted");
          }}
          className="h-7 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
        >
          {state === "drafted" ? "Added to review" : "Add to review"}
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger
          aria-label="More actions for this suggestion"
          disabled={state === "posting"}
          className="grid size-7 place-items-center rounded-md text-ink-3 hover:bg-raise hover:text-ink disabled:opacity-50"
        >
          <MoreHorizontal className="size-4" />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-44">
          {lift ? (
            <MenuItem
              disabled={state === "posting" || state === "posted"}
              onClick={async () => {
                setState("posting");
                try {
                  await actions.onPost(step, lift);
                  setState("posted");
                } catch {
                  setState("failed");
                }
              }}
            >
              {state === "posted"
                ? "Posted to GitHub"
                : state === "failed"
                  ? "Retry posting to GitHub"
                  : "Post directly to GitHub"}
            </MenuItem>
          ) : null}
          {canCheck ? (
            <MenuItem onClick={() => g.check(index)}>Check in local clone</MenuItem>
          ) : null}
          <MenuItem onClick={() => g.dismiss(index)}>Dismiss suggestion</MenuItem>
        </MenuPopup>
      </Menu>
      {checking ? <span className="text-[12px] text-ink-3">Checking in your clone…</span> : null}
      <span role="status" className="text-[12px] text-ink-3">
        {state === "posting"
          ? "Posting…"
          : state === "posted"
            ? "Posted to GitHub"
            : state === "failed"
              ? "Couldn’t post. Retry from the menu."
              : ""}
      </span>
    </div>
  );
}

/** One stop, under the line it is about: what to see, and a comment to lift if it earned one. */
export function StepCard({
  g,
  step,
  index,
  total,
  actions,
}: {
  g: Guided;
  step: GuidedStep;
  index: number;
  total: number;
  actions: StepActions;
}) {
  const result = g.checks[stepKey(step)];
  return (
    <article className="guided-stop-card max-w-[860px]" data-kind={step.kind}>
      <header className="guided-stop-header">
        <div className="guided-stop-position">
          <Sparkles className="guided-stop-spark" strokeWidth={2} aria-hidden />
          <span className="guided-stop-label">Stop</span>
          <strong className="guided-stop-index tnum">{index + 1}</strong>
          <span className="guided-stop-total tnum">of {total}</span>
        </div>
        <span className={cn("guided-stop-kind", step.kind === "concern" && "is-concern")}>
          {KIND_LABEL[step.kind]}
        </span>
        <span className="guided-stop-location">
          <span>{step.path.split("/").pop()}</span>
          <span className="tnum">
            {step.line}
            {step.endLine ? `–${step.endLine}` : ""}
          </span>
        </span>
      </header>
      <h3 className="guided-stop-title">{step.title}</h3>
      <Markdown className="guided-stop-detail">{step.detail}</Markdown>
      {result ? (
        <CheckBlock
          result={result}
          onKeep={() => g.clearCheck(index)}
          onDismiss={() => g.dismiss(index)}
        />
      ) : null}
      <StepButtons g={g} index={index} step={step} actions={actions} />
    </article>
  );
}

/** Keep the tour's order, grouping adjacent stops in the same file. */
export function StepsList({
  g,
  current,
  onPick,
}: {
  g: Guided;
  current: number;
  onPick: (i: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const steps = g.plan?.steps ?? [];
  const counts = new Map<StepKind, number>();
  steps.forEach((step, index) => {
    if (!g.isDismissed(index)) counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1);
  });
  const total = [...counts.values()].reduce((n, count) => n + count, 0);
  const labels: Record<StepKind, string> = {
    concern: "Concerns",
    question: "Questions",
    orient: "Context",
    praise: "Highlights",
  };
  const groups: Array<{
    path: string;
    start: number;
    items: Array<{ step: GuidedStep; index: number }>;
  }> = [];
  steps.forEach((step, index) => {
    if (!g.visible(index)) return;
    const last = groups[groups.length - 1];
    if (last?.path === step.path) last.items.push({ step, index });
    else groups.push({ path: step.path, start: index, items: [{ step, index }] });
  });
  useEffect(() => {
    root.current
      ?.querySelector(`[data-step-index="${current}"][aria-current="step"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);
  if (!steps.length)
    return <p className="px-4 pt-3 text-[12px] text-ink-3">No stops on this one.</p>;
  return (
    <div className="guided-outline" ref={root}>
      <div className="guided-outline-filter">
        <Select
          value={g.kindFilter ?? "all"}
          onValueChange={(value) => g.setKindFilter(value === "all" ? null : (value as StepKind))}
        >
          <SelectTrigger
            id="guided-focus"
            size="sm"
            aria-label="Filter guided review steps"
            className="guided-focus-trigger"
          >
            <SelectValue>
              {g.kindFilter
                ? `${labels[g.kindFilter]} · ${counts.get(g.kindFilter) ?? 0}`
                : `All steps · ${total}`}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value="all">All steps · {total}</SelectItem>
            {KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {labels[kind]} · {counts.get(kind)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      {groups.map((group) => {
        const parts = group.path.split("/");
        const filename = parts.pop();
        return (
          <section
            className="guided-outline-group"
            key={`${group.path}:${group.start}`}
            aria-label={group.path}
          >
            <div className="guided-outline-file">
              <div>
                <span>{filename}</span>
                {parts.length ? <small>{parts.join("/")}</small> : null}
              </div>
              <span className="guided-outline-count tnum">
                {group.items.length} {group.items.length === 1 ? "step" : "steps"}
              </span>
            </div>
            <ol>
              {group.items.map(({ step, index }) => (
                <li key={`${step.path}:${step.line}:${index}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="guided-outline-step"
                    data-step-index={index}
                    aria-current={index === current ? "step" : undefined}
                    aria-label={`Step ${index + 1}: ${step.title}, ${step.path}, line ${step.line}`}
                    onClick={() => onPick(index)}
                  >
                    <span className="guided-step-number tnum">{index + 1}</span>
                    <span className="guided-step-content">
                      <span className="guided-step-title">{step.title}</span>
                      <span className="guided-step-meta">
                        <span className="mono">
                          L{step.line}
                          {step.endLine && step.endLine > step.line ? `–${step.endLine}` : ""}
                        </span>
                        {step.kind !== "orient" ? (
                          <span className={step.kind === "concern" ? "guided-step-concern" : ""}>
                            {step.kind === "concern"
                              ? "Concern"
                              : step.kind === "question"
                                ? "Question"
                                : "Highlight"}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {!groups.length ? <p className="guided-outline-empty">No steps in this view.</p> : null}
      {g.dismissed.size ? (
        <div className="guided-outline-dismissed">
          <span>{g.dismissed.size} dismissed</span>
          <Button variant="ghost" size="sm" type="button" onClick={g.restore}>
            Restore
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Navigation stays in its own row; the suggestion and its actions stay beside the code. */
export function TourCard({
  g,
  onPrev,
  onNext,
  onLeave,
}: {
  g: Guided;
  onPrev: () => void;
  onNext: () => void;
  onLeave: () => void;
}) {
  const plan = g.plan;
  if (!plan?.steps.length) return null;
  const index = Math.min(g.step, plan.steps.length - 1);
  return (
    <div
      role="region"
      aria-label="Guided review navigation"
      className="flex shrink-0 items-center gap-2 border-b border-hair bg-page px-4 py-1.5"
    >
      <Sparkles className="size-3.5 text-ink-3" aria-hidden />
      <span className="tnum text-[12px] text-ink-2" aria-live="polite">
        {index + 1} of {plan.steps.length}
      </span>
      <IconButton
        size={6}
        label="Previous stop (k, shift space)"
        onClick={onPrev}
        disabled={g.nextIndex(index, -1) == null}
      >
        <ChevronUp className="size-3.5" />
      </IconButton>
      <IconButton
        size={6}
        label="Next stop (j, space)"
        onClick={onNext}
        disabled={g.nextIndex(index, 1) == null}
      >
        <ChevronDown className="size-3.5" />
      </IconButton>
      <IconButton
        size={6}
        label="Leave guided review (Escape)"
        onClick={onLeave}
        className="ml-auto"
      >
        <X className="size-3.5" />
      </IconButton>
    </div>
  );
}
