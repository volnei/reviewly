import { IconButton } from "@/components/icon-button";
import { PatchView } from "@/components/patch-view";
import { TooltipFor } from "@/components/tooltip-for";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { COMMIT_PROMPT } from "@/lib/ai/prompts";
import { parsePatch } from "@/lib/diff";
import { detectLanguage } from "@/lib/lang";
import { invoke } from "@/lib/tauri";
import { toastError } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { aiInvokeArgs } from "@/stores/ai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  GitBranch,
  Minus,
  Plus,
  RefreshCw,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface FileChange {
  path: string;
  status: string;
}
interface WorkingTree {
  branch: string;
  upstream: boolean;
  ahead: number;
  behind: number;
  staged: FileChange[];
  unstaged: FileChange[];
}

const STATUS_TONE: Record<string, string> = {
  M: "text-warning",
  A: "text-success",
  D: "text-destructive",
  R: "text-info",
  "?": "text-muted-foreground",
};

export function ChangesPanel({ path }: { path: string }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<{ file: string; staged: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  const [generating, setGenerating] = useState(false);
  const [amend, setAmend] = useState(false);

  const status = useQuery({
    queryKey: ["git-status", path],
    queryFn: () => invoke<WorkingTree>("git_status", { path }),
    staleTime: 3_000,
    retry: false,
  });
  const wt = status.data;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["git-status", path] });
    qc.invalidateQueries({ queryKey: ["git-diff", path] });
  };

  const statusKey = ["git-status", path];
  // Optimistically patch the working tree so files jump sections instantly.
  // Returns the snapshot to roll back to on error.
  async function patchStatus(
    fn: (wt: WorkingTree) => WorkingTree,
  ): Promise<{ prev: WorkingTree | undefined }> {
    await qc.cancelQueries({ queryKey: statusKey });
    const prev = qc.getQueryData<WorkingTree>(statusKey);
    if (prev) qc.setQueryData<WorkingTree>(statusKey, fn(prev));
    return { prev };
  }
  // onError signature is (error, variables, context) — context is the snapshot
  // returned by onMutate.
  const rollback = (
    e: unknown,
    _vars: unknown,
    ctx: { prev: WorkingTree | undefined } | undefined,
  ) => {
    if (ctx?.prev) qc.setQueryData<WorkingTree>(statusKey, ctx.prev);
    toastError(e);
  };

  const stage = useMutation({
    mutationFn: (file: string | null) => invoke("git_stage", { path, file }),
    onMutate: (file) =>
      patchStatus((wt) => {
        // file === null → stage everything; else move just that one.
        const moving = file === null ? wt.unstaged : wt.unstaged.filter((f) => f.path === file);
        if (moving.length === 0) return wt;
        const movingPaths = new Set(moving.map((f) => f.path));
        const staged = [...wt.staged.filter((f) => !movingPaths.has(f.path)), ...moving];
        return { ...wt, staged, unstaged: wt.unstaged.filter((f) => !movingPaths.has(f.path)) };
      }),
    onError: rollback,
    onSettled: invalidate,
  });
  const unstage = useMutation({
    mutationFn: (file: string | null) => invoke("git_unstage", { path, file }),
    onMutate: (file) =>
      patchStatus((wt) => {
        const moving = file === null ? wt.staged : wt.staged.filter((f) => f.path === file);
        if (moving.length === 0) return wt;
        const movingPaths = new Set(moving.map((f) => f.path));
        const unstaged = [...wt.unstaged.filter((f) => !movingPaths.has(f.path)), ...moving];
        return { ...wt, staged: wt.staged.filter((f) => !movingPaths.has(f.path)), unstaged };
      }),
    onError: rollback,
    onSettled: invalidate,
  });
  const commit = useMutation({
    mutationFn: () => invoke("git_commit", { path, message: msg, amend }),
    onSuccess: () => {
      setMsg("");
      setSel(null);
      setAmend(false);
      invalidate();
      toast.success(amend ? "Amended" : "Committed");
    },
    onError: (e) => toast.error(`Commit failed — ${String(e)}`),
  });
  const discard = useMutation({
    mutationFn: (f: FileChange) =>
      invoke("git_discard", { path, file: f.path, untracked: f.status === "?" }),
    onMutate: (f) => {
      setSel(null);
      // Drop the discarded file from the working tree immediately.
      return patchStatus((wt) => ({
        ...wt,
        unstaged: wt.unstaged.filter((x) => x.path !== f.path),
      }));
    },
    onError: (e, _f, ctx) => {
      if (ctx?.prev) qc.setQueryData<WorkingTree>(statusKey, ctx.prev);
      toast.error(`Discard failed — ${String(e)}`);
    },
    onSettled: invalidate,
  });

  // Amend reuses the last commit's message — prefill it the first time it's on.
  async function toggleAmend() {
    const next = !amend;
    setAmend(next);
    if (next && !msg.trim()) {
      try {
        const log = await invoke<{ subject: string }[]>("git_log", { path, limit: 1 });
        if (log[0]?.subject) setMsg(log[0].subject);
      } catch {
        /* no commits yet — leave the box empty */
      }
    }
  }

  const fetchM = useSyncMutation("git_fetch", "Fetched", path, invalidate);
  const pullM = useSyncMutation("git_pull", "Pulled", path, invalidate);
  const pushM = useSyncMutation("git_push", "Pushed", path, invalidate);

  async function generateMessage() {
    setGenerating(true);
    try {
      const diff = await invoke<string>("git_staged_diff", { path });
      if (!diff.trim()) {
        toast.error("Stage some changes first.");
        return;
      }
      const out = await invoke<string>("ai_review", {
        ...aiInvokeArgs(),
        prompt: COMMIT_PROMPT + diff,
        cwd: path,
      });
      setMsg(out.trim());
    } catch (e) {
      toast.error(`Couldn't generate — ${String(e)}`);
    } finally {
      setGenerating(false);
    }
  }

  // Shared gate for the Commit button and the ⌘↵ shortcut in the message box.
  const commitDisabled = !msg.trim() || (!amend && (!wt || wt.staged.length === 0));

  return (
    <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
      <ResizablePanel defaultSize={34} minSize={22}>
        <div className="flex h-full flex-col">
          {/* sync toolbar */}
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-xs">
            <GitBranch className="size-3.5 text-muted-foreground" />
            <span className="truncate font-medium text-foreground">{wt?.branch ?? "…"}</span>
            {wt && (wt.ahead > 0 || wt.behind > 0) && (
              <span className="text-muted-foreground tabular-nums">
                {wt.ahead > 0 && `↑${wt.ahead}`} {wt.behind > 0 && `↓${wt.behind}`}
              </span>
            )}
            <div className="ml-auto flex items-center gap-0.5">
              <TooltipFor label="Fetch">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Fetch"
                  loading={fetchM.isPending}
                  onClick={() => fetchM.mutate()}
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </TooltipFor>
              <TooltipFor label="Pull">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Pull"
                  loading={pullM.isPending}
                  onClick={() => pullM.mutate()}
                >
                  <ArrowDownToLine className="size-3.5" />
                </Button>
              </TooltipFor>
              <TooltipFor label="Push">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Push"
                  loading={pushM.isPending}
                  onClick={() => pushM.mutate()}
                >
                  <ArrowUpFromLine className="size-3.5" />
                </Button>
              </TooltipFor>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <Section
              title="Staged"
              count={wt?.staged.length ?? 0}
              action={
                wt && wt.staged.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => unstage.mutate(null)}
                  >
                    Unstage all
                  </button>
                ) : null
              }
            >
              {wt?.staged.map((f) => (
                <Row
                  key={`s-${f.path}`}
                  f={f}
                  active={sel?.file === f.path && sel.staged}
                  onSelect={() => setSel({ file: f.path, staged: true })}
                  action={
                    <IconBtn title="Unstage" onClick={() => unstage.mutate(f.path)}>
                      <Minus className="size-3.5" />
                    </IconBtn>
                  }
                />
              ))}
            </Section>

            <Section
              title="Changes"
              count={wt?.unstaged.length ?? 0}
              action={
                wt && wt.unstaged.length > 0 ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => stage.mutate(null)}
                  >
                    Stage all
                  </button>
                ) : null
              }
            >
              {wt?.unstaged.map((f) => (
                <Row
                  key={`u-${f.path}`}
                  f={f}
                  active={sel?.file === f.path && !sel.staged}
                  onSelect={() => setSel({ file: f.path, staged: false })}
                  action={
                    <>
                      <IconBtn
                        title={f.status === "?" ? "Delete untracked file" : "Discard changes"}
                        onClick={() => {
                          const what =
                            f.status === "?"
                              ? `Delete ${f.path}?`
                              : `Discard changes to ${f.path}?`;
                          if (confirm(`${what} This can't be undone.`)) discard.mutate(f);
                        }}
                      >
                        <Undo2 className="size-3.5" />
                      </IconBtn>
                      <IconBtn title="Stage" onClick={() => stage.mutate(f.path)}>
                        <Plus className="size-3.5" />
                      </IconBtn>
                    </>
                  }
                />
              ))}
            </Section>

            {wt && wt.staged.length === 0 && wt.unstaged.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Working tree clean.
              </p>
            )}
          </ScrollArea>

          {/* commit box */}
          <div className="border-t border-hairline p-3">
            <Textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => {
                // ⌘/Ctrl+Enter commits — respecting the same disabled conditions
                // as the Commit button below.
                if (
                  (e.metaKey || e.ctrlKey) &&
                  e.key === "Enter" &&
                  !commit.isPending &&
                  !commitDisabled
                ) {
                  e.preventDefault();
                  commit.mutate();
                }
              }}
              placeholder="Commit message"
              rows={3}
              className="min-h-0 resize-none text-xs"
            />
            <div className="mt-2 flex items-center gap-2">
              <IconButton
                label="Draft commit message with AI"
                icon={Sparkles}
                loading={generating}
                disabled={!wt || wt.staged.length === 0}
                onClick={generateMessage}
              />
              <TooltipFor label="Amend the last commit instead of creating a new one">
                <button
                  type="button"
                  onClick={toggleAmend}
                  className={cn(
                    "inline-flex h-7 items-center rounded-md px-1.5 text-xs transition-colors sm:h-6",
                    amend
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Amend
                </button>
              </TooltipFor>
              <Button
                size="xs"
                className="ml-auto"
                loading={commit.isPending}
                disabled={commitDisabled}
                onClick={() => commit.mutate()}
              >
                <Check className="size-3.5" />
                {amend
                  ? "Amend"
                  : `Commit ${wt && wt.staged.length > 0 ? `(${wt.staged.length})` : ""}`}
              </Button>
            </div>
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel>
        <DiffView path={path} sel={sel} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function useSyncMutation(cmd: string, successLabel: string, path: string, invalidate: () => void) {
  return useMutation({
    mutationFn: () => invoke(cmd, { path }),
    onSuccess: () => {
      invalidate();
      toast.success(successLabel);
    },
    onError: toastError,
  });
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {title} <span className="tabular-nums">{count}</span>
        </span>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </div>
  );
}

function Row({
  f,
  active,
  onSelect,
  action,
}: {
  f: FileChange;
  active: boolean;
  onSelect: () => void;
  action: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-1 text-xs",
        active ? "bg-primary/10" : "hover:bg-foreground/[0.03]",
      )}
    >
      <span className={cn("w-3 shrink-0 text-center font-mono", STATUS_TONE[f.status] ?? "")}>
        {f.status}
      </span>
      <button
        type="button"
        onClick={onSelect}
        aria-label={f.path}
        className="min-w-0 flex-1 truncate text-left font-mono text-foreground/90"
      >
        {f.path}
      </button>
      <span className="opacity-0 transition-opacity group-hover:opacity-100">{action}</span>
    </div>
  );
}

function IconBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <TooltipFor label={title}>
      <button
        type="button"
        aria-label={title}
        onClick={onClick}
        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      >
        {children}
      </button>
    </TooltipFor>
  );
}

function DiffView({ path, sel }: { path: string; sel: { file: string; staged: boolean } | null }) {
  const diff = useQuery({
    queryKey: ["git-diff", path, sel?.file, sel?.staged],
    queryFn: () => invoke<string>("git_diff_file", { path, file: sel!.file, staged: sel!.staged }),
    enabled: !!sel,
    retry: false,
    staleTime: 3_000,
  });

  if (!sel) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Select a file to see its changes.
      </div>
    );
  }
  const lang = detectLanguage(sel.file);
  const hunks = parsePatch(diff.data ?? null);
  if (hunks.length === 0) {
    return (
      <div className="p-6 text-xs text-muted-foreground">
        {diff.isLoading ? "Loading…" : "No textual diff (new, binary, or untracked file)."}
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <PatchView hunks={hunks} lang={lang} />
    </ScrollArea>
  );
}
