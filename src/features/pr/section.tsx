import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";

/** A folded stretch of the read: one line to open it, a hairline above. */
export function Section({
  title,
  open: initial = false,
  children,
  aside,
}: { title: ReactNode; open?: boolean; children: ReactNode; aside?: ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="mt-6 border-t border-hair pt-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex h-7 items-center gap-2 text-[13px] text-ink-2 hover:text-ink"
        >
          <ChevronRight
            className={cn("size-3.5 text-ink-3 transition-transform", open && "rotate-90")}
            strokeWidth={2}
          />
          {title}
        </button>
        {aside ? <span className="ml-auto flex items-center gap-1">{aside}</span> : null}
      </div>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
