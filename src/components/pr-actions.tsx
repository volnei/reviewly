import { PopoverPanel } from "@/components/popover";
import { ReviewerPicker } from "@/components/reviewer-picker";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/tauri";
import type { PullDetail } from "@/lib/tauri";
import { safeOpenUrl, toastError } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useLocalRepos } from "@/stores/local-repos";
import { type MergeMethod, useMergePrefs } from "@/stores/merge-prefs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import {
  Bot,
  Check,
  ChevronDown,
  CircleDashed,
  CircleOff,
  ExternalLink,
  GitMerge,
  type LucideIcon,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  owner: string;
  repo: string;
  number: number;
  pr: PullDetail;
  /** GraphQL node id, fetched lazily by parent. */
  nodeId?: string;
}

/**
 * Header actions. The one primary action (Merge / Ready for review / Reopen)
 * stays prominent; everything secondary (draft toggle, update-branch, close,
 * open-on-GitHub) collapses into a "⋯" overflow menu to keep the header calm.
 */
export function PrActions({ owner, repo, number, pr, nodeId }: Props) {
  const qc = useQueryClient();
  const open = pr.state === "open";
  const closed = pr.state === "closed" && !pr.merged;
  const merged = pr.merged === true;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pull", owner, repo, number] });
    qc.invalidateQueries({ queryKey: ["prs"] });
    // The dashboard/inbox isn't under ["prs"] — refresh it too (e.g. merging a
    // stacked PR must drop it out of "Ready to merge"/"Awaiting review").
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const setState = useMutation({
    mutationFn: (openNow: boolean) =>
      invoke("gh_set_pr_state", { owner, repo, number, open: openNow }),
    onSuccess: (_data, openNow) => {
      invalidate();
      if (openNow) {
        toast.success("PR reopened");
      } else {
        // Closing is recoverable — offer a one-click Undo that re-opens via the
        // same mutation.
        toast.success("Pull request closed", {
          action: { label: "Undo", onClick: () => setState.mutate(true) },
        });
      }
    },
    onError: toastError,
  });

  const setDraft = useMutation({
    mutationFn: (draft: boolean) => {
      if (!nodeId) {
        return Promise.reject(new Error("PR node id not loaded yet"));
      }
      return invoke("gh_set_draft", { prNodeId: nodeId, draft });
    },
    onSuccess: () => {
      invalidate();
      toast.success(pr.draft ? "Marked ready for review" : "Converted to draft");
    },
    onError: toastError,
  });

  const updateBranch = useMutation({
    mutationFn: () => invoke("gh_update_branch", { owner, repo, number }),
    onSuccess: () => {
      invalidate();
      toast.success("Branch updated from base");
    },
    onError: toastError,
  });

  const merge = useMutation({
    mutationFn: (method: MergeMethod) => invoke("gh_merge_pr", { owner, repo, number, method }),
    onSuccess: () => {
      invalidate();
      toast.success("PR merged");
    },
    onError: toastError,
  });

  const autoMerge = useMutation({
    mutationFn: (method: MergeMethod) => {
      if (!nodeId) return Promise.reject(new Error("PR node id not loaded yet"));
      return invoke("gh_enable_auto_merge", { prNodeId: nodeId, method });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Auto-merge enabled — merges once checks and reviews pass");
    },
    onError: toastError,
  });

  const disableAutoMerge = useMutation({
    mutationFn: () => {
      if (!nodeId) return Promise.reject(new Error("PR node id not loaded yet"));
      return invoke("gh_disable_auto_merge", { prNodeId: nodeId });
    },
    onSuccess: () => {
      invalidate();
      toast.success("Auto-merge disabled");
    },
    onError: toastError,
  });

  const autoMergeOn = pr.auto_merge != null;

  // Preferred merge method, persisted — pre-selected for both auto-merge and
  // "Merge now" so the viewer's choice sticks instead of always being "squash".
  const preferredMethod = useMergePrefs((s) => s.method);
  const setPreferredMethod = useMergePrefs((s) => s.setMethod);

  const [mergeMenu, setMergeMenu] = useState(false);
  const [moreMenu, setMoreMenu] = useState(false);
  const [reviewersOpen, setReviewersOpen] = useState(false);
  // "Merge now" is immediate + irreversible — confirm with an in-app dialog
  // (replaces the blocking window.confirm). Holds the method to merge with.
  const [confirmMerge, setConfirmMerge] = useState<MergeMethod | null>(null);

  // "Resolve conflicts with AI" — runs in your local clone of this repo, if any.
  const localRepo = useLocalRepos((s) =>
    s.repos.find((r) => `${r.owner}/${r.repo}` === `${owner}/${repo}`),
  );
  const resolveConflicts = useMutation({
    mutationFn: () =>
      invoke<string>("gh_resolve_conflicts_ai", {
        path: localRepo?.path ?? "",
        number,
        base: pr.base.ref,
      }),
    onSuccess: () => {
      toast.success("Conflicts resolved · pushed", {
        description: "The PR branch was updated — re-checking mergeability.",
      });
      invalidate();
    },
    onError: (e) => toast.error("AI couldn't resolve the conflicts", { description: String(e) }),
  });
  async function runResolveConflicts() {
    if (!localRepo) {
      toast.error(`Clone ${owner}/${repo} locally first`, {
        description: "Add it in the Repositories tab so the AI can work in your checkout.",
      });
      return;
    }
    const ok = await confirmDialog(
      `Let AI resolve the conflicts in this PR and push?\n\nIt works in your local clone:\n${localRepo.path}\n\nThe agent merges the base, resolves every conflict, runs your build/tests, commits the merge, and pushes to the PR branch.`,
      { title: "Resolve conflicts with AI", kind: "warning" },
    );
    if (ok) resolveConflicts.mutate();
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Primary action. Clicking opens a menu — never an instant merge.
          Auto-merge (waits for checks + required reviews) is the recommended
          path; "Merge now" is a deliberate, explicit choice below it. */}
      {open && !pr.draft && pr.mergeable === false && (
        <Button
          size="sm"
          variant="secondary"
          loading={resolveConflicts.isPending}
          onClick={runResolveConflicts}
          aria-label="Resolve conflicts with AI"
        >
          <Bot className="size-3.5" />
          Resolve with AI
        </Button>
      )}
      {open && !pr.draft && (
        <div className="relative">
          <Button
            size="sm"
            variant="secondary"
            disabled={pr.mergeable === false}
            loading={merge.isPending || autoMerge.isPending || disableAutoMerge.isPending}
            onClick={() => setMergeMenu((v) => !v)}
            aria-label={
              pr.mergeable === false
                ? "PR has conflicts and can't be merged"
                : autoMergeOn
                  ? "Auto-merge is enabled"
                  : "Merge options"
            }
          >
            <GitMerge className="size-3.5" />
            {pr.mergeable === false ? "Conflicts" : "Merge"}
            {autoMergeOn && (
              <span className="size-1.5 rounded-full bg-primary" aria-label="Auto-merge enabled" />
            )}
            <ChevronDown className="size-3" />
          </Button>
          {mergeMenu && (
            <PopoverPanel onClose={() => setMergeMenu(false)} width="w-60">
              <p className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">Auto-merge</p>
              {autoMergeOn ? (
                <>
                  <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-success">
                    <Check className="size-3" />
                    Enabled
                    {pr.auto_merge?.merge_method
                      ? ` · ${pr.auto_merge.merge_method.toLowerCase()}`
                      : ""}
                  </p>
                  <MenuButton
                    icon={X}
                    disabled={!nodeId}
                    onClick={() => {
                      disableAutoMerge.mutate();
                      setMergeMenu(false);
                    }}
                  >
                    Disable auto-merge
                  </MenuButton>
                </>
              ) : (
                <MenuButton
                  icon={Sparkles}
                  disabled={!nodeId}
                  onClick={() => {
                    autoMerge.mutate(preferredMethod);
                    setMergeMenu(false);
                  }}
                >
                  Enable auto-merge
                  <span className="ml-auto text-muted-foreground">{preferredMethod}</span>
                </MenuButton>
              )}
              <p className="mt-1 border-t border-border/30 px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
                Merge now
              </p>
              {orderByPreferred(preferredMethod).map((m) => (
                <MenuButton
                  key={m}
                  icon={m === preferredMethod ? Check : GitMerge}
                  onClick={() => {
                    // "Merge now" is immediate + irreversible — confirm via the
                    // in-app AlertDialog instead of a blocking window.confirm.
                    setConfirmMerge(m);
                    setMergeMenu(false);
                  }}
                >
                  {m === "merge"
                    ? "Create a merge commit"
                    : m === "squash"
                      ? "Squash and merge"
                      : "Rebase and merge"}
                </MenuButton>
              ))}
            </PopoverPanel>
          )}
        </div>
      )}

      {open && pr.draft && (
        <Button
          size="sm"
          variant="default"
          onClick={() => setDraft.mutate(false)}
          disabled={!nodeId || setDraft.isPending}
        >
          <Sparkles className="size-3.5" />
          Ready for review
        </Button>
      )}

      {closed && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setState.mutate(true)}
          loading={setState.isPending}
        >
          <CircleOff className="size-3.5" />
          Reopen
        </Button>
      )}

      {/* Overflow */}
      <div className="relative">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setMoreMenu((v) => !v)}
          aria-label="More actions"
        >
          <MoreHorizontal className="size-4" />
        </Button>
        {moreMenu && (
          <PopoverPanel onClose={() => setMoreMenu(false)} width="w-48">
            {open && (
              <MenuButton
                icon={UserPlus}
                onClick={() => {
                  setMoreMenu(false);
                  setReviewersOpen(true);
                }}
              >
                Request reviewers
              </MenuButton>
            )}
            {open && !pr.draft && (
              <MenuButton
                icon={CircleDashed}
                disabled={!nodeId || setDraft.isPending}
                onClick={() => {
                  setDraft.mutate(true);
                  setMoreMenu(false);
                }}
              >
                Mark as draft
              </MenuButton>
            )}
            {open && (
              <MenuButton
                icon={RefreshCw}
                onClick={() => {
                  updateBranch.mutate();
                  setMoreMenu(false);
                }}
              >
                Update branch
              </MenuButton>
            )}
            <MenuButton
              icon={ExternalLink}
              onClick={() => {
                safeOpenUrl(pr.html_url);
                setMoreMenu(false);
              }}
            >
              Open on GitHub
            </MenuButton>
            {open && (
              <MenuButton
                icon={XCircle}
                destructive
                onClick={() => {
                  setState.mutate(false);
                  setMoreMenu(false);
                }}
              >
                Close pull request
              </MenuButton>
            )}
            {merged && (
              <p className="px-2 py-1 text-xs text-muted-foreground">This PR is merged.</p>
            )}
          </PopoverPanel>
        )}
      </div>

      <ReviewerPicker
        owner={owner}
        repo={repo}
        number={number}
        open={reviewersOpen}
        onOpenChange={setReviewersOpen}
      />

      <AlertDialog
        open={confirmMerge != null}
        onOpenChange={(o) => {
          if (!o) setConfirmMerge(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge #{number} now?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMerge === "merge"
                ? "Create a merge commit"
                : confirmMerge === "rebase"
                  ? "Rebase and merge"
                  : "Squash and merge"}{" "}
              immediately. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" size="sm" />}>
              Cancel
            </AlertDialogClose>
            <Button
              size="sm"
              onClick={() => {
                if (confirmMerge) {
                  // Remember the chosen method so it's pre-selected next time.
                  setPreferredMethod(confirmMerge);
                  merge.mutate(confirmMerge);
                }
                setConfirmMerge(null);
              }}
            >
              <GitMerge className="size-3.5" />
              Merge now
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

/** Preferred method first, then the rest in their canonical order. */
function orderByPreferred(preferred: MergeMethod): MergeMethod[] {
  const all: MergeMethod[] = ["squash", "merge", "rebase"];
  return [preferred, ...all.filter((m) => m !== preferred)];
}

function MenuButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  destructive,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.04] disabled:opacity-50",
        destructive ? "text-destructive" : "text-foreground",
      )}
    >
      <Icon className="size-3 opacity-70" />
      {children}
    </button>
  );
}
