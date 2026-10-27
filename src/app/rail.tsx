import { useWorkspace, useWorkspaceInbox } from "@/app/workspace";
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
import { Input } from "@/components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { isNative } from "@/effect/Tauri";
import { useAuth } from "@/effect/services/Auth";
import { usePrefs } from "@/effect/services/Prefs";
import {
  type SavedView,
  applyView,
  deleteSavedView,
  renameSavedView,
  savedViewPath,
  useSavedViews,
} from "@/features/list/filters";
import { useWorkspaceHealth } from "@/features/list/workspace";
import { actionableIssueCount, useSpecWorkspaces } from "@/features/spec-lens/model";
import { countOpenPrs } from "@/lib/prs-db";
import { problemCount } from "@/lib/turbo-health";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AtSign,
  Bookmark,
  Boxes,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  HeartPulse,
  History,
  Inbox,
  type LucideIcon,
  MoreHorizontal,
  Pencil,
  ScanSearch,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";

interface Item {
  to: string;
  label: string;
  key: string;
  icon: LucideIcon;
  count?: number;
}

export function Rail() {
  const auth = useAuth();
  const workspace = useWorkspace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const inbox = useWorkspaceInbox();
  const counts = inbox.data?.counts;
  const watched = usePrefs((p) => p.watchedRepos);
  const countedRepos = workspace ? [workspace] : watched;
  const openPulls = useQuery({
    queryKey: ["prs", "open-count", countedRepos],
    queryFn: () => countOpenPrs(countedRepos),
    enabled: isNative() && countedRepos.length > 0,
    staleTime: 60_000,
  });
  const views = useSavedViews();
  const turboWorkspaces = useWorkspaceHealth();
  const specWorkspaces = useSpecWorkspaces();
  const turboProblems = turboWorkspaces.reduce((total, repo) => total + problemCount(repo), 0);
  const specProblems = specWorkspaces.reduce(
    (total, workspace) => total + actionableIssueCount(workspace),
    0,
  );
  const items: Item[] = [
    { to: "/inbox", label: "Inbox", key: "⌘2", icon: Inbox, count: counts?.inbox },
    {
      to: "/prs",
      label: "Pull requests",
      key: "⌘3",
      icon: GitPullRequest,
      count: openPulls.data ?? counts?.prs,
    },
    { to: "/mentions", label: "Mentions", key: "⌘4", icon: AtSign, count: counts?.mentions },
    { to: "/health", label: "Health", key: "⌘5", icon: HeartPulse, count: counts?.health },
  ];
  const active = (to: string) => (to === "/" ? pathname === "/" : pathname.startsWith(to));
  return (
    <nav
      aria-label="Workspace navigation"
      className="workspace-sidebar flex shrink-0 flex-col bg-rail px-2.5 py-4"
    >
      <Link
        to="/"
        aria-current={active("/") ? "page" : undefined}
        aria-label="Home"
        className="workspace-brand"
        title="Home (⌘1)"
      >
        <span className="workspace-brand-mark">
          <img src="/reviewly-mark.svg" alt="" className="size-5" draggable={false} />
        </span>
        <span className="workspace-brand-name">Reviewly</span>
      </Link>
      <p
        className="workspace-section-label mb-2 truncate px-2 text-ink-3"
        title={workspace ?? "All repositories"}
      >
        {workspace?.split("/").pop() ?? "All repositories"}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavItem item={item} active={active(item.to)} />
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <p className="workspace-section-label mb-2 px-2 text-ink-3">Labs</p>
        {turboWorkspaces.length ? (
          <NavItem
            item={{
              to: "/turbo",
              label: "Living architecture",
              key: "G T",
              icon: Boxes,
              count: turboProblems,
            }}
            active={active("/turbo")}
          />
        ) : null}
        {specWorkspaces.length ? (
          <NavItem
            item={{
              to: "/spec-lens",
              label: "Spec Lens",
              key: "G V",
              icon: ScanSearch,
              count: specProblems,
            }}
            active={active("/spec-lens")}
          />
        ) : null}
        <NavItem
          item={{
            to: "/merge-lab",
            label: "Merge Lab",
            key: "G X",
            icon: FlaskConical,
          }}
          active={active("/merge-lab")}
        />
      </div>
      <p className="workspace-section-label mt-6 mb-2 px-2 text-ink-3">Saved views</p>
      <div className="workspace-saved min-h-0 flex-1 overflow-y-auto">
        {views.length ? (
          views.map((view) => (
            <SavedViewItem
              key={view.id}
              view={view}
              onOpen={() => {
                applyView(view);
                void navigate({ to: savedViewPath(view) });
              }}
            />
          ))
        ) : (
          <p className="px-2 text-[12px] leading-relaxed text-ink-3">
            Save your filters to create a view.
          </p>
        )}
      </div>
      <div className="mt-5 space-y-1 border-t border-hair pt-3">
        <NavItem
          item={{ to: "/history", label: "History", key: "G Y", icon: History }}
          active={active("/history")}
        />
        <NavItem
          item={{ to: "/local", label: "Local repositories", key: "⌘6", icon: FolderGit2 }}
          active={active("/local")}
        />
        <NavItem
          item={{ to: "/settings", label: "Settings", key: "⌘,", icon: Settings2 }}
          active={active("/settings")}
        />
      </div>
      {auth.viewer ? (
        <div className="workspace-user mt-5 flex items-center gap-2.5 px-2">
          <img
            src={auth.viewer.avatar_url}
            alt={`${auth.viewer.login}'s avatar`}
            className="size-7 rounded-full bg-raise"
            draggable={false}
          />
          <div className="min-w-0">
            <p className="truncate text-[12px] text-ink-2">{auth.viewer.login}</p>
            <p className="text-[11px] text-ink-3">{watched.length} repositories watched</p>
          </div>
        </div>
      ) : null}
    </nav>
  );
}

function SavedViewItem({ view, onOpen }: { view: SavedView; onOpen: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draftName, setDraftName] = useState(view.name);

  const commitRename = () => {
    if (!draftName.trim()) return;
    renameSavedView(view.id, draftName);
    setRenaming(false);
  };

  return (
    <>
      <div className="workspace-saved-row group">
        <button
          type="button"
          className="workspace-option"
          title={`Open saved view: ${view.name}`}
          onClick={onOpen}
        >
          <Bookmark className="size-3.5 shrink-0" />
          <span className="truncate">{view.name}</span>
        </button>
        <Menu>
          <MenuTrigger
            aria-label={`Actions for saved view ${view.name}`}
            className="workspace-saved-actions"
            render={<Button variant="ghost" size="icon-xs" />}
          >
            <MoreHorizontal className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" className="min-w-36 border-edge bg-popover text-[12px]">
            <MenuItem
              onClick={() => {
                setDraftName(view.name);
                setRenaming(true);
              }}
            >
              <Pencil className="size-3.5" />
              Rename
            </MenuItem>
            <MenuItem
              variant="destructive"
              className="text-[color:var(--del)] data-highlighted:text-[color:var(--del)]"
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-3.5" />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogPopup className="max-w-[400px] rounded-xl border-edge bg-popover">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-[15px] font-medium text-ink">
                Rename saved view
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-ink-3">
                Choose a name that makes this filter easy to recognize.
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="pt-0">
              <label
                htmlFor={`saved-view-name-${view.id}`}
                className="mb-2 block text-[12px] text-ink-2"
              >
                Name
              </label>
              <Input
                id={`saved-view-name-${view.id}`}
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
              />
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!draftName.trim()}>
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogPopup className="max-w-[400px] rounded-xl border-edge bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-medium text-ink">
              Delete “{view.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px] text-ink-3">
              This removes the saved view. Your pull requests and filters are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogClose className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:bg-raise">
              Keep view
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                deleteSavedView(view.id);
                setDeleting(false);
              }}
            >
              Delete view
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
function NavItem({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={item.count ? `${item.label}, ${item.count} requiring attention` : item.label}
      aria-current={active ? "page" : undefined}
      title={`${item.label} (${item.key})`}
      className={cn(
        "workspace-nav-link flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-ink-2 transition-colors hover:bg-raise hover:text-ink",
        active && "font-medium text-ink",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active && "text-workspace")} strokeWidth={1.75} />
      <span className="workspace-nav-label flex-1 truncate">{item.label}</span>
      {item.count ? <span className="workspace-nav-count tnum">{item.count}</span> : null}
    </Link>
  );
}
