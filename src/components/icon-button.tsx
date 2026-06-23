import { TooltipFor } from "@/components/tooltip-for";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

/**
 * Icon-only button with a custom tooltip + accessible name. The standard way to
 * render a secondary/utility action compactly (no visible text, no native
 * `title`). For primary actions with a label, use `<Button>` directly.
 */
export function IconButton({
  label,
  icon: Icon,
  shortcut,
  side,
  variant = "ghost",
  size = "icon-sm",
  className,
  ...props
}: {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
} & Pick<ButtonProps, "onClick" | "loading" | "disabled">) {
  return (
    <TooltipFor label={label} shortcut={shortcut} side={side}>
      <Button variant={variant} size={size} aria-label={label} className={className} {...props}>
        <Icon className="size-3.5" />
      </Button>
    </TooltipFor>
  );
}
