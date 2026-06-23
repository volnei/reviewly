import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PopoverItem, PopoverPanel } from "@/components/popover";
import { TooltipFor } from "@/components/tooltip-for";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { readPrs } from "@/lib/prs-db";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { type LocalRepo, parseGitRemote, useLocalRepos } from "@/stores/local-repos";
import { usePrFilters } from "@/stores/pr-filters";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Code2,
  DownloadCloud,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Github,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface RepoInfo {
  remoteUrl: string | null;
  currentBranch: string;
  dirty: boolean;
}

/** One row in the unified list — a repo you watch and/or have cloned. */
interface RepoItem {
  slug: string;
  owner: string;
  repo: string;
  local: LocalRepo | null;
  watched: boolean;
}

export function ReposPage() {
  const localRepos = useLocalRepos((s) => s.repos);
  const addLocal = useLocalRepos((s) => s.add);
  const removeLocal = useLocalRepos((s) => s.remove);
  const watched = useWatchedRepos((s) => s.repos);
  const toggleWatch = useWatchedRepos((s) => s.toggle);
  const [cloningSlug, setCloningSlug] = useState<string | null>(null);

  // The page shows the union of repos you watch and repos you've cloned — so a
  // watched-but-not-cloned repo still gets a card (with a Clone button), and a
  // clone you've stopped watching doesn't vanish.
  const items = useMemo<RepoItem[]>(() => {
    const localBySlug = new Map(localRepos.map((r) => [`${r.owner}/${r.repo}`, r]));
    const watchedSet = new Set(watched);
    const slugs = new Set<string>([...watched, ...localBySlug.keys()]);
    return [...slugs]
      .map((slug) => {
        const [owner, repo] = slug.split("/");
        return {
          slug,
          owner,
          repo,
          local: localBySlug.get(slug) ?? null,
          watched: watchedSet.has(slug),
        };
      })
      .sort((a, b) => {
        // Cloned first (richer card), then alphabetical.
        if (!!a.local !== !!b.local) return a.local ? -1 : 1;
        return a.slug.localeCompare(b.slug);
      });
  }, [localRepos, watched]);

  const clonedCount = items.filter((i) => i.local).length;

  /** Bind a freshly cloned/associated folder: register the clone and watch it. */
  async function bind(path: string) {
    const info = await invoke<RepoInfo>("git_repo_info", { path });
    const parsed = info.remoteUrl ? parseGitRemote(info.remoteUrl) : null;
    if (!parsed) {
      toast.error("That folder isn't a GitHub clone (no github.com origin).");
      return;
    }
    const slug = `${parsed.owner}/${parsed.repo}`;
    addLocal({ path, owner: parsed.owner, repo: parsed.repo, remoteUrl: info.remoteUrl ?? "" });
    if (!useWatchedRepos.getState().repos.includes(slug)) toggleWatch(slug);
    toast.success(`Added ${slug}`);
  }

  async function associate() {
    try {
      const picked = await open({ directory: true, title: "Select a cloned repository" });
      if (!picked || typeof picked !== "string") return;
      await bind(picked);
    } catch (e) {
      toast.error(`Not a git repository — ${String(e)}`);
    }
  }

  /** Clone `owner/repo` (or a raw git URL) into a chosen folder, then bind it. */
  async function clone(target: string) {
    const url = /^(https?:\/\/|git@|ssh:\/\/)/.test(target)
      ? target
      : `https://github.com/${target}.git`;
    const slug = target.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    try {
      const parentDir = await open({ directory: true, title: "Clone into…" });
      if (!parentDir || typeof parentDir !== "string") return;
      setCloningSlug(slug);
      const dest = await invoke<string>("git_clone", { url, parentDir });
      await bind(dest);
    } catch (e) {
      toast.error(`Clone failed — ${String(e)}`);
    } finally {
      setCloningSlug(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Repositories"
        subtitle={
          items.length === 0
            ? "Watch the repos you review — your PR lists are scoped to them"
            : `${watched.length} watched · ${clonedCount} cloned`
        }
        actions={
          <AddRepoMenu
            watchedSet={new Set(watched)}
            onWatch={toggleWatch}
            onCloneUrl={clone}
            onAssociate={associate}
          />
        }
      />
      <ScrollArea className="flex-1">
        {items.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title="No repositories yet"
            description="Add the repos you review. Your pull-request lists and dashboard are scoped to them — clone any one to review its code locally."
          />
        ) : (
          <div className="grid gap-4 px-6 py-4 md:grid-cols-2 2xl:grid-cols-3">
            {items.map((item) => (
              <RepoCard
                key={item.slug}
                item={item}
                cloning={cloningSlug === item.slug}
                onToggleWatch={() => toggleWatch(item.slug)}
                onClone={() => clone(item.slug)}
                onRemoveClone={() => item.local && removeLocal(item.local.path)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/**
 * "Add repository" — watch repos you review (clone is optional, per-card later),
 * clone a git URL straight away, or associate an existing local folder.
 */
function AddRepoMenu({
  watchedSet,
  onWatch,
  onCloneUrl,
  onAssociate,
}: {
  watchedSet: Set<string>;
  onWatch: (slug: string) => void;
  onCloneUrl: (url: string) => void;
  onAssociate: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ghRepos = useQuery({
    queryKey: ["repos"],
    queryFn: () => invoke<string[]>("gh_list_repos"),
    enabled: menuOpen,
    staleTime: 5 * 60_000,
  });
  const q = query.trim();
  const isUrl = /^(https?:\/\/|git@|ssh:\/\/)/.test(q) || q.endsWith(".git");
  const list = useMemo(() => {
    const all = ghRepos.data ?? [];
    if (isUrl) return [];
    const f = q.toLowerCase();
    return f ? all.filter((r) => r.toLowerCase().includes(f)) : all;
  }, [ghRepos.data, q, isUrl]);

  return (
    <div className="relative">
      <Button size="sm" onClick={() => setMenuOpen((v) => !v)}>
        <Plus className="size-3.5" />
        Add repository
      </Button>
      {menuOpen && (
        <PopoverPanel onClose={() => setMenuOpen(false)} width="w-80">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Watch a repo, or paste a git URL to clone…"
            size="sm"
            className="mb-1.5 w-full"
          />
          {isUrl ? (
            <PopoverItem
              icon={DownloadCloud}
              onClick={() => {
                onCloneUrl(q);
                setMenuOpen(false);
              }}
            >
              Clone {q}
            </PopoverItem>
          ) : (
            <ul className="max-h-64 space-y-0.5 overflow-y-auto">
              {ghRepos.isLoading ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">Loading your repos…</li>
              ) : list.length === 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  No repositories found.
                </li>
              ) : (
                // Toggle watch; keep the menu open so you can pick several at once.
                list
                  .slice(0, 200)
                  .map((full) => (
                    <PopoverItem
                      key={full}
                      checked={watchedSet.has(full)}
                      onClick={() => onWatch(full)}
                    >
                      {full}
                    </PopoverItem>
                  ))
              )}
            </ul>
          )}
          <div className="mt-1 border-t border-hairline pt-1">
            <PopoverItem
              icon={FolderOpen}
              onClick={() => {
                onAssociate();
                setMenuOpen(false);
              }}
            >
              Associate an existing folder…
            </PopoverItem>
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}

function RepoCard({
  item,
  cloning,
  onToggleWatch,
  onClone,
  onRemoveClone,
}: {
  item: RepoItem;
  cloning: boolean;
  onToggleWatch: () => void;
  onClone: () => void;
  onRemoveClone: () => void;
}) {
  const navigate = useNavigate();
  const { slug, owner, local, watched } = item;

  // Live git status (branch + dirty) — only meaningful for a clone on disk.
  const info = useQuery({
    queryKey: ["git-repo-info", local?.path],
    queryFn: () => invoke<RepoInfo>("git_repo_info", { path: local?.path ?? "" }),
    enabled: Boolean(local?.path),
    staleTime: 15_000,
    retry: false,
  });
  // Open-PR count, straight from the local DB (works even before you clone).
  const openPrs = useQuery({
    queryKey: ["repo-open-count", slug],
    queryFn: async () => (await readPrs([slug], "open")).length,
    staleTime: 30_000,
  });

  // Click the PR count → the list, pre-filtered to this repo.
  function browsePrs() {
    usePrFilters.getState().clearRepos();
    usePrFilters.getState().toggleRepo(slug);
    navigate({ to: "/prs" });
  }

  return (
    <div className={cnCard(watched, Boolean(local))}>
      {/* Cloned cards open the local workspace on click; un-cloned ones don't. */}
      {local && (
        <Link
          to="/repos/$owner/$repo"
          params={{ owner: local.owner, repo: local.repo }}
          aria-label={`Open ${slug}`}
          className="absolute inset-0 z-0 rounded-2xl"
        />
      )}

      <div className="pointer-events-none relative flex items-start gap-3">
        <img
          src={`https://github.com/${owner}.png?size=72`}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded-lg bg-foreground/[0.06] object-cover ring-1 ring-hairline"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{slug}</p>
          {local ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground">{local.path}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground/70">Not cloned</p>
          )}
        </div>
        {/* Watch switch — always visible; the name keeps the full row width. */}
        <TooltipFor
          label={
            watched ? "Watching — included in your PR lists" : "Watch — include in your PR lists"
          }
        >
          <Switch
            checked={watched}
            onCheckedChange={onToggleWatch}
            label={`Watch ${slug}`}
            className="pointer-events-auto relative z-10 shrink-0"
          />
        </TooltipFor>
      </div>

      <div className="pointer-events-none relative flex items-center justify-between gap-2">
        {/* Left: branch chip when cloned, otherwise a Clone call-to-action. */}
        {local ? (
          info.isError ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">
              folder missing
            </span>
          ) : (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{info.data?.currentBranch || "—"}</span>
              {info.data?.dirty && (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-warning"
                  aria-label="Uncommitted changes"
                />
              )}
            </span>
          )
        ) : (
          <Button
            size="sm"
            variant="outline"
            loading={cloning}
            onClick={onClone}
            className="pointer-events-auto relative z-10 h-6 shrink-0 px-2 text-[11px]"
          >
            <DownloadCloud className="size-3.5" />
            Clone
          </Button>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          {/* Quiet action icons, revealed on hover. */}
          <div className="pointer-events-auto relative z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <TooltipFor label="Open on GitHub">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Open on GitHub"
                onClick={() => safeOpenUrl(`https://github.com/${slug}`)}
              >
                <Github className="size-4" />
              </Button>
            </TooltipFor>
            {local && (
              <>
                <TooltipFor label="Open in VS Code">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Open in VS Code"
                    onClick={() =>
                      openPath(local.path, "Visual Studio Code").catch(() =>
                        toast.error("Couldn't open the editor — is VS Code installed?"),
                      )
                    }
                  >
                    <Code2 className="size-4" />
                  </Button>
                </TooltipFor>
                <TooltipFor label="Reveal in Finder">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Reveal in Finder"
                    onClick={() => void revealItemInDir(local.path).catch(() => {})}
                  >
                    <FolderOpen className="size-4" />
                  </Button>
                </TooltipFor>
                <TooltipFor label="Refresh git status">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Refresh git status"
                    loading={info.isFetching}
                    onClick={() => info.refetch()}
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                </TooltipFor>
                <TooltipFor label="Remove local clone">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove local clone"
                    onClick={onRemoveClone}
                  >
                    <X className="size-4" />
                  </Button>
                </TooltipFor>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={browsePrs}
            className="pointer-events-auto relative z-10 inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="font-display tabular-nums text-foreground">{openPrs.data ?? 0}</span>
            open PR{openPrs.data === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Card shell — a subtle ring when watched, dimmed a touch when not cloned. */
function cnCard(watched: boolean, cloned: boolean): string {
  return [
    "group relative flex flex-col gap-3.5 rounded-2xl border p-5 transition-colors hover:bg-card/70",
    watched ? "border-primary/30 bg-card/60" : "border-hairline bg-card/40",
    !cloned && "opacity-95",
    "hover:border-border",
  ]
    .filter(Boolean)
    .join(" ");
}
