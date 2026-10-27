import { Button } from "@/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 28px ghost, lucide 16px, the name in the tooltip; a pressed state when it toggles. */
export function IconButton({
  label,
  onClick,
  pressed,
  disabled,
  className,
  size = 7,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  /** Tailwind size step: 7 = 28px, 6 = 24px. */
  size?: 6 | 7;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size === 7 ? "icon-sm" : "icon-xs"}
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
            className={cn(
              "grid place-items-center rounded-md text-ink-2 hover:bg-raise hover:text-ink disabled:opacity-40",
              size === 7 ? "size-7" : "size-6",
              pressed && "bg-raise text-ink",
              className,
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
