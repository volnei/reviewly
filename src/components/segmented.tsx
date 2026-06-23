import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Optional trailing count (e.g. "Files 18"). */
  count?: number;
  /** Status tone className applied to the icon + count (e.g. "text-success"). */
  tone?: string;
}

/**
 * The app's standard segmented switcher (28px tall, aligned with the rest of a
 * filter bar). Used for PR scope, notification modes, etc.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-lg bg-foreground/[0.05] p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
            value === o.value
              ? "bg-card text-foreground shadow-md ring-1 ring-inset ring-border/40"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon && <o.icon className={cn("size-3.5", o.tone)} />}
          {o.label}
          {o.count != null && (
            <span className={cn("tabular-nums", o.tone ?? "text-muted-foreground/70")}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
