import { ScrollArea } from "@/components/ui/scroll-area";
import { HIDE_LABEL, type HideReason, classify } from "@/lib/focus";
import type { PullFile } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";
import { useViewedFiles } from "@/stores/viewed-files";
import {
  Check,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  EyeOff,
  MessageSquare,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  files: PullFile[];
  active: string | null;
  onSelect: (path: string) => void;
  loading: boolean;
  /** Stable per-PR+head-sha key for the viewed-files store; null while sha unknown. */
  viewedKey?: string | null;
  /** Unresolved review-thread count per file path, for the comment badge. */
  commentCounts?: Record<string, number>;
  /**
   * Toggle "viewed" for the given file. Used both by the per-row check button
   * and (when wired by the parent) the `v` keyboard shortcut on the focused row.
   */
  onToggleViewed?: (path: string, viewed: boolean) => void;
}

interface FileNode {
  kind: "file";
  file: PullFile;
  reason: HideReason | null;
}
interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}
type TreeNode = FileNode | FolderNode;

function buildTree(items: { file: PullFile; reason: HideReason | null }[]): TreeNode[] {
  const root: FolderNode = { kind: "folder", name: "", path: "", children: [] };
  for (const item of items) {
    const parts = item.file.filename.split("/");
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = current.children.find(
        (c): c is FolderNode => c.kind === "folder" && c.name.split("/").pop() === seg,
      );
      if (!next) {
        next = {
          kind: "folder",
          name: seg,
          path: parts.slice(0, i + 1).join("/"),
          children: [],
        };
        current.children.push(next);
      }
      current = next;
    }
    current.children.push({ kind: "file", file: item.file, reason: item.reason });
  }
  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      const an = a.kind === "folder" ? a.name : a.file.filename;
      const bn = b.kind === "folder" ? b.name : b.file.filename;
      return an.localeCompare(bn);
    });
    for (const n of nodes) {
      if (n.kind === "folder") sortNodes(n.children);
    }
    return nodes;
  };
  return collapseChains(sortNodes(root.children));
}

/** Merge `a → b → c` chains of single-child folders into one `a/b/c` row. */
function collapseChains(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.kind !== "folder") return n;
    let folder: FolderNode = { ...n, children: collapseChains(n.children) };
    while (folder.children.length === 1 && folder.children[0].kind === "folder") {
      const only = folder.children[0] as FolderNode;
      folder = {
        kind: "folder",
        name: `${folder.name}/${only.name}`,
        path: only.path,
        children: only.children,
      };
    }
    return folder;
  });
}

/** Lightweight subsequence fuzzy match — every char of `query` appears in
 * `text` in order (case-insensitive). Empty query matches everything. */
function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = false;
    while (ti < t.length) {
      if (t[ti] === c) {
        found = true;
        ti++;
        break;
      }
      ti++;
    }
    if (!found) return false;
  }
  return true;
}

/** A single-letter status glyph so the status reads without relying on color. */
function statusLetter(status: string): string {
  switch (status) {
    case "added":
      return "A";
    case "removed":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "modified":
      return "M";
    default:
      return "M";
  }
}

/** Status text color, paired with the letter glyph. */
function statusTextColor(status: string): string {
  switch (status) {
    case "added":
      return "text-success";
    case "removed":
      return "text-destructive";
    case "renamed":
      return "text-info";
    case "copied":
      return "text-muted-foreground";
    default:
      return "text-warning";
  }
}

export function FileTree({
  files,
  active,
  onSelect,
  loading,
  viewedKey,
  commentCounts = {},
  onToggleViewed,
}: Props) {
  const focusMode = useUi((s) => s.focusMode);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState("");
  const viewedMap = useViewedFiles((s) => (viewedKey ? s.viewed[viewedKey] : undefined));
  const setViewed = useViewedFiles((s) => s.setViewed);
  const viewedCount = viewedMap ? Object.keys(viewedMap).length : 0;

  // Per-folder collapse state, persisted per-PR (keyed by viewedKey).
  const collapsedMap = useViewedFiles((s) => (viewedKey ? s.collapsed[viewedKey] : undefined));
  const setFolderCollapsed = useViewedFiles((s) => s.setCollapsed);
  const setFolderCollapsedBulk = useViewedFiles((s) => s.setCollapsedBulk);

  // Classify each file once; we keep the reason around so we can show a label.
  const classified = useMemo(() => {
    return files.map((f) => ({ file: f, reason: classify(f) }));
  }, [files]);

  const hiddenCount = classified.filter((c) => c.reason !== null).length;

  const visibleFiles = useMemo(() => {
    let out = classified;
    if (focusMode && !showHidden) out = out.filter((c) => c.reason === null);
    if (filter.trim()) {
      const q = filter.trim();
      out = out.filter((c) => fuzzyMatch(c.file.filename, q));
    }
    return out;
  }, [classified, focusMode, showHidden, filter]);

  const tree = useMemo(() => buildTree(visibleFiles), [visibleFiles]);
  const allFolderPaths = useMemo(() => folderPaths(tree), [tree]);

  // Default collapse: large folders start collapsed. Only used to seed which
  // folders count as "collapsed" *until the user has any persisted state*; once
  // a PR has any persisted collapse entries, that state is the source of truth.
  const defaultCollapsed = useMemo(() => initialCollapsedSet(tree), [tree]);
  const hasPersisted = collapsedMap != null;

  const isCollapsed = (path: string): boolean => {
    if (hasPersisted) return Boolean(collapsedMap?.[path]);
    return defaultCollapsed.has(path);
  };

  function toggle(path: string) {
    if (!viewedKey) return;
    if (hasPersisted) {
      setFolderCollapsed(viewedKey, path, !collapsedMap?.[path]);
      return;
    }
    // First interaction on this PR — materialize the default set, then flip one.
    const next = new Set(defaultCollapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setFolderCollapsedBulk(viewedKey, [...next], true);
    // Ensure folders NOT in `next` are explicitly recorded as expanded so the
    // map becomes the source of truth going forward.
    const expanded = allFolderPaths.filter((p) => !next.has(p));
    if (expanded.length) setFolderCollapsedBulk(viewedKey, expanded, false);
  }

  function collapseAll() {
    if (viewedKey) setFolderCollapsedBulk(viewedKey, allFolderPaths, true);
  }
  function expandAll() {
    if (viewedKey) setFolderCollapsedBulk(viewedKey, allFolderPaths, false);
  }

  // Flatten the tree into the rows that are actually rendered (respecting
  // collapse) so arrow-key roving focus and auto-scroll have a linear order.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `isCollapsed` is derived from collapsedMap/hasPersisted, which ARE the deps
  const rows = useMemo(() => flatten(tree, isCollapsed), [tree, collapsedMap, hasPersisted]);
  const filePaths = useMemo(
    () => rows.filter((r) => r.node.kind === "file").map((r) => (r.node as FileNode).file.filename),
    [rows],
  );

  // Roving focus index over the flattened rows (folders + files).
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const activeRowRef = useRef<HTMLLIElement>(null);

  // Auto-scroll the active file row into view when the selection changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on active change
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const effectiveToggleViewed =
    onToggleViewed ??
    (viewedKey ? (path: string, v: boolean) => setViewed(viewedKey, path, v) : undefined);

  function moveFocus(delta: number) {
    setFocusIdx((prev) => {
      const base = prev ?? rows.findIndex((r) => r.node.kind === "file" && isActiveRow(r, active));
      const start = base < 0 ? 0 : base;
      let next = start + delta;
      if (next < 0) next = 0;
      if (next > rows.length - 1) next = rows.length - 1;
      return next;
    });
  }

  function onTreeKeyDown(e: React.KeyboardEvent) {
    if (rows.length === 0) return;
    const fallback = rows.findIndex((r) => r.node.kind === "file" && isActiveRow(r, active));
    const idx = focusIdx ?? (fallback >= 0 ? fallback : 0);
    const cur = rows[idx];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(-1);
        break;
      case "ArrowRight":
        if (cur?.node.kind === "folder" && isCollapsed(cur.node.path)) {
          e.preventDefault();
          toggle(cur.node.path);
        }
        break;
      case "ArrowLeft":
        if (cur?.node.kind === "folder" && !isCollapsed(cur.node.path)) {
          e.preventDefault();
          toggle(cur.node.path);
        }
        break;
      case "Enter":
      case " ":
        if (cur) {
          e.preventDefault();
          if (cur.node.kind === "folder") toggle(cur.node.path);
          else onSelect(cur.node.file.filename);
        }
        break;
      case "v":
        // Toggle "viewed" on the focused (or active) file.
        if (effectiveToggleViewed) {
          const target =
            cur?.node.kind === "file"
              ? cur.node.file.filename
              : active && filePaths.includes(active)
                ? active
                : null;
          if (target) {
            e.preventDefault();
            effectiveToggleViewed(target, !viewedMap?.[target]);
          }
        }
        break;
    }
  }

  if (loading) {
    return <FileTreePlaceholder />;
  }

  const total = classified.length;
  const focusedRow = focusIdx != null ? rows[focusIdx] : undefined;

  return (
    <ScrollArea className="h-full border-r border-hairline">
      {viewedKey && total > 0 && (
        <div className="px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Check className="size-3" strokeWidth={2} />
              {viewedCount} of {total} viewed
            </span>
            <span className="tabular-nums">{Math.round((viewedCount / total) * 100)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.08]">
            <div
              className="h-full rounded-full bg-success transition-[width] duration-300 ease-out"
              style={{
                width: viewedCount > 0 ? `max(3px, ${(viewedCount / total) * 100}%)` : "0%",
              }}
            />
          </div>
        </div>
      )}
      {/* Filter + collapse/expand controls above the tree. */}
      <div className="flex items-center gap-1 px-2 pb-1.5 pt-1">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60"
            strokeWidth={2}
          />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              // Enter jumps to the first matching file.
              if (e.key === "Enter" && filePaths.length > 0) {
                e.preventDefault();
                onSelect(filePaths[0]);
              } else if (e.key === "Escape" && filter) {
                e.preventDefault();
                setFilter("");
              }
            }}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="h-6 w-full rounded border border-border/40 bg-background/40 pl-6 pr-6 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/50"
          />
          {filter && (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setFilter("")}
              className="absolute right-1 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2} />
            </button>
          )}
        </div>
        {viewedKey && allFolderPaths.length > 0 && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={collapseAll}
              aria-label="Collapse all folders"
              title="Collapse all"
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <ChevronsDownUp className="size-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={expandAll}
              aria-label="Expand all folders"
              title="Expand all"
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <ChevronsUpDown className="size-3.5" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
      {focusMode && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <EyeOff className="size-3" strokeWidth={2} />
          {showHidden
            ? `${hiddenCount} noise files shown · hide`
            : `${hiddenCount} files hidden · show`}
        </button>
      )}
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">
          {filter ? "No files match your filter." : "No files."}
        </p>
      ) : (
        <ul
          role="tree"
          aria-label="Changed files"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: roving-tabindex tree widget (arrow-key nav)
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          onFocus={() => {
            if (focusIdx == null) {
              const i = rows.findIndex((r) => r.node.kind === "file" && isActiveRow(r, active));
              setFocusIdx(i >= 0 ? i : 0);
            }
          }}
          className="p-1.5 outline-none"
        >
          {rows.map((row, i) => {
            const isRowActive = row.node.kind === "file" && isActiveRow(row, active);
            const isRowFocused = focusedRow === row;
            const ref = isRowActive ? activeRowRef : undefined;
            if (row.node.kind === "folder") {
              const folder = row.node;
              const collapsed = isCollapsed(folder.path);
              const count = leafCount(folder);
              const folderComments = collapsed ? commentSum(folder, commentCounts) : 0;
              return (
                <FolderRow
                  key={`d:${folder.path}`}
                  node={folder}
                  depth={row.depth}
                  collapsed={collapsed}
                  count={count}
                  comments={folderComments}
                  focused={isRowFocused}
                  onToggle={() => toggle(folder.path)}
                  onFocusRow={() => setFocusIdx(i)}
                />
              );
            }
            const file = row.node.file;
            return (
              <FileRow
                key={`f:${file.filename}`}
                rowRef={ref}
                file={file}
                reason={row.node.reason}
                depth={row.depth}
                active={isRowActive}
                focused={isRowFocused}
                onSelect={onSelect}
                onFocusRow={() => setFocusIdx(i)}
                viewed={Boolean(viewedMap?.[file.filename])}
                onToggleViewed={effectiveToggleViewed}
                comments={commentCounts[file.filename] ?? 0}
              />
            );
          })}
        </ul>
      )}
    </ScrollArea>
  );
}

function FileTreePlaceholder() {
  const rows = [
    { depth: 0, width: 118, folder: true },
    { depth: 1, width: 156 },
    { depth: 1, width: 132 },
    { depth: 0, width: 96, folder: true },
    { depth: 1, width: 144 },
    { depth: 1, width: 104 },
    { depth: 0, width: 174 },
    { depth: 0, width: 128 },
  ];

  return (
    <div className="h-full border-r border-hairline">
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground/55">
          <span className="inline-flex items-center gap-1.5">
            <Check className="size-3 opacity-55" strokeWidth={2} />
            <span className="h-3 w-20 rounded bg-foreground/[0.045]" />
          </span>
          <span className="h-3 w-10 rounded bg-foreground/[0.045]" />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.045]">
          <div className="h-full w-1/4 rounded-full bg-foreground/[0.08]" />
        </div>
      </div>
      <div className="border-t border-hairline/60 px-2 py-1">
        {rows.map((row, i) => (
          <div
            key={`${row.width}-${i}`}
            className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground/55"
            style={{ paddingLeft: `${row.depth * 14 + 6}px` }}
          >
            {row.folder ? (
              <ChevronRight className="size-3.5 opacity-55" />
            ) : (
              <span className="ml-1 size-1.5 rounded-full bg-foreground/[0.12]" />
            )}
            <span className="h-3 rounded bg-foreground/[0.055]" style={{ width: row.width }} />
            {!row.folder && i % 3 === 1 && (
              <span className="ml-auto h-3 w-4 rounded bg-foreground/[0.045]" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function isActiveRow(row: FlatRow, active: string | null): boolean {
  return row.node.kind === "file" && row.node.file.filename === active;
}

interface FlatRow {
  node: TreeNode;
  depth: number;
}

/** Walk the tree into a linear list of visible rows, skipping the children of
 * collapsed folders. */
function flatten(tree: TreeNode[], isCollapsed: (path: string) => boolean): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      out.push({ node: n, depth });
      if (n.kind === "folder" && !isCollapsed(n.path)) {
        walk(n.children, depth + 1);
      }
    }
  };
  walk(tree, 0);
  return out;
}

function folderPaths(tree: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind !== "folder") return;
    out.push(n.path);
    for (const c of n.children) walk(c);
  };
  for (const n of tree) walk(n);
  return out;
}

function leafCount(n: TreeNode): number {
  if (n.kind === "file") return 1;
  return n.children.reduce((acc, c) => acc + leafCount(c), 0);
}

function commentSum(n: TreeNode, counts: Record<string, number>): number {
  if (n.kind === "file") return counts[n.file.filename] ?? 0;
  return n.children.reduce((acc, c) => acc + commentSum(c, counts), 0);
}

function CommentBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 text-xs text-info"
      aria-label={`${count} unresolved comment${count === 1 ? "" : "s"}`}
    >
      <MessageSquare className="size-3" strokeWidth={2} />
      {count}
    </span>
  );
}

function initialCollapsedSet(tree: TreeNode[]): Set<string> {
  const set = new Set<string>();
  const walk = (n: TreeNode) => {
    if (n.kind !== "folder") return;
    if (leafCount(n) > 12) set.add(n.path);
    for (const c of n.children) walk(c);
  };
  for (const n of tree) walk(n);
  return set;
}

function FolderRow({
  node,
  depth,
  collapsed,
  count,
  comments,
  focused,
  onToggle,
  onFocusRow,
}: {
  node: FolderNode;
  depth: number;
  collapsed: boolean;
  count: number;
  comments: number;
  focused: boolean;
  onToggle: () => void;
  onFocusRow: () => void;
}) {
  return (
    <li role="treeitem" aria-expanded={!collapsed} aria-label={node.path}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          onFocusRow();
          onToggle();
        }}
        className={cn(
          "flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
          focused && "ring-1 ring-inset ring-primary/40",
        )}
        style={{ paddingLeft: 5 + depth * 10 }}
      >
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform", !collapsed && "rotate-90")}
          strokeWidth={2}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
        <CommentBadge count={comments} />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground/50">{count}</span>
      </button>
    </li>
  );
}

function FileRow({
  rowRef,
  file,
  reason,
  depth,
  active,
  focused,
  onSelect,
  onFocusRow,
  viewed,
  onToggleViewed,
  comments,
}: {
  rowRef?: React.Ref<HTMLLIElement>;
  file: PullFile;
  reason: HideReason | null;
  depth: number;
  active: boolean;
  focused: boolean;
  onSelect: (path: string) => void;
  onFocusRow: () => void;
  viewed: boolean;
  onToggleViewed?: (path: string, viewed: boolean) => void;
  comments: number;
}) {
  const basename = file.filename.split("/").pop() ?? file.filename;
  const muted = reason !== null || (viewed && !active);
  return (
    <li
      ref={rowRef}
      role="treeitem"
      aria-current={active ? "true" : undefined}
      aria-selected={active}
      aria-label={file.filename}
      className={cn(
        "group flex items-center gap-1 rounded pr-1 hover:bg-foreground/[0.04]",
        active && "bg-primary/15",
        focused && !active && "ring-1 ring-inset ring-primary/40",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          onFocusRow();
          onSelect(file.filename);
        }}
        aria-label={file.filename}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-xs",
          active && "text-foreground",
          muted && !active && "opacity-55",
        )}
        style={{ paddingLeft: 5 + depth * 10 }}
      >
        <span
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded-sm text-[9px] font-semibold leading-none ring-1 ring-inset ring-border/50",
            statusTextColor(file.status),
          )}
          aria-hidden
        >
          {statusLetter(file.status)}
        </span>
        <span className="min-w-0 flex-1 truncate">{basename}</span>
        <CommentBadge count={comments} />
        {reason && (
          <span className="shrink-0 rounded bg-foreground/[0.06] px-1 text-xs text-muted-foreground">
            {HIDE_LABEL[reason]}
          </span>
        )}
        {file.additions + file.deletions > 0 && (
          <span
            className="flex h-1 w-8 shrink-0 overflow-hidden rounded-full bg-foreground/[0.08] group-hover:hidden group-focus-within:hidden"
            aria-hidden
          >
            <span
              className="h-full bg-success/55"
              style={{
                width: `${(file.additions / (file.additions + file.deletions)) * 100}%`,
              }}
            />
            <span
              className="h-full bg-destructive/55"
              style={{
                width: `${(file.deletions / (file.additions + file.deletions)) * 100}%`,
              }}
            />
          </span>
        )}
        <span className="hidden shrink-0 text-xs text-success group-hover:inline group-focus-within:inline">
          +{file.additions}
        </span>
        <span className="hidden shrink-0 text-xs text-destructive group-hover:inline group-focus-within:inline">
          −{file.deletions}
        </span>
      </button>
      {onToggleViewed && (
        <button
          type="button"
          tabIndex={-1}
          aria-pressed={viewed}
          aria-label={viewed ? "Mark as not viewed" : "Mark as viewed"}
          onClick={() => onToggleViewed(file.filename, !viewed)}
          className={cn(
            "flex size-3.5 shrink-0 items-center justify-center rounded transition-colors",
            viewed
              ? "bg-success/20 text-success"
              : "text-muted-foreground/40 opacity-0 hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <Check className="size-2.5" strokeWidth={3} />
        </button>
      )}
    </li>
  );
}
