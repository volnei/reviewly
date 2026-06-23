import { Segmented } from "@/components/segmented";
import { Input } from "@/components/ui/input";
import { fileIcon } from "@/lib/file-icons";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

interface GrepHit {
  file: string;
  line: number;
  text: string;
}

/** Case-insensitive subsequence score; rewards consecutive + boundary hits. */
function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  let prev = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak = prev === ti - 1 ? streak + 1 : 1;
      let pts = 1 + streak;
      const before = t[ti - 1];
      if (ti === 0 || before === "/" || before === "." || before === "-" || before === "_")
        pts += 3;
      score += pts;
      prev = ti;
      qi++;
    }
  }
  if (qi < q.length) return null;
  return score - target.length * 0.01; // tie-break toward shorter paths
}

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** ⌘P quick-open scoped to one repo: fuzzy file jump + `git grep` content search. */
export function RepoQuickOpen({
  root,
  onClose,
  onOpen,
}: {
  root: string;
  onClose: () => void;
  onOpen: (absPath: string) => void;
}) {
  const [mode, setMode] = useState<"files" | "text">("files");
  const [query, setQuery] = useState("");
  const dq = useDeferredValue(query);
  const [active, setActive] = useState(0);

  const files = useQuery({
    queryKey: ["ls-files", root],
    queryFn: () => invoke<string[]>("git_ls_files", { path: root }),
    staleTime: 60_000,
  });
  const grep = useQuery({
    queryKey: ["git-grep", root, dq],
    queryFn: () => invoke<GrepHit[]>("git_grep", { path: root, query: dq, limit: 200 }),
    enabled: mode === "text" && dq.trim().length >= 2,
    staleTime: 30_000,
  });

  const fileResults = useMemo(() => {
    const all = files.data ?? [];
    const q = dq.trim();
    if (!q) return all.slice(0, 50);
    return all
      .map((f) => ({ f, s: fuzzyScore(q, f) }))
      .filter((x): x is { f: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.f);
  }, [files.data, dq]);

  const grepResults = grep.data ?? [];
  const count = mode === "files" ? fileResults.length : grepResults.length;

  // Reset the cursor whenever the result set changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dq/mode are trigger-only deps
  useEffect(() => {
    setActive(0);
  }, [dq, mode]);

  function choose(i: number) {
    if (mode === "files") {
      const f = fileResults[i];
      if (f) onOpen(`${root}/${f}`);
    } else {
      const h = grepResults[i];
      if (h) onOpen(`${root}/${h.file}`);
    }
  }

  function onKey(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-[34rem] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Quick open"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="flex items-center gap-2 border-b border-hairline p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "files" ? "Go to file…" : "Search in files…"}
            size="sm"
            spellCheck={false}
            className="flex-1"
          />
          <Segmented
            options={[
              { value: "files", label: "Files" },
              { value: "text", label: "In files" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "files" | "text")}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1">
          {mode === "files" ? (
            files.isLoading ? (
              <Empty>Loading files…</Empty>
            ) : fileResults.length === 0 ? (
              <Empty>No files match.</Empty>
            ) : (
              fileResults.map((f, i) => {
                const { Icon, className } = fileIcon(base(f));
                const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/") + 1) : "";
                return (
                  <button
                    key={f}
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(i)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs",
                      i === active ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
                    )}
                  >
                    <Icon className={cn("size-3.5 shrink-0", className)} />
                    <span className="truncate">
                      <span className="text-foreground">{base(f)}</span>
                      {dir && <span className="text-muted-foreground/55"> · {dir}</span>}
                    </span>
                  </button>
                );
              })
            )
          ) : dq.trim().length < 2 ? (
            <Empty>Type at least 2 characters to search file contents…</Empty>
          ) : grep.isLoading ? (
            <Empty>Searching…</Empty>
          ) : grepResults.length === 0 ? (
            <Empty>No matches.</Empty>
          ) : (
            grepResults.map((h, i) => (
              <button
                key={`${h.file}:${h.line}:${i}`}
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs",
                  i === active ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.04]",
                )}
              >
                <span className="shrink-0 font-mono text-muted-foreground/55">
                  {base(h.file)}:{h.line}
                </span>
                <span className="truncate font-mono text-foreground/80">{h.text.trim()}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-3 py-1.5 text-[10px] text-muted-foreground/55">
          <span>↑↓ navigate · esc close</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" /> open
          </span>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{children}</p>;
}
