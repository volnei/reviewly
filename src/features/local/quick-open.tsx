import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { Chips } from "@/features/list/filters";
import { fileIcon } from "@/lib/file-icons";
import { cn } from "@/lib/utils";
import { Effect } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";

/** A subsequence match, scored: consecutive hits and hits after a separator count more; shorter paths win ties. */
function fuzzyScore(query: string, path: string): number {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < p.length && qi < q.length; i++) {
    if (p[i] === q[qi]) {
      const boundary = i === 0 || "/._-".includes(p[i - 1]);
      score += 10 + streak * 4 + (boundary ? 8 : 0);
      streak++;
      qi++;
    } else streak = 0;
  }
  if (qi < q.length) return -1;
  return score - p.length / 50;
}

type Mode = "files" | "text";

/**
 * ⌘P in a clone: a file by a few letters of its path, or a line by the words
 * in it. ↑↓ move, ↵ opens, esc closes.
 */
export function QuickOpen({
  repo,
  open,
  onOpenChange,
  onPick,
}: {
  repo: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (file: string, line?: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("files");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const files = useEffectQuery(
    ["local-repo", repo, "ls-files"],
    Effect.flatMap(Git, (g) => g.lsFiles(repo)),
    { enabled: open, staleTime: 60_000 },
  );
  const [needle, setNeedle] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setNeedle(q.trim()), 120);
    return () => clearTimeout(t);
  }, [q]);
  const hits = useEffectQuery(
    ["local-repo", repo, "grep", needle],
    Effect.flatMap(Git, (g) => g.grep(repo, needle, 200)),
    { enabled: open && mode === "text" && needle.length >= 2, staleTime: 30_000, retry: false },
  );
  const matches = useMemo(() => {
    if (mode !== "files") return [];
    const all = files.data ?? [];
    const query = q.trim();
    if (!query) return all.slice(0, 50).map((path) => ({ path, score: 0 }));
    return all
      .map((path) => ({ path, score: fuzzyScore(query, path) }))
      .filter((m) => m.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);
  }, [files.data, q, mode]);
  const rows: Array<{ key: string; file: string; line?: number; text?: string }> =
    mode === "files"
      ? matches.map((m) => ({ key: m.path, file: m.path }))
      : (hits.data ?? []).map((h) => ({
          key: `${h.file}:${h.line}`,
          file: h.file,
          line: h.line,
          text: h.text,
        }));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the cursor starts over with the list
  useEffect(() => setCursor(0), [q, mode]);
  useEffect(() => {
    if (open) {
      setQ("");
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);
  const pick = (i: number) => {
    const r = rows[i];
    if (!r) return;
    onOpenChange(false);
    onPick(r.file, r.line);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[640px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">Open a file</DialogTitle>
          <DialogDescription className="text-[12.5px] text-ink-3">
            {repo.split("/").pop()} · a few letters of the path, or words inside the files.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-2 px-6 pb-5">
          <div className="flex items-center gap-2">
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === "files" ? "src/pay/int…" : "words in the files"}
              className="selectable h-8 min-w-0 flex-1 rounded-md border border-input bg-sink px-2.5 font-sans text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(rows.length - 1, c + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pick(cursor);
                } else if (e.key === "Tab") {
                  e.preventDefault();
                  setMode((m) => (m === "files" ? "text" : "files"));
                }
              }}
            />
            <Chips
              label="Where"
              value={mode}
              onChange={setMode}
              options={[
                ["files", "Files"],
                ["text", "In files"],
              ]}
            />
          </div>
          <ul className="max-h-[360px] overflow-y-auto scrollbar-thin" aria-label="Matches">
            {rows.map((r, i) => {
              const { Icon } = fileIcon(r.file.split("/").pop() ?? r.file);
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    onMouseEnter={() => setCursor(i)}
                    aria-current={i === cursor ? "true" : undefined}
                    className={cn(
                      "grid h-8 w-full grid-cols-[16px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-left text-[12.5px]",
                      i === cursor ? "bg-raise text-ink" : "text-ink-2 hover:bg-raise/50",
                    )}
                  >
                    <Icon className="size-3.5 text-ink-3" strokeWidth={1.75} />
                    <span className="mono flex min-w-0 items-baseline gap-2">
                      <span className="truncate">
                        {r.file.split("/").pop()}
                        {r.line != null ? `:${r.line}` : ""}
                      </span>
                      <span className="truncate text-[11.5px] text-ink-3">
                        {r.text?.trim() ?? r.file.split("/").slice(0, -1).join("/")}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-[11.5px] text-ink-3">
            {mode === "files"
              ? files.isPending
                ? "Listing the files…"
                : rows.length
                  ? ""
                  : "No file matches."
              : needle.length < 2
                ? "Two letters, at least."
                : hits.isPending
                  ? "Searching…"
                  : rows.length
                    ? ""
                    : "Nothing contains that."}
            {rows.length ? (
              <>
                <kbd>↑↓</kbd> move · <kbd>↵</kbd> open · <kbd>tab</kbd> files or words
              </>
            ) : null}
          </p>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
