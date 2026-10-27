import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

/**
 * A hairline you can drag at a column's edge. `onDrag` gets the distance from
 * where the press started; `onEnd` fires once, to keep the width.
 */
export function ResizeHandle({
  edge,
  onDrag,
  onEnd,
  label,
}: {
  edge: "left" | "right";
  onDrag: (dx: number) => void;
  onEnd: () => void;
  label: string;
}) {
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    if (start == null) return;
    const move = (e: MouseEvent) => onDrag(e.clientX - start);
    const up = () => {
      setStart(null);
      onEnd();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [start, onDrag, onEnd]);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        setStart(e.clientX);
      }}
      onKeyDown={(e) => {
        // ← → nudge the edge by 16px; the keyboard route to the same width.
        const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
        if (!d) return;
        e.preventDefault();
        onDrag(d);
        onEnd();
      }}
      className={cn(
        "absolute top-0 bottom-0 z-20 w-[7px] cursor-col-resize outline-none focus-visible:after:bg-ink",
        edge === "right" ? "-right-[3px]" : "-left-[3px]",
        "after:absolute after:top-0 after:bottom-0 after:left-[3px] after:w-px after:bg-transparent after:transition-colors hover:after:bg-edge",
        start != null && "after:bg-edge",
      )}
    />
  );
}
