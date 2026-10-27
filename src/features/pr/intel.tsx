import { IconButton } from "@/components/icon-button";
import { useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { Git } from "@/effect/services/Git";
import { age } from "@/features/list/row";
import type { Hunk } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { Effect } from "effect";
import { ExternalLink, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * What the clone knows that the diff doesn't: where a name is defined, and
 * who last touched a block. Only when Settings → Local points at the repo.
 */

const WORD = /[A-Za-z0-9_$]/;

/** The identifier under a point on the page, or null. */
function wordAt(x: number, y: number): string | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (!p) return null;
    node = p.offsetNode;
    offset = p.offset;
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (!r) return null;
    node = r.startContainer;
    offset = r.startOffset;
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  let a = offset;
  let b = offset;
  while (a > 0 && WORD.test(text[a - 1])) a--;
  while (b < text.length && WORD.test(text[b])) b++;
  const w = text.slice(a, b);
  return w.length >= 2 && !/^\d+$/.test(w) ? w : null;
}

const DEF = (w: string) =>
  new RegExp(
    `\\b(function|const|let|var|class|interface|type|enum|struct|fn|def|trait|impl|export)\\s+(async\\s+)?(function\\s+)?${w}\\b|\\b${w}\\s*[:=]\\s*(async\\s+)?(\\(|function\\b|\\{|=>)`,
  );

/** ⌥-click a name in the diff: where it is defined and used, from the clone. */
export function Definitions({
  clone,
  root,
  onOpenFile,
}: {
  clone: string | null;
  root: React.RefObject<HTMLDivElement>;
  onOpenFile: (file: string) => void;
}) {
  const [ask, setAsk] = useState<{ word: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !clone) return;
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return;
      const cell = (e.target as HTMLElement).closest("[data-line]");
      if (!cell) return;
      // The caret tells which word; a token span tells it when the caret can't.
      const t = (e.target as HTMLElement).textContent?.trim() ?? "";
      const word = wordAt(e.clientX, e.clientY) ?? (/^[A-Za-z_$][\w$]{1,}$/.test(t) ? t : null);
      if (!word) return;
      e.preventDefault();
      setAsk({ word, x: e.clientX, y: e.clientY });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [root, clone]);
  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setAsk(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [ask]);
  if (!ask || !clone) return null;
  return (
    <DefinitionCard
      clone={clone}
      word={ask.word}
      x={ask.x}
      y={ask.y}
      onClose={() => setAsk(null)}
      onOpenFile={onOpenFile}
    />
  );
}

function DefinitionCard({
  clone,
  word,
  x,
  y,
  onClose,
  onOpenFile,
}: {
  clone: string;
  word: string;
  x: number;
  y: number;
  onClose: () => void;
  onOpenFile: (file: string) => void;
}) {
  const hits = useEffectQuery(
    ["grep", clone, word],
    Effect.flatMap(Git, (g) => g.grep(clone, word, 60)),
    { staleTime: 60_000, retry: false },
  );
  const [picked, setPicked] = useState<S.GrepHit | null>(null);
  const ranked = (hits.data ?? [])
    .map((h) => ({ h, def: DEF(word).test(h.text) }))
    .sort((a, b) => Number(b.def) - Number(a.def))
    .slice(0, 10);
  const chosen = picked ?? ranked[0]?.h ?? null;
  const context = useEffectQuery(
    ["read", clone, chosen?.file ?? ""],
    Effect.flatMap(Git, (g) => g.readFile(`${clone}/${chosen?.file ?? ""}`)),
    { enabled: !!chosen, staleTime: 60_000, retry: false },
  );
  const lines = context.data?.split("\n") ?? [];
  const from = chosen ? Math.max(0, chosen.line - 4) : 0;
  const slice = chosen ? lines.slice(from, chosen.line + 8) : [];
  const left = Math.min(x + 8, window.innerWidth - 480);
  const top = Math.min(y + 8, window.innerHeight - 380);
  return (
    <div
      role="dialog"
      aria-label={`Where ${word} is defined`}
      className="fixed z-40 w-[460px] rounded-lg border border-edge bg-card shadow-[0_12px_32px_rgba(0,0,0,.45)]"
      style={{ left, top }}
    >
      <div className="flex h-8 items-center gap-2 border-b border-hair px-3 text-[12.5px]">
        <span className="mono text-ink">{word}</span>
        <span className="text-ink-3">in your clone</span>
        <span className="flex-1" />
        {chosen ? (
          <IconButton size={6} label="Open in editor" onClick={() => onOpenFile(chosen.file)}>
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        <IconButton size={6} label="Close (esc)" onClick={onClose}>
          <X className="size-3.5" strokeWidth={2} />
        </IconButton>
      </div>
      {hits.isPending ? (
        <p className="px-3 py-2 text-[12.5px] text-ink-3">Looking in the clone…</p>
      ) : ranked.length === 0 ? (
        <p className="px-3 py-2 text-[12.5px] text-ink-3">Nothing in the clone matches {word}.</p>
      ) : (
        <>
          <ul className="max-h-40 overflow-y-auto py-1 scrollbar-thin">
            {ranked.map(({ h, def }) => (
              <li key={`${h.file}:${h.line}`}>
                <button
                  type="button"
                  onClick={() => setPicked(h)}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-3 py-1 text-left text-[12px] hover:bg-raise",
                    chosen === h && "bg-raise",
                  )}
                >
                  <span className="mono truncate text-ink-2">{h.text.trim()}</span>
                  <span className="mono text-[11px] text-ink-3">
                    {def ? "def · " : ""}
                    {h.file.split("/").pop()}:{h.line}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {chosen ? (
            <pre className="mono max-h-56 overflow-auto border-t border-hair bg-sink px-3 py-2 text-[11.5px] leading-[18px] text-ink-2 scrollbar-thin">
              {slice.map((l, i) => {
                const n = from + i + 1;
                return (
                  <span key={n} className={cn("block", n === chosen.line && "text-ink")}>
                    <span className="tnum mr-3 inline-block w-8 text-right text-ink-3">{n}</span>
                    {l}
                  </span>
                );
              })}
            </pre>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Under a hunk header, on request: who last touched these lines, and in which commit. */
export function BlameLine({
  clone,
  file,
  hunk,
  rev,
  onCommit,
}: {
  clone: string;
  file: string;
  hunk: Hunk;
  rev: string | null;
  onCommit?: (number: number) => void;
}) {
  const [want, setWant] = useState(false);
  const olds = hunk.lines.filter((l) => l.oldLine != null).map((l) => l.oldLine as number);
  const start = olds.length ? Math.min(...olds) : hunk.oldStart;
  const end = olds.length ? Math.max(...olds) : hunk.oldStart;
  const q = useEffectQuery(
    ["blame", clone, file, start, end, rev ?? ""],
    Effect.flatMap(Git, (g) => g.blame(clone, file, start, end, rev)),
    { enabled: want, staleTime: 5 * 60_000, retry: false },
  );
  const pick = useCallback((rows: ReadonlyArray<S.BlameLine>) => {
    const by = new Map<string, { b: S.BlameLine; n: number }>();
    for (const b of rows) by.set(b.hash, { b, n: (by.get(b.hash)?.n ?? 0) + 1 });
    return [...by.values()].sort((a, b) => b.b.time - a.b.time);
  }, []);
  if (!want)
    return (
      <button
        type="button"
        onClick={() => setWant(true)}
        className="ml-auto font-sans text-[11px] text-ink-3 hover:text-ink"
      >
        who touched this
      </button>
    );
  if (q.isPending)
    return <span className="ml-auto font-sans text-[11px] text-ink-3">asking git…</span>;
  if (q.isError || !q.data?.length)
    return <span className="ml-auto font-sans text-[11px] text-ink-3">git didn’t say</span>;
  const top = pick(q.data)[0];
  const pr = top.b.summary.match(/\(#(\d+)\)\s*$/)?.[1];
  return (
    <span className="ml-auto truncate font-sans text-[11px] text-ink-3">
      {top.b.author} · <span className="mono">{top.b.short}</span> ·{" "}
      {pr && onCommit ? (
        <button
          type="button"
          onClick={() => onCommit(Number(pr))}
          className="text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
        >
          {top.b.summary}
        </button>
      ) : (
        top.b.summary
      )}{" "}
      · {age(new Date(top.b.time * 1000).toISOString())} ago
    </span>
  );
}
