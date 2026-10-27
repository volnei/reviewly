import {
  type DiffLine,
  type Hunk,
  gapsOf,
  hideWhitespaceOnly,
  parsePatch,
  toSplit,
} from "@/lib/diff";
import { type Range, intraPairs, markRanges } from "@/lib/intra";
import { detectLanguage, highlightLine } from "@/lib/lang";
import { cn } from "@/lib/utils";
import { UnfoldVertical } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";

/**
 * One file's patch: unified or split, numbered, highlighted, with a slot under
 * any line for its threads and drafts. The gutter is a well (`--sink`); added
 * and deleted lines carry the only green and red on the page. The unchanged
 * stretches a patch leaves out unfold in place from the file at the head.
 *
 * A comment is one line, or a range: press the `+` and drag down (or up) to
 * the last line, or ⇧-click another `+` while a composer is open.
 */
export type Side = "L" | "R";

interface LineRange {
  readonly side: Side;
  readonly start: number;
  readonly end: number;
}

interface CommentOpts {
  /** The first line of a range; the clicked line is the last. */
  readonly start?: number;
  /** ⇧-click: stretch the open composer to this line. */
  readonly extend?: boolean;
}

export interface DiffProps {
  readonly filename: string;
  readonly patch: string | null;
  readonly split: boolean;
  /** Something to draw under a line: "R12" (right/new) or "L8" (left/old). */
  readonly under: (side: Side, line: number) => ReactNode;
  /** The user wants to say something about this line, or about a range ending here. */
  readonly onComment?: (side: Side, line: number, opts?: CommentOpts) => void;
  /** Makes line ids unique across files: the file's anchor. */
  readonly idPrefix: string;
  readonly wrap?: boolean;
  readonly hideWhitespace?: boolean;
  /** The lines a composer is open for: lit while you write. */
  readonly selection?: LineRange | null;
  /** The whole file at the head commit once asked for: undefined while loading, null when it can't be had. */
  readonly fullText?: string | null;
  readonly onNeedFullText?: () => void;
  /** Something beside a hunk header: who touched it, from the clone. */
  readonly aside?: (hunk: Hunk) => ReactNode;
}

const lineKey = (side: Side, n: number) => `${side}${n}`;
/** The DOM id of one diff line, unique across files. */
export const lineId = (prefix: string, side: Side, n: number) => `${prefix}-${lineKey(side, n)}`;

/** What every row needs to take part in a selection. */
interface Pick {
  readonly sel: (side: Side, n: number) => boolean;
  /** Press on a `+` or a line number: the start of a range, or ⇧ to stretch an open one. */
  readonly begin: (e: React.MouseEvent, side: Side, n: number) => void;
  readonly tap: (e: React.MouseEvent, side: Side, n: number) => void;
}

type HunkProps = {
  hunk: Hunk;
  lang: string;
  codeCls: string;
  pick: Pick;
  /** The changed stretches inside paired lines, to light. */
  intra: ReadonlyMap<DiffLine, ReadonlyArray<Range>>;
  aside?: (hunk: Hunk) => ReactNode;
} & Pick2<DiffProps, "under" | "onComment" | "idPrefix">;
type Pick2<T, K extends keyof T> = { [P in K]: T[P] };

export function Diff({
  filename,
  patch,
  split,
  under,
  onComment,
  idPrefix,
  wrap = true,
  hideWhitespace = false,
  selection,
  fullText,
  onNeedFullText,
  aside,
}: DiffProps) {
  // No patch, but the file at the head: shown whole, every line a context line you can comment on.
  const [wantWhole, setWantWhole] = useState(false);
  const wholeFile = useMemo<Hunk | null>(() => {
    if (patch || !fullText) return null;
    const lines = fullText.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return {
      header: `@@ -1,${lines.length} +1,${lines.length} @@`,
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "hunk", oldLine: null, newLine: null, text: "the whole file" },
        ...lines.map((text, i) => ({
          kind: "context" as const,
          oldLine: i + 1,
          newLine: i + 1,
          text,
        })),
      ],
    };
  }, [patch, fullText]);
  const hunks = useMemo(() => {
    if (wholeFile) return [wholeFile];
    const h = parsePatch(patch);
    return hideWhitespace ? hideWhitespaceOnly(h) : h;
  }, [patch, hideWhitespace, wholeFile]);
  const gaps = useMemo(() => gapsOf(hunks), [hunks]);
  const intra = useMemo(() => intraPairs(hunks), [hunks]);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
  const lang = useMemo(() => detectLanguage(filename), [filename]);

  // Press a `+` or a line number, drag to the last line, let go: one composer
  // for the range. The window follows the pointer, so it doesn't matter which
  // cell it crosses, or whether it strays off the table for a moment.
  const [drag, setDrag] = useState<{ side: Side; from: number; to: number } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-line]");
      if (!el) return;
      const n = Number(el.dataset.line);
      if (el.dataset.side !== drag.side || !n) return;
      setDrag((d) => (d && d.to !== n ? { ...d, to: n } : d));
    };
    const up = () => {
      const start = Math.min(drag.from, drag.to);
      const end = Math.max(drag.from, drag.to);
      setDrag(null);
      onComment?.(drag.side, end, start !== end ? { start } : undefined);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [drag, onComment]);
  const pick = useMemo<Pick>(
    () => ({
      sel: (side, n) =>
        (drag != null &&
          drag.side === side &&
          n >= Math.min(drag.from, drag.to) &&
          n <= Math.max(drag.from, drag.to)) ||
        (selection != null &&
          selection.side === side &&
          n >= selection.start &&
          n <= selection.end),
      begin: (e, side, n) => {
        if (e.button !== 0 || !onComment) return;
        e.preventDefault();
        if (e.shiftKey) {
          onComment(side, n, { extend: true });
          return;
        }
        setDrag({ side, from: n, to: n });
      },
      // The keyboard presses the button; the mouse was handled on the way down.
      tap: (e, side, n) => {
        if (e.detail === 0) onComment?.(side, n);
      },
    }),
    [drag, selection, onComment],
  );

  if (!patch && !(fullText && wholeFile))
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-[12.5px] text-ink-3">
        No text diff for this file: binary, renamed, or too large for GitHub to show.
        {onNeedFullText ? (
          <button
            type="button"
            disabled={fullText === null || wantWhole}
            onClick={() => {
              setWantWhole(true);
              onNeedFullText();
            }}
            className="h-6 rounded-md border border-edge px-2 text-ink-2 hover:bg-raise hover:text-ink disabled:opacity-50"
          >
            {fullText === null
              ? "It isn’t readable at this commit"
              : wantWhole
                ? "Loading the file…"
                : "Show the whole file"}
          </button>
        ) : null}
      </p>
    );
  if (hunks.length === 0)
    return <p className="px-4 py-3 text-[12.5px] text-ink-3">Only whitespace changed.</p>;

  const cols = split ? 4 : 3;
  const codeCls = wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre";
  const fileLines = fullText == null ? null : fullText.split("\n");
  const expand = (i: number) => {
    setExpanded((s) => new Set([...s, i]));
    if (fileLines == null) onNeedFullText?.();
  };
  const gapRow = (i: number) => {
    const g = gaps[i];
    const size = g.toNew == null ? null : g.toNew - g.fromNew + 1;
    if (size != null && size <= 0) return null;
    if (!expanded.has(i))
      return <GapRow key={`g${i}`} cols={cols} size={size} onExpand={() => expand(i)} />;
    if (!fileLines)
      return (
        <tr key={`g${i}`} className="bg-sink">
          <td colSpan={cols} className="px-3 py-0.5 text-[11.5px] text-ink-3">
            {fullText === null ? "The file isn’t available at this commit." : "Loading the file…"}
          </td>
        </tr>
      );
    const to = g.toNew ?? fileLines.length;
    const rows: ContextRow[] = [];
    for (let n = g.fromNew; n <= to; n++) {
      const text = fileLines[n - 1];
      if (text === undefined) break;
      rows.push({ oldLine: g.fromOld + (n - g.fromNew), newLine: n, text });
    }
    if (rows.length === 0) return null;
    return (
      <ContextRows
        key={`g${i}`}
        rows={rows}
        split={split}
        lang={lang}
        idPrefix={idPrefix}
        under={under}
        codeCls={codeCls}
        pick={pick}
      />
    );
  };

  return (
    <div className={cn(!wrap && "overflow-x-auto scrollbar-thin")}>
      <table
        className={cn(
          "w-full border-collapse font-mono text-[12px] leading-[20px]",
          drag ? "select-none" : "selectable",
        )}
        translate="no"
      >
        <tbody>
          {hunks.map((h, i) => (
            <Fragment key={`${h.header}-${i}`}>
              {gapRow(i)}
              {split ? (
                <SplitHunk
                  hunk={h}
                  lang={lang}
                  under={under}
                  onComment={onComment}
                  idPrefix={idPrefix}
                  codeCls={codeCls}
                  pick={pick}
                  intra={intra}
                  aside={aside}
                />
              ) : (
                <UnifiedHunk
                  hunk={h}
                  lang={lang}
                  under={under}
                  onComment={onComment}
                  idPrefix={idPrefix}
                  codeCls={codeCls}
                  pick={pick}
                  intra={intra}
                  aside={aside}
                />
              )}
            </Fragment>
          ))}
          {gapRow(hunks.length)}
        </tbody>
      </table>
    </div>
  );
}

function Code({
  text,
  lang,
  ranges,
}: { text: string; lang: string; ranges?: ReadonlyArray<Range> }) {
  const html = ranges?.length
    ? markRanges(highlightLine(text, lang), ranges)
    : highlightLine(text, lang);
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Prism output of our own escaping, marks inserted between tags only
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

const rowCls = (kind: DiffLine["kind"]) =>
  kind === "add"
    ? "bg-add/10"
    : kind === "del"
      ? "bg-del/10"
      : kind === "hunk"
        ? "bg-sink text-ink-3"
        : "";
const gutterCls =
  "tnum w-[46px] select-none bg-sink pr-2 text-right align-top text-[11px] text-ink-3";

/** In unified view a row shows two numbers but is one line to comment on: the label is one, the anchor the other. */
function GutterLabel({
  label,
  side,
  n,
  pick,
  enabled = true,
}: { label: number | null; side: Side; n: number | null; pick: Pick; enabled?: boolean }) {
  return (
    <td
      className={cn(gutterCls, enabled && n != null && "cursor-row-resize hover:text-ink")}
      title={enabled && n != null ? "Press and drag to comment on a range" : undefined}
      onMouseDown={enabled && n != null ? (e) => pick.begin(e, side, n) : undefined}
    >
      {label ?? ""}
    </td>
  );
}

/** A line number: press and drag down (or up) to comment on a range. */
function Gutter({
  side,
  n,
  pick,
  enabled,
  selected,
}: { side: Side; n: number | null; pick: Pick; enabled: boolean; selected?: boolean }) {
  return (
    <td
      className={cn(gutterCls, enabled && n != null && "cursor-row-resize hover:text-ink")}
      data-line={n ?? undefined}
      data-side={n != null ? side : undefined}
      data-sel={selected || undefined}
      title={enabled && n != null ? "Press and drag to comment on a range" : undefined}
      onMouseDown={enabled && n != null ? (e) => pick.begin(e, side, n) : undefined}
    >
      {n ?? ""}
    </td>
  );
}

function HunkHeader({ text, cols, aside }: { text: string; cols: number; aside?: ReactNode }) {
  return (
    <tr className="bg-sink" data-hunk>
      <td colSpan={cols} className="px-3 py-0.5 text-[11.5px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="truncate">
            {text.replace(/^@@.*?@@ ?/, "")}
            <span className="ml-2 text-ink-3/70">{text.match(/@@.*?@@/)?.[0]}</span>
          </span>
          {aside}
        </span>
      </td>
    </tr>
  );
}

/** The fold between hunks: how much is hidden, one click to see it. */
function GapRow({
  cols,
  size,
  onExpand,
}: { cols: number; size: number | null; onExpand: () => void }) {
  return (
    <tr className="bg-sink">
      <td colSpan={cols} className="px-3 py-0 font-sans text-[11.5px]">
        <button
          type="button"
          onClick={onExpand}
          className="flex h-6 items-center gap-2 text-ink-3 hover:text-ink"
        >
          <UnfoldVertical className="size-3.5" strokeWidth={1.75} />
          {size == null
            ? "Expand to the end of the file"
            : `Expand ${size} unchanged line${size === 1 ? "" : "s"}`}
        </button>
      </td>
    </tr>
  );
}

/** The `+` on a line: press and drag for a range, ⇧-click to stretch an open composer. */
function Plus({
  side,
  n,
  pick,
  enabled,
}: { side: Side; n: number | null; pick: Pick; enabled: boolean }) {
  if (!enabled || n == null) return null;
  return (
    <button
      type="button"
      aria-label="Comment on this line (drag for a range)"
      onMouseDown={(e) => pick.begin(e, side, n)}
      onClick={(e) => pick.tap(e, side, n)}
      className="invisible mx-1 grid size-4 cursor-row-resize place-items-center rounded-[3px] border border-edge bg-raise text-[12px] leading-none text-ink-2 hover:bg-ink hover:text-[#141414] group-hover:visible"
    >
      +
    </button>
  );
}

interface ContextRow {
  oldLine: number;
  newLine: number;
  text: string;
}

/** Unchanged lines unfolded from the file: numbered on both sides; a comment can land here too. */
function ContextRows({
  rows,
  split,
  lang,
  idPrefix,
  under,
  codeCls,
  pick,
}: {
  rows: ReadonlyArray<ContextRow>;
  split: boolean;
  lang: string;
  idPrefix: string;
  under: DiffProps["under"];
  codeCls: string;
  pick: Pick;
}) {
  return (
    <>
      {rows.map((r) =>
        split ? (
          <RowGroup key={r.newLine} below={under("R", r.newLine)} cols={4}>
            <tr className="group" data-context>
              <Gutter
                side="L"
                n={r.oldLine}
                pick={pick}
                enabled
                selected={pick.sel("L", r.oldLine)}
              />
              <td
                className={cn("w-1/2 border-r border-hair pr-3 pl-6 align-top", codeCls)}
                id={lineId(idPrefix, "L", r.oldLine)}
                data-line={r.oldLine}
                data-side="L"
                data-sel={pick.sel("L", r.oldLine) || undefined}
              >
                <Code text={r.text} lang={lang} />
              </td>
              <Gutter
                side="R"
                n={r.newLine}
                pick={pick}
                enabled
                selected={pick.sel("R", r.newLine)}
              />
              <td
                className={cn("w-1/2 pr-3 pl-1 align-top", codeCls)}
                id={lineId(idPrefix, "R", r.newLine)}
                data-line={r.newLine}
                data-side="R"
                data-sel={pick.sel("R", r.newLine) || undefined}
              >
                <span className="inline-flex w-5 items-center">
                  <Plus side="R" n={r.newLine} pick={pick} enabled />
                </span>
                <Code text={r.text} lang={lang} />
              </td>
            </tr>
          </RowGroup>
        ) : (
          <RowGroup key={r.newLine} below={under("R", r.newLine)} cols={3}>
            <tr
              className="group"
              id={lineId(idPrefix, "R", r.newLine)}
              data-context
              data-line={r.newLine}
              data-side="R"
              data-sel={pick.sel("R", r.newLine) || undefined}
            >
              <GutterLabel label={r.oldLine} side="R" n={r.newLine} pick={pick} />
              <Gutter side="R" n={r.newLine} pick={pick} enabled />
              <td className={cn("pr-4 pl-1 align-top", codeCls)}>
                <span className="inline-flex w-5 items-center">
                  <Plus side="R" n={r.newLine} pick={pick} enabled />
                </span>
                <span className="mr-2 inline-block w-2 text-ink-3"> </span>
                <Code text={r.text} lang={lang} />
              </td>
            </tr>
          </RowGroup>
        ),
      )}
    </>
  );
}

function UnifiedHunk({
  hunk,
  lang,
  under,
  onComment,
  idPrefix,
  codeCls,
  pick,
  intra,
  aside,
}: HunkProps) {
  return (
    <>
      {hunk.lines.map((l, i) => {
        if (l.kind === "hunk")
          return <HunkHeader key={`h${i}`} text={l.text} cols={3} aside={aside?.(hunk)} />;
        const side: Side = l.kind === "del" ? "L" : "R";
        const n = side === "L" ? l.oldLine : l.newLine;
        const below = n != null ? under(side, n) : null;
        return (
          <RowGroup key={`${i}`} below={below} cols={3}>
            <tr
              className={cn("group", rowCls(l.kind))}
              id={n != null ? lineId(idPrefix, side, n) : undefined}
              data-kind={l.kind}
              data-line={n ?? undefined}
              data-side={n != null ? side : undefined}
              data-sel={(n != null && pick.sel(side, n)) || undefined}
            >
              <GutterLabel label={l.oldLine} side={side} n={n} pick={pick} enabled={!!onComment} />
              <GutterLabel label={l.newLine} side={side} n={n} pick={pick} enabled={!!onComment} />
              <td className={cn("pr-4 pl-1 align-top", codeCls)}>
                <span className="inline-flex w-5 items-center">
                  <Plus side={side} n={n} pick={pick} enabled={!!onComment} />
                </span>
                <span
                  className={cn(
                    "mr-2 inline-block w-2 text-ink-3",
                    l.kind === "add" && "text-add",
                    l.kind === "del" && "text-del",
                  )}
                >
                  {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
                </span>
                <Code text={l.text} lang={lang} ranges={intra.get(l)} />
              </td>
            </tr>
          </RowGroup>
        );
      })}
    </>
  );
}

function SplitHunk({
  hunk,
  lang,
  under,
  onComment,
  idPrefix,
  codeCls,
  pick,
  intra,
  aside,
}: HunkProps) {
  const rows = useMemo(() => toSplit(hunk), [hunk]);
  const cell = (side: Side, n: number | null, l: DiffLine | null) => {
    const on = n != null && pick.sel(side, n);
    return (
      <>
        <Gutter side={side} n={n} pick={pick} enabled={!!onComment} selected={on} />
        <td
          className={cn(
            "w-1/2 pr-3 pl-1 align-top",
            side === "L" && "border-r border-hair",
            codeCls,
            l ? rowCls(l.kind) : "",
          )}
          id={n != null ? lineId(idPrefix, side, n) : undefined}
          data-kind={l?.kind}
          data-line={n ?? undefined}
          data-side={n != null ? side : undefined}
          data-sel={on || undefined}
        >
          {l ? (
            <>
              <span className="inline-flex w-5 items-center">
                <Plus side={side} n={n} pick={pick} enabled={!!onComment} />
              </span>
              <Code text={l.text} lang={lang} ranges={intra.get(l)} />
            </>
          ) : null}
        </td>
      </>
    );
  };
  return (
    <>
      <HunkHeader text={hunk.header} cols={4} aside={aside?.(hunk)} />
      {rows.map((r, i) => {
        if (r.left?.kind === "hunk") return null;
        const left = r.left,
          right = r.right;
        const belowL = left?.oldLine != null ? under("L", left.oldLine) : null;
        const belowR = right?.newLine != null ? under("R", right.newLine) : null;
        return (
          <RowGroup
            key={i}
            below={
              belowL || belowR ? (
                <>
                  {belowL}
                  {belowR}
                </>
              ) : null
            }
            cols={4}
          >
            <tr className="group">
              {cell("L", left?.oldLine ?? null, left)}
              {cell("R", right?.newLine ?? null, right)}
            </tr>
          </RowGroup>
        );
      })}
    </>
  );
}

function RowGroup({
  children,
  below,
  cols,
}: { children: ReactNode; below: ReactNode; cols: number }) {
  if (!below) return <>{children}</>;
  return (
    <>
      {children}
      <tr>
        <td colSpan={cols} className="bg-page px-3 py-2 font-sans">
          {below}
        </td>
      </tr>
    </>
  );
}
