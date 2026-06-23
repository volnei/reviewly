import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReactElement, ReactNode } from "react";

interface TooltipForProps {
  label: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Optional shortcut shown muted on the right of the label. */
  shortcut?: string;
  children: ReactElement;
}

/**
 * Wrap any interactive element with a Base-UI tooltip. The child is the
 * trigger (rendered as-is via `render={child}`), so event handlers and
 * accessibility attributes compose onto it instead of wrapping it in
 * another element.
 */
export function TooltipFor({
  label,
  side = "top",
  align = "center",
  shortcut,
  children,
}: TooltipForProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} align={align} className="inline-flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded border border-border/40 bg-background/30 px-1 py-px font-mono text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
