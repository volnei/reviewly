import { CommentByline } from "@/components/comment-byline";
import { Composer } from "@/components/composer";
import { MarkdownBody } from "@/components/markdown-body";
import { ReactionsBar } from "@/components/reactions-bar";
import { ReviewThreadGroup } from "@/components/review-thread";
import { TooltipFor } from "@/components/tooltip-for";
import { type DiffLine, type Hunk, parsePatch, toSplit } from "@/lib/diff";
import { detectLanguage, highlightLine } from "@/lib/lang";
import type { DraftComment, ReviewThread, ReviewThreadGraphQL } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useReviewPrefs } from "@/stores/review-prefs";
import { useViewedFiles } from "@/stores/viewed-files";
import { diffWordsWithSpace } from "diff";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  MessageSquarePlus,
  TextQuote,
  UnfoldVertical,
  WrapText,
} from "lucide-react";
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface Props {
  path: string;
  patch: string | null;
  view: "unified" | "split";
  threads: ReviewThread[];
  onAddComment: (c: DraftComment) => void;
  /** PR coordinates + GraphQL thread data, for inline reply/resolve actions. */
  owner: string;
  repo: string;
  number: number;
  reviewThreads?: ReviewThreadGraphQL[];
  /** Logged-in user login — enables react/un-react toggle on inline comments. */
  viewerLogin?: string;
  /** Full HEAD file content (lines), enabling "expand context" between hunks. */
  fileLines?: string[];
  /** When true, calls `onReachedEnd` once the bottom of the diff scrolls into view. */
  autoMarkViewed?: boolean;
  onReachedEnd?: () => void;
  /** Line spacing for the diff rows. */
  density?: "comfortable" | "compact";
  /** New-file line to scroll to + flash (e.g. when a guided-tour step opens). */
  focusLine?: number | null;
  /** Bumps on every focus request so repeat clicks re-trigger the scroll/flash. */
  focusNonce?: number;
  /** PR head sha — enables GitHub permalinks for the file/line copy actions. */
  headSha?: string | null;
  /**
   * Stable per-PR+head-sha key for persisting expanded context gaps so
   * re-opening a file keeps its expansions. Null disables persistence.
   */
  viewedKey?: string | null;
  /** True while the full HEAD file content is still loading (for context UX). */
  fileLinesLoading?: boolean;
}

interface GapInfo {
  idx: number;
  newFrom: number;
  newTo: number;
  /** oldLine = newLine + offset within this unchanged region. */
  offset: number;
}

interface HunkBound {
  endNew: number;
  endOld: number;
}

type Side = "LEFT" | "RIGHT";

interface ThreadMeta {
  owner: string;
  repo: string;
  number: number;
  reviewThreads: ReviewThreadGraphQL[];
  viewerLogin?: string;
}
const ThreadMetaContext = createContext<ThreadMeta | null>(null);

/** Identifies a specific line in the diff. */
interface Anchor {
  side: Side;
  line: number;
}

/** Per-render line presentation options threaded down to each row. */
interface LineRenderCtx {
  /** Wrap long lines (whitespace-pre-wrap) vs. overflow horizontally (pre). */
  wrap: boolean;
}

/** State shared across all rows so we can show one popover and extend ranges. */
interface CommentUiState {
  popoverAt: Anchor | null;
  rangeStart: Anchor | null;
  dragAnchor: Anchor | null;
  dragEnd: Anchor | null;
  open: (anchor: Anchor, shift: boolean) => void;
  close: () => void;
  startDrag: (anchor: Anchor) => void;
  extendDrag: (anchor: Anchor) => void;
}

export function DiffViewer({
  path,
  patch,
  view,
  threads,
  onAddComment,
  owner,
  repo,
  number,
  reviewThreads = [],
  viewerLogin,
  fileLines,
  autoMarkViewed = false,
  onReachedEnd,
  density = "comfortable",
  focusLine,
  focusNonce,
  headSha,
  viewedKey,
  fileLinesLoading = false,
}: Props) {
  const hunks = useMemo(() => parsePatch(patch), [patch]);
  const lang = useMemo(() => detectLanguage(path), [path]);
  const bounds = useMemo(() => hunks.map(hunkBounds), [hunks]);
  const rootRef = useRef<HTMLDivElement>(null);

  // Line-wrapping + whitespace-only collapsing are review-wide prefs.
  const diffWrap = useReviewPrefs((s) => s.diffWrap);
  const setDiffWrap = useReviewPrefs((s) => s.setDiffWrap);
  const hideWhitespace = useReviewPrefs((s) => s.hideWhitespace);
  const setHideWhitespace = useReviewPrefs((s) => s.setHideWhitespace);

  // Persisted expanded context gaps for this file (keyed by viewedKey → path).
  const persistedGaps = useViewedFiles((s) =>
    viewedKey ? s.expandedGaps[viewedKey]?.[path] : undefined,
  );
  const setGapExpanded = useViewedFiles((s) => s.setGapExpanded);

  const lineCtx: LineRenderCtx = { wrap: diffWrap };

  // Scroll to + flash a target line when the guided tour jumps here. The
  // `focusLine` carries a fresh value per request (incl. repeat clicks).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on focusLine even when path is unchanged
  useEffect(() => {
    if (focusLine == null) return;
    const root = rootRef.current;
    if (!root) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Defer to next frame so a just-switched file has rendered its rows.
    raf = requestAnimationFrame(() => {
      const el = root.querySelector<HTMLElement>(`[data-line="${focusLine}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("diff-line-flash");
      // Force reflow so the animation restarts on repeat clicks.
      void el.offsetWidth;
      el.classList.add("diff-line-flash");
      timer = setTimeout(() => el.classList.remove("diff-line-flash"), 1700);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
  }, [focusLine, focusNonce, path]);

  // Which gaps (between/around hunks) the user has expanded. Reset per file,
  // then re-seeded from any persisted expansions for this file.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset+reseed when the file (or its persisted gaps) changes
  useEffect(() => {
    const seed = new Set<number>();
    if (persistedGaps) {
      for (const k of Object.keys(persistedGaps)) seed.add(Number(k));
    }
    setExpanded(seed);
  }, [path, persistedGaps]);

  const expandGap = (idx: number) => {
    setExpanded((prev) => new Set(prev).add(idx));
    if (viewedKey) setGapExpanded(viewedKey, path, idx);
  };

  // "Load full file" toggle for the null-patch fallback. Reset per file.
  const [nullPatchExpanded, setNullPatchExpanded] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on file change
  useEffect(() => setNullPatchExpanded(false), [path]);

  // Reset the diff scroll back to the top whenever the file changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll reset on file change
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sc = scrollParent(root);
    if (sc) sc.scrollTop = 0;
  }, [path]);

  const gapFor = (idx: number): GapInfo | null => {
    if (!fileLines || fileLines.length === 0) return null;
    const prevEndNew = idx === 0 ? 0 : bounds[idx - 1].endNew;
    const newFrom = prevEndNew + 1;
    const nextStartNew = idx === hunks.length ? fileLines.length + 1 : hunks[idx].newStart;
    const newTo = nextStartNew - 1;
    if (newTo < newFrom || newFrom < 1) return null;
    const offset = idx === 0 ? 0 : bounds[idx - 1].endOld - bounds[idx - 1].endNew;
    return { idx, newFrom, newTo: Math.min(newTo, fileLines.length), offset };
  };

  // Auto-mark viewed: fire once when the end-of-diff sentinel scrolls into view.
  const endRef = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-arm on file change
  useEffect(() => {
    firedRef.current = false;
  }, [path]);
  useEffect(() => {
    if (!autoMarkViewed || !onReachedEnd) return;
    const el = endRef.current;
    if (!el) return;
    const root = scrollParent(el);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onReachedEnd();
    };
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting;
        if (!visible || firedRef.current) {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          return;
        }
        // Short file (fits without scrolling) → mark instantly. Otherwise the
        // reader scrolled to the end, so require a 3s dwell before marking.
        const short = !root || root.scrollHeight <= root.clientHeight + 4;
        if (short) {
          fire();
        } else if (!timer) {
          timer = setTimeout(fire, 3000);
        }
      },
      { root, threshold: 1 },
    );
    io.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
    };
  }, [autoMarkViewed, onReachedEnd]);

  const [popoverAt, setPopoverAt] = useState<Anchor | null>(null);
  const [rangeStart, setRangeStart] = useState<Anchor | null>(null);
  const [dragAnchor, setDragAnchor] = useState<Anchor | null>(null);
  const [dragEnd, setDragEnd] = useState<Anchor | null>(null);

  // Keep current drag values in a ref so the window mouseup handler always
  // sees the latest, without re-attaching the listener on every drag step.
  const dragRef = useRef<{ anchor: Anchor | null; end: Anchor | null }>({
    anchor: null,
    end: null,
  });
  dragRef.current = { anchor: dragAnchor, end: dragEnd };

  useEffect(() => {
    function onUp() {
      const { anchor, end } = dragRef.current;
      if (!anchor) return;
      setDragAnchor(null);
      setDragEnd(null);
      const target = end ?? anchor;
      if (target.side === anchor.side && target.line !== anchor.line) {
        // Multi-line range — set rangeStart and popoverAt accordingly.
        setRangeStart(anchor);
        setPopoverAt(target);
      } else {
        // Single-line click → open popover for that line.
        setRangeStart(null);
        setPopoverAt(target);
      }
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const ui: CommentUiState = {
    popoverAt,
    rangeStart,
    dragAnchor,
    dragEnd,
    open: (anchor, shift) => {
      if (shift && popoverAt && popoverAt.side === anchor.side) {
        setRangeStart(popoverAt);
        setPopoverAt(anchor);
      } else {
        setRangeStart(null);
        setPopoverAt(anchor);
      }
    },
    close: () => {
      setPopoverAt(null);
      setRangeStart(null);
    },
    startDrag: (anchor) => {
      setDragAnchor(anchor);
      setDragEnd(anchor);
      setPopoverAt(null);
      setRangeStart(null);
    },
    extendDrag: (anchor) => {
      if (!dragAnchor) return;
      if (anchor.side !== dragAnchor.side) return;
      setDragEnd(anchor);
    },
  };

  // Sorted distinct new-file lines that have a thread anchor, for prev/next
  // comment navigation. Scrolls between the rendered `[data-line]` anchors.
  const commentLines = useMemo(() => {
    const set = new Set<number>();
    for (const t of threads) {
      if (t.path !== path) continue;
      const ln = t.line ?? t.original_line;
      if (ln != null) set.add(ln);
    }
    return [...set].sort((a, b) => a - b);
  }, [threads, path]);

  const navComment = (dir: 1 | -1) => {
    const root = rootRef.current;
    if (!root || commentLines.length === 0) return;
    // Use the current scroll position to find the nearest anchor in `dir`.
    const sc = scrollParent(root);
    const viewportTop = sc ? sc.scrollTop : 0;
    let target: number | null = null;
    for (const ln of dir === 1 ? commentLines : [...commentLines].reverse()) {
      const el = root.querySelector<HTMLElement>(`[data-line="${ln}"]`);
      if (!el) continue;
      const top = el.offsetTop;
      if (dir === 1 ? top > viewportTop + 4 : top < viewportTop - 4) {
        target = ln;
        break;
      }
    }
    // Wrap around if nothing ahead.
    if (target == null)
      target = dir === 1 ? commentLines[0] : commentLines[commentLines.length - 1];
    const el = root.querySelector<HTMLElement>(`[data-line="${target}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // The file/line copy actions need a GitHub permalink base. With a head sha we
  // produce a stable blob permalink; without it we fall back to the PR files URL.
  const permalink = (line?: number): string => {
    if (headSha) {
      const base = `https://github.com/${owner}/${repo}/blob/${headSha}/${path}`;
      return line != null ? `${base}#L${line}` : base;
    }
    return `https://github.com/${owner}/${repo}/pull/${number}/files`;
  };

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  const toolbar = (
    <DiffToolbar
      wrap={diffWrap}
      onToggleWrap={() => setDiffWrap(!diffWrap)}
      hideWhitespace={hideWhitespace}
      onToggleHideWhitespace={() => setHideWhitespace(!hideWhitespace)}
      commentCount={commentLines.length}
      onPrevComment={() => navComment(-1)}
      onNextComment={() => navComment(1)}
      onCopyPath={() => copyText(path, "File path copied")}
      onCopyPermalink={() => copyText(permalink(), "GitHub permalink copied")}
      onOpenGitHub={() => safeOpenUrl(permalink())}
    />
  );

  if (hunks.length === 0) {
    // Better null-patch handling: instead of a dead-end message, offer to load
    // the full file (when HEAD content is available) or open it on GitHub.
    const fullLines = fileLines ?? [];
    return (
      <div ref={rootRef}>
        {toolbar}
        <div className="space-y-3 p-6 text-xs text-muted-foreground">
          <p>No inline diff available — this file may be binary, renamed, or too large.</p>
          <div className="flex flex-wrap items-center gap-2">
            {fullLines.length > 0 && !nullPatchExpanded && (
              <button
                type="button"
                onClick={() => setNullPatchExpanded(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-foreground/[0.04] px-2.5 py-1 text-foreground transition-colors hover:bg-primary/10"
              >
                <UnfoldVertical className="size-3.5 text-primary/80" />
                Load full file ({fullLines.length} lines)
              </button>
            )}
            {fileLinesLoading && fullLines.length === 0 && (
              <span className="inline-flex items-center gap-1.5 opacity-70">
                <UnfoldVertical className="size-3.5 animate-pulse" />
                Loading file…
              </span>
            )}
            <button
              type="button"
              onClick={() => safeOpenUrl(permalink())}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/50 px-2.5 py-1 text-foreground transition-colors hover:bg-foreground/[0.06]"
            >
              <ExternalLink className="size-3.5" />
              Open on GitHub
            </button>
          </div>
        </div>
        {nullPatchExpanded && fullLines.length > 0 && (
          <ThreadMetaContext.Provider value={{ owner, repo, number, reviewThreads, viewerLogin }}>
            <div
              className={cn(
                "font-mono text-xs",
                density === "compact" ? "leading-[1.3]" : "leading-[1.55]",
              )}
            >
              <HunkBlock
                path={path}
                lang={lang}
                hunk={fullFileHunk(fullLines)}
                view={view}
                threads={threads}
                ui={ui}
                onAddComment={onAddComment}
                line={lineCtx}
              />
            </div>
          </ThreadMetaContext.Provider>
        )}
      </div>
    );
  }

  return (
    <ThreadMetaContext.Provider value={{ owner, repo, number, reviewThreads, viewerLogin }}>
      {toolbar}
      <div
        ref={rootRef}
        data-selectable
        className={cn(
          "font-mono text-xs",
          density === "compact" ? "leading-[1.3]" : "leading-[1.55]",
        )}
      >
        {hunks.map((h, i) => (
          <Fragment key={i}>
            <GapExpander
              gap={gapFor(i)}
              expanded={expanded.has(i)}
              onExpand={() => expandGap(i)}
              loading={fileLinesLoading}
              fileLines={fileLines}
              path={path}
              lang={lang}
              view={view}
              threads={threads}
              ui={ui}
              onAddComment={onAddComment}
              line={lineCtx}
            />
            <HunkBlock
              path={path}
              lang={lang}
              hunk={h}
              view={view}
              threads={threads}
              ui={ui}
              onAddComment={onAddComment}
              hideWhitespace={hideWhitespace}
              line={lineCtx}
            />
          </Fragment>
        ))}
        <GapExpander
          gap={gapFor(hunks.length)}
          expanded={expanded.has(hunks.length)}
          onExpand={() => expandGap(hunks.length)}
          loading={fileLinesLoading}
          fileLines={fileLines}
          path={path}
          lang={lang}
          view={view}
          threads={threads}
          ui={ui}
          onAddComment={onAddComment}
          line={lineCtx}
        />
        <div ref={endRef} aria-hidden className="h-px" />
      </div>
    </ThreadMetaContext.Provider>
  );
}

/** Synthesize a single all-context hunk covering an entire file's lines. */
function fullFileHunk(lines: string[]): Hunk {
  const out: DiffLine[] = lines.map((text, i) => ({
    kind: "context",
    oldLine: i + 1,
    newLine: i + 1,
    text,
  }));
  return { header: "", oldStart: 1, newStart: 1, lines: out };
}

const TOOLBAR_BTN =
  "flex h-6 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";

/** A toolbar button with a real (Base-UI) tooltip — never a native `title`. */
function ToolBtn({
  tip,
  onClick,
  disabled,
  pressed,
  active,
  children,
}: {
  tip: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TooltipFor label={tip}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={pressed}
        aria-label={tip}
        className={cn(TOOLBAR_BTN, active && "bg-foreground/[0.08] text-foreground")}
      >
        {children}
      </button>
    </TooltipFor>
  );
}

/** Top toolbar: wrap toggle, hide-whitespace toggle, comment nav, copy actions. */
function DiffToolbar({
  wrap,
  onToggleWrap,
  hideWhitespace,
  onToggleHideWhitespace,
  commentCount,
  onPrevComment,
  onNextComment,
  onCopyPath,
  onCopyPermalink,
  onOpenGitHub,
}: {
  wrap: boolean;
  onToggleWrap: () => void;
  hideWhitespace: boolean;
  onToggleHideWhitespace: () => void;
  commentCount: number;
  onPrevComment: () => void;
  onNextComment: () => void;
  onCopyPath: () => void;
  onCopyPermalink: () => void;
  onOpenGitHub: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-hairline bg-card/95 px-2 py-1 font-sans">
      <ToolBtn
        tip={wrap ? "Wrapping long lines" : "Not wrapping (overflow)"}
        onClick={onToggleWrap}
        pressed={wrap}
        active={wrap}
      >
        <WrapText className="size-3.5" />
        Wrap
      </ToolBtn>
      <ToolBtn
        tip="Collapse changes that differ only in whitespace"
        onClick={onToggleHideWhitespace}
        pressed={hideWhitespace}
        active={hideWhitespace}
      >
        <TextQuote className="size-3.5" />
        Hide whitespace
      </ToolBtn>
      <div className="mx-0.5 h-4 w-px bg-border/50" aria-hidden />
      <ToolBtn tip="Previous comment" onClick={onPrevComment} disabled={commentCount === 0}>
        <ChevronUp className="size-3.5" />
      </ToolBtn>
      <span className="text-xs tabular-nums text-muted-foreground/70">{commentCount}</span>
      <ToolBtn tip="Next comment" onClick={onNextComment} disabled={commentCount === 0}>
        <ChevronDown className="size-3.5" />
      </ToolBtn>
      <div className="ml-auto flex items-center gap-1">
        <ToolBtn tip="Copy file path" onClick={onCopyPath}>
          <Copy className="size-3.5" />
        </ToolBtn>
        <ToolBtn tip="Copy GitHub permalink" onClick={onCopyPermalink}>
          <LinkIcon className="size-3.5" />
        </ToolBtn>
        <ToolBtn tip="Open on GitHub" onClick={onOpenGitHub}>
          <ExternalLink className="size-3.5" />
        </ToolBtn>
      </div>
    </div>
  );
}

/* ───────────────────── context expansion ───────────────────── */

function hunkBounds(h: Hunk): HunkBound {
  let endNew = h.newStart - 1;
  let endOld = h.oldStart - 1;
  for (const l of h.lines) {
    if (l.newLine != null) endNew = Math.max(endNew, l.newLine);
    if (l.oldLine != null) endOld = Math.max(endOld, l.oldLine);
  }
  return { endNew, endOld };
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let p = el?.parentElement ?? null;
  while (p) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

function GapExpander({
  gap,
  expanded,
  onExpand,
  loading = false,
  fileLines,
  path,
  lang,
  view,
  threads,
  ui,
  onAddComment,
  line,
}: {
  gap: GapInfo | null;
  expanded: boolean;
  onExpand: () => void;
  /** While the HEAD file content is still loading the button is disabled. */
  loading?: boolean;
  fileLines?: string[];
  path: string;
  lang: string;
  view: "unified" | "split";
  threads: ReviewThread[];
  ui: CommentUiState;
  onAddComment: (c: DraftComment) => void;
  line: LineRenderCtx;
}) {
  // While content is loading we may not yet have a gap (no fileLines). Surface a
  // disabled placeholder rather than nothing, so the reader sees it's coming.
  if (!gap || !fileLines) {
    if (loading) {
      return (
        <div
          className="flex w-full items-center gap-2 border-y border-hairline bg-foreground/[0.03] px-3 py-1.5 text-xs text-muted-foreground/60"
          aria-busy="true"
        >
          <UnfoldVertical className="size-3.5 shrink-0 animate-pulse" />
          <span className="shrink-0">Loading context…</span>
          <span className="h-px flex-1 bg-border/40" aria-hidden />
        </div>
      );
    }
    return null;
  }
  const count = gap.newTo - gap.newFrom + 1;
  if (count <= 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onExpand}
        disabled={loading}
        aria-busy={loading}
        className="flex w-full items-center gap-2 border-y border-hairline bg-foreground/[0.04] px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-foreground/[0.04] disabled:hover:text-muted-foreground"
      >
        <UnfoldVertical
          className={cn("size-3.5 shrink-0 text-primary/80", loading && "animate-pulse")}
        />
        <span className="shrink-0">
          {loading ? "Loading…" : `Expand ${count} hidden line${count === 1 ? "" : "s"}`}
        </span>
        <span className="h-px flex-1 bg-border/40" aria-hidden />
      </button>
    );
  }

  const lines: DiffLine[] = [];
  for (let n = gap.newFrom; n <= gap.newTo; n++) {
    lines.push({
      kind: "context",
      oldLine: n + gap.offset,
      newLine: n,
      text: fileLines[n - 1] ?? "",
    });
  }
  const hunk: Hunk = { header: "", oldStart: 0, newStart: 0, lines };
  return (
    <HunkBlock
      path={path}
      lang={lang}
      hunk={hunk}
      view={view}
      threads={threads}
      ui={ui}
      onAddComment={onAddComment}
      line={line}
    />
  );
}

function parseHunkHeader(text: string): { range: string; symbol: string } {
  const m = text.match(/^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)\s?(.*)$/);
  if (!m) return { range: text, symbol: "" };
  return { range: m[1], symbol: m[2] };
}

/** Sticky breadcrumb shown at the top of each hunk — keeps the enclosing
 * symbol in view while you scroll through the changes. */
function HunkHeaderBar({ text, gutter }: { text: string; gutter?: string }) {
  const { range, symbol } = parseHunkHeader(text);
  return (
    <div className="sticky top-0 z-10 flex border-y border-border/40 bg-card/95 shadow-[0_1px_0_var(--color-border)] backdrop-blur-md">
      {gutter && <span className={cn("shrink-0", gutter)} />}
      <pre className="flex-1 select-text truncate px-3 py-1 text-xs">
        {symbol ? (
          <>
            <span className="text-muted-foreground/45">{range} </span>
            <span className="text-foreground/80">{symbol}</span>
          </>
        ) : (
          <span className="text-muted-foreground/80">{range}</span>
        )}
      </pre>
    </div>
  );
}

/** Fixed-width gutter slot, kept so line content stays aligned. Reserved for
 * future per-line markers (e.g. guided-tour steps). */
function GutterSlot() {
  return <span className="w-4 shrink-0" aria-hidden />;
}

/* ────────────────────────────────────────────────────────────────── */

interface PairWordDiff {
  oldHtml: string;
  newHtml: string;
}

/**
 * For paired del+add lines we compute a word-level diff and produce two HTML
 * strings with `.diff-word-add` / `.diff-word-del` spans on the changed
 * portions. Unchanged tokens still get syntax-highlighted via Prism.
 */
function wordDiff(oldText: string, newText: string, lang: string): PairWordDiff {
  const parts = diffWordsWithSpace(oldText, newText);
  let oldHtml = "";
  let newHtml = "";
  for (const part of parts) {
    const html = highlightLine(part.value, lang);
    if (part.added) {
      newHtml += `<span class="diff-word-add">${html}</span>`;
    } else if (part.removed) {
      oldHtml += `<span class="diff-word-del">${html}</span>`;
    } else {
      oldHtml += html;
      newHtml += html;
    }
  }
  return { oldHtml, newHtml };
}

interface DecoratedLine extends DiffLine {
  html: string;
  /** Marks a del/add pair collapsed because it differs only in whitespace. */
  whitespaceOnly?: boolean;
}

/** True when two strings are identical once all whitespace is stripped. */
function whitespaceEqual(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "") && a !== b;
}

function decorateHunk(hunk: Hunk, lang: string, hideWhitespace = false): DecoratedLine[] {
  const out: DecoratedLine[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.kind === "context" || l.kind === "hunk") {
      out.push({ ...l, html: highlightLine(l.text, lang) });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "del") {
      dels.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].kind === "add") {
      adds.push(lines[i]);
      i++;
    }
    const pairCount = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairCount; k++) {
      // Collapse a pair that differs only by whitespace into a single muted
      // context row showing the new text, so the real change stays visible.
      if (hideWhitespace && whitespaceEqual(dels[k].text, adds[k].text)) {
        out.push({
          ...adds[k],
          kind: "context",
          oldLine: dels[k].oldLine,
          html: highlightLine(adds[k].text, lang),
          whitespaceOnly: true,
        });
        continue;
      }
      const { oldHtml, newHtml } = wordDiff(dels[k].text, adds[k].text, lang);
      out.push({ ...dels[k], html: oldHtml });
      out.push({ ...adds[k], html: newHtml });
    }
    for (let k = pairCount; k < dels.length; k++) {
      out.push({ ...dels[k], html: highlightLine(dels[k].text, lang) });
    }
    for (let k = pairCount; k < adds.length; k++) {
      out.push({ ...adds[k], html: highlightLine(adds[k].text, lang) });
    }
  }
  return out;
}

function HunkBlock({
  path,
  lang,
  hunk,
  view,
  threads,
  ui,
  onAddComment,
  hideWhitespace = false,
  line,
}: {
  path: string;
  lang: string;
  hunk: Hunk;
  view: "unified" | "split";
  threads: ReviewThread[];
  ui: CommentUiState;
  onAddComment: (c: DraftComment) => void;
  hideWhitespace?: boolean;
  line: LineRenderCtx;
}) {
  const decorated = useMemo(
    () => decorateHunk(hunk, lang, hideWhitespace),
    [hunk, lang, hideWhitespace],
  );

  if (view === "split") {
    return (
      <SplitHunk
        path={path}
        lines={decorated}
        threads={threads}
        ui={ui}
        onAddComment={onAddComment}
        line={line}
      />
    );
  }

  // Big-diff perf (SAFE): let the browser skip layout/paint for off-screen
  // hunks via `content-visibility:auto`, reserving an estimated height so the
  // scrollbar stays stable. ~22px/row is a rough line-height estimate. No
  // virtualization or logic change — purely a rendering hint.
  const estHeight = Math.max(1, decorated.length) * 22;
  return (
    <div
      className="border-b border-border/20 [content-visibility:auto]"
      style={{ containIntrinsicSize: `auto ${estHeight}px` }}
    >
      {decorated.map((row, i) => (
        <RowUnified
          key={i}
          line={row}
          path={path}
          threads={threads}
          ui={ui}
          onAddComment={onAddComment}
          render={line}
        />
      ))}
    </div>
  );
}

/* ───────────────────── selection helpers ───────────────────── */

function rangeBounds(ui: CommentUiState): { side: Side; from: number; to: number } | null {
  if (!ui.popoverAt) return null;
  if (!ui.rangeStart)
    return { side: ui.popoverAt.side, from: ui.popoverAt.line, to: ui.popoverAt.line };
  if (ui.rangeStart.side !== ui.popoverAt.side) return null;
  const a = ui.rangeStart.line;
  const b = ui.popoverAt.line;
  return { side: ui.popoverAt.side, from: Math.min(a, b), to: Math.max(a, b) };
}

/** Active range — drag preview while dragging, otherwise the popover-confirmed range. */
function effectiveRange(ui: CommentUiState): { side: Side; from: number; to: number } | null {
  if (ui.dragAnchor && ui.dragEnd && ui.dragAnchor.side === ui.dragEnd.side) {
    const a = ui.dragAnchor.line;
    const b = ui.dragEnd.line;
    return { side: ui.dragAnchor.side, from: Math.min(a, b), to: Math.max(a, b) };
  }
  return rangeBounds(ui);
}

function isInRange(line: number | null, side: Side, ui: CommentUiState): boolean {
  if (line == null) return false;
  const r = effectiveRange(ui);
  if (!r || r.side !== side) return false;
  return line >= r.from && line <= r.to;
}

/* ───────────────────── unified view ───────────────────── */

function lineBgClass(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return "bg-[color-mix(in_oklch,var(--color-success)_13%,transparent)] border-l-2 border-success/60";
    case "del":
      return "bg-[color-mix(in_oklch,var(--color-destructive)_9%,transparent)] border-l-2 border-destructive/60";
    case "hunk":
      return "border-y border-border/40 bg-[color-mix(in_oklch,var(--color-primary)_4%,transparent)] text-muted-foreground/80 select-text";
    default:
      return "border-l-2 border-transparent";
  }
}

function linePrefix(kind: DiffLine["kind"]): string {
  switch (kind) {
    case "add":
      return "+";
    case "del":
      return "−";
    case "hunk":
      return "";
    default:
      return " ";
  }
}

function RowUnified({
  line,
  path,
  threads,
  ui,
  onAddComment,
  render,
}: {
  line: DecoratedLine;
  path: string;
  threads: ReviewThread[];
  ui: CommentUiState;
  onAddComment: (c: DraftComment) => void;
  render: LineRenderCtx;
}) {
  const isHunk = line.kind === "hunk";
  const lineNum = line.newLine ?? line.oldLine;
  const side: Side = line.newLine != null ? "RIGHT" : "LEFT";
  const matchingThreads = !isHunk
    ? threads.filter(
        (t) =>
          t.path === path &&
          ((side === "RIGHT" && t.line === line.newLine) ||
            (side === "LEFT" && t.original_line === line.oldLine)),
      )
    : [];
  const selected = isInRange(lineNum, side, ui);
  const isPopoverHere =
    ui.popoverAt != null && ui.popoverAt.side === side && ui.popoverAt.line === lineNum;
  const canComment = lineNum != null;

  if (isHunk) {
    return <HunkHeaderBar text={line.text} gutter="w-24" />;
  }

  return (
    <>
      <div
        data-line={line.newLine ?? undefined}
        // Keyboard-focusable so a comment can be placed without the mouse:
        // Enter (or space) opens the comment popover for this line.
        tabIndex={canComment ? 0 : undefined}
        role={canComment ? "button" : undefined}
        aria-label={canComment ? `Line ${lineNum} — press Enter to comment` : undefined}
        onKeyDown={
          canComment
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  ui.open({ side, line: lineNum as number }, e.shiftKey);
                }
              }
            : undefined
        }
        className={cn(
          "group flex outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
          selected ? "border-l-2 border-l-primary bg-primary/15" : lineBgClass(line.kind),
        )}
      >
        <Gutter num={line.oldLine} side="LEFT" ui={ui} />
        <Gutter num={line.newLine} side="RIGHT" ui={ui} />
        <GutterSlot />
        <CommentTrigger
          disabled={lineNum == null}
          onClick={(shift) => ui.open({ side, line: lineNum as number }, shift)}
        />
        <span
          className={cn(
            "flex w-3 shrink-0 select-none items-center justify-center text-xs font-medium",
            line.whitespaceOnly
              ? "text-muted-foreground/40"
              : line.kind === "add" && (selected ? "text-success" : "bg-success/15 text-success"),
            !line.whitespaceOnly &&
              line.kind === "del" &&
              (selected ? "text-destructive" : "bg-destructive/15 text-destructive"),
            line.kind === "context" && "text-muted-foreground/40",
          )}
        >
          {linePrefix(line.kind)}
        </span>
        <pre
          className={cn(
            "flex-1 break-words pr-4 py-0.5 text-foreground/95",
            render.wrap ? "whitespace-pre-wrap" : "overflow-x-auto whitespace-pre",
          )}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: pre-sanitized via Prism / escapeHtml
          dangerouslySetInnerHTML={{ __html: line.html || "&nbsp;" }}
        />
        {line.whitespaceOnly && (
          <span className="shrink-0 self-center pr-1 text-[10px] text-muted-foreground/50">
            whitespace
          </span>
        )}
        <CopyLineButton text={line.text} />
      </div>
      {isPopoverHere && (
        <CommentPopover
          path={path}
          ui={ui}
          onSubmit={(comment) => {
            onAddComment(comment);
            ui.close();
          }}
        />
      )}
      {matchingThreads.length > 0 && <ThreadsBlock threads={matchingThreads} />}
    </>
  );
}

/** Per-line "copy clean source" affordance — copies the raw line text (no diff
 * prefix, no highlight markup), revealed on row hover/focus. */
function CopyLineButton({ text }: { text: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Copy line source"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Line copied");
        } catch {
          toast.error("Couldn't copy");
        }
      }}
      className="mr-1 flex size-4 shrink-0 items-center justify-center self-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Copy className="size-3" />
    </button>
  );
}

/* ───────────────────── split view ───────────────────── */

function SplitHunk({
  path,
  lines,
  threads,
  ui,
  onAddComment,
  line: render,
}: {
  path: string;
  lines: DecoratedLine[];
  threads: ReviewThread[];
  ui: CommentUiState;
  onAddComment: (c: DraftComment) => void;
  line: LineRenderCtx;
}) {
  const rows = useMemo(() => toSplitDecorated(lines), [lines]);
  return (
    <div className="grid grid-cols-2 divide-x divide-border/20 border-b border-border/20">
      {rows.map((row, i) => {
        if (row.left?.kind === "hunk") {
          return (
            <div key={i} className="col-span-2">
              <HunkHeaderBar text={row.left.text} />
            </div>
          );
        }
        return (
          <div key={i} className="col-span-2 contents">
            <Half
              line={row.left}
              side="LEFT"
              path={path}
              threads={threads}
              ui={ui}
              onAddComment={onAddComment}
              render={render}
            />
            <Half
              line={row.right}
              side="RIGHT"
              path={path}
              threads={threads}
              ui={ui}
              onAddComment={onAddComment}
              render={render}
            />
          </div>
        );
      })}
    </div>
  );
}

interface SplitRow {
  left: DecoratedLine | null;
  right: DecoratedLine | null;
}

function toSplitDecorated(lines: DecoratedLine[]): SplitRow[] {
  const fake: Hunk = {
    header: "",
    oldStart: 0,
    newStart: 0,
    lines: lines as DiffLine[],
  };
  const baseRows = toSplit(fake);
  return baseRows.map((r) => ({
    left: (r.left as DecoratedLine) ?? null,
    right: (r.right as DecoratedLine) ?? null,
  }));
}

function Half({
  line,
  side,
  path,
  threads,
  ui,
  onAddComment,
  render,
}: {
  line: DecoratedLine | null;
  side: Side;
  path: string;
  threads: ReviewThread[];
  ui: CommentUiState;
  onAddComment: (c: DraftComment) => void;
  render: LineRenderCtx;
}) {
  if (!line) {
    return <div className="border-l-2 border-transparent bg-foreground/[0.03]" />;
  }
  const lineNum = side === "RIGHT" ? line.newLine : line.oldLine;
  const matchingThreads = threads.filter(
    (t) =>
      t.path === path &&
      ((side === "RIGHT" && t.line === line.newLine) ||
        (side === "LEFT" && t.original_line === line.oldLine)),
  );
  const selected = isInRange(lineNum, side, ui);
  const isPopoverHere =
    ui.popoverAt != null && ui.popoverAt.side === side && ui.popoverAt.line === lineNum;
  const canComment = lineNum != null;

  return (
    <div className="min-w-0">
      <div
        data-line={side === "RIGHT" ? (line.newLine ?? undefined) : undefined}
        tabIndex={canComment ? 0 : undefined}
        role={canComment ? "button" : undefined}
        aria-label={canComment ? `Line ${lineNum} — press Enter to comment` : undefined}
        onKeyDown={
          canComment
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  ui.open({ side, line: lineNum as number }, e.shiftKey);
                }
              }
            : undefined
        }
        className={cn(
          "group flex outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary",
          selected ? "border-l-2 border-l-primary bg-primary/15" : lineBgClass(line.kind),
        )}
      >
        <Gutter num={lineNum} side={side} ui={ui} />
        <GutterSlot />
        <CommentTrigger
          disabled={lineNum == null}
          onClick={(shift) => ui.open({ side, line: lineNum as number }, shift)}
        />
        <pre
          className={cn(
            "min-w-0 flex-1 break-words px-3 py-0.5 text-foreground/95",
            render.wrap ? "whitespace-pre-wrap" : "overflow-x-auto whitespace-pre",
          )}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Prism output
          dangerouslySetInnerHTML={{ __html: line.html || "&nbsp;" }}
        />
        <CopyLineButton text={line.text} />
      </div>
      {isPopoverHere && (
        <CommentPopover
          path={path}
          ui={ui}
          onSubmit={(comment) => {
            onAddComment(comment);
            ui.close();
          }}
        />
      )}
      {matchingThreads.length > 0 && <ThreadsBlock threads={matchingThreads} />}
    </div>
  );
}

/* ───────────────────── pieces ───────────────────── */

function Gutter({
  num,
  side,
  ui,
}: {
  num: number | null | undefined;
  side?: Side;
  ui?: CommentUiState;
}) {
  const isInteractive = num != null && side != null && ui != null;
  if (!isInteractive) {
    return (
      <span className="select-none w-10 shrink-0 border-r border-border/30 px-2 py-px text-right text-xs text-muted-foreground/70 tabular-nums">
        {num ?? ""}
      </span>
    );
  }
  return (
    <span
      className="select-none w-10 shrink-0 cursor-ns-resize border-r border-border/30 px-2 py-px text-right text-xs text-muted-foreground/70 tabular-nums hover:bg-primary/15 hover:text-primary"
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        ui.startDrag({ side, line: num });
      }}
      onMouseEnter={(e) => {
        if (e.buttons !== 1) return;
        ui.extendDrag({ side, line: num });
      }}
    >
      {num}
    </span>
  );
}

function CommentTrigger({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: (shift: boolean) => void;
}) {
  if (disabled) {
    return <span className="w-5 shrink-0" />;
  }
  return (
    <span className="relative w-5 shrink-0">
      <button
        type="button"
        onClick={(e) => onClick(e.shiftKey)}
        className="absolute inset-0 m-auto flex h-4 w-4 items-center justify-center rounded text-primary opacity-0 hover:bg-primary/20 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-primary group-hover:opacity-80"
        aria-label="Add comment (shift-click to extend range)"
      >
        <MessageSquarePlus className="size-3" />
      </button>
    </span>
  );
}

function CommentPopover({
  path,
  ui,
  onSubmit,
}: {
  path: string;
  ui: CommentUiState;
  onSubmit: (c: DraftComment) => void;
}) {
  const r = rangeBounds(ui);
  if (!r) return null;
  const multi = r.from !== r.to;
  return (
    <div className="mx-2 my-1.5 rounded-md border border-border/40 bg-popover/95 px-4 py-3 font-sans shadow-md backdrop-blur-xl">
      {/* The same Composer used in the Conversation tab — with a line chip in
          its header — so every "write a comment" surface is identical. */}
      <Composer
        autoFocus
        className="mx-auto max-w-3xl"
        placeholder="Leave a review comment…"
        submitLabel="Add to review"
        onCancel={ui.close}
        onSubmit={(b) => onSubmit(buildComment(path, r, b))}
        header={
          <>
            <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary">
              {multi ? `Lines ${r.from}–${r.to}` : `Line ${r.from}`}
            </span>
            {!multi && (
              <span className="inline-flex items-center gap-1 text-muted-foreground/55">
                Shift-click another <MessageSquarePlus className="size-3" /> to extend
              </span>
            )}
          </>
        }
      />
    </div>
  );
}

function buildComment(
  path: string,
  r: { side: Side; from: number; to: number },
  body: string,
): DraftComment {
  if (r.from === r.to) {
    return { path, body, line: r.to, side: r.side };
  }
  return {
    path,
    body,
    line: r.to,
    side: r.side,
    start_line: r.from,
    start_side: r.side,
  };
}

function ThreadsBlock({ threads }: { threads: ReviewThread[] }) {
  const meta = useContext(ThreadMetaContext);

  // Group this line's comments by their GraphQL thread so each conversation
  // gets reply + resolve/reopen. Anything not matched falls back to a plain
  // read-only block (e.g. before the GraphQL threads finish loading).
  const groups: { thread: ReviewThreadGraphQL; comments: ReviewThread[] }[] = [];
  const grouped = new Set<number>();
  if (meta) {
    for (const gt of meta.reviewThreads) {
      const cmts = threads.filter((t) => gt.comment_ids.includes(t.id));
      if (cmts.length > 0) {
        groups.push({ thread: gt, comments: cmts });
        for (const c of cmts) grouped.add(c.id);
      }
    }
  }
  const ungrouped = threads.filter((t) => !grouped.has(t.id));

  return (
    <div className="space-y-2 px-10 py-2.5 font-sans backdrop-blur-md">
      {meta &&
        groups.map(({ thread, comments }) => (
          <ReviewThreadGroup
            key={thread.id}
            owner={meta.owner}
            repo={meta.repo}
            number={meta.number}
            thread={thread}
            comments={comments}
            viewerLogin={meta.viewerLogin}
            hideLocation
          />
        ))}
      {ungrouped.length > 0 && (
        <div className="space-y-3 rounded-lg bg-card/40 p-3 text-xs">
          {ungrouped.map((t) => (
            <div key={t.id}>
              <CommentByline
                className="mb-1"
                user={t.user}
                timestamp={t.created_at}
                avatarClassName="size-4"
              />
              <MarkdownBody className="text-xs">{t.body}</MarkdownBody>
              {meta && (
                <div className="mt-1.5">
                  <ReactionsBar
                    target="review_comment"
                    owner={meta.owner}
                    repo={meta.repo}
                    id={t.id}
                    pr={meta.number}
                    viewerLogin={meta.viewerLogin}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
