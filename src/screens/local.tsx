import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  ArrowDownToLine,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Code,
  ExternalLink,
  FolderOpen,
  FolderPlus,
  GitBranch,
  LoaderCircle,
  Search,
} from "lucide-react";
import { useState } from "react";

import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { IconButton } from "@/components/icon-button";
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
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { type AppServices, run, useEffectQuery } from "@/effect/runtime";
import { githubWebUrl } from "@/effect/services/Auth";
import { Git } from "@/effect/services/Git";
import { GitHub } from "@/effect/services/GitHub";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import { isNative } from "@/effect/Tauri";
import { ListHead, Nothing } from "@/features/list/list";
import { toLocalId } from "@/lib/local-id";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** "owner/repo" out of a clone's remote, or null. */
const slugOf = (remote: string | null | undefined) =>
  remote
    ?.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/)
    ?.slice(1, 3)
    .join("/") ?? null;

/**
 * The checkouts on this machine: branch, how far from upstream, what is
 * uncommitted, how many pull requests are open there. Add a folder, or clone
 * by URL; open in your editor or reveal in the file manager; watch or not.
 */
export function LocalScreen() {
  useTitleSlot(<span className="text-[13px] text-ink-2">Local repositories</span>, "desk");
  const paths = usePrefs((p) => p.localRepos);
  const watched = usePrefs((p) => p.watchedRepos);
  const navigate = useNavigate();
  const [cloning, setCloning] = useState(false);
  const repos = useEffectQuery(
    ["local", paths],
    Effect.forEach(
      paths,
      (path) =>
        Effect.flatMap(Git, (g) =>
          Effect.all([
            g.repoInfo(path),
            g.status(path),
            g
              .localBranches(path)
              .pipe(
                Effect.orElseSucceed(() => ({ current: "", all: [] as ReadonlyArray<string> })),
              ),
          ]).pipe(
            Effect.map(([info, tree, branches]) => ({
              path,
              info,
              tree,
              branches,
              ok: true as const,
            })),
            Effect.orElseSucceed(() => ({
              path,
              info: null,
              tree: null,
              branches: null,
              ok: false as const,
            })),
          ),
        ),
      { concurrency: 4 },
    ),
  );
  const editors = useEffectQuery(
    ["editors"],
    Effect.flatMap(Git, (g) => g.editorTargets),
    { staleTime: Number.POSITIVE_INFINITY },
  );
  const slugs = (repos.data ?? [])
    .map((r) => slugOf(r.info?.remote_url))
    .filter(Boolean) as string[];
  const open = useEffectQuery(
    ["local-open-prs", slugs],
    Effect.forEach(
      slugs,
      (slug) => {
        const [owner, repo] = slug.split("/");
        return Effect.flatMap(GitHub, (g) => g.repoPulls(owner, repo)).pipe(
          Effect.map((ps) => [slug, ps.filter((p) => p.state === "open").length] as const),
          Effect.orElseSucceed(() => [slug, null] as const),
        );
      },
      { concurrency: 3 },
    ),
    { enabled: slugs.length > 0, staleTime: 60_000 },
  );
  const openCount = new Map(open.data ?? []);

  /** A folder becomes a clone here, and its repository is watched. */
  const adopt = (picked: string) =>
    prefsStore.update((p) => ({ ...p, localRepos: [...new Set([...p.localRepos, picked])] }));
  const add = async () => {
    if (!isNative()) {
      toast.say("Adding a folder needs the desktop app");
      return;
    }
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const picked = await pick({ directory: true, multiple: false });
    if (typeof picked === "string") adopt(picked);
  };
  const watch = (slug: string, on: boolean) =>
    prefsStore.update((p) => ({
      ...p,
      watchedRepos: on
        ? [...new Set([...p.watchedRepos, slug])]
        : p.watchedRepos.filter((w) => w !== slug),
    }));
  const reveal = async (path: string) => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch (e) {
      toast.fail("Couldn’t reveal it", e);
    }
  };
  const openIn = (path: string) => {
    const t = editors.data?.[0];
    if (!t) return;
    run(Effect.flatMap(Git, (g) => g.openEditor(path, t.id))).catch((e) =>
      toast.fail(`Couldn’t open ${t.label}`, e),
    );
  };

  return (
    <div className="h-full overflow-y-auto bg-desk scrollbar-thin">
      <div className="flex items-baseline justify-between pr-5">
        <ListHead title="Local">
          {paths.length
            ? `${paths.length} repositor${paths.length === 1 ? "y" : "ies"} on this machine.`
            : "Checkouts on this machine, and what is waiting in them."}
        </ListHead>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setCloning(true)}>
            Clone a repository
          </Button>
          <Button variant="ghost" size="sm" onClick={add}>
            <FolderPlus /> Add a folder
          </Button>
        </span>
      </div>
      {paths.length === 0 ? (
        <Nothing detail="Add a checkout or clone a repository. Reviewly will watch its branch, upstream and uncommitted work.">
          No local repositories yet
        </Nothing>
      ) : null}
      <div role="list">
        {(repos.data ?? []).map((r) => {
          const slug = slugOf(r.info?.remote_url);
          const n = slug ? openCount.get(slug) : null;
          return (
            <div
              key={r.path}
              role="listitem"
              className="group grid h-12 grid-cols-[minmax(220px,1fr)_minmax(160px,260px)_minmax(0,1fr)_auto_auto] items-center gap-5 border-b border-hair px-5 hover:bg-raise/50"
            >
              <button
                type="button"
                disabled={!r.ok}
                onClick={() =>
                  void navigate({ to: "/local/$id", params: { id: toLocalId(r.path) } })
                }
                className="flex min-w-0 flex-col items-start text-left disabled:text-ink-3"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink">
                  <span className="truncate">{r.path.split("/").pop()}</span>
                  {r.ok ? (
                    <ChevronRight className="size-3.5 shrink-0 text-ink-3" strokeWidth={2} />
                  ) : null}
                </span>
                <span className="mono truncate text-[11px] text-ink-3">{slug ?? r.path}</span>
              </button>
              <RepoGitControls
                path={r.path}
                current={r.tree?.branch ?? r.info?.current_branch ?? ""}
                branches={r.branches?.all ?? []}
                hasUpstream={r.tree?.upstream ?? false}
                disabled={!r.ok}
                onChanged={() => repos.refetch()}
              />
              <span className={cn("truncate text-[12.5px]", r.ok ? "text-ink-2" : "text-del")}>
                {!r.ok
                  ? "couldn’t read it — moved, or not a repository"
                  : r.tree
                    ? [
                        r.tree.staged.length + r.tree.unstaged.length
                          ? `${r.tree.staged.length + r.tree.unstaged.length} files uncommitted`
                          : "clean",
                        r.tree.ahead ? `${r.tree.ahead} ahead` : "",
                        r.tree.behind ? `${r.tree.behind} behind` : "",
                        r.tree.upstream ? "" : "never pushed",
                        n != null ? `${n} open pull request${n === 1 ? "" : "s"}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : ""}
              </span>
              {slug ? (
                <span className="flex items-center gap-2 text-[12px] text-ink-3">
                  watched
                  <Switch
                    checked={watched.includes(slug)}
                    onCheckedChange={(v) => watch(slug, v)}
                    aria-label={`Watch ${slug}`}
                  />
                </span>
              ) : (
                <span />
              )}
              <span className="flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                {editors.data?.[0] && r.ok ? (
                  <IconButton
                    size={6}
                    label={`Open in ${editors.data[0].label}`}
                    onClick={() => openIn(r.path)}
                  >
                    <Code className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                ) : null}
                <IconButton size={6} label="Reveal the folder" onClick={() => void reveal(r.path)}>
                  <FolderOpen className="size-3.5" strokeWidth={1.75} />
                </IconButton>
                {slug ? (
                  <IconButton
                    size={6}
                    label="Open on GitHub"
                    onClick={() => safeOpenUrl(githubWebUrl(slug))}
                  >
                    <ExternalLink className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                ) : null}
                <button
                  type="button"
                  className="h-6 rounded-md px-1.5 text-[12px] text-ink-3 hover:bg-raise hover:text-ink"
                  onClick={() =>
                    prefsStore.update((p) => ({
                      ...p,
                      localRepos: p.localRepos.filter((x) => x !== r.path),
                    }))
                  }
                >
                  Forget
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onCloned={adopt} />
    </div>
  );
}

/** Branch and sync actions stay together in the branch column, not in the row's utility tray. */
function RepoGitControls({
  path,
  current,
  branches,
  hasUpstream,
  disabled,
  onChanged,
}: {
  path: string;
  current: string;
  branches: ReadonlyArray<string>;
  hasUpstream: boolean;
  disabled: boolean;
  onChanged: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<"branch" | "pull" | null>(null);
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const visibleBranches = branches.filter((branch) =>
    branch.toLocaleLowerCase().includes(branchQuery.trim().toLocaleLowerCase()),
  );
  const act = async (
    kind: "branch" | "pull",
    effect: Effect.Effect<void, unknown, AppServices>,
  ) => {
    setBusy(kind);
    try {
      await run(effect);
      await onChanged();
      toast.done(kind === "pull" ? "Pulled" : "Branch changed");
    } catch (error) {
      toast.fail(kind === "pull" ? "Pull didn’t go through" : "Couldn’t switch branch", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <span className="flex min-w-0 items-center gap-1">
      <Popover
        open={branchMenuOpen}
        onOpenChange={(open) => {
          setBranchMenuOpen(open);
          if (!open) setBranchQuery("");
        }}
      >
        <PopoverTrigger
          disabled={disabled || busy !== null || branches.length === 0}
          aria-label={`Branch for ${path.split("/").pop() ?? path}`}
          title={current || undefined}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent px-2 text-[12.5px] text-ink-2 outline-none transition-colors hover:border-edge hover:bg-raise focus-visible:border-edge focus-visible:bg-raise disabled:pointer-events-none disabled:opacity-60"
        >
          <GitBranch className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-left">
            {busy === "branch" ? "Switching…" : current || "No branch"}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />
        </PopoverTrigger>
        <PopoverPopup
          align="start"
          className="w-[360px] max-w-[calc(100vw-24px)] [--viewport-inline-padding:--spacing(3)]"
        >
          <div className="mb-2 px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
            Switch branch
          </div>
          <label className="flex items-center gap-2 rounded-md border border-edge bg-desk/60 px-2.5 py-2 focus-within:border-ink-3/60">
            <Search className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
            <input
              autoFocus
              aria-label="Search branches"
              placeholder="Search branches…"
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </label>
          <div className="mt-2 max-h-64 overflow-y-auto overscroll-contain pr-1 scrollbar-thin">
            {visibleBranches.length ? (
              visibleBranches.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  title={branch}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink focus-visible:bg-raise focus-visible:text-ink focus-visible:outline-none"
                  onClick={() => {
                    setBranchMenuOpen(false);
                    setBranchQuery("");
                    if (branch === current) return;
                    void act(
                      "branch",
                      Effect.flatMap(Git, (g) => g.checkout(path, branch)),
                    );
                  }}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {branch === current ? (
                      <Check className="size-3.5 text-ok" strokeWidth={2} />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{branch}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-6 text-center text-[12px] text-ink-3">
                No branches match “{branchQuery.trim()}”.
              </p>
            )}
          </div>
        </PopoverPopup>
      </Popover>
      <IconButton
        size={6}
        label={hasUpstream ? `Pull ${current}` : `${current || "This branch"} has no upstream`}
        disabled={disabled || busy !== null || !hasUpstream}
        onClick={() =>
          void act(
            "pull",
            Effect.flatMap(Git, (g) => g.pull(path)),
          )
        }
      >
        {busy === "pull" ? (
          <LoaderCircle className="size-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <ArrowDownToLine className="size-3.5" strokeWidth={1.75} />
        )}
      </IconButton>
    </span>
  );
}

/** A URL and a folder to put it in; the new clone joins the list. */
function CloneDialog({
  open,
  onOpenChange,
  onCloned,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCloned: (path: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const canonical = /^[\w.-]+\/[\w.-]+$/.test(url.trim())
    ? `${githubWebUrl(url.trim())}.git`
    : url.trim();
  const go = async () => {
    if (!canonical) return;
    if (!isNative()) {
      toast.say("Cloning needs the desktop app");
      return;
    }
    const { open: pick } = await import("@tauri-apps/plugin-dialog");
    const parent = await pick({ directory: true, multiple: false, title: "Clone into…" });
    if (typeof parent !== "string") return;
    setBusy(true);
    try {
      const path = await run(Effect.flatMap(Git, (g) => g.clone(canonical, parent)));
      onCloned(path);
      onOpenChange(false);
      setUrl("");
      toast.done("Cloned", path);
    } catch (e) {
      toast.fail("The clone didn’t finish", e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[520px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">Clone a repository</DialogTitle>
          <DialogDescription className="text-[12.5px] text-ink-3">
            A git URL, or <span className="mono">owner/name</span> on GitHub. You pick the folder it
            goes in next.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3 px-6">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="git@github.com:acme/ledger-api.git"
            className="selectable mono h-8 w-full rounded-md border border-input bg-sink px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") void go();
            }}
          />
        </DialogPanel>
        <DialogFooter className="px-6 pb-5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:bg-raise"
          >
            Not now
          </button>
          <button
            type="button"
            disabled={!canonical || busy}
            onClick={() => void go()}
            className="h-7 rounded-md border border-ink bg-ink px-3 text-[12.5px] font-medium text-[#141414] disabled:opacity-50"
          >
            {busy ? "Cloning…" : "Pick a folder and clone"}
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
