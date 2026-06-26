import { Composer } from "@/components/composer";
import { IconButton } from "@/components/icon-button";
import { KiteLoader } from "@/components/kite-loader";
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
  ListOrdered,
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
  /** Report whether the guided reading pane has scrolled past its intro. */
  onScrolledChange?: (scrolled: boolean) => void;
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
  orient: {
    icon: Compass,
    text: "text-muted-foreground",
    dot: "bg-foreground/55",
    label: "Orientation",
  },
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
  onScrolledChange,
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
      onScrolledChange={onScrolledChange}
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

  // The kite is alive by *physics*, not a canned path: a spring tugs it by its
  // line toward the cursor (lag + overshoot = the feel of being pulled), and
  // when the mouse is idle it drifts gently on its own. Each frame we also draw
  // the slack flying line from the kite's (now-moved) bridle to the cursor.
  // Refs (not state) so none of this re-renders React.
  const panelRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<HTMLDivElement>(null);
  const kiteRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<SVGCircleElement>(null);
  const stringRef = useRef<SVGPathElement>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const pos = { x: 0, y: 0 };
    const vel = { x: 0, y: 0 };
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const kite = kiteRef.current;
      const home = homeRef.current;
      const panel = panelRef.current;
      if (!kite || !home || !panel) return;
      const pr = panel.getBoundingClientRect();
      const hr = home.getBoundingClientRect();
      const hx = hr.left + hr.width / 2 - pr.left;
      const hy = hr.top + hr.height / 2 - pr.top;
      const cur = cursorRef.current;
      const t = performance.now() / 1000;

      // Target offset from home: pulled toward the cursor on a leash (≤72px),
      // or a gentle idle wander when there's no cursor.
      let tx: number;
      let ty: number;
      if (cur) {
        const rx = cur.x - hx;
        const ry = cur.y - hy;
        const d = Math.hypot(rx, ry) || 1;
        const reach = Math.min(d, 72);
        tx = (rx / d) * reach + Math.sin(t * 1.4) * 2.5;
        ty = (ry / d) * reach + Math.cos(t * 1.8) * 2.5;
      } else {
        tx = Math.sin(t * 0.7) * 9 + Math.sin(t * 1.9) * 3;
        ty = Math.cos(t * 0.9) * 7 + Math.cos(t * 2.3) * 2;
      }

      // Spring toward the target with damping → lag and a little overshoot.
      vel.x = (vel.x + (tx - pos.x) * 0.045) * 0.87;
      vel.y = (vel.y + (ty - pos.y) * 0.045) * 0.87;
      pos.x += vel.x;
      pos.y += vel.y;
      // Face the pull: tilt toward the side the line is tugging it (kite→cursor
      // horizontal), plus a little of its own velocity for life.
      const aim = cur ? clamp((cur.x - (hx + pos.x)) / 50, -1, 1) * 28 : 0;
      const bank = clamp(aim + vel.x * 0.8, -34, 34);
      kite.style.transform = `translate(${pos.x.toFixed(2)}px, ${pos.y.toFixed(2)}px) rotate(${bank.toFixed(2)}deg)`;

      // Flying line: slack curve from the moved bridle to the cursor.
      const path = stringRef.current;
      const anchor = anchorRef.current;
      if (!path) return;
      if (!cur || !anchor) {
        path.setAttribute("opacity", "0");
        return;
      }
      const a = anchor.getBoundingClientRect();
      const ax = a.left + a.width / 2 - pr.left;
      const ay = a.top + a.height / 2 - pr.top;
      const sag = Math.min(44, Math.max(6, Math.hypot(cur.x - ax, cur.y - ay) * 0.16));
      path.setAttribute(
        "d",
        `M${ax} ${ay} Q${(ax + cur.x) / 2} ${(ay + cur.y) / 2 + sag} ${cur.x} ${cur.y}`,
      );
      path.setAttribute("opacity", "0.55");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={panelRef}
      onMouseMove={(e) => {
        const r = panelRef.current?.getBoundingClientRect();
        if (r) cursorRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      }}
      onMouseLeave={() => {
        cursorRef.current = null;
      }}
      className="relative flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
    >
      {/* Blueprint dot-grid for a restrained "labs" feel. */}
      <div aria-hidden className="lab-grid pointer-events-none absolute inset-0 opacity-60" />

      {/* Flying line: a slack string from the kite's bridle to the cursor. Sits
          below the z-10 content, so it emerges from behind the kite. */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        <path
          ref={stringRef}
          fill="none"
          stroke="#7a5a3a"
          strokeWidth={1.5}
          strokeLinecap="round"
          opacity={0}
        />
      </svg>

      {/* Emblem: the brand kite, flown by physics. homeRef is its fixed rest
          slot (never transformed — the spring measures from here); kiteRef is
          the moved kite. It wanders gently on its own and is tugged by its line
          toward the cursor. */}
      <div ref={homeRef} className="relative z-10 flex h-36 w-24 items-center justify-center">
        <div ref={kiteRef} className="will-change-transform">
          <KiteLoader anchorRef={anchorRef} className="h-36 w-24" />
        </div>
      </div>

      <div className="z-10 flex flex-col items-center gap-2.5">
        <h2 className="font-display text-lg text-foreground">Guided tour</h2>
        {!pending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Compass className="size-3.5 text-primary" />
              Reads the PR
            </span>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <span className="inline-flex items-center gap-1.5">
              <ListOrdered className="size-3.5 text-primary" />
              Orders it
            </span>
            <ChevronRight className="size-3 text-muted-foreground/40" />
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="size-3.5 text-primary" />
              Flags what matters
            </span>
          </div>
        )}
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
  onScrolledChange,
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
  onScrolledChange?: (scrolled: boolean) => void;
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
  const [tourScrolled, setTourScrolled] = useState(false);
  // 82: lets the reviewer keep a stale tour — acknowledges staleness and hides
  // the banner without discarding the (still useful) walkthrough.
  const [staleAck, setStaleAck] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<(HTMLElement | null)[]>([]);
  const scrolledRef = useRef(false);

  // While a programmatic jump (click a node / next / prev) is smooth-scrolling,
  // hold the chosen stop active until the scroll actually arrives — otherwise
  // the scroll listener reads the mid-animation position and briefly flashes
  // each stop it passes over (the "blink to the previous one").
  const jumpTargetRef = useRef<number | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beginJump = useCallback((target: number) => {
    jumpTargetRef.current = target;
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    // Safety release: the scroll may never reach the very top (e.g. the last
    // stops), so don't hold the highlight hostage forever.
    jumpTimer.current = setTimeout(() => {
      jumpTargetRef.current = null;
    }, 1000);
  }, []);
  useEffect(
    () => () => {
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
    },
    [],
  );

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
        beginJump(n);
        stepRefs.current[n]?.scrollIntoView({ behavior: "smooth", block: "start" });
        return n;
      });
    },
    [visible, beginJump],
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

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    function syncScrolled() {
      if (!root) return;
      const next = root.scrollTop > 12;
      if (next === scrolledRef.current) return;
      scrolledRef.current = next;
      setTourScrolled(next);
      onScrolledChange?.(next);
    }

    syncScrolled();
    root.addEventListener("scroll", syncScrolled, { passive: true });
    return () => {
      root.removeEventListener("scroll", syncScrolled);
      scrolledRef.current = false;
      setTourScrolled(false);
      onScrolledChange?.(false);
    };
  }, [onScrolledChange]);

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
        // Small tolerance so a jumped-to stop (which lands ~flush at the top)
        // still registers as current — a tight `<= 1` would snap back to the
        // previous stop after a click/next jump.
        if (el.getBoundingClientRect().top - top <= 4) current = i;
        else break;
      }
      // A jump is animating: hold the chosen stop until the scroll reaches it,
      // so we don't flash each stop it passes over on the way.
      if (jumpTargetRef.current !== null) {
        if (current !== jumpTargetRef.current) return;
        jumpTargetRef.current = null;
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

  const jumpTo = useCallback(
    (i: number) => {
      beginJump(i);
      stepRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(i);
    },
    [beginJump],
  );

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
      <div
        className={cn(
          "overflow-hidden border-b border-hairline transition-[max-height,opacity,transform,padding] duration-300 ease-out motion-reduce:transition-none",
          tourScrolled
            ? "pointer-events-none max-h-0 -translate-y-1 px-5 py-0 opacity-0"
            : "max-h-28 translate-y-0 px-5 py-2.5 opacity-100",
        )}
        aria-hidden={tourScrolled}
      >
        <div
          className={cn(
            "transition-opacity duration-200 ease-out motion-reduce:transition-none",
            tourScrolled ? "opacity-0" : "opacity-100",
          )}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
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

      {/* Timeline spine (the journey at a glance) + the reading pane (the
          focused stop). The spine carries progress on its own — nodes fill in
          the accent up to the active one, which glows — so there's no separate
          progress bar. */}
      <div className="mt-2 flex min-h-0 flex-1">
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
                            ? "bg-foreground/35"
                            : "bg-foreground/12",
                      )}
                    />
                    <span className="relative flex size-3.5 items-center justify-center">
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute inline-flex size-full rounded-full bg-foreground opacity-20 motion-safe:animate-ping"
                        />
                      )}
                      {/* Fill encodes STATE (done/current = accent, ahead = hollow).
                          The kind shows in the row heading, not on the node. */}
                      <span
                        className={cn(
                          "relative flex size-3.5 items-center justify-center rounded-full",
                          done && "bg-foreground/55 text-background",
                          isActive && "bg-foreground/75 text-background ring-4 ring-foreground/10",
                          !done && !isActive && "border-[1.5px] border-foreground/25 bg-background",
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
                            ? "bg-foreground/35"
                            : "bg-foreground/12",
                      )}
                    />
                  </span>
                  <span className="min-w-0 flex-1 py-2">
                    <span
                      className={cn(
                        "mb-0.5 block text-[10px] font-medium uppercase leading-none tracking-wide",
                        K.text,
                        !isActive && "opacity-55",
                      )}
                    >
                      {K.label}
                    </span>
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
                <Compass className="size-3.5 text-muted-foreground" />
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
    <section ref={setRef} className="animate-tour-fade-in">
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
                <Sparkles className="size-3 text-info" />
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
            // One continuous neutral bar marks the focused range — no per-line box.
            className={cn(
              "flex border-l-2 border-transparent",
              !hit && l.kind === "add" && "bg-success/[0.07]",
              !hit && l.kind === "del" && "bg-destructive/[0.07]",
              hit && "border-foreground/50 bg-foreground/[0.08]",
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
