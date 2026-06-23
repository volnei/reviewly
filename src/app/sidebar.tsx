import { ReviewlyGlyph } from "@/components/reviewly-glyph";
import { TooltipFor } from "@/components/tooltip-for";
import type { DependabotAlert, Notification } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useDependabotRepo } from "@/stores/dependabot";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Bot, FolderGit2, GitPullRequest, type LucideIcon, Settings } from "lucide-react";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  shortcut: string;
};

const NAV: NavItem[] = [
  { to: "/prs", label: "Pull requests", icon: GitPullRequest, shortcut: "⌘2" },
  { to: "/repos", label: "Repositories", icon: FolderGit2, shortcut: "⌘3" },
  { to: "/notifications", label: "Notifications", icon: Bell, shortcut: "⌘4" },
  { to: "/dependabot", label: "Dependabot", icon: Bot, shortcut: "⌘5" },
];

export function Sidebar() {
  const { location } = useRouterState();
  // Shared with the Notifications page cache; drives the unread badge.
  const notifs = useQuery({
    queryKey: ["notifications"],
    queryFn: () => invoke<Notification[]>("gh_list_notifications", { all: false }),
    staleTime: 60_000,
  });
  const unread = notifs.data?.length ?? 0;

  // Open PRs awaiting your review — the actionable queue, badged on "Pull requests".
  // Refetch on window focus so the count stays fresh when you return to the app.
  const reviewQueue = useQuery({
    queryKey: ["sidebar-review-count"],
    queryFn: () =>
      invoke<number>("gh_search_count", {
        query: "is:pr is:open review-requested:@me archived:false -is:draft",
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const toReview = reviewQueue.data ?? 0;
  // A real "0 to review" is a clean rail; loading/error must NOT masquerade as 0.
  const reviewPending = reviewQueue.isLoading || reviewQueue.isError;

  // Open Dependabot alerts for the tracked repo → an amber (alert-toned) count on
  // the Dependabot rail. Per-repo endpoint, so it follows the selected repo; quiet
  // (no badge) when none is set or the call lacks security access.
  const dependabotRepo = useDependabotRepo((s) => s.repo);
  const [depOwner, depName] = dependabotRepo.split("/");
  const dependabotAlerts = useQuery({
    queryKey: ["dependabot-alerts", dependabotRepo],
    queryFn: () =>
      invoke<DependabotAlert[]>("gh_dependabot_alerts", { owner: depOwner, repo: depName }),
    enabled: Boolean(depOwner && depName),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const dependabotCount = (dependabotAlerts.data ?? []).filter((a) => a.state === "open").length;

  const badgeFor = (to: string): number =>
    to === "/notifications" ? unread : to === "/dependabot" ? dependabotCount : 0;

  return (
    <aside className="flex h-full w-14 shrink-0 flex-col items-center bg-sidebar/40 py-2">
      <TooltipFor label="Dashboard" shortcut="⌘1" side="right">
        <Link
          to="/"
          aria-label="Dashboard"
          className={cn(
            "group relative mb-2 flex h-8 w-8 items-center justify-center rounded-md transition-colors",
            location.pathname === "/" ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.05]",
          )}
        >
          <ReviewlyGlyph size={26} />
        </Link>
      </TooltipFor>
      <nav className="flex flex-1 flex-col items-center gap-0.5">
        {NAV.map((item) => (
          <RailItem
            key={item.to}
            item={item}
            active={isActive(item.to, location.pathname)}
            badge={item.to === "/prs" ? toReview : badgeFor(item.to)}
            // Dependabot is a security alert → amber, not the primary accent.
            badgeTone={item.to === "/dependabot" ? "warning" : "primary"}
            // While the review-queue count is loading or errored, show a neutral
            // dot instead of "0" so a genuine empty queue reads differently.
            pending={item.to === "/prs" && reviewPending}
            pendingLabel={
              item.to === "/prs"
                ? reviewQueue.isError
                  ? "Review queue count unavailable"
                  : "Loading review queue…"
                : undefined
            }
          />
        ))}
      </nav>

      <div className="flex flex-col items-center gap-0.5">
        <RailItem
          item={{
            to: "/settings",
            label: "Settings",
            icon: Settings,
            shortcut: "⌘,",
          }}
          active={location.pathname.startsWith("/settings")}
        />
      </div>
    </aside>
  );
}

function isActive(to: string, current: string) {
  if (to === "/") return current === "/";
  return current.startsWith(to);
}

function RailItem({
  item,
  active,
  badge = 0,
  badgeTone = "primary",
  pending = false,
  pendingLabel,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  /** Badge color — "warning" (amber) for alert-style counts like Dependabot. */
  badgeTone?: "primary" | "warning";
  /** Count not yet known (loading/error) — show a neutral dot, never "0". */
  pending?: boolean;
  pendingLabel?: string;
}) {
  const Icon = item.icon;
  return (
    <TooltipFor label={item.label} shortcut={item.shortcut} side="right">
      <Link
        to={item.to}
        className={cn(
          "group relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          active
            ? "text-foreground bg-foreground/[0.09]"
            : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]",
        )}
      >
        <Icon className="size-[16px]" strokeWidth={1.5} />
        {pending ? (
          <span
            className="pointer-events-none absolute -right-1 -top-1 size-2 rounded-full bg-muted-foreground/50 ring-2 ring-background"
            aria-label={pendingLabel}
          />
        ) : (
          badge > 0 && (
            <span
              className={cn(
                "pointer-events-none absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 text-[9px] font-medium leading-none tabular-nums ring-2 ring-background",
                badgeTone === "warning"
                  ? "bg-warning text-white"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {badge > 9 ? "9+" : badge}
            </span>
          )
        )}
      </Link>
    </TooltipFor>
  );
}
