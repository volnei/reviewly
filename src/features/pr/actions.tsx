import { toast } from "@/app/toast";
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
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { isNative } from "@/effect/Tauri";
import { type AppServices, run, useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { Git } from "@/effect/services/Git";
import { GitHub, type MergeMethod, type PrRef } from "@/effect/services/GitHub";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import { copyNamedLink } from "@/lib/clipboard";
import { syncPrs } from "@/lib/pr-sync";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { Ellipsis, GitMerge } from "lucide-react";
import { useCallback, useState } from "react";
import { isReviewablePull } from "./model";

const METHODS: ReadonlyArray<{ value: MergeMethod; label: string; hint: string }> = [
  { value: "squash", label: "Squash", hint: "one commit on the base" },
  { value: "merge", label: "Merge commit", hint: "the branch as it is" },
  { value: "rebase", label: "Rebase", hint: "its commits replayed on the base" },
];

type Fx = Effect.Effect<unknown, unknown, AppServices>;

/**
 * Everything with consequences that isn't the decision: words, in one menu,
 * with a dialog where it can't be undone. The menu changes with the PR's state
 * instead of greying things out.
 */
export function MoreMenu({
  prRef,
  pull,
  clone,
  stack,
  primaryMerge = false,
  onRefresh,
  onMerged,
}: {
  prRef: PrRef;
  pull: S.PullDetail;
  /** GitHub's stack this PR is a layer of, when it is one: merging goes through the async endpoint. */
  stack: S.PullStack | null;
  /** An approval just landed: keep the reviewer here and promote merge from the overflow menu. */
  primaryMerge?: boolean;
  /** The local clone, when Settings → Local knows one. */
  clone: string | null;
  onRefresh: () => Promise<unknown>;
  onMerged: () => void;
}) {
  const qc = useQueryClient();
  const node = useEffectQuery(
    ["pr-node", prRef.owner, prRef.repo, prRef.number],
    Effect.flatMap(GitHub, (g) => g.nodeId(prRef)),
    { staleTime: Number.POSITIVE_INFINITY },
  );
  const editors = useEffectQuery(
    ["editors"],
    Effect.flatMap(Git, (g) => g.editorTargets),
    { staleTime: Number.POSITIVE_INFINITY, enabled: !!clone },
  );
  const method = usePrefs((p) => p.mergeMethod);
  const hideWs = usePrefs((p) => p.hideWhitespace);
  const wrap = usePrefs((p) => p.wrapLines);
  const [merge, setMerge] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const merged = pull.merged === true;
  const open = isReviewablePull(pull);
  const autoOn = pull.auto_merge != null;
  const nodeId = node.data;
  const editorList = editors.data ?? [];

  const act = useCallback(
    async (label: string, fx: Fx, done: string, refresh = true) => {
      setBusy(label);
      try {
        await run(fx);
        if (refresh) {
          await onRefresh();
          if (isNative()) void syncPrs(qc, [`${prRef.owner}/${prRef.repo}`]);
          else void qc.invalidateQueries({ queryKey: ["inbox"] });
        }
        toast.done(done);
        return true;
      } catch (e) {
        toast.fail(`${label} didn’t go through`, e);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onRefresh, prRef.owner, prRef.repo, qc],
  );

  const gh = <A,>(f: (g: GitHub["Service"]) => Effect.Effect<A, unknown, never>) =>
    Effect.flatMap(GitHub, f);
  const git = <A,>(f: (g: Git["Service"]) => Effect.Effect<A, unknown, never>) =>
    Effect.flatMap(Git, f);

  return (
    <>
      {primaryMerge && open && !pull.draft ? (
        <Button
          variant="default"
          size="sm"
          type="button"
          disabled={pull.mergeable === false || busy !== null}
          onClick={() => setMerge(true)}
          title={pull.mergeable === false ? "Resolve merge conflicts first" : "Merge pull request"}
        >
          <GitMerge className="size-3.5" aria-hidden />
          Merge
        </Button>
      ) : null}
      <Menu>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                aria-label="More actions"
                disabled={busy !== null}
                className="grid size-7 place-items-center rounded-md text-ink-2 hover:bg-raise hover:text-ink data-[popup-open]:bg-raise data-[popup-open]:text-ink disabled:opacity-40"
              />
            }
          >
            <Ellipsis className="size-4" strokeWidth={1.75} />
          </TooltipTrigger>
          <TooltipPopup>More actions</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" className="min-w-60 border-edge bg-popover text-[13px]">
          {open && !pull.draft ? (
            <MenuItem disabled={pull.mergeable === false} onClick={() => setMerge(true)}>
              Merge…
              {pull.mergeable === false ? (
                <span className="ml-auto text-[12px] text-ink-3">has conflicts</span>
              ) : null}
            </MenuItem>
          ) : null}
          {open && !pull.draft ? (
            autoOn ? (
              <MenuItem
                disabled={!nodeId}
                onClick={() =>
                  nodeId &&
                  act(
                    "Auto-merge",
                    gh((g) => g.disableAutoMerge(nodeId)),
                    "Auto-merge is off",
                  )
                }
              >
                Turn auto-merge off
              </MenuItem>
            ) : (
              <MenuItem
                disabled={!nodeId}
                onClick={() =>
                  nodeId &&
                  act(
                    "Auto-merge",
                    gh((g) => g.enableAutoMerge(nodeId, method)),
                    "Merges itself once checks and reviews pass",
                  )
                }
              >
                Auto-merge when checks pass
                <span className="ml-auto text-[12px] text-ink-3">{method}</span>
              </MenuItem>
            )
          ) : null}
          {open ? (
            <MenuItem
              onClick={() =>
                act(
                  "Update branch",
                  gh((g) => g.updateBranch(prRef)),
                  `Brought ${pull.base.ref} into the branch`,
                )
              }
            >
              Update branch from {pull.base.ref}
            </MenuItem>
          ) : null}
          {open ? (
            <MenuItem
              disabled={!nodeId}
              onClick={() =>
                nodeId &&
                act(
                  pull.draft ? "Ready for review" : "Mark as draft",
                  gh((g) => g.setDraft(nodeId, !pull.draft)),
                  pull.draft ? "Ready for review" : "It’s a draft now",
                )
              }
            >
              {pull.draft ? "Ready for review" : "Mark as draft"}
            </MenuItem>
          ) : null}
          {open && pull.mergeable === false && clone ? (
            <MenuItem onClick={() => setResolving(true)}>
              Resolve conflicts with the model…
            </MenuItem>
          ) : null}
          {open ? <MenuSeparator /> : null}
          {clone ? (
            <MenuItem
              onClick={() =>
                act(
                  "Checkout",
                  git((g) => g.checkoutPr(clone, prRef.number)),
                  `Checked out in ${clone.split("/").pop()}`,
                  false,
                )
              }
            >
              Check out locally
            </MenuItem>
          ) : null}
          {clone && editorList.length === 1 ? (
            <MenuItem
              onClick={() =>
                act(
                  "Open in editor",
                  git((g) => g.openEditor(clone, editorList[0].id)),
                  `Opened in ${editorList[0].label}`,
                  false,
                )
              }
            >
              Open in {editorList[0].label}
            </MenuItem>
          ) : clone && editorList.length > 1 ? (
            <MenuSub>
              <MenuSubTrigger>Open in editor</MenuSubTrigger>
              <MenuSubPopup className="border-edge bg-popover text-[13px]">
                {editorList.map((t) => (
                  <MenuItem
                    key={t.id}
                    onClick={() =>
                      act(
                        "Open in editor",
                        git((g) => g.openEditor(clone, t.id)),
                        `Opened in ${t.label}`,
                        false,
                      )
                    }
                  >
                    {t.label}
                    {t.isDefault ? (
                      <span className="ml-auto text-[12px] text-ink-3">default</span>
                    ) : null}
                  </MenuItem>
                ))}
              </MenuSubPopup>
            </MenuSub>
          ) : null}
          <MenuCheckboxItem
            checked={hideWs}
            onCheckedChange={(v) => prefsStore.update((p) => ({ ...p, hideWhitespace: v }))}
          >
            Hide whitespace changes
          </MenuCheckboxItem>
          <MenuCheckboxItem
            checked={wrap}
            onCheckedChange={(v) => prefsStore.update((p) => ({ ...p, wrapLines: v }))}
          >
            Wrap long lines
          </MenuCheckboxItem>
          <MenuSeparator />
          <MenuItem
            onClick={() =>
              copyNamedLink(pull.title, pull.html_url)
                .then(() => toast.say("Link copied"))
                .catch(() => toast.fail("Couldn’t copy the link"))
            }
          >
            Copy link
          </MenuItem>
          <MenuItem onClick={() => void onRefresh()}>Refresh</MenuItem>
          <MenuSeparator />
          {open ? (
            <MenuItem
              onClick={async () => {
                const ok = await act(
                  "Close",
                  gh((g) => g.setState(prRef, false)),
                  "Closed",
                );
                if (ok)
                  toast.act("Pull request closed", "Reopen", () =>
                    act(
                      "Reopen",
                      gh((g) => g.setState(prRef, true)),
                      "Reopened",
                    ),
                  );
              }}
            >
              Close pull request
            </MenuItem>
          ) : !merged ? (
            <MenuItem
              onClick={() =>
                act(
                  "Reopen",
                  gh((g) => g.setState(prRef, true)),
                  "Reopened",
                )
              }
            >
              Reopen pull request
            </MenuItem>
          ) : (
            <MenuItem disabled>Merged</MenuItem>
          )}
        </MenuPopup>
      </Menu>
      <AlertDialog open={resolving} onOpenChange={setResolving}>
        <AlertDialogPopup className="max-w-[480px] rounded-xl border-edge bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-medium text-ink">
              Resolve the conflicts with the model?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px] text-ink-3">
              In your clone it checks out #{pull.number}, merges{" "}
              <span className="mono">{pull.base.ref}</span>, edits every conflict keeping both
              sides’ intent, runs the build and the tests, commits the merge and pushes to the
              branch. It needs push access. The clone:{" "}
              <span className="mono text-ink-2">{clone}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogClose className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:bg-raise">
              Not yet
            </AlertDialogClose>
            <button
              type="button"
              onClick={() => {
                setResolving(false);
                if (clone)
                  void act(
                    "Resolving conflicts",
                    gh((g) => g.resolveConflicts(clone, prRef.number, pull.base.ref)),
                    "Conflicts resolved and pushed",
                  );
              }}
              className="h-7 rounded-md border border-ink bg-ink px-3 text-[12.5px] font-medium text-[#141414]"
            >
              Resolve and push
            </button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
      <MergeDialog
        open={merge}
        onOpenChange={setMerge}
        pull={pull}
        stack={stack}
        busy={busy === "Merge"}
        onConfirm={async (m, title) => {
          prefsStore.update((p) => ({ ...p, mergeMethod: m }));
          const ok = stack
            ? await act("Merge", mergeStacked(prRef, m, title), "Merged")
            : await act(
                "Merge",
                gh((g) => g.merge(prRef, m, title)),
                "Merged",
              );
          if (ok) {
            setMerge(false);
            onMerged();
          }
        }}
      />
    </>
  );
}

/**
 * A stacked PR merges in the background: start it, then poll until GitHub
 * says merged, enqueued (a merge queue took it) or failed.
 */
const mergeStacked = (prRef: PrRef, method: MergeMethod, title: string | undefined) =>
  Effect.gen(function* () {
    const g = yield* GitHub;
    const id = yield* g.mergeAsync(prRef, method, title);
    if (!id) return;
    for (let i = 0; i < 60; i++) {
      const s = yield* g.mergeAsyncStatus(prRef, id);
      if (s.status === "merged" || s.status === "enqueued") return;
      if (s.status === "failed")
        return yield* Effect.fail(new Error(s.message ?? "GitHub refused the merge"));
      yield* Effect.sleep("1500 millis");
    }
    return yield* Effect.fail(
      new Error("GitHub is still merging; check the pull request in a moment"),
    );
  });

/** Merging can't be undone, so it gets a dialog: the method, remembered, and the commit title. */
function MergeDialog({
  open,
  onOpenChange,
  pull,
  stack,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pull: S.PullDetail;
  stack: S.PullStack | null;
  busy: boolean;
  onConfirm: (method: MergeMethod, title: string | undefined) => void;
}) {
  const remembered = usePrefs((p) => p.mergeMethod);
  const [method, setMethod] = useState<MergeMethod>(remembered);
  // Merging a layer lands every unmerged layer below it too.
  const idx = stack ? stack.pull_requests.findIndex((l) => l.number === pull.number) : -1;
  const below = stack
    ? stack.pull_requests
        .slice(0, Math.max(0, idx))
        .filter((l) => !l.merged_at && l.state === "open")
    : [];
  const [title, setTitle] = useState("");
  const placeholder =
    method === "squash" ? `${pull.title} (#${pull.number})` : "GitHub’s own merge message";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[520px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">
            Merge #{pull.number}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-ink-3">
            <span className="mono">{pull.head.ref}</span> into{" "}
            <span className="mono">{pull.base.ref}</span>. This one can’t be undone.
            {stack
              ? ` A layer of a stack onto ${stack.base.ref}: GitHub merges it in the background, and the layers above rebase and retarget themselves.`
              : ""}
            {below.length ? (
              <>
                {" "}
                <span className="text-ink">
                  This also lands {below.map((l) => `#${l.number}`).join(" and ")}.
                </span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3 px-6">
          <div role="radiogroup" aria-label="How" className="grid gap-1">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                onClick={() => setMethod(m.value)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md border px-2.5 text-left text-[12.5px]",
                  method === m.value
                    ? "border-edge bg-raise text-ink"
                    : "border-transparent text-ink-2 hover:bg-raise/60",
                )}
              >
                {m.label}
                <span className="text-ink-3">{m.hint}</span>
              </button>
            ))}
          </div>
          {method !== "rebase" ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={placeholder}
              className="selectable h-8 w-full rounded-md border border-input bg-sink px-2.5 font-sans text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
              onKeyDown={(e) => e.stopPropagation()}
            />
          ) : null}
        </DialogPanel>
        <DialogFooter className="px-6 pb-5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:bg-raise"
          >
            Not yet
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(method, title.trim() || undefined)}
            className="h-7 rounded-md border border-ink bg-ink px-3 text-[12.5px] font-medium text-[#141414] disabled:opacity-50"
          >
            {busy
              ? stack
                ? "Merging the layer…"
                : "Merging…"
              : below.length
                ? `Merge ${below.length + 1} layers`
                : "Merge"}
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
