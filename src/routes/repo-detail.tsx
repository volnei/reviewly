import { ChangesPanel } from "@/components/changes-panel";
import { EmptyState } from "@/components/empty-state";
import { KbdCmd, KbdEnter } from "@/components/kbd";
import { PatchView } from "@/components/patch-view";
import { PopoverPanel } from "@/components/popover";
import { RepoQuickOpen } from "@/components/repo-quick-open";
import { Segmented } from "@/components/segmented";
import { TooltipFor } from "@/components/tooltip-for";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type CodeownersRule, ownersFor, parseCodeowners } from "@/lib/codeowners";
import { parsePatch } from "@/lib/diff";
import { fileIcon } from "@/lib/file-icons";
import { relativeTime } from "@/lib/format";
import { detectLanguage, highlightLine } from "@/lib/lang";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useLocalRepos } from "@/stores/local-repos";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  ChevronsUpDown,
  FileCode,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommit,
  GitPullRequestArrow,
  Layers,
  Search,
  Trash2,
} from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface DirEntry {
  name: string;
  isDir: boolean;
}
interface Branches {
  current: string;
  all: string[];
}
interface Worktree {
  path: string;
  branch: string | null;
}

interface FileChangeLite {
  path: string;
  status: string;
}
interface WorkingTreeLite {
  staged: FileChangeLite[];
  unstaged: FileChangeLite[];
}
interface FileActivity {
  path: string;
  lastShort: string;
  lastAuthor: string;
  lastTime: number;
  lastSubject: string;
  churn: number;
}
interface NumstatChange {
  path: string;
  additions: number;
  deletions: number;
}
interface BranchChanges {
  base: string | null;
  files: NumstatChange[];
}

/** Decoration sources for the file tree, shared down the recursion via context. */
interface TreeDeco {
  root: string;
  statusByPath: Map<string, string>;
  dirtyDirs: Set<string>;
  changeByPath: Map<string, NumstatChange>;
  activityByPath: Map<string, FileActivity>;
  maxChurn: number;
  owners: (rel: string) => string[];
}
const DecoCtx = createContext<TreeDeco | null>(null);

/** Git-status letter → color, VS-Code-ish (added green, modified amber, …). */
function statusColor(s: string): string {
  switch (s) {
    case "A":
      return "text-success";
    case "U":
      return "text-success/80";
    case "M":
      return "text-warning";
    case "D":
      return "text-destructive";
    case "R":
      return "text-info";
    default:
      return "text-foreground";
  }
}

export function RepoDetailPage() {
  const { owner, repo } = useParams({ from: "/repos/$owner/$repo" });
  const localRepo = useLocalRepos((s) => s.repos.find((r) => r.owner === owner && r.repo === repo));
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"code" | "changes" | "history">("code");
  const [quickOpen, setQuickOpen] = useState(false);
  const root = localRepo?.path ?? "";
  const codeMode = mode === "code";

  // ⌘P / Ctrl+P — quick-open within this repo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- File-tree decoration sources: git status, branch-vs-base, churn, owners ---
  const status = useQuery({
    queryKey: ["git-status-tree", root],
    queryFn: () => invoke<WorkingTreeLite>("git_status", { path: root }),
    enabled: codeMode && !!root,
    staleTime: 15_000,
    retry: false,
  });
  const branchChanges = useQuery({
    queryKey: ["git-branch-changes", root],
    queryFn: () => invoke<BranchChanges>("git_branch_changes", { path: root }),
    enabled: codeMode && !!root,
    staleTime: 60_000,
    retry: false,
  });
  const activity = useQuery({
    queryKey: ["git-activity", root],
    queryFn: () => invoke<FileActivity[]>("git_file_activity", { path: root, sinceDays: 90 }),
    enabled: codeMode && !!root,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const owners = useQuery({
    queryKey: ["codeowners", root],
    queryFn: async () => {
      for (const rel of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
        try {
          return parseCodeowners(await invoke<string>("read_file", { path: `${root}/${rel}` }));
        } catch {
          // try the next candidate location
        }
      }
      return [] as CodeownersRule[];
    },
    enabled: codeMode && !!root,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const deco = useMemo<TreeDeco>(() => {
    const statusByPath = new Map<string, string>();
    const dirtyDirs = new Set<string>();
    const markDirs = (rel: string) => {
      const parts = rel.split("/");
      let acc = "";
      for (let k = 0; k < parts.length - 1; k++) {
        acc = acc ? `${acc}/${parts[k]}` : parts[k];
        dirtyDirs.add(acc);
      }
    };
    for (const f of [...(status.data?.staged ?? []), ...(status.data?.unstaged ?? [])]) {
      statusByPath.set(f.path, f.status === "?" ? "U" : f.status);
      markDirs(f.path);
    }
    const changeByPath = new Map<string, NumstatChange>();
    for (const f of branchChanges.data?.files ?? []) changeByPath.set(f.path, f);
    const activityByPath = new Map<string, FileActivity>();
    let maxChurn = 1;
    for (const a of activity.data ?? []) {
      activityByPath.set(a.path, a);
      if (a.churn > maxChurn) maxChurn = a.churn;
    }
    const rules = owners.data ?? [];
    return {
      root,
      statusByPath,
      dirtyDirs,
      changeByPath,
      activityByPath,
      maxChurn,
      owners: (rel: string) => ownersFor(rules, rel),
    };
  }, [root, status.data, branchChanges.data, activity.data, owners.data]);

  if (!localRepo) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="Repository not found"
        description="This clone isn't in your local repositories anymore."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-hairline px-6 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            to="/repos"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          >
            Repositories
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <span className="truncate font-medium text-foreground">
            {owner}/{repo}
          </span>
        </div>

        <Segmented
          className="ml-1 shrink-0"
          options={[
            { value: "code", label: "Code" },
            { value: "changes", label: "Changes" },
            { value: "history", label: "History" },
          ]}
          value={mode}
          onChange={setMode}
        />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-card/40 px-2 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <Search className="size-3.5" />
            Go to file
            <kbd className="rounded border border-border/40 bg-background/40 px-1 py-px font-mono text-[10px] text-muted-foreground/70">
              ⌘P
            </kbd>
          </button>
          <span className="h-4 w-px bg-border/50" aria-hidden />
          <RepoToolbar path={localRepo.path} />
        </div>
      </header>
      {mode === "changes" ? (
        <ChangesPanel path={localRepo.path} />
      ) : mode === "history" ? (
        <CommitLog path={localRepo.path} />
      ) : (
        <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize={26} minSize={16}>
            <ScrollArea className="h-full">
              <div className="py-2 font-mono text-xs">
                <DecoCtx.Provider value={deco}>
                  <Tree
                    path={localRepo.path}
                    name={repo}
                    depth={0}
                    selected={selected}
                    onSelect={setSelected}
                  />
                </DecoCtx.Provider>
              </div>
            </ScrollArea>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel>
            <CodeView path={selected} />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      {quickOpen && (
        <RepoQuickOpen
          root={localRepo.path}
          onClose={() => setQuickOpen(false)}
          onOpen={(p) => {
            setSelected(p);
            setMode("code");
            setQuickOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Tree({
  path,
  name,
  depth,
  selected,
  onSelect,
}: {
  path: string;
  name: string;
  depth: number;
  selected: string | null;
  onSelect: (p: string) => void;
}) {
  const [open, setOpen] = useState(depth === 0);
  const deco = useContext(DecoCtx);
  const entries = useQuery({
    queryKey: ["dir", path],
    queryFn: () => invoke<DirEntry[]>("list_dir", { path }),
    enabled: open,
    staleTime: 30_000,
  });

  const folderRel = deco && depth > 0 ? path.slice(deco.root.length + 1) : "";
  const folderDirty = folderRel ? (deco?.dirtyDirs.has(folderRel) ?? false) : false;

  return (
    <div>
      {depth > 0 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 py-0.5 pr-2 text-left text-muted-foreground transition-colors hover:text-foreground"
          style={{ paddingLeft: depth * 12 }}
        >
          <ChevronRight
            className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
          />
          {open ? (
            <FolderOpen className="size-3.5 shrink-0 text-info" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-info" />
          )}
          <span className="min-w-0 truncate">{name}</span>
          {folderDirty && (
            <span
              className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
              aria-label="Uncommitted changes inside"
            />
          )}
        </button>
      )}
      {open &&
        entries.data?.map((e) => {
          const child = `${path}/${e.name}`;
          if (e.isDir) {
            return (
              <Tree
                key={child}
                path={child}
                name={e.name}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            );
          }
          const rel = deco ? child.slice(deco.root.length + 1) : e.name;
          const stt = deco?.statusByPath.get(rel);
          const chg = deco?.changeByPath.get(rel);
          const act = deco?.activityByPath.get(rel);
          const owns = deco?.owners(rel) ?? [];
          const heat = act && deco ? 0.3 + 0.7 * (act.churn / deco.maxChurn) : 0;
          const { Icon, className: iconClass } = fileIcon(e.name);
          const tipNode =
            act || owns.length > 0 ? (
              // biome-ignore lint/correctness/useJsxKeyInIterable: a tooltip label prop, not a list item
              <span className="flex flex-col gap-0.5 text-left">
                {act && (
                  <>
                    <span className="font-medium text-foreground">{act.lastSubject}</span>
                    <span className="text-muted-foreground/80">
                      {act.lastAuthor} · {relativeTime(act.lastTime * 1000)} · {act.churn} commit
                      {act.churn === 1 ? "" : "s"}/90d
                    </span>
                  </>
                )}
                {owns.length > 0 && (
                  <span className="text-muted-foreground/80">owners: {owns.join(", ")}</span>
                )}
              </span>
            ) : null;
          const rowButton = (
            <button
              key={child}
              type="button"
              onClick={() => onSelect(child)}
              className={cn(
                "group/row flex w-full items-center gap-1 py-0.5 pr-2 text-left transition-colors",
                selected === child ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.03]",
              )}
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              <Icon className={cn("size-3.5 shrink-0", iconClass)} />
              <span
                className={cn(
                  "min-w-0 truncate",
                  stt
                    ? statusColor(stt)
                    : selected === child
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {e.name}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
                {owns.length > 0 && (
                  <span className="hidden max-w-24 truncate text-[10px] text-muted-foreground/55 group-hover/row:inline">
                    {owns[0]}
                  </span>
                )}
                {chg && (chg.additions > 0 || chg.deletions > 0) && (
                  <span className="text-[10px] tabular-nums">
                    {chg.additions > 0 && <span className="text-success">+{chg.additions}</span>}
                    {chg.deletions > 0 && (
                      <span className="ml-0.5 text-destructive">−{chg.deletions}</span>
                    )}
                  </span>
                )}
                {stt && (
                  <span className={cn("text-[10px] font-semibold leading-none", statusColor(stt))}>
                    {stt}
                  </span>
                )}
                {act && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-warning"
                    style={{ opacity: heat }}
                  />
                )}
              </span>
            </button>
          );
          return tipNode ? (
            <TooltipFor key={child} label={tipNode} side="right" align="start">
              {rowButton}
            </TooltipFor>
          ) : (
            rowButton
          );
        })}
    </div>
  );
}

function CodeView({ path }: { path: string | null }) {
  const file = useQuery({
    queryKey: ["file", path],
    queryFn: () => invoke<string>("read_file", { path: path as string }),
    enabled: !!path,
    retry: false,
    staleTime: 30_000,
  });

  if (!path) {
    return (
      <EmptyState icon={FileCode} title="Pick a file" description="Browse the tree to view code." />
    );
  }
  if (file.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[...Array(10)].map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }
  if (file.isError) {
    return (
      <div className="p-6 text-xs text-muted-foreground">
        Can't preview this file — {String(file.error)}
      </div>
    );
  }

  const lang = detectLanguage(path);
  const lines = (file.data ?? "").split("\n");
  return (
    <ScrollArea className="h-full">
      <div className="overflow-x-auto py-2 font-mono text-xs leading-[1.5]">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-12 shrink-0 select-none bg-foreground/[0.02] px-2 text-right text-muted-foreground/75 tabular-nums">
              {i + 1}
            </span>
            <pre
              className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4 text-foreground/90"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: Prism-highlighted
              dangerouslySetInnerHTML={{ __html: highlightLine(l, lang) || "&nbsp;" }}
            />
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function RepoToolbar({ path }: { path: string }) {
  const qc = useQueryClient();
  const [prOpen, setPrOpen] = useState(false);
  const branches = useQuery({
    queryKey: ["branches", path],
    queryFn: () => invoke<Branches>("git_branches", { path }),
    staleTime: 15_000,
    retry: false,
  });
  const worktrees = useQuery({
    queryKey: ["worktrees", path],
    queryFn: () => invoke<Worktree[]>("git_worktrees", { path }),
    staleTime: 30_000,
    retry: false,
  });
  const checkout = useMutation({
    mutationFn: (branch: string) => invoke("git_checkout", { path, branch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches", path] });
      qc.invalidateQueries({ queryKey: ["dir"] });
      qc.invalidateQueries({ queryKey: ["file"] });
      qc.invalidateQueries({ queryKey: ["git-repo-info", path] });
      toast.success("Switched branch");
    },
    onError: (e) => toast.error(`Checkout failed — ${String(e)}`),
  });
  const del = useMutation({
    mutationFn: (v: { name: string; force: boolean }) =>
      invoke("git_delete_branch", { path, name: v.name, force: v.force }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches", path] });
      toast.success("Branch deleted");
    },
  });

  return (
    <>
      {branches.data && (
        <BranchMenu
          branches={branches.data}
          busy={checkout.isPending || del.isPending}
          onCheckout={(b) => checkout.mutate(b)}
          onDelete={(b) => {
            if (!confirm(`Delete branch "${b}"?`)) return;
            del.mutate(
              { name: b, force: false },
              {
                // `-d` refuses unmerged branches — offer the force path on failure.
                onError: () => {
                  if (confirm(`"${b}" isn't fully merged. Force-delete it?`)) {
                    del.mutate({ name: b, force: true });
                  }
                },
              },
            );
          }}
        />
      )}
      {worktrees.data && worktrees.data.length > 1 && (
        <TooltipFor
          label={
            <span className="flex flex-col gap-0.5">
              {worktrees.data.map((w) => (
                <span key={w.path}>
                  {w.branch ?? "(detached)"} → {w.path}
                </span>
              ))}
            </span>
          }
        >
          <span className="inline-flex h-7 items-center gap-1 rounded-md border border-border/40 bg-card/40 px-2 text-xs text-muted-foreground">
            <Layers className="size-3" />
            {worktrees.data.length}
          </span>
        </TooltipFor>
      )}
      <Button size="sm" variant="outline" onClick={() => setPrOpen(true)}>
        <GitPullRequestArrow className="size-3.5" />
        New PR
      </Button>
      {prOpen && <NewPrDialog path={path} onClose={() => setPrOpen(false)} />}
    </>
  );
}

function NewPrDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const create = useMutation({
    mutationFn: () => invoke<string>("gh_pr_create", { path, title, body, base: null }),
    onSuccess: (url) => {
      toast.success("Pull request created");
      if (url) safeOpenUrl(url);
      onClose();
    },
    onError: (e) => toast.error(`Create PR failed — ${String(e)}`),
  });

  const canSubmit = title.trim().length > 0 && !create.isPending;

  return (
    <button
      type="button"
      aria-label="Close"
      className="fixed inset-0 z-50 flex cursor-default items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[28rem] cursor-auto rounded-xl border border-hairline bg-popover/95 p-4 text-left shadow-2xl backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          // Esc closes; ⌘/Ctrl+Enter submits from anywhere in the dialog.
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
            e.preventDefault();
            create.mutate();
          }
        }}
      >
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
          <GitPullRequestArrow className="size-4 text-primary" />
          Open a pull request
        </p>
        <p className="mb-3 text-xs text-muted-foreground">
          Pushes the current branch to origin, then opens the PR via the GitHub CLI.
        </p>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 text-xs"
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Description (optional)"
          rows={5}
          className="resize-none font-sans text-xs"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="xs"
            loading={create.isPending}
            disabled={!title.trim()}
            onClick={() => create.mutate()}
          >
            Create PR
            <span className="ml-1 inline-flex items-center gap-px opacity-60">
              <KbdCmd className="size-2.5" />
              <KbdEnter className="size-2.5" />
            </span>
          </Button>
        </div>
      </div>
    </button>
  );
}

interface CommitEntry {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

function CommitLog({ path }: { path: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const log = useQuery({
    queryKey: ["git-log", path],
    queryFn: () => invoke<CommitEntry[]>("git_log", { path, limit: 100 }),
    staleTime: 15_000,
    retry: false,
  });

  if (log.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {[...Array(8)].map((_, i) => (
          <Skeleton key={i} className="h-10 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (log.isError || !log.data) {
    return (
      <div className="p-6 text-xs text-muted-foreground">
        Couldn't read history — {String(log.error ?? "")}
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <ul className="px-4 py-3">
        {log.data.map((c) => {
          const open = expanded === c.hash;
          return (
            <li key={c.hash} className="border-b border-hairline last:border-0">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : c.hash)}
                className="flex w-full items-start gap-3 py-2.5 text-left"
              >
                <GitCommit
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                  strokeWidth={1.5}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{c.subject}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-mono text-foreground/70">{c.short}</span> · {c.author} ·{" "}
                    {c.date}
                  </p>
                </div>
                <ChevronRight
                  className={cn(
                    "mt-1 size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
                    open && "rotate-90",
                  )}
                />
              </button>
              {open && <CommitDiff path={path} hash={c.hash} />}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

/** Split a multi-file `git show`/`git diff` into per-file patch bodies. */
function splitFiles(raw: string): { path: string; body: string }[] {
  const files: { path: string; lines: string[] }[] = [];
  let cur: { path: string; lines: string[] } | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (cur) files.push(cur);
      const m = line.match(/ b\/(.+)$/);
      cur = { path: m ? m[1] : line.slice("diff --git ".length), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) files.push(cur);
  return files.map((f) => ({ path: f.path, body: f.lines.join("\n") }));
}

function CommitDiff({ path, hash }: { path: string; hash: string }) {
  const show = useQuery({
    queryKey: ["git-show", path, hash],
    queryFn: () => invoke<string>("git_show", { path, hash }),
    staleTime: 5 * 60_000, // commit diffs are immutable
    retry: false,
  });

  if (show.isLoading) {
    return <p className="py-2 pl-7 text-xs text-muted-foreground">Loading diff…</p>;
  }
  if (show.isError) {
    return (
      <p className="py-2 pl-7 text-xs text-muted-foreground">
        Couldn't load diff — {String(show.error)}
      </p>
    );
  }
  const files = splitFiles(show.data ?? "");
  if (files.length === 0) {
    return <p className="py-2 pl-7 text-xs text-muted-foreground">No textual diff.</p>;
  }
  return (
    <div className="mb-2 ml-7 overflow-hidden rounded-lg border border-hairline">
      {files.map((f) => {
        const lang = detectLanguage(f.path);
        const hunks = parsePatch(f.body);
        return (
          <div key={f.path} className="border-b border-hairline last:border-0">
            <p className="bg-foreground/[0.04] px-3 py-1.5 font-mono text-xs text-foreground/70">
              {f.path}
            </p>
            {hunks.length === 0 ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">
                No textual changes (rename, mode, or binary).
              </p>
            ) : (
              <PatchView hunks={hunks} lang={lang} showHunkHeaders />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BranchMenu({
  branches,
  busy,
  onCheckout,
  onDelete,
}: {
  branches: Branches;
  busy: boolean;
  onCheckout: (b: string) => void;
  onDelete: (b: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const close = () => {
    setOpen(false);
    setFilter("");
  };
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return branches.all;
    return branches.all.filter((b) => b.toLowerCase().includes(q));
  }, [branches.all, filter]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="inline-flex h-7 max-w-48 items-center gap-1.5 rounded-md border border-border/40 bg-card/40 px-2 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
      >
        <GitBranch className="size-3.5 shrink-0" />
        <span className="truncate text-foreground">{branches.current}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground/60" />
      </button>
      {open && (
        <PopoverPanel onClose={close} width="w-64" className="flex max-h-80 flex-col">
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${branches.all.length} branches…`}
              size="sm"
              className="w-full pl-7"
            />
          </div>
          <div className="-mr-1 flex-1 space-y-px overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No branches match “{filter.trim()}”.
              </p>
            ) : (
              filtered.map((b) => {
                const cur = b === branches.current;
                return (
                  <div
                    key={b}
                    className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-foreground/[0.06]"
                  >
                    <button
                      type="button"
                      disabled={cur}
                      onClick={() => {
                        onCheckout(b);
                        close();
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <Check
                        className={cn("size-3.5 shrink-0", cur ? "text-primary" : "opacity-0")}
                      />
                      <span
                        className={cn("truncate", cur ? "text-foreground" : "text-foreground/80")}
                      >
                        {b}
                      </span>
                    </button>
                    {!cur && (
                      <button
                        type="button"
                        aria-label={`Delete branch ${b}`}
                        onClick={() => onDelete(b)}
                        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}
