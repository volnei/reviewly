import { cn } from "@/lib/utils";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

interface SwitchProps extends Omit<ComponentPropsWithoutRef<"button">, "onChange"> {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  /** Accessible name; also wire a <TooltipFor> around it for a visible hint. */
  label?: string;
}

/**
 * A small on/off switch — the same control used by Settings toggles.
 *
 * Forwards `ref` and spreads remaining props onto the button so it can act as a
 * tooltip/menu trigger (e.g. Base-UI's `render={child}` injects handlers here).
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, disabled, className, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "inline-block size-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
});
