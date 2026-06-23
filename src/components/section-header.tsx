import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A small section label (optional icon + title + optional right-aligned action).
 * Shared so every "section" heading — settings, dashboard, panels — matches.
 */
export function SectionHeader({
  title,
  icon: Icon,
  action,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={1.5} />}
      <span>{title}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
