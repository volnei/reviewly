import { cn } from "@/lib/utils";
import { Check, type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * The app's standard floating panel + click-outside backdrop. Use inside a
 * `relative` container, gated by your own `open` state:
 *   {open && <PopoverPanel onClose={() => setOpen(false)}>…</PopoverPanel>}
 * Canonical spacing/bg/shadow so every dropdown in the app matches.
 */
export function PopoverPanel({
  onClose,
  align = "right",
  side = "bottom",
  width = "w-64",
  className,
  children,
}: {
  onClose: () => void;
  align?: "left" | "right";
  side?: "top" | "bottom";
  width?: string;
  className?: string;
  children: ReactNode;
}) {
  // Capture the trigger on open; restore focus to it when the panel closes so
  // keyboard users aren't dumped to the top of the page after any dropdown.
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => triggerRef.current?.focus?.();
  }, []);
  // Escape closes the panel — matches every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        className={cn(
          "absolute z-30 rounded-lg border border-hairline bg-popover/90 p-2 shadow-xl backdrop-blur-xl",
          side === "top" ? "bottom-full mb-1" : "top-full mt-1",
          align === "right" ? "right-0" : "left-0",
          width,
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}

/** A titled group inside a popover. */
export function PopoverSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-2 pb-0.5 text-[11px] font-medium text-muted-foreground/60">{title}</p>
      {children}
    </div>
  );
}

/** A standard selectable row inside a popover/menu. */
export function PopoverItem({
  icon: Icon,
  checked,
  count,
  onClick,
  className,
  children,
}: {
  icon?: LucideIcon;
  /** Show a leading check slot (true = checked, false = reserved space). */
  checked?: boolean;
  count?: number;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.05]",
        className,
      )}
    >
      {checked != null && (
        <Check className={cn("size-3 shrink-0", checked ? "text-primary" : "opacity-0")} />
      )}
      {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null && (
        <span className="shrink-0 tabular-nums text-muted-foreground">{count}</span>
      )}
    </button>
  );
}

/**
 * A quiet "Filter" / "Display" style menu: a 28px trigger button (icon + label,
 * optional active count) that opens a `PopoverPanel`. Children may be a render
 * function receiving `close` so items can dismiss the menu.
 */
export function Menu({
  label,
  icon: Icon,
  count = 0,
  width = "w-64",
  align = "right",
  children,
}: {
  label: string;
  icon: LucideIcon;
  count?: number;
  width?: string;
  align?: "left" | "right";
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
          count > 0 || open
            ? "bg-foreground/[0.06] text-foreground"
            : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
        {label}
        {count > 0 && (
          <span className="rounded-full bg-primary/20 px-1 text-[10px] font-medium tabular-nums text-primary">
            {count}
          </span>
        )}
      </button>
      {open && (
        <PopoverPanel onClose={close} align={align} width={width}>
          {typeof children === "function" ? children(close) : children}
        </PopoverPanel>
      )}
    </div>
  );
}
