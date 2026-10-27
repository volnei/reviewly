import { useKeyScope } from "@/app/keys";
import { StatePanel } from "@/components/state-panel";
import { Button } from "@/components/ui/button";
import type { Ranked } from "@/effect/services/Triage";
import { prefetchPull } from "@/features/pr/model";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Row } from "./row";
import type { SnoozeWhen } from "./snooze";
import { type Block, blocksOf } from "./stack-model";

export interface Section {
  readonly key: string;
  readonly items: ReadonlyArray<Ranked>;
  /** Text above the section, when it is a tail: "Couldn’t rank these". */
  readonly head?: ReactNode;
  /** Folded by default, with this summary: "Later 7 · 3 waiting on others…". */
  readonly folded?: ReactNode;
  /** False when the section already is one stack: rows stay as given, no block head. */
  readonly cluster?: boolean;
  /** The section is one verdict: its head says it, the rows need not. */
  readonly hideVerdict?: boolean;
}

const flatten = (blocks: ReadonlyArray<Block>): Ranked[] =>
  blocks.flatMap((b) => (b.kind === "one" ? [b.item] : b.items));

/** The row each list had selected, by its name, so coming back lands on it. */
const remembered = new Map<string, string>();
const MAX_REMEMBERED_LISTS = 50;
export const rememberSelection = (list: string, id: string) => {
  remembered.delete(list);
  remembered.set(list, id);
  while (remembered.size > MAX_REMEMBERED_LISTS) {
    const oldest = remembered.keys().next().value;
    if (oldest == null) break;
    remembered.delete(oldest);
  }
};

export interface ListActions {
  readonly open: (item: Ranked) => void;
  readonly done?: (item: Ranked) => void;
  readonly snooze?: (item: Ranked) => void;
  /** The snooze menu's other choices. */
  readonly snoozeFor?: (item: Ranked, when: SnoozeWhen) => void;
  readonly unsnooze?: (item: Ranked) => void;
  /** `c`: check the pull request out in its clone. */
  readonly checkout?: (item: Ranked) => void;
  readonly peek?: (item: Ranked) => void;
}

/**
 * The working list: full width, one row per item, `j`/`k` to move, `↵` to
 * open, `e` done, `s` snooze. Sections are the Inbox's own: your turn, the
 * unranked tail, and "Later" folded.
 */
export function List({
  label,
  sections,
  actions,
  empty,
  renderPeek,
  openInline = false,
  pageSize = 0,
}: {
  label: string;
  sections: ReadonlyArray<Section>;
  actions: ListActions;
  empty?: ReactNode;
  /** `space`: a card under the row with more than the row can say. Follows the selection. */
  renderPeek?: (item: Ranked) => ReactNode;
  /** Clicking or pressing Enter reveals `renderPeek`; the external URL stays behind `o` and the row menu. */
  openInline?: boolean;
  /** Render large archives in bounded chunks instead of blocking the WebView. */
  pageSize?: number;
}) {
  const [openFolds, setOpenFolds] = useState<Record<string, boolean>>({});
  const [peekId, setPeekId] = useState<string | null>(null);
  const [renderLimit, setRenderLimit] = useState(pageSize || Number.POSITIVE_INFINITY);
  const blocks = useMemo(
    () =>
      sections.map((s) =>
        s.cluster === false
          ? s.items.map((item): Block => ({ kind: "one", item }))
          : blocksOf(s.items),
      ),
    [sections],
  );
  const pagedBlocks = useMemo(() => {
    if (!pageSize) return blocks;
    let remaining = renderLimit;
    return blocks.map((section) => {
      const shown = section.slice(0, Math.max(0, remaining));
      remaining -= shown.length;
      return shown;
    });
  }, [blocks, pageSize, renderLimit]);
  const blockCount = blocks.reduce((total, section) => total + section.length, 0);
  const shownBlockCount = pagedBlocks.reduce((total, section) => total + section.length, 0);
  const visible = useMemo(
    () =>
      sections.flatMap((s, i) => (s.folded && !openFolds[s.key] ? [] : flatten(pagedBlocks[i]))),
    [sections, pagedBlocks, openFolds],
  );
  const [selectedId, setSelectedId] = useState<string | null>(() => remembered.get(label) ?? null);
  useEffect(() => {
    if (selectedId) rememberSelection(label, selectedId);
  }, [label, selectedId]);
  const index = Math.max(
    0,
    visible.findIndex((i) => i.id === selectedId),
  );
  const selected = visible[index] ?? null;

  useEffect(() => {
    if (!selectedId && visible[0]) setSelectedId(visible[0].id);
  }, [selectedId, visible]);

  useEffect(() => {
    if (!selected) return;
    document
      .querySelector(`[data-id="${CSS.escape(selected.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  // The selected pull request's detail and files come in behind the cursor, so ↵ opens a page that is already there.
  const qc = useQueryClient();
  useEffect(() => {
    if (!selected?.owner || !selected.repoName || !selected.number) return;
    if (selected.kind !== "pr" && selected.kind !== "mention") return;
    const ref = { owner: selected.owner, repo: selected.repoName, number: selected.number };
    const t = setTimeout(() => void prefetchPull(qc, ref).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [selected, qc]);

  const move = useCallback(
    (d: number) => {
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + d))];
      if (next) {
        setSelectedId(next.id);
        setPeekId((p) => (p ? next.id : p));
      }
    },
    [visible, index],
  );
  const jump = useCallback(
    (to: number) => {
      const next = visible[Math.min(visible.length - 1, Math.max(0, to))];
      if (next) setSelectedId(next.id);
    },
    [visible],
  );
  const activate = useCallback(
    (item: Ranked) => {
      setSelectedId(item.id);
      if (openInline && renderPeek) {
        setPeekId((p) => (p === item.id ? null : item.id));
        return;
      }
      actions.open(item);
    },
    [actions, openInline, renderPeek],
  );

  useKeyScope(
    "list",
    useCallback(
      (e: KeyboardEvent) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        switch (e.key) {
          case "j":
          case "ArrowDown":
            move(1);
            return true;
          case "k":
          case "ArrowUp":
            move(-1);
            return true;
          case "Home":
            jump(0);
            return true;
          case "End":
            jump(visible.length - 1);
            return true;
          case "PageDown":
            move(12);
            return true;
          case "PageUp":
            move(-12);
            return true;
          case "o":
            if (selected?.url) safeOpenUrl(selected.url);
            return !!selected?.url;
          case "c":
            if (selected && actions.checkout) actions.checkout(selected);
            return !!actions.checkout;
          case "Enter":
            if (selected) activate(selected);
            return true;
          case " ":
            if (selected && renderPeek) {
              setPeekId((p) => (p === selected.id ? null : selected.id));
              return true;
            }
            if (selected && actions.peek) actions.peek(selected);
            return !!actions.peek;
          case "Escape":
            if (peekId) {
              setPeekId(null);
              return true;
            }
            return false;
          case "e":
            if (selected && actions.done) actions.done(selected);
            return !!actions.done;
          case "s":
            if (selected && actions.snooze) actions.snooze(selected);
            return !!actions.snooze;
        }
        return false;
      },
      [move, jump, visible.length, selected, actions, renderPeek, peekId, activate],
    ),
  );

  const total = sections.reduce((n, s) => n + s.items.length, 0);
  if (total === 0) return <>{empty}</>;

  const row = (it: Ranked, hideVerdict?: boolean, inStack = false, stackGapBefore = false) => (
    <Fragment key={it.id}>
      <Row
        item={it}
        selected={it.id === selected?.id}
        hideVerdict={hideVerdict}
        inStack={inStack}
        stackGapBefore={stackGapBefore}
        onSelect={() => setSelectedId(it.id)}
        onOpen={() => activate(it)}
        onDone={actions.done ? () => actions.done?.(it) : undefined}
        onSnooze={actions.snooze ? () => actions.snooze?.(it) : undefined}
        onSnoozeFor={actions.snoozeFor ? (w) => actions.snoozeFor?.(it, w) : undefined}
        onUnsnooze={actions.unsnooze ? () => actions.unsnooze?.(it) : undefined}
      />
      {renderPeek && peekId === it.id
        ? (() => {
            const node = renderPeek(it);
            return node ? <div className="pr-list-peek">{node}</div> : null;
          })()
        : null}
    </Fragment>
  );
  const block = (b: Block, hideVerdict?: boolean) => {
    if (b.kind === "one") return row(b.item, hideVerdict);
    const first = b.items[0];
    return (
      <div
        key={b.key}
        role="group"
        aria-label={`Stack ${first.stack?.number} in ${first.repo}, based on ${b.base}`}
        className="pr-stack-group"
      >
        <div className="pr-stack-members">
          {b.items.map((it, index) =>
            row(
              it,
              hideVerdict,
              true,
              index > 0 &&
                (it.stack?.position ?? 0) !== (b.items[index - 1].stack?.position ?? 0) + 1,
            ),
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-activedescendant={selected?.id}
      tabIndex={0}
      className="outline-none"
    >
      {sections.map((s, si) => {
        if (s.items.length === 0) return null;
        if (s.folded) {
          const open = !!openFolds[s.key];
          return (
            <div key={s.key} className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-expanded={open}
                onClick={() => setOpenFolds((f) => ({ ...f, [s.key]: !open }))}
                className="flex h-10 w-full min-w-0 items-center gap-2 overflow-hidden px-5 text-left text-[12.5px] text-ink-2 hover:bg-raise/50"
              >
                <ChevronRight
                  className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-90")}
                  strokeWidth={2}
                />
                <span className="min-w-0 flex-1 truncate">{s.folded}</span>
              </Button>
              {open ? pagedBlocks[si].map((b) => block(b, s.hideVerdict)) : null}
            </div>
          );
        }
        return (
          <div key={s.key}>
            {s.head ? <div className="px-5 pt-5 pb-2">{s.head}</div> : null}
            {pagedBlocks[si].map((b) => block(b, s.hideVerdict))}
          </div>
        );
      })}
      {pageSize && shownBlockCount < blockCount ? (
        <div className="flex justify-center px-5 py-4">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => setRenderLimit((limit) => limit + pageSize)}
            className="text-[12px] text-ink-2"
          >
            Show {Math.min(pageSize, blockCount - shownBlockCount)} more
            <span className="tnum text-ink-3">· {blockCount - shownBlockCount} remaining</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The screen's first line: a name and one sentence about what the list is. */
export function ListHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="list-head flex items-baseline gap-3 px-5 pt-6 pb-4">
      <h1 className="text-[20px] font-medium tracking-[-0.025em] text-ink">{title}</h1>
      {children ? <p className="text-[12.5px] text-ink-3">{children}</p> : null}
    </div>
  );
}

export function Nothing({
  children,
  detail,
  kind = "empty",
  action,
}: {
  children: ReactNode;
  detail?: ReactNode;
  kind?: "empty" | "error";
  action?: ReactNode;
}) {
  return <StatePanel kind={kind} title={children} description={detail} action={action} />;
}
