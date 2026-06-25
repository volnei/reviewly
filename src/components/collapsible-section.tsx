import { cn } from "@/lib/utils";
import { useSettingsUi } from "@/stores/settings-ui";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A Settings section whose body collapses behind its header. The open/closed
 * state is keyed by `id` and persisted, so it survives navigation and restarts.
 * Matches the SectionHeader label styling (uppercase, muted) with a rotating
 * chevron; the body animates via a grid-rows 0fr↔1fr transition.
 */
export function CollapsibleSection({
  id,
  title,
  icon: Icon,
  defaultOpen = true,
  action,
  children,
}: {
  id: string;
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSettingsUi((s) => s.collapsed[id]);
  const toggle = useSettingsUi((s) => s.toggle);
  const open = collapsed === undefined ? defaultOpen : !collapsed;

  return (
    <section>
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={open}
          className="-mx-2 flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 transition-transform duration-200",
              open && "rotate-90",
            )}
            strokeWidth={2}
          />
          {Icon && <Icon className="size-3.5 shrink-0" strokeWidth={1.5} />}
          <span>{title}</span>
        </button>
        {action}
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </section>
  );
}
