import { ResizeHandle } from "@/components/resize-handle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import type * as S from "@/effect/schema";
import { type HideReason, classify } from "@/lib/focus";
import type { PullFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { ChevronRight, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { FileRow } from "./file-row";
import { type Guided, StepsList } from "./guided";
import { type Layers, LayersColumn } from "./layers";

export type FilesOrder = "path" | "layer" | "guided";

interface Group {
  folder: string;
  files: S.PullFile[];
  /** The folded tail: lockfiles, generated code, format-only changes. Dimmer, last. */
  quiet?: boolean;
}

/** Folders you closed, per column, for the visit. */
const closedFolders = new Map<string, Set<string>>();

/**
 * The 256px column on the left of a PR: every file, grouped by its folder,
 * with a read mark, its churn and how many threads sit in it. Click scrolls
 * the read pane; `j`/`k` do the same from the keyboard. By layer it shows the
 * slices of the plan; in Guided order the model's stops.
 */
export function FilesColumn({
  files,
  threadsByPath,
  draftsByPath,
  viewed,
  current,
  onSelect,
  order,
  onOrder,
  guidedView = false,
  guided,
  stepIndex,
  onStep,
  foldNoise,
  layers,
  provider,
  busyHint,
  width,
  onWidth,
}: {
  files: ReadonlyArray<S.PullFile>;
  threadsByPath: ReadonlyMap<string, number>;
  draftsByPath: ReadonlyMap<string, number>;
  viewed: ReadonlySet<string>;
  current: string | null;
  onSelect: (path: string) => void;
  order: FilesOrder;
  guidedView?: boolean;
  onOrder: (o: FilesOrder) => void;
  guided: Guided;
  stepIndex: number;
  onStep: (i: number) => void;
  /** Generated files and lockfiles sit under their own heading at the end. */
  foldNoise: boolean;
  layers: Layers;
  provider: string;
  /** While the model reads: how far it got. */
  busyHint?: string;
  width: number;
  onWidth: (w: number, done: boolean) => void;
}) {
  const startW = useRef(width);
  const drag = useCallback(
    (dx: number) => onWidth(Math.min(480, Math.max(200, startW.current + dx)), false),
    [onWidth],
  );
  const end = useCallback(() => {
    startW.current = width;
    onWidth(width, true);
  }, [onWidth, width]);
  const [filter, setFilter] = useState("");
  const showSteps = guidedView;
  const fileOrder = order === "guided" ? "path" : order;
  const reasons = useMemo(() => {
    const m = new Map<string, HideReason>();
    if (foldNoise)
      for (const f of files) {
        const r = classify(f as unknown as PullFile);
        if (r) m.set(f.filename, r);
      }
    return m;
  }, [files, foldNoise]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? files.filter((f) => f.filename.toLowerCase().includes(q)) : files;
  }, [files, filter]);
  const main = useMemo(() => shown.filter((f) => !reasons.has(f.filename)), [shown, reasons]);
  const noise = useMemo(() => shown.filter((f) => reasons.has(f.filename)), [shown, reasons]);
  const groups = useMemo(() => {
    const gs = groupByFolder(main);
    if (noise.length)
      gs.push({ folder: "folded: lockfiles, generated, formatting", files: noise, quiet: true });
    return gs;
  }, [main, noise]);
  const [, bump] = useState(0);
  const closed = closedFolders.get(files.map((f) => f.filename).join("|")) ?? new Set<string>();
  const toggleFolder = (folder: string) => {
    const key = files.map((f) => f.filename).join("|");
    const set = closedFolders.get(key) ?? new Set<string>();
    if (set.has(folder)) set.delete(folder);
    else set.add(folder);
    closedFolders.set(key, set);
    bump((n) => n + 1);
  };
  const seen = files.filter((f) => viewed.has(f.filename)).length;
  const chips: ReadonlyArray<[FilesOrder, string, boolean]> = [
    ["path", "By path", false],
    ["layer", "By layer", layers.running],
  ];
  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-hair bg-desk"
      style={{ width }}
      onMouseDownCapture={() => {
        startW.current = width;
      }}
    >
      <ResizeHandle edge="right" onDrag={drag} onEnd={end} label="Files column width" />
      <div
        className={cn(
          "relative text-[12px] text-ink-3",
          showSteps ? "guided-column-header" : "px-3 pt-3 pb-2",
        )}
      >
        {showSteps ? (
          <>
            <span className="guided-column-title">Review plan</span>
            <span className="guided-column-count tnum">
              {guided.plan?.steps.length ?? "…"} steps
            </span>
            <span className="guided-column-read tnum">
              {seen} of {files.length} files read
            </span>
            <span className="guided-column-progress" aria-hidden>
              <span style={{ width: `${files.length ? (seen / files.length) * 100 : 0}%` }} />
            </span>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-[12px] text-ink-2">Files</span>
              <span className="tnum text-[10.5px] text-ink-3">
                {seen} of {files.length} read
              </span>
            </div>
            <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-sink">
              <span
                className="block h-full rounded-full bg-ink-3 transition-[width]"
                style={{ width: `${files.length ? (seen / files.length) * 100 : 0}%` }}
              />
            </div>
          </>
        )}
        {!showSteps ? (
          <div
            role="radiogroup"
            aria-label="File order"
            className="mt-3 grid grid-cols-2 gap-0.5 rounded-lg bg-sink p-0.5"
          >
            {chips.map(([v, label, pulse]) => (
              <Button
                variant="ghost"
                size="sm"
                key={v}
                type="button"
                role="radio"
                aria-checked={fileOrder === v}
                onClick={() => onOrder(v)}
                className={cn(
                  "flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] shadow-none",
                  order === v
                    ? "bg-page text-ink shadow-sm/10"
                    : "text-ink-3 hover:bg-page/50 hover:text-ink-2",
                )}
              >
                {pulse ? (
                  <span
                    className="ai-dot size-1.5 animate-pulse rounded-full"
                    aria-label="working"
                  />
                ) : null}
                {label === "By path" ? "Path" : "Layers"}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {!showSteps && fileOrder === "path" ? (
        <div className="px-3 pt-1 pb-2">
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-ink-3"
              strokeWidth={1.75}
            />
            <Input
              size="sm"
              id="files-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files"
              aria-label="Filter the files by path"
              className="h-7 w-full rounded-md border-hair bg-page/45 [&_[data-slot=input]]:pr-12 [&_[data-slot=input]]:pl-7 [&_[data-slot=input]]:text-[11.5px]"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  setFilter("");
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === "Enter" && main[0]) onSelect(main[0].filename);
              }}
            />
            <Kbd className="absolute top-1/2 right-1.5 z-10 h-4 min-w-0 -translate-y-1/2 bg-transparent px-1 text-[9.5px] text-ink-3">
              ⌘P
            </Kbd>
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-6 scrollbar-thin">
        {showSteps ? (
          guided.plan ? (
            <StepsList g={guided} current={stepIndex} onPick={onStep} />
          ) : (
            <p className="px-4 pt-3 text-[12px] text-ink-3">
              {busyHint ?? "The stops appear once the model has read the diff."}
            </p>
          )
        ) : fileOrder === "layer" ? (
          <LayersColumn
            layers={layers}
            files={files}
            viewed={viewed}
            threadsByPath={threadsByPath}
            draftsByPath={draftsByPath}
            current={current}
            onSelect={onSelect}
            provider={provider}
          />
        ) : (
          groups.map((g) => {
            const isClosed = closed.has(g.folder);
            const unread = g.files.filter((f) => !viewed.has(f.filename)).length;
            return (
              <div key={g.folder} className="mt-1 first:mt-0">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-expanded={!isClosed}
                  onClick={() => toggleFolder(g.folder)}
                  className="flex h-7 w-full items-center justify-start gap-1.5 rounded-none px-3 text-left text-[11px] font-normal text-ink-3 hover:bg-transparent hover:text-ink-2"
                >
                  <ChevronRight
                    className={cn("size-3 shrink-0 transition-transform", !isClosed && "rotate-90")}
                    strokeWidth={2}
                  />
                  <span className="min-w-0 truncate">{g.folder || "/"}</span>
                  {isClosed ? (
                    <span className="tnum ml-auto shrink-0">
                      {g.files.length}
                      {unread ? ` · ${unread} unread` : ""}
                    </span>
                  ) : null}
                </Button>
                {isClosed
                  ? null
                  : g.files.map((f) => (
                      <FileRow
                        key={f.filename}
                        f={f}
                        read={viewed.has(f.filename)}
                        threads={threadsByPath.get(f.filename) ?? 0}
                        drafts={draftsByPath.get(f.filename) ?? 0}
                        current={f.filename === current}
                        quiet={g.quiet}
                        reason={reasons.get(f.filename) ?? null}
                        onSelect={() => onSelect(f.filename)}
                      />
                    ))}
              </div>
            );
          })
        )}
        {order === "path" && filter && shown.length === 0 ? (
          <p className="px-4 pt-3 text-[12px] text-ink-3">No file matches.</p>
        ) : null}
      </div>
    </aside>
  );
}

function groupByFolder(files: ReadonlyArray<S.PullFile>): Group[] {
  const m = new Map<string, S.PullFile[]>();
  for (const f of files) {
    const parts = f.filename.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    const g = m.get(folder) ?? [];
    g.push(f);
    m.set(folder, g);
  }
  return [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([folder, fs]) => ({ folder, files: fs }));
}
