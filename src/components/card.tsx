import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

/**
 * The standard surface: a rounded-xl card with a hairline border and padded
 * body. The single container for settings sections, onboarding panels, and
 * dialogs — so card padding/radius/border stay consistent app-wide.
 */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-xl border border-border/40 bg-card/50 p-5", className)}
      {...props}
    />
  );
}
