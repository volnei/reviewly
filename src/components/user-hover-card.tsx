import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { UserProfile, UserRef } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Building2,
  CalendarDays,
  Link2,
  type LucideIcon,
  MapPin,
  Twitter,
} from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";

interface Props {
  user: Pick<UserRef, "login" | "avatar_url">;
  /** Optional contextual footer, e.g. "updated yesterday". */
  meta?: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** The trigger element (rendered as-is — usually the avatar `<img>`). */
  children: ReactElement;
}

function compactNum(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function sizedAvatar(url: string): string {
  return url.includes("?") ? `${url}&s=120` : `${url}?s=120`;
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function joinedLabel(iso: string): string {
  return `Joined ${new Date(iso).toLocaleString(undefined, { month: "short", year: "numeric" })}`;
}

/**
 * Hover an avatar to reveal a premium profile card. The full profile is
 * lazy-fetched only once the card opens, then cached; the avatar + login
 * render instantly from data we already have.
 */
export function UserHoverCard({ user, meta, side = "top", children }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["user", user.login],
    queryFn: () => invoke<UserProfile>("gh_user", { login: user.login }),
    enabled: open,
    // Profiles change rarely — keep them fresh for hours and cached for a day
    // so the card is instant after the first hover, app-wide.
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="max-w-none">
        <div className="w-72 py-1">
          {/* identity */}
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-full bg-primary/20 blur-md" aria-hidden />
              <img
                src={data ? sizedAvatar(data.avatar_url) : user.avatar_url}
                alt={user.login}
                className="relative size-12 rounded-full ring-2 ring-primary/25"
              />
            </div>
            <div className="min-w-0 pt-0.5">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-display text-sm leading-tight text-foreground">
                  {data?.name ?? user.login}
                </p>
                {data?.hireable && (
                  <BadgeCheck className="size-3.5 shrink-0 text-success" strokeWidth={2} />
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground">@{user.login}</p>
            </div>
          </div>

          {data?.bio && (
            <p className="mt-2.5 line-clamp-3 text-xs leading-relaxed text-foreground/80">
              {data.bio}
            </p>
          )}

          {/* stats bar */}
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-foreground/[0.05] px-3 py-2">
            {data ? (
              <>
                <Stat n={data.followers} label="followers" />
                <Dot />
                <Stat n={data.following} label="following" />
                <Dot />
                <Stat n={data.public_repos} label="repos" />
              </>
            ) : (
              <span className="h-3.5 w-40 animate-pulse rounded bg-foreground/10" />
            )}
          </div>

          {/* meta */}
          {data && (
            <div className="mt-2.5 grid gap-1.5 text-xs text-muted-foreground">
              {data.company && <MetaRow icon={Building2}>{data.company}</MetaRow>}
              {data.location && <MetaRow icon={MapPin}>{data.location}</MetaRow>}
              {data.blog && <MetaRow icon={Link2}>{prettyUrl(data.blog)}</MetaRow>}
              {data.twitter_username && <MetaRow icon={Twitter}>@{data.twitter_username}</MetaRow>}
              {data.created_at && (
                <MetaRow icon={CalendarDays}>{joinedLabel(data.created_at)}</MetaRow>
              )}
            </div>
          )}

          {meta && (
            <p className="mt-2.5 border-t border-hairline pt-2 text-xs text-muted-foreground">
              {meta}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 text-xs">
      <span className="font-display tabular-nums text-foreground">{compactNum(n)}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Dot() {
  return <span className="text-muted-foreground/40">·</span>;
}

function MetaRow({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon className={cn("size-3.5 shrink-0 text-muted-foreground/70")} strokeWidth={1.5} />
      <span className="truncate text-foreground/80">{children}</span>
    </span>
  );
}
