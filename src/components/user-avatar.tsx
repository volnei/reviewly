import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { UserRef } from "@/lib/tauri";
import { cn } from "@/lib/utils";

/**
 * A user's avatar with a graceful initial fallback. The single avatar used for
 * standalone (non-hover-card) sites — PR rows, reviewer pickers, settings.
 * Default size is `size-5`; override via `className`.
 */
export function UserAvatar({
  user,
  className,
}: {
  user: Pick<UserRef, "login" | "avatar_url">;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-5", className)}>
      <AvatarImage src={user.avatar_url} alt={user.login} />
      <AvatarFallback className="text-[0.6em]">{user.login.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
