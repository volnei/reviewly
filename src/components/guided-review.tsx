import { Composer } from "@/components/composer";
import { IconButton } from "@/components/icon-button";
import { MarkdownBody } from "@/components/markdown-body";
import { Button } from "@/components/ui/button";
import { GUIDED_SYSTEM } from "@/lib/ai/prompts";
import { useAiAvailable } from "@/lib/ai/use-ai-available";
import { parsePatch } from "@/lib/diff";
import { relativeTime } from "@/lib/format";
import type { GuidedStep, GuidedVerdict, StepKind } from "@/lib/guided";
import { detectLanguage, highlightLine } from "@/lib/lang";
import type { DraftComment, PullFile } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL, aiInvokeArgs, useAiProvider } from "@/stores/ai";
import { type GuidedEntry, useGuided } from "@/stores/guided";
import { useGuidedGen } from "@/stores/guided-gen";
import { useLocalRepos } from "@/stores/local-repos";
import { useReviewPrefs } from "@/stores/review-prefs";
import { type ReviewEvent, useReviewVerdict } from "@/stores/review-verdict";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  FileCode,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface Props {
  prKey: string;
  /** Self-contained PR context (metadata + diff). */
  context: string;
  files: PullFile[];
  /** Head SHA of the PR right now — used to flag a stale (out-of-date) tour. */
  headSha?: string;
  /** Add a suggested comment to the pending review. */
  onAddComment: (c: DraftComment) => void;
  /** Post a suggested comment straight to GitHub as an inline review comment. */
  onPostComment?: (c: { path: string; line: number; body: string }) => Promise<void>;
  /** Open a file in the diff (when the reader wants the full context). */
  onOpenFile: (path: string, line?: number) => void;
}

const KIND: Record<
  StepKind,
  {
    icon: ComponentType<{ className?: string }>;
    text: string;
    /** Progress-rail / focus-chip fill for this kind. */
    dot: string;
    label: string;
  }
> = {
  orient: { icon: Compass, text: "text-primary", dot: "bg-primary", label: "Orientation" },
  concern: {
    icon: AlertTriangle,
    text: "text-warning",
    dot: "bg-warning",
    label: "Worth a comment",
  },
  question: { icon: HelpCircle, text: "text-info", dot: "bg-info", label: "Question" },
  praise: { icon: ThumbsUp, text: "text-success", dot: "bg-success", label: "Nice" },
};

/** The tour's suggested verdict → its chip + the review event it seeds. */
const VERDICT_META: Record<
  GuidedVerdict,
  { label: string; event: ReviewEvent; icon: ComponentType<{ className?: string }>; chip: string }
> = {
  approve: {
    label: "Suggests approve",
    event: "APPROVE",
    icon: ThumbsUp,
    chip: "text-success bg-success/12",
  },
  request_changes: {
    label: "Suggests changes",
    event: "REQUEST_CHANGES",
    icon: AlertTriangle,
    chip: "text-warning bg-warning/12",
  },
  comment: {
    label: "Suggests comment",
    event: "COMMENT",
    icon: MessageSquare,
    chip: "text-info bg-info/12",
  },
};

/** Seconds elapsed while `running` is true; resets to 0 when it flips off. */
function useElapsed(running: boolean): number {
  const [secs, setSecs] = useState(0);
  const start = useRef(0);
  useEffect(() => {
    if (!running) {
      setSecs(0);
      return;
    }
    start.current = Date.now();
    setSecs(0);
    const t = setInterval(() => setSecs(Math.round((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);
  return secs;
}

export function GuidedReview({
  prKey,
  context,
  files,
  headSha,
  onAddComment,
  onPostComment,
  onOpenFile,
}: Props) {
  const provider = useAiProvider((s) => s.provider);
  const { available } = useAiAvailable();
  const aiInstructions = useReviewPrefs((s) => s.aiInstructions);
  const localRepos = useLocalRepos((s) => s.repos);
  const entry = useGuided((s) => s.byPr[prKey]);
  const resetPlan = useGuided((s) => s.reset);
  const pending = useGuidedGen((s) => !!s.inFlight[prKey]);
  const genError = useGuidedGen((s) => s.error[prKey]);
  const aiName = PROVIDER_LABEL[provider];

  // Recover the "generating" state if a background tour for this PR is still
  // running after navigating away or refreshing (the Rust task outlives both).
  useEffect(() => {
    invoke<string[]>("ai_inflight")
      .then((keys) => {
        if (keys.includes(prKey)) useGuidedGen.getState().start(prKey);
      })
      .catch(() => {});
  }, [prKey]);

  // Kick off generation in the background task. It keeps running (and lands the
  // result via the app-wide `ai:done` listener) regardless of this component.
  const start = useCallback(() => {
    const custom = aiInstructions.trim()
      ? `\n\n# Reviewer's instructions\n${aiInstructions.trim()}`
      : "";
    // Run inside the PR's local clone (if present) so the agent can read the repo.
    const [owner, repo] = prKey.split("#")[0].split("/");
    const cwd = localRepos.find((r) => r.owner === owner && r.repo === repo)?.path ?? null;
    useGuidedGen.getState().start(prKey);
    invoke("ai_review_bg", {
      key: prKey,
      ...aiInvokeArgs(),
      headSha: headSha ?? "",
      cwd,
      prompt: `${GUIDED_SYSTEM}${custom}\n\n# Pull request\n${context}`,
    }).catch((e) => useGuidedGen.getState().fail(prKey, String(e)));
  }, [prKey, headSha, aiInstructions, context, localRepos]);

  // Auto-start the tour on first open when the reviewer opted in (Settings →
  // Guided tour). Guarded so it fires at most once per PR and never when a tour
  // already exists or is generating.
  const autoStartTour = useReviewPrefs((s) => s.autoStartTour);
  // Tracks the PR we've already auto-started for, so it fires once per PR.
  const autoStartedFor = useRef<string | null>(null);
  useEffect(() => {
    if (autoStartedFor.current === prKey) return;
    if (autoStartTour && !entry && !pending && available === true) {
      autoStartedFor.current = prKey;
      start();
    }
  }, [prKey, autoStartTour, entry, pending, available, start]);

  // Stop a running generation (kills the AI CLI on the backend).
  const cancel = useCallback(() => {
    invoke("ai_cancel", { key: prKey }).catch(() => {});
    useGuidedGen.getState().done(prKey);
  }, [prKey]);

  if (!entry) {
    return (
      <Intro
        aiName={aiName}
        available={available}
        pending={pending}
        error={genError ?? null}
        onStart={start}
        onCancel={cancel}
      />
    );
  }

  const stale = !!headSha && !!entry.headSha && entry.headSha !== headSha;

  return (
    <Tour
      prKey={prKey}
      entry={entry}
      stale={stale}
      files={files}
      regenerating={pending}
      onRegenerate={() => {
        resetPlan(prKey);
        start();
      }}
      onAddComment={onAddComment}
      onPostComment={onPostComment}
      onOpenFile={onOpenFile}
    />
  );
}

/** Staged status copy so the wait reads as deliberate work, not a dead spinner. */
function tourPhase(elapsed: number): string {
  if (elapsed < 8) return "Reading the whole diff…";
  if (elapsed < 20) return "Mapping how the changes connect…";
  if (elapsed < 40) return "Finding what's worth a comment…";
  return "Ordering your tour…";
}

function Intro({
  aiName,
  available,
  pending,
  error,
  onStart,
  onCancel,
}: {
  aiName: string;
  available: boolean | undefined;
  pending: boolean;
  error: string | null;
  onStart: () => void;
  onCancel?: () => void;
}) {
  const elapsed = useElapsed(pending);
  const unavailable = available === false;
  const hasInstructions = useReviewPrefs((s) => s.aiInstructions.trim().length > 0);
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      {/* Blueprint dot-grid + a restrained spotlight — depth and a "labs" feel
          without haze. */}
      <div aria-hidden className="lab-grid pointer-events-none absolute inset-0 opacity-60" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(38% 46% at 50% 38%, color-mix(in oklch, var(--color-primary) 10%, transparent), transparent 72%)",
        }}
      />

      {/* Emblem: a crisp icon tile. While reading, a scan line sweeps top→bottom
          (Claude reading the diff) and a soft glow breathes behind it. */}
      <div className="relative z-10 flex size-12 items-center justify-center">
        {pending && (
          <span
            aria-hidden
            className="absolute inset-0 animate-pulse rounded-[18px] bg-primary/20 blur-lg motion-reduce:hidden"
          />
        )}
        <div className="relative flex size-12 items-center justify-center overflow-hidden rounded-[14px] border border-border/50 bg-card shadow-sm">
          {pending && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 h-px animate-tile-scan bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_6px_var(--color-primary)] motion-reduce:hidden"
            />
          )}
          <Sparkles className="size-6 text-primary" strokeWidth={1.5} />
        </div>
      </div>

      <div className="z-10 max-w-md">
        <h2 className="font-display text-lg text-foreground">Guided tour</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {aiName} reads the whole PR and walks you through it in a sensible order — the core change
          first, then what depends on it — with a suggested comment where it counts.
        </p>
      </div>

      <div className="z-10 flex min-h-[3rem] flex-col items-center justify-center gap-1">
        {pending ? (
          <>
            <p className="text-sm font-medium text-foreground/80">{tourPhase(elapsed)}</p>
            <p className="font-mono text-xs text-muted-foreground/70">
              reading locally · {elapsed}s{elapsed >= 60 ? " · almost there" : ""}
            </p>
            {onCancel && (
              <Button size="xs" variant="ghost" onClick={onCancel} className="mt-1.5">
                <X className="size-3" />
                Stop
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" onClick={onStart} disabled={unavailable}>
            <Sparkles className="size-3.5" />
            Start guided tour
          </Button>
        )}
      </div>

      {unavailable && !pending && (
        <p className="z-10 max-w-sm text-xs text-warning">
          The <span className="font-medium">{aiName.toLowerCase()}</span> CLI wasn't found on your
          PATH. Install it, or switch the provider in Settings.
        </p>
      )}
      {error && !pending && <p className="z-10 max-w-sm text-xs text-destructive">{error}</p>}
      {hasInstructions && (
        <p className="z-10 inline-flex items-center gap-1 text-[11px] text-muted-foreground/60">
          <Sparkles className="size-3" />
          Using your custom review instructions
        </p>
      )}
    </div>
  );
}

function Tour({
  prKey,
  entry,
  stale,
  files,
  regenerating,
  onRegenerate,
  onAddComment,
  onPostComment,
  onOpenFile,
}: {
  prKey: string;
  entry: GuidedEntry;
  stale: boolean;
  files: PullFile[];
  regenerating: boolean;
  onRegenerate: () => void;
  onAddComment: (c: DraftComment) => void;
  onPostComment?: (c: { path: string; line: number; body: string }) => Promise<void>;
  onOpenFile: (path: string, line?: number) => void;
}) {
  const plan = entry.plan;
  const total = plan.steps.length;
  const preferPost = useReviewPrefs((s) => s.defaultSuggestionAction === "post");
  const markSeen = useGuided((s) => s.markSeen);
  const setLastActive = useGuided((s) => s.setLastActive);
  const dismiss = useGuided((s) => s.dismiss);
  const restoreDismissed = useGuided((s) => s.restoreDismissed);
  const [active, setActive] = useState(() => Math.min(entry.lastActive, total - 1));
  const [posted, setPosted] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<StepKind | null>(null);
  // 82: lets the reviewer keep a stale tour — acknowledges staleness and hides
  // the banner without discarding the (still useful) walkthrough.
  const [staleAck, setStaleAck] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);

  // Stops the reviewer dismissed (handled questions / concerns) are hidden.
  const dismissedSet = useMemo(() => new Set(entry.dismissed ?? []), [entry.dismissed]);

  // Per-kind counts (of the *remaining* stops) → which "focus" chips to show.
  const counts = useMemo(() => {
    const c: Record<StepKind, number> = { orient: 0, concern: 0, question: 0, praise: 0 };
    plan.steps.forEach((s, i) => {
      if (!dismissedSet.has(i)) c[s.kind]++;
    });
    return c;
  }, [plan.steps, dismissedSet]);
  const kindsPresent = useMemo(
    () => (["orient", "concern", "question", "praise"] as StepKind[]).filter((k) => counts[k] > 0),
    [counts],
  );
  // Original-index list of the steps currently in view (not dismissed; all or one kind).
  const visible = useMemo(
    () =>
      plan.steps
        .map((_, i) => i)
        .filter((i) => !dismissedSet.has(i) && (!filter || plan.steps[i].kind === filter)),
    [plan.steps, filter, dismissedSet],
  );

  // Move ±1 through the *visible* set (respects an active kind filter).
  const move = useCallback(
    (delta: number) => {
      setActive((a) => {
        const p = visible.indexOf(a);
        const curr = p < 0 ? 0 : p;
        const n = visible[Math.max(0, Math.min(visible.length - 1, curr + delta))] ?? a;
        stepRefs.current[n]?.scrollIntoView({ behavior: "smooth", block: "start" });
        return n;
      });
    },
    [visible],
  );

  // When the filter hides the active step, snap to the first visible one.
  useEffect(() => {
    if (visible.length > 0 && !visible.includes(active)) setActive(visible[0]);
  }, [visible, active]);

  const pos = visible.indexOf(active);
  const atFirst = pos <= 0;
  const atLast = pos >= visible.length - 1;

  // Persist resume position + mark the visited step as seen.
  useEffect(() => {
    markSeen(prKey, active);
    setLastActive(prKey, active);
  }, [prKey, active, markSeen, setLastActive]);

  // Keyboard nav: j/↓ next, k/↑ prev, o open file, x dismiss, Enter/d next
  // undismissed stop. Ignored while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "o") {
        const step = plan.steps[active];
        if (step) onOpenFile(step.path, step.line);
      } else if (e.key === "x") {
        // 81: dismiss the active stop; the effect on `visible` re-snaps to the
        // next remaining stop automatically.
        e.preventDefault();
        dismiss(prKey, active);
      } else if (e.key === "Enter" || e.key === "d") {
        // 81: advance to the next (undismissed) stop.
        e.preventDefault();
        move(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, plan.steps, onOpenFile, move, dismiss, prKey]);

  // The active (colored) step is exactly the one whose sticky header is pinned
  // at the top: the last visible section that has scrolled to/above the top
  // edge. This keeps the highlight in lock-step with the stuck header.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    function syncStuck() {
      if (!root) return;
      const top = root.getBoundingClientRect().top;
      let current = visible[0] ?? 0;
      for (const i of visible) {
        const el = stepRefs.current[i];
        if (!el) continue;
        if (el.getBoundingClientRect().top - top <= 1) current = i;
        else break;
      }
      setActive(current);
    }
    syncStuck();
    root.addEventListener("scroll", syncStuck, { passive: true });
    return () => root.removeEventListener("scroll", syncStuck);
  }, [visible]);

  function addComment(step: GuidedStep, idx: number, body: string) {
    if (!body.trim()) return;
    onAddComment({ path: step.path, line: step.line, body: body.trim(), side: "RIGHT" });
    setPosted((s) => new Set(s).add(idx));
  }

  const setLastVerdict = useReviewVerdict((s) => s.setLast);
  const verdict = plan.verdict ? VERDICT_META[plan.verdict] : null;
  const suggestionIdxs = useMemo(
    () => visible.filter((i) => !!plan.steps[i].suggestion),
    [visible, plan.steps],
  );

  const jumpTo = useCallback((i: number) => {
    stepRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(i);
  }, []);

  // Promote every (undismissed) suggested comment into the pending review at
  // once, and seed the suggested verdict so the submit popover opens on it.
  function draftAsReview() {
    const fresh = suggestionIdxs.filter((i) => !posted.has(i));
    for (const i of fresh) {
      const s = plan.steps[i];
      if (s.suggestion) addComment(s, i, s.suggestion);
    }
    if (plan.verdict) setLastVerdict(VERDICT_META[plan.verdict].event);
    toast.success(
      fresh.length > 0
        ? `${fresh.length} comment${fresh.length === 1 ? "" : "s"} added to your review`
        : "All suggestions are already in your review",
      {
        description: verdict
          ? `${verdict.label.replace("Suggests", "Suggested verdict:")} — open Submit to finish`
          : "Open Submit to finish",
      },
    );
  }

  const lastPos = visible.length - 1;

  return (
    <div className="flex h-full flex-col">
      {/* tour controller */}
      <div className="border-b border-hairline px-5 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            <span>Guided tour</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {Math.max(1, pos + 1)} / {visible.length}
            </span>
            <Button size="icon-sm" variant="ghost" disabled={atFirst} onClick={() => move(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button size="icon-sm" variant="ghost" disabled={atLast} onClick={() => move(1)}>
              <ChevronRight className="size-4" />
            </Button>
            <IconButton
              label="Regenerate tour"
              icon={RefreshCw}
              loading={regenerating}
              onClick={onRegenerate}
            />
          </div>
        </div>
        {plan.summary && (
          <p className="mt-1.5 text-xs leading-relaxed text-foreground/80 line-clamp-2">
            {plan.summary}
          </p>
        )}
      </div>

      {/* staleness / provenance banner */}
      {stale && !staleAck ? (
        // 82: offer Keep / Regenerate rather than forcing a regenerate (which
        // would discard the current walkthrough on a single click).
        <div className="flex items-center gap-2 bg-warning/10 px-5 py-1.5 text-xs text-warning">
          <RefreshCw className="size-3 shrink-0" />
          <span className="min-w-0 flex-1">The diff changed since this tour was generated.</span>
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0 text-warning hover:text-warning"
            onClick={() => setStaleAck(true)}
          >
            Keep
          </Button>
          <Button size="xs" variant="ghost" className="shrink-0" onClick={onRegenerate}>
            Regenerate
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-5 pt-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground/70">
            Toured by {entry.provider === "codex" ? "Codex" : "Claude"} ·{" "}
            {relativeTime(new Date(entry.generatedAt).toISOString())}
          </p>
          {(verdict || suggestionIdxs.length > 0) && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {verdict && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                    verdict.chip,
                  )}
                >
                  <verdict.icon className="size-3" />
                  {verdict.label}
                </span>
              )}
              {suggestionIdxs.length > 0 && (
                <Button size="xs" onClick={draftAsReview}>
                  <Sparkles className="size-3" />
                  Draft as review
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* focus chips — narrow the tour to one kind for a fast risk pass */}
      {kindsPresent.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-2.5">
          <span className="text-[11px] text-muted-foreground/60">Focus</span>
          {kindsPresent.map((k) => {
            const K = KIND[k];
            const on = filter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(on ? null : k)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  on
                    ? cn(K.dot, "text-background")
                    : cn("bg-foreground/5 hover:bg-foreground/10", K.text),
                )}
              >
                <K.icon className="size-3" />
                {K.label}
                <span className="tabular-nums opacity-70">{counts[k]}</span>
              </button>
            );
          })}
          {filter && (
            <button
              type="button"
              onClick={() => setFilter(null)}
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* progress — a single quiet bar; the "N / total" counter above carries
          the exact position. */}
      <div className="mx-5 mt-3 h-1 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-r-full bg-primary transition-[width] duration-300"
          style={{ width: `${(Math.max(1, pos + 1) / Math.max(1, visible.length)) * 100}%` }}
        />
      </div>

      {/* Timeline spine (the journey at a glance) + the reading pane (the
          focused stop). The spine reflects progress: filled up to the active
          node, which glows in its kind colour. */}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-hairline px-3 py-4 lg:block">
          <p className="mb-2 px-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50">
            The tour
          </p>
          <div className="flex flex-col">
            {visible.map((i, p) => {
              const step = plan.steps[i];
              const K = KIND[step.kind];
              const done = p < pos;
              const isActive = p === pos;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => jumpTo(i)}
                  className={cn(
                    "group flex w-full gap-2.5 rounded-md pr-2 text-left transition-colors hover:bg-foreground/[0.03]",
                    isActive && "bg-foreground/[0.05]",
                  )}
                >
                  <span className="relative flex w-4 shrink-0 flex-col items-center self-stretch">
                    <span
                      className={cn(
                        "w-px flex-1",
                        p === 0
                          ? "bg-transparent"
                          : p <= pos
                            ? "bg-primary/55"
                            : "bg-foreground/12",
                      )}
                    />
                    <span className="relative flex size-3.5 items-center justify-center">
                      {isActive && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inline-flex size-full rounded-full opacity-40 motion-safe:animate-ping",
                            K.dot,
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "relative flex size-3.5 items-center justify-center rounded-full",
                          done && "bg-primary text-background",
                          isActive && cn(K.dot, "ring-4 ring-foreground/5"),
                          !done &&
                            !isActive &&
                            cn("border-[1.5px] border-current bg-background", K.text),
                        )}
                      >
                        {done && <Check className="size-2.5" strokeWidth={3} />}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "w-px flex-1",
                        p === lastPos
                          ? "bg-transparent"
                          : p < pos
                            ? "bg-primary/55"
                            : "bg-foreground/12",
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1 py-2">
                    {isActive && (
                      <span
                        className={cn(
                          "mb-0.5 block text-[10px] font-medium uppercase leading-none tracking-wide",
                          K.text,
                        )}
                      >
                        {K.label}
                      </span>
                    )}
                    <span
                      className={cn(
                        "block truncate text-xs leading-snug",
                        isActive
                          ? "font-medium text-foreground"
                          : done
                            ? "text-muted-foreground"
                            : "text-muted-foreground/55",
                      )}
                    >
                      {step.title}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* No top padding here: container padding insets the sticky-stop, leaving
            a gap above the pinned header. The spacer below scrolls away cleanly. */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <div aria-hidden className="h-4" />
          {plan.tour && (
            <div className="mb-5 rounded-lg bg-card/40 px-3.5 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Compass className="size-3.5 text-primary" />
                How to read this PR
              </p>
              <MarkdownBody className="text-xs">{plan.tour}</MarkdownBody>
            </div>
          )}

          {plan.steps.map((step, i) =>
            visible.includes(i) ? (
              <Step
                key={i}
                setRef={(el) => {
                  stepRefs.current[i] = el;
                }}
                step={step}
                index={i}
                files={files}
                preferPost={preferPost}
                posted={posted.has(i)}
                onAdd={(body) => addComment(step, i, body)}
                onPost={
                  onPostComment
                    ? (body) => onPostComment({ path: step.path, line: step.line, body })
                    : undefined
                }
                onDismiss={() => dismiss(prKey, i)}
                onOpenFile={onOpenFile}
              />
            ) : null,
          )}

          <div className="flex flex-col items-center gap-1.5 py-6">
            {atLast ? (
              <p className="text-xs text-muted-foreground">
                {filter
                  ? `That's every ${KIND[filter].label.toLowerCase()} stop.`
                  : "That's the whole tour — happy reviewing."}
              </p>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => move(1)}>
                Next stop
                <ArrowRight className="size-3" />
              </Button>
            )}
            {dismissedSet.size > 0 && (
              <Button size="xs" variant="ghost" onClick={() => restoreDismissed(prKey)}>
                <RotateCcw className="size-3" />
                Restore {dismissedSet.size} dismissed
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const Step = ({
  setRef,
  step,
  index,
  files,
  preferPost,
  posted,
  onAdd,
  onPost,
  onDismiss,
  onOpenFile,
}: {
  setRef: (el: HTMLElement | null) => void;
  step: GuidedStep;
  index: number;
  files: PullFile[];
  /** When posting straight to GitHub is available, make it the primary action. */
  preferPost: boolean;
  posted: boolean;
  onAdd: (body: string) => void;
  onPost?: (body: string) => Promise<void>;
  onDismiss?: () => void;
  onOpenFile: (path: string, line?: number) => void;
}) => {
  const kind = KIND[step.kind];
  const Icon = kind.icon;
  const [posting, setPosting] = useState(false);
  const [postedGh, setPostedGh] = useState(false);
  // Posting to GitHub is only an option when onPost is wired; the setting only
  // chooses which of the two is the primary (vs secondary) button.
  const canPost = !!onPost;
  const primaryPost = canPost && preferPost;

  async function post(b: string) {
    if (!onPost || !b.trim() || posting) return;
    setPosting(true);
    try {
      await onPost(b.trim());
      setPostedGh(true);
    } catch (e) {
      toast.error(`Couldn't post — ${String(e)}`);
    } finally {
      setPosting(false);
    }
  }

  return (
    <section ref={setRef} className="scroll-mt-2 animate-tour-fade-in">
      {/* sticky header — the current stop stays pinned while you read it.
          Opaque so the diff scrolls cleanly *under* it (no bleed-through). The
          pinning itself marks "where you are", so the row stays neutral. */}
      <div className="sticky top-0 z-20 -mx-5 flex items-center gap-2 border-b border-b-hairline bg-background px-5 py-2 shadow-sm">
        <span aria-hidden className={cn("absolute inset-y-0 left-0 w-0.5", kind.dot)} />
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[11px] font-medium tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <span
          className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", kind.text)}
        >
          <Icon className="size-3.5" />
          {kind.label}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {step.title}
        </h3>
        <button
          type="button"
          onClick={() => onOpenFile(step.path, step.line)}
          aria-label={`Open ${step.path} in the diff`}
          className="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <FileCode className="size-3.5" />
          {step.path.split("/").pop()}:{step.line}
          {step.endLine ? `-${step.endLine}` : ""}
        </button>
        {onDismiss && (
          <IconButton
            label="Dismiss this stop"
            icon={X}
            size="icon-xs"
            onClick={onDismiss}
            className="shrink-0 text-muted-foreground/60 hover:text-foreground"
          />
        )}
      </div>

      {/* content */}
      <div className="min-w-0 pt-3 pb-8">
        <div>
          <InlineDiff files={files} path={step.path} line={step.line} endLine={step.endLine} />
        </div>

        {step.detail && (
          <MarkdownBody className="mt-3 text-xs text-foreground/90">{step.detail}</MarkdownBody>
        )}

        {step.suggestion != null && (
          <Composer
            className="mt-3"
            initialValue={step.suggestion}
            rows={3}
            header={
              <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                <Sparkles className="size-3 text-primary" />
                Suggested comment
              </span>
            }
            submitLabel={
              primaryPost
                ? postedGh
                  ? "Post again"
                  : "Post to GitHub"
                : posted
                  ? "Add again"
                  : "Add to review"
            }
            submitIcon={primaryPost ? <Send className="size-3" /> : undefined}
            submitting={posting}
            onSubmit={primaryPost ? (b) => post(b) : (b) => onAdd(b)}
            secondaryLabel={
              canPost
                ? primaryPost
                  ? posted
                    ? "Add again"
                    : "Add to review"
                  : postedGh
                    ? "Post again"
                    : "Post to GitHub"
                : undefined
            }
            onSecondary={canPost ? (primaryPost ? (b) => onAdd(b) : (b) => post(b)) : undefined}
            footerStatus={
              postedGh ? (
                <span className="inline-flex items-center gap-1 pl-0.5 text-[11px] text-success">
                  <Check className="size-3" /> Posted to GitHub
                </span>
              ) : posted ? (
                <span className="inline-flex items-center gap-1 pl-0.5 text-[11px] text-success">
                  <Check className="size-3" /> Added to review
                </span>
              ) : undefined
            }
          />
        )}
      </div>
    </section>
  );
};

function InlineDiff({
  files,
  path,
  line,
  endLine,
}: {
  files: PullFile[];
  path: string;
  line: number;
  endLine?: number;
}) {
  const file = files.find((f) => f.filename === path);
  const lang = detectLanguage(path);
  const lo = line;
  const hi = endLine && endLine >= line ? endLine : line;

  const window = useMemo(() => {
    const hunks = parsePatch(file?.patch ?? null);
    const inRange = (nl: number | null | undefined) => nl != null && nl >= lo && nl <= hi;
    const hunk =
      hunks.find((h) => h.lines.some((l) => inRange(l.newLine))) ??
      hunks.find((h) => h.lines.some((l) => (l.newLine ?? 0) >= lo)) ??
      hunks[0];
    if (!hunk) return null;
    const rows = hunk.lines.filter((l) => l.kind !== "hunk");
    let first = rows.findIndex((l) => inRange(l.newLine));
    let last = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (inRange(rows[i].newLine)) {
        last = i;
        break;
      }
    }
    if (first < 0) {
      // Range not present as added lines — center on the closest line.
      const c = rows.findIndex((l) => (l.newLine ?? 0) >= lo);
      first = last = c < 0 ? 0 : c;
    }
    const CTX = 4;
    const from = Math.max(0, first - CTX);
    const to = Math.min(rows.length, last + CTX + 1);
    return rows.slice(from, to);
  }, [file?.patch, lo, hi]);

  if (!window) {
    return (
      <p className="rounded-lg bg-foreground/[0.03] p-2.5 text-xs text-muted-foreground">
        Not part of this diff — open the file for the full context.
      </p>
    );
  }

  const inRange = (nl: number | null | undefined) => nl != null && nl >= lo && nl <= hi;
  return (
    <div className="overflow-x-auto rounded-lg border border-border/40 bg-card/60 py-1 font-mono text-xs leading-[1.5]">
      {window.map((l, i) => {
        const num = l.newLine ?? l.oldLine;
        const hit = inRange(l.newLine);
        return (
          <div
            key={i}
            // One continuous primary bar marks the focused range — no per-line box.
            className={cn(
              "flex border-l-2 border-transparent",
              !hit && l.kind === "add" && "bg-success/[0.07]",
              !hit && l.kind === "del" && "bg-destructive/[0.07]",
              hit && "border-primary/70 bg-primary/[0.14]",
            )}
          >
            <span className="w-10 shrink-0 select-none px-2 text-right text-muted-foreground/40 tabular-nums">
              {num ?? ""}
            </span>
            <span
              className={cn(
                "w-3 shrink-0 text-center",
                l.kind === "add" && "text-success/80",
                l.kind === "del" && "text-destructive/80",
              )}
            >
              {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
            </span>
            <pre
              className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-3 text-foreground/90"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Prism-highlighted
              dangerouslySetInnerHTML={{ __html: highlightLine(l.text, lang) || "&nbsp;" }}
            />
          </div>
        );
      })}
    </div>
  );
}
