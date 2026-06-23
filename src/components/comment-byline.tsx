import { UserHoverCard } from "@/components/user-hover-card";
import { relativeTime } from "@/lib/format";
import type { UserRef } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  user: Pick<UserRef, "login" | "avatar_url">;
  /** ISO timestamp, shown relative after the login (e.g. "· 2h ago"). */
  timestamp?: string | null;
  /** Verb before the timestamp, e.g. "opened" → "opened · 2h ago". */
  action?: string;
  /** Inline node right after the login — e.g. the colored review-state word. */
  badge?: ReactNode;
  /** Node pinned to the right of the row (e.g. an edit button). */
  trailing?: ReactNode;
  /** Avatar size override (default `size-5`). */
  avatarClassName?: string;
  className?: string;
}

/**
 * The one byline for every comment-like surface: avatar (with profile hover
 * card) + login + optional state badge + relative timestamp. Replaces the
 * hand-rolled "avatar + login + · time" pattern that was duplicated across the
 * conversation, reviews, inline threads and the diff viewer.
 */
export function CommentByline({
  user,
  timestamp,
  action,
  badge,
  trailing,
  avatarClassName,
  className,
}: Props) {
  return (
    <header className={cn("flex items-center gap-2 text-xs", className)}>
      <UserHoverCard user={user}>
        <img
          src={user.avatar_url}
          alt={user.login}
          className={cn("size-5 rounded-full", avatarClassName)}
        />
      </UserHoverCard>
      <span className="font-medium text-foreground">{user.login}</span>
      {badge}
      {timestamp && (
        <span className="tabular-nums text-muted-foreground/70">
          {action ? `${action} · ` : "· "}
          {relativeTime(timestamp)}
        </span>
      )}
      {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
    </header>
  );
}
