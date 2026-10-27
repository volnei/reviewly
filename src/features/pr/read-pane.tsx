import { Effect } from "effect";
import { Check, Copy, ExternalLink, Link2 } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { toast } from "@/app/toast";
import { IconButton } from "@/components/icon-button";
import { TabsPanel } from "@/components/ui/tabs";
import { useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { githubWebUrl } from "@/effect/services/Auth";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { age } from "@/features/list/row";
import { linesText } from "@/lib/diff";
import { classify, type HIDE_LABEL } from "@/lib/focus";
import type { GuidedStep } from "@/lib/guided";
import type { PullFile } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";

import { type BriefingReach, ReviewBriefing } from "./briefing";
import { ChecksSection } from "./checks";
import { Diff, lineId } from "./diff";
import { EditableBody } from "./editable";
import { FindBar } from "./find";
import { type Guided, GuidedBanner, type StepActions, StepCard, TourCard } from "./guided";
import { BlameLine, Definitions } from "./intel";
import { Markdown } from "./markdown";
import { type MapMark, Minimap } from "./minimap";
import type { Thread } from "./model";
import { Reactions } from "./reactions";
import {
  Byline,
  type CommentOps,
  CommentView,
  Composer,
  type Draft,
  DraftView,
  ThreadView,
} from "./thread";

/** Where a comment is being written: one line, or a range ending at `line`. */
export interface Composing {
  readonly path: string;
  readonly side: "L" | "R";
  readonly line: number;
  readonly startLine?: number;
}

/** What moved under you since the last visit. */
export interface Since {
  readonly commits: ReadonlyArray<S.Commit>;
  readonly forced: boolean;
  readonly seenAt: string | null;
}

/**
 * ONE continuous scroll: description → the conversation → commits (folded) →
 * checks (one line, folded) → every file's diff with its threads under the
 * lines they are about. Nothing sits beside the code unless asked.
 */
export type PrView = "overview" | "files" | "guided" | "discussion" | "commits" | "checks";

export function ReadPane({
  view,
  onShowFiles,
  pull,
  files,
  issueComments,
  reviews,
  commits,
  checks,
  checksError,
  checksRefreshing,
  onRetryChecks,
  threads,
  drafts,
  split,
  viewer,
  composing,
  setComposing,
  onDraft,
  onDraftChange,
  onDraftDiscard,
  onReply,
  onResolve,
  onComment,
  onMarkRead,
  viewed,
  scrollRef,
  guided,
  showGuided,
  provider,
  onStepJump,
  stepActions,
  onDraftTour,
  since,
  onFileEnd,
  prRef,
  ops,
  canEdit,
  onEditBody,
  wrap,
  hideWhitespace,
  hideNoise,
  findOpen,
  onFindClose,
  headingFor,
  tourOn,
  onLeaveTour,
  sinceReview,
  replies,
  clone,
  onOpenFile,
  onCommitPr,
  briefingReach,
  onOpenBriefing,
  onJumpFile,
  onFinishReview,
}: {
  view: PrView;
  onShowFiles: () => void;
  pull: S.PullDetail;
  files: ReadonlyArray<S.PullFile>;
  issueComments: ReadonlyArray<S.IssueComment>;
  /** The reviews sent so far: a decision, often with words. */
  reviews: ReadonlyArray<S.Review>;
  commits: ReadonlyArray<S.Commit>;
  checks: S.CheckRuns | undefined;
  checksError?: unknown;
  checksRefreshing?: boolean;
  onRetryChecks?: () => void;
  threads: ReadonlyArray<Thread>;
  drafts: ReadonlyArray<Draft>;
  split: boolean;
  viewer: S.Viewer | null;
  composing: Composing | null;
  setComposing: (c: Composing | null) => void;
  onDraft: (d: Omit<Draft, "key">) => void;
  onDraftChange: (key: string, body: string) => void;
  onDraftDiscard: (key: string) => void;
  onReply: (thread: Thread, body: string) => Promise<void>;
  onResolve: (thread: Thread, resolve: boolean) => Promise<void>;
  onComment: (body: string) => Promise<void>;
  onMarkRead: (path: string) => void;
  viewed: ReadonlySet<string>;
  scrollRef: React.RefObject<HTMLDivElement>;
  guided: Guided;
  /** The banner shows in Guided order, and whenever a plan already exists. */
  showGuided: boolean;
  provider: string;
  onStepJump: (i: number) => void;
  /** What a stop can do with its comment: into your review, or straight to GitHub. */
  stepActions: StepActions;
  /** Every stop's comment into the review at once. */
  onDraftTour?: () => void;
  since: Since | null;
  /** Called once a file's end has been on screen with its start scrolled past — if the reader wants that. */
  onFileEnd?: (path: string) => void;
  prRef: PrRef;
  ops: CommentOps;
  /** The author can edit the title and the description in place. */
  canEdit: boolean;
  onEditBody: (body: string) => Promise<void>;
  wrap: boolean;
  hideWhitespace: boolean;
  /** Generated files and lockfiles stay closed until opened. */
  hideNoise: boolean;
  findOpen: boolean;
  onFindClose: () => void;
  /** In layer order: the heading that opens a layer, above its first file. */
  headingFor?: (path: string) => ReactNode;
  /** Guided order with a plan: the tour card floats at the bottom right. */
  tourOn: boolean;
  onLeaveTour: () => void;
  /** The review you sent and what moved since: the read can show only that. */
  sinceReview: {
    sha: string;
    commits: number;
    files: number | null;
    onlyChanged: boolean;
    setOnlyChanged: (v: boolean) => void;
  } | null;
  /** Threads you were in whose last word isn't yours. */
  replies: ReadonlyArray<Thread>;
  /** The local clone, for definitions and blame. */
  clone: string | null;
  onOpenFile: (file: string) => void;
  onCommitPr: (number: number) => void;
  briefingReach: BriefingReach | null;
  onOpenBriefing: () => void;
  onJumpFile: (path: string) => void;
  onFinishReview?: () => void;
}) {
  const positions = useRef(new Map<string, number>());
  const scrollKey = `${prRef.owner}/${prRef.repo}#${pull.number}:${view}`;
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (root) root.scrollTop = positions.current.get(scrollKey) ?? 0;
  }, [scrollKey, scrollRef]);
  const steps = guided.plan?.steps ?? [];
  // Comments and reviews in one order, the one they happened in. A review
  // that only wrapped inline comments (no words, no decision) says nothing here.
  const timeline = useMemo(() => {
    const items: Array<
      | { kind: "comment"; at: string; c: S.IssueComment }
      | { kind: "review"; at: string; r: S.Review }
    > = [];
    for (const c of issueComments)
      if (hasWords(c.body)) items.push({ kind: "comment", at: c.created_at, c });
    for (const r of reviews)
      if (r.state !== "COMMENTED" || hasWords(r.body))
        items.push({ kind: "review", at: r.submitted_at ?? "", r });
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [issueComments, reviews]);
  const ctx: FileCtx = {
    prRef,
    headSha: pull.head.sha,
    baseSha: pull.base.sha,
    clone,
    onCommitPr,
    split,
    wrap,
    hideWhitespace,
    threads,
    drafts,
    steps,
    showGuided,
    provider,
    composing,
    setComposing,
    onDraft,
    onDraftChange,
    onDraftDiscard,
    onReply,
    onResolve,
    onStepJump,
    guided,
    stepActions,
    viewer,
    ops,
    viewed,
    onMarkRead,
  };
  const marks: MapMark[] = [
    ...threads
      .filter((t) => !t.resolved && t.line != null)
      .map((t) => ({
        id: lineId(fileAnchor(t.path), t.side?.[0] === "L" ? "L" : "R", t.line as number),
        kind: "thread" as const,
      })),
    ...drafts.map((d) => ({
      id: lineId(fileAnchor(d.path), d.side, d.line),
      kind: "draft" as const,
    })),
  ];
  const jumpToSide = (path: string, side: "L" | "R", line: number) => {
    onShowFiles();
    requestAnimationFrame(() =>
      document
        .getElementById(lineId(fileAnchor(path), side, line))
        ?.scrollIntoView({ block: "center" }),
    );
  };
  const jumpToLine = (path: string, line: number) => jumpToSide(path, "R", line);

  // A file counts as read once you have scrolled through it: its start above
  // the viewport, its end inside. Checked once per frame while scrolling.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !onFileEnd || (view !== "files" && view !== "guided")) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const rr = root.getBoundingClientRect();
      for (const el of root.querySelectorAll<HTMLElement>("[data-file]")) {
        const r = el.getBoundingClientRect();
        const end = r.bottom > rr.top && r.bottom <= rr.bottom + 8;
        if (r.top < rr.top + 8 && end && el.dataset.file) onFileEnd(el.dataset.file);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onFileEnd, scrollRef, view]);
  return (
    <TabsPanel value={view} keepMounted className="relative flex h-full min-w-0 flex-1 flex-col">
      {(view === "files" || view === "guided") && findOpen ? (
        <FindBar scrollRef={scrollRef} onClose={onFindClose} />
      ) : null}
      <Definitions clone={clone} root={scrollRef} onOpenFile={onOpenFile} />
      {view === "guided" && tourOn ? (
        <TourCard
          g={guided}
          onPrev={() => {
            const i = guided.nextIndex(guided.step, -1);
            if (i != null) onStepJump(i);
          }}
          onNext={() => {
            const i = guided.nextIndex(guided.step, 1);
            if (i != null) onStepJump(i);
          }}
          onLeave={onLeaveTour}
        />
      ) : null}
      {view === "files" || view === "guided" ? (
        <Minimap
          scrollRef={scrollRef}
          paths={files.map((f) => f.filename)}
          viewed={viewed}
          marks={marks}
        />
      ) : null}
      <div
        ref={scrollRef}
        onScroll={(e) => positions.current.set(scrollKey, e.currentTarget.scrollTop)}
        className="min-h-0 flex-1 overflow-y-auto bg-page scrollbar-thin"
      >
        <div
          className={cn(
            "mx-auto px-8 pt-6 pb-24",
            view === "files" || view === "guided" || view === "discussion" || view === "commits"
              ? "max-w-none"
              : view === "overview"
                ? "max-w-none"
                : "max-w-[820px]",
          )}
        >
          <div hidden={view !== "overview" && view !== "files" && view !== "guided"}>
            {sinceReview ? (
              <div className="mb-5 rounded-lg bg-sink px-4 py-3 text-[13px]">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
                  <span>
                    Since your review at{" "}
                    <span className="mono text-ink-2">{sinceReview.sha.slice(0, 7)}</span>
                    <span className="tnum text-ink-3">
                      {" "}
                      · {sinceReview.commits} commit{sinceReview.commits === 1 ? "" : "s"}
                      {sinceReview.files != null
                        ? ` · ${sinceReview.files} file${sinceReview.files === 1 ? "" : "s"} changed`
                        : ""}
                    </span>
                  </span>
                  <span
                    role="radiogroup"
                    aria-label="What to read"
                    className="ml-auto flex gap-0.5"
                  >
                    {(
                      [
                        [true, "Only what changed"],
                        [false, "Everything"],
                      ] as const
                    ).map(([v, label]) => (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={sinceReview.onlyChanged === v}
                        onClick={() => sinceReview.setOnlyChanged(v)}
                        className={cn(
                          "h-6 rounded-md px-2 text-[12px]",
                          sinceReview.onlyChanged === v
                            ? "bg-raise text-ink"
                            : "text-ink-3 hover:bg-raise/50 hover:text-ink-2",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </p>
              </div>
            ) : null}
            {replies.length ? (
              <div className="mb-5 rounded-lg bg-sink px-4 py-3 text-[13px]">
                <p className="text-ink">
                  {replies.length === 1
                    ? "A reply is waiting for you"
                    : `${replies.length} replies are waiting for you`}
                </p>
                <ul className="mt-1.5 grid gap-1">
                  {replies.map((t) => {
                    const last = t.comments[t.comments.length - 1];
                    const side: "L" | "R" = t.side?.[0] === "L" ? "L" : "R";
                    return (
                      <li key={t.key}>
                        <button
                          type="button"
                          onClick={() => jumpToSide(t.path, side, t.line as number)}
                          className="text-left text-[12.5px] text-ink-2 hover:text-ink"
                        >
                          <span className="font-medium text-ink">{last.user.login}</span> in{" "}
                          <span className="mono">
                            {t.path.split("/").pop()}:{t.line}
                          </span>
                          <span className="text-ink-3"> · {last.body.slice(0, 90)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            {since ? (
              <div className="mb-5 rounded-lg bg-sink px-4 py-3 text-[13px]">
                <p className="text-ink">
                  {since.forced
                    ? "Force-pushed since you last looked"
                    : `${since.commits.length} commit${since.commits.length === 1 ? "" : "s"} since you last looked`}
                  {since.seenAt ? <span className="text-ink-3"> · {ago(since.seenAt)}</span> : null}
                  <span className="text-ink-3"> · read marks reset</span>
                </p>
                {!since.forced && since.commits.length ? (
                  <ol className="mt-1.5 grid gap-0.5">
                    {since.commits.map((c) => (
                      <li
                        key={c.sha}
                        className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 text-[12.5px]"
                      >
                        <span className="mono text-ink-3">{c.sha.slice(0, 7)}</span>
                        <span className="truncate text-ink-2">
                          {c.commit.message.split("\n")[0]}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
            {view === "guided" && showGuided ? (
              <GuidedBanner
                g={guided}
                provider={provider}
                onJump={onStepJump}
                onDraftAll={onDraftTour}
              />
            ) : null}
          </div>
          <div hidden={view !== "overview"}>
            <ReviewBriefing
              pull={pull}
              files={files}
              plan={guided.plan}
              planRunning={guided.running}
              reach={briefingReach}
              reviews={reviews}
              viewerLogin={viewer?.login ?? null}
              viewed={viewed}
              threads={threads}
              drafts={drafts}
              checks={checks}
              onGenerate={onOpenBriefing}
              onJumpStep={onStepJump}
              onJumpFile={onJumpFile}
              onFinish={onFinishReview}
            />
            <h2 className="mt-9 mb-5 text-[15px] font-medium">About this change</h2>
            <EditableBody body={pull.body} canEdit={canEdit} onSave={onEditBody}>
              <Markdown>{pull.body}</Markdown>
            </EditableBody>
            <div className="mt-1.5 max-w-[760px]">
              <Reactions
                target="issue"
                owner={prRef.owner}
                repo={prRef.repo}
                id={pull.number}
                me={ops.me}
              />
            </div>
          </div>
          <div hidden={view !== "discussion"}>
            <div className="grid w-full gap-4">
              {timeline.map((t) =>
                t.kind === "comment" ? (
                  <CommentView key={`c${t.c.id}`} kind="issue" comment={t.c} ops={ops} />
                ) : (
                  <ReviewCard key={`r${t.r.id}`} review={t.r} />
                ),
              )}
              <div className="pl-7">
                <Composer
                  placeholder="Say something to the whole pull request…"
                  submitLabel="Comment"
                  onSubmit={onComment}
                  autoFocus={false}
                />
              </div>
            </div>
          </div>
          <div hidden={view !== "commits"}>
            <CommitList commits={commits} />
          </div>
          <div hidden={view !== "checks"}>
            <ChecksSection
              prRef={prRef}
              runs={checks?.check_runs}
              error={checksError}
              refreshing={checksRefreshing}
              onRetry={onRetryChecks}
              onJump={jumpToLine}
              expanded
            />
          </div>

          <div hidden={view !== "files" && view !== "guided"}>
            <div className="grid min-w-0 gap-8">
              {files.map((f) => (
                <Fragment key={f.filename}>
                  {headingFor?.(f.filename)}
                  <FileSection
                    f={f}
                    reason={hideNoise ? classify(f as unknown as PullFile) : null}
                    ctx={ctx}
                  />
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </TabsPanel>
  );
}

const ago = (iso: string) => {
  const a = age(iso);
  return a === "now" ? "just now" : `${a} ago`;
};

/** A body with something to read once HTML comments (a bot's markers) are gone. */
const hasWords = (body: string | null | undefined) =>
  !!body && body.replace(/<!--[\s\S]*?-->/g, "").trim().length > 0;

const REVIEW_WORD: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "review dismissed",
  PENDING: "pending",
};

/** One review in the conversation: who decided what, and the words that came with it. */
function ReviewCard({ review }: { review: S.Review }) {
  const word = REVIEW_WORD[review.state] ?? review.state.toLowerCase();
  return (
    <div className="grid gap-1.5">
      <Byline user={review.user} when={review.submitted_at ?? ""}>
        <span
          className={cn(
            "rounded-[3px] px-1.5 py-px text-[11px]",
            review.state === "APPROVED"
              ? "bg-add/15 text-add"
              : review.state === "CHANGES_REQUESTED"
                ? "bg-del/15 text-del"
                : "bg-raise text-ink-2",
          )}
        >
          {word}
        </span>
      </Byline>
      {hasWords(review.body) ? (
        <div className="pl-7">
          <Markdown>{review.body}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

function CommitList({ commits }: { commits: ReadonlyArray<S.Commit> }) {
  return (
    <section className="mt-6 border-t border-hair pt-5">
      <header>
        <h2 className="text-[15px] font-medium text-ink">
          {commits.length} commit{commits.length === 1 ? "" : "s"}
        </h2>
        <p className="mt-1 text-[12.5px] text-ink-3">The history this pull request adds.</p>
      </header>
      <ol className="mt-5 divide-y divide-hair border-y border-hair">
        {commits.map((c) => {
          const [subject, ...body] = c.commit.message.split("\n");
          const author = c.author?.login ?? c.commit.author?.name ?? "Unknown author";
          return (
            <li key={c.sha} className="group grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 py-3">
              {c.author?.avatar_url ? (
                <img
                  src={c.author.avatar_url}
                  alt=""
                  className="mt-0.5 size-6 rounded-full bg-raise"
                  draggable={false}
                />
              ) : (
                <span className="mt-0.5 grid size-6 place-items-center rounded-full bg-raise text-[10px] text-ink-3">
                  {author.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">{subject}</p>
                {body.join("\n").trim() ? (
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-[12px] leading-[1.45] text-ink-3">
                    {body.join("\n").trim()}
                  </p>
                ) : null}
                <p className="mt-1 text-[11.5px] text-ink-3">
                  <span className="text-ink-2">{author}</span>
                  {c.commit.author?.date ? (
                    <span className="tnum"> · {age(c.commit.author.date)}</span>
                  ) : null}
                </p>
              </div>
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(c.sha)
                      .then(() => toast.say("Commit SHA copied", c.sha))
                      .catch(() => toast.fail("Couldn’t copy it"))
                  }
                  className="mono h-7 rounded-md px-2 text-[11.5px] text-ink-3 hover:bg-raise hover:text-ink"
                  title="Copy the full SHA"
                >
                  {c.sha.slice(0, 7)}
                </button>
                {c.html_url ? (
                  <button
                    type="button"
                    onClick={() => safeOpenUrl(c.html_url as string)}
                    className="grid size-7 place-items-center rounded-md text-ink-3 opacity-0 hover:bg-raise hover:text-ink group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Open commit ${c.sha.slice(0, 7)} on GitHub`}
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export const fileAnchor = (path: string) => `f-${path.replace(/[^a-z0-9]+/gi, "-")}`;

interface FileCtx {
  readonly prRef: PrRef;
  readonly headSha: string;
  readonly baseSha: string;
  readonly clone: string | null;
  readonly onCommitPr: (number: number) => void;
  readonly split: boolean;
  readonly wrap: boolean;
  readonly hideWhitespace: boolean;
  readonly threads: ReadonlyArray<Thread>;
  readonly drafts: ReadonlyArray<Draft>;
  readonly steps: ReadonlyArray<GuidedStep>;
  readonly showGuided: boolean;
  readonly provider: string;
  readonly composing: Composing | null;
  readonly setComposing: (c: Composing | null) => void;
  readonly onDraft: (d: Omit<Draft, "key">) => void;
  readonly onDraftChange: (key: string, body: string) => void;
  readonly onDraftDiscard: (key: string) => void;
  readonly onReply: (thread: Thread, body: string) => Promise<void>;
  readonly onResolve: (thread: Thread, resolve: boolean) => Promise<void>;
  readonly onStepJump: (i: number) => void;
  readonly guided: Guided;
  readonly stepActions: StepActions;
  readonly viewer: S.Viewer | null;
  readonly ops: CommentOps;
  readonly viewed: ReadonlySet<string>;
  readonly onMarkRead: (path: string) => void;
}

/**
 * One file in the read: its header, its diff, and under each line whatever is
 * about that line. Generated files start folded; the whole file at the head
 * is fetched only once someone unfolds a gap.
 */
function FileSection({
  f,
  reason,
  ctx,
}: {
  f: S.PullFile;
  reason: ReturnType<typeof classify>;
  ctx: FileCtx;
}) {
  const [open, setOpen] = useState(!reason);
  const permalink = githubWebUrl(
    `${ctx.prRef.owner}/${ctx.prRef.repo}/blob/${ctx.headSha}/${f.filename}`,
  );
  const copy = (text: string, said: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast.say(said))
      .catch(() => toast.fail("Couldn’t copy it"));
  const [wantFull, setWantFull] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const full = useEffectQuery(
    ["file-content", ctx.prRef.owner, ctx.prRef.repo, ctx.headSha, f.filename],
    Effect.flatMap(GitHub, (g) =>
      g.fileContent(ctx.prRef.owner, ctx.prRef.repo, f.filename, ctx.headSha),
    ),
    { enabled: wantFull, staleTime: Number.POSITIVE_INFINITY, retry: false },
  );
  const fullText = !wantFull ? undefined : full.isError ? null : full.data;
  const ts = ctx.threads.filter((t) => t.path === f.filename);
  const ds = ctx.drafts.filter((d) => d.path === f.filename);
  const stepsHere = ctx.showGuided ? ctx.steps.filter((s) => s.path === f.filename) : [];
  const read = ctx.viewed.has(f.filename);
  const under = (side: "L" | "R", line: number): ReactNode => {
    const here = ts.filter((t) => t.line === line && (t.side ? t.side[0] === side : side === "R"));
    const dh = ds.filter((d) => d.line === line && d.side === side);
    const stepIdx =
      side === "R" ? ctx.steps.findIndex((s) => s.path === f.filename && s.line === line) : -1;
    const step =
      stepIdx >= 0 && stepsHere.length && !ctx.guided.isDismissed(stepIdx)
        ? ctx.steps[stepIdx]
        : null;
    const c = ctx.composing;
    const isComposing = c && c.path === f.filename && c.side === side && c.line === line;
    if (!here.length && !dh.length && !isComposing && !step) return null;
    return (
      <div className="grid max-w-[760px] gap-2">
        {step ? (
          <StepCard
            g={ctx.guided}
            step={step}
            index={stepIdx}
            total={ctx.steps.length}
            actions={ctx.stepActions}
          />
        ) : null}
        {here.map((t) => (
          <ThreadView
            key={t.key}
            thread={t}
            ops={ctx.ops}
            onReply={(b) => ctx.onReply(t, b)}
            onResolve={(r) => ctx.onResolve(t, r)}
          />
        ))}
        {dh.map((d) => (
          <DraftView
            key={d.key}
            draft={d}
            me={ctx.viewer}
            onChange={(b) => ctx.onDraftChange(d.key, b)}
            onDiscard={() => ctx.onDraftDiscard(d.key)}
          />
        ))}
        {isComposing ? (
          <div className="rounded-lg border border-edge bg-card p-3">
            <p className="mb-1.5 text-[11.5px] text-ink-3">
              {c.startLine != null ? (
                <>
                  Lines{" "}
                  <span className="tnum text-ink-2">
                    {c.startLine}–{line}
                  </span>
                </>
              ) : (
                <>
                  Line <span className="tnum text-ink-2">{line}</span>
                </>
              )}{" "}
              · drag a + for a range, ⇧-click a + to stretch it
              {side === "R" ? (
                <>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => {
                      const text = linesText(f.patch, "R", c.startLine ?? line, line);
                      if (text != null) setSeed(`\`\`\`suggestion\n${text}\n\`\`\`\n`);
                    }}
                    className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
                  >
                    suggest a change
                  </button>
                </>
              ) : null}
            </p>
            <Composer
              key={seed ?? "plain"}
              initial={seed ?? ""}
              placeholder="Say it plainly. It goes up with your review."
              submitLabel="Add to review"
              onSubmit={(b) => {
                ctx.onDraft({ path: f.filename, side, line, startLine: c.startLine, body: b });
                ctx.setComposing(null);
                setSeed(null);
              }}
              onCancel={() => {
                ctx.setComposing(null);
                setSeed(null);
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };
  return (
    <section
      id={fileAnchor(f.filename)}
      data-file={f.filename}
      className="min-w-0 scroll-mt-10 border-t border-hair pt-1"
    >
      <header className="group/file sticky top-0 z-10 flex h-9 items-center gap-3 bg-page/95 px-1 backdrop-blur">
        <span className="mono min-w-0 flex-1 truncate text-[12.5px] text-ink">{f.filename}</span>
        {f.previous_filename ? (
          <span className="mono truncate text-[11px] text-ink-3">was {f.previous_filename}</span>
        ) : null}
        <span className="flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover/file:opacity-100">
          <IconButton
            size={6}
            label="Copy the path"
            onClick={() => copy(f.filename, "Path copied")}
          >
            <Copy className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            size={6}
            label="Copy a permalink at this commit"
            onClick={() => copy(permalink, "Permalink copied")}
          >
            <Link2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton size={6} label="Open on GitHub" onClick={() => safeOpenUrl(permalink)}>
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </span>
        <span className="tnum text-[11px]">
          {f.additions ? <span className="text-add">+{f.additions}</span> : null}{" "}
          {f.deletions ? <span className="text-del">−{f.deletions}</span> : null}
        </span>
        <IconButton
          size={6}
          label={read ? "Mark unread" : "Mark read"}
          pressed={read}
          onClick={() => ctx.onMarkRead(f.filename)}
          className={read ? "text-ok hover:text-ok" : undefined}
        >
          <Check className="size-3.5" strokeWidth={2} />
        </IconButton>
      </header>
      {open ? (
        <Diff
          filename={f.filename}
          patch={f.patch}
          split={ctx.split}
          wrap={ctx.wrap}
          hideWhitespace={ctx.hideWhitespace}
          under={under}
          idPrefix={fileAnchor(f.filename)}
          selection={
            ctx.composing && ctx.composing.path === f.filename
              ? {
                  side: ctx.composing.side,
                  start: ctx.composing.startLine ?? ctx.composing.line,
                  end: ctx.composing.line,
                }
              : null
          }
          onComment={(side, line, o) => {
            const c = ctx.composing;
            if (o?.extend && c && c.path === f.filename && c.side === side) {
              const a = Math.min(c.startLine ?? c.line, line);
              const b = Math.max(c.startLine ?? c.line, line);
              ctx.setComposing({
                path: f.filename,
                side,
                line: b,
                startLine: a !== b ? a : undefined,
              });
              return;
            }
            ctx.setComposing({ path: f.filename, side, line, startLine: o?.start });
          }}
          fullText={fullText}
          onNeedFullText={() => setWantFull(true)}
          aside={
            ctx.clone
              ? (hunk) => (
                  <BlameLine
                    clone={ctx.clone as string}
                    file={f.previous_filename ?? f.filename}
                    hunk={hunk}
                    rev={ctx.baseSha}
                    onCommit={ctx.onCommitPr}
                  />
                )
              : undefined
          }
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full items-center gap-2 px-3 text-left text-[12.5px] text-ink-3 hover:text-ink"
        >
          {reason ? FOLD_WHY[reason] : "Folded"} — {f.changes} line{f.changes === 1 ? "" : "s"}{" "}
          changed.
          <span className="text-ink-2">Show it anyway</span>
        </button>
      )}
    </section>
  );
}

/** Why a file starts folded, in a few words. */
const FOLD_WHY: Record<keyof typeof HIDE_LABEL, string> = {
  lockfile: "A lockfile",
  generated: "Generated code",
  snapshot: "A snapshot",
  rename: "A rename, nothing inside changed",
  "format-only": "Only formatting changed",
  "comment-only": "Only comments changed",
  empty: "Nothing changed inside",
};
