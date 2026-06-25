import { LabelChip } from "@/components/label-chip";
import { TooltipFor } from "@/components/tooltip-for";
import { UserHoverCard } from "@/components/user-hover-card";
import { compactTime, relativeTime } from "@/lib/format";
import type { PullDetail, PullSummary } from "@/lib/tauri";
import { invoke, parseRepoUrl } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useGuided } from "@/stores/guided";
import { useGuidedGen } from "@/stores/guided-gen";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
  Sparkles,
} from "lucide-react";

export type PrState = "open" | "draft" | "merged" | "closed";

export const STATE_META: Record<PrState, { icon: LucideIcon; color: string; label: string }> = {
  open: { icon: GitPullRequest, color: "text-success", label: "Open" },
  draft: { icon: GitPullRequestDraft, color: "text-muted-foreground", label: "Draft" },
  merged: { icon: GitMerge, color: "text-primary", label: "Merged" },
  closed: { icon: GitPullRequestClosed, color: "text-destructive", label: "Closed" },
};

/** Derive a PR's lifecycle state from the search summary. */
export function prState(pr: PullSummary): PrState {
  if (pr.pull_request?.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  if (pr.draft) return "draft";
  return "open";
}

interface Props {
  pr: PullSummary;
  /** Hide the `owner/repo` prefix (e.g. when the list is already grouped by repo). */
  showRepo?: boolean;
  /** Show the relative "updated" time in a fixed-width slot (keeps rows aligned). */
  showUpdated?: boolean;
  /** CI rollup state — a small dot is shown for failing/pending only. */
  ciState?: "success" | "failure" | "pending" | "none" | string;
  className?: string;
  tabIndex?: number;
}

/**
 * One PR in a list. Resting row stays calm — icon, id, title, up to two
 * labels, draft marker, avatar. The timestamp is secondary, so it only
 * fades in on hover/focus to keep the row quiet at rest.
 */
export function PrRowLink({
  pr,
  showRepo = true,
  showUpdated = false,
  ciState,
  className,
  tabIndex,
}: Props) {
  const repo = parseRepoUrl(pr.repository_url);
  const prKey = repo ? `${repo.owner}/${repo.repo}#${pr.number}` : "";
  // A guided tour exists (or is generating in the background) for this PR.
  const hasTour = useGuided((s) => (prKey ? !!s.byPr[prKey] : false));
  const tourPending = useGuidedGen((s) => (prKey ? !!s.inFlight[prKey] : false));
  const qc = useQueryClient();

  // On hover/focus, warm the detail query so the row opens instantly. The route
  // chunk itself is already preloaded by the router's `defaultPreload: "intent"`.
  const prefetchDetail = () => {
    if (!repo) return;
    const number = pr.number;
    qc.prefetchQuery({
      queryKey: ["pull", repo.owner, repo.repo, number],
      queryFn: () =>
        invoke<PullDetail>("gh_get_pull", { owner: repo.owner, repo: repo.repo, number }),
      staleTime: 30_000,
    });
  };

  if (!repo) return null;
  const labels = pr.labels ?? [];
  const state = prState(pr);
  const meta = STATE_META[state];
  const StateIcon = meta.icon;
  return (
    <Link
      to="/prs/$owner/$repo/$number"
      params={{ owner: repo.owner, repo: repo.repo, number: String(pr.number) }}
      preload="intent"
      tabIndex={tabIndex}
      onMouseEnter={prefetchDetail}
      onFocus={prefetchDetail}
      className={cn(
        "group flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors duration-100 hover:bg-foreground/[0.04] data-[status=active]:bg-primary/[0.08]",
        className,
      )}
    >
      <StateIcon
        className={cn("size-4 shrink-0", meta.color)}
        strokeWidth={1.5}
        aria-label={meta.label}
      />
      <span className="shrink-0 font-display text-xs tabular-nums text-muted-foreground">
        {showRepo ? `${repo.owner}/${repo.repo}#${pr.number}` : `#${pr.number}`}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-sm text-foreground",
          state !== "open" && "text-foreground/70",
          state === "closed" && "text-muted-foreground",
        )}
      >
        {pr.title}
      </span>
      {labels.length > 0 && (
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {labels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {labels.length > 2 && (
            <span className="text-xs text-muted-foreground">+{labels.length - 2}</span>
          )}
        </div>
      )}
      {(hasTour || tourPending) && (
        <TooltipFor label={tourPending ? "Guided tour generating…" : "Guided tour ready"}>
          <Sparkles
            className={cn(
              "size-3.5 shrink-0",
              tourPending ? "animate-pulse text-primary/70" : "text-primary/90",
            )}
            strokeWidth={1.5}
            aria-label={tourPending ? "Guided tour generating" : "Guided tour ready"}
          />
        </TooltipFor>
      )}
      {ciState === "failure" ? (
        <TooltipFor label="CI failing">
          <span
            role="img"
            className="size-2.5 shrink-0 cursor-help rounded-full bg-destructive ring-2 ring-background"
            aria-label="CI failing"
          />
        </TooltipFor>
      ) : ciState === "pending" ? (
        <TooltipFor label="CI pending">
          <span
            role="img"
            className="size-2.5 shrink-0 cursor-help rounded-full bg-warning ring-2 ring-background"
            aria-label="CI pending"
          />
        </TooltipFor>
      ) : (
        <span className="w-2.5 shrink-0" aria-hidden />
      )}
      <span className="flex-1" />
      <UserHoverCard user={pr.user} meta={`updated ${relativeTime(pr.updated_at)}`}>
        <img
          src={pr.user.avatar_url}
          alt={pr.user.login}
          className="size-5 shrink-0 rounded-full ring-1 ring-foreground/10"
        />
      </UserHoverCard>
      {showUpdated && (
        <span className="w-9 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
          {compactTime(pr.updated_at)}
        </span>
      )}
    </Link>
  );
}
