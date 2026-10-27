import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export interface MapMark {
  readonly id: string;
  readonly kind: "thread" | "draft";
}

interface Block {
  path: string;
  top: number;
  height: number;
  read: boolean;
}

/**
 * A 12px strip at the right edge of the read, built from the page's own
 * geometry: one block per file (read ones darker), a dot per thread, a ring
 * per draft, and a translucent window for where you are. Click to jump.
 */
export function Minimap({
  scrollRef,
  paths,
  viewed,
  marks,
}: {
  scrollRef: React.RefObject<HTMLDivElement>;
  paths: ReadonlyArray<string>;
  viewed: ReadonlySet<string>;
  marks: ReadonlyArray<MapMark>;
}) {
  const [geo, setGeo] = useState<{
    total: number;
    view: { top: number; height: number };
    blocks: Block[];
    dots: Array<{ id: string; top: number; kind: MapMark["kind"] }>;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the page's structure changes, not on every render
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rr = root.getBoundingClientRect();
      const total = root.scrollHeight;
      const rel = (el: Element) => el.getBoundingClientRect().top - rr.top + root.scrollTop;
      const blocks: Block[] = [];
      for (const el of root.querySelectorAll<HTMLElement>("[data-file]")) {
        const path = el.dataset.file ?? "";
        blocks.push({ path, top: rel(el), height: el.offsetHeight, read: viewed.has(path) });
      }
      const dots = marks.flatMap((m) => {
        const el = document.getElementById(m.id);
        return el ? [{ id: m.id, top: rel(el), kind: m.kind }] : [];
      });
      setGeo({ total, view: { top: root.scrollTop, height: root.clientHeight }, blocks, dots });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    schedule();
    const late = setTimeout(schedule, 800);
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);
    return () => {
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
      clearTimeout(late);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, paths.join("|"), viewed, marks]);

  if (!geo || geo.total <= geo.view.height * 1.5) return null;
  const pct = (y: number) => `${(y / geo.total) * 100}%`;
  const jump = (e: React.MouseEvent<HTMLDivElement>) => {
    const root = scrollRef.current;
    if (!root) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * geo.total;
    root.scrollTo({ top: Math.max(0, y - root.clientHeight / 2) });
  };
  return (
    <div
      aria-hidden
      onClick={jump}
      className="absolute top-0 right-0 bottom-0 z-10 w-3 cursor-pointer select-none"
    >
      {geo.blocks.map((b) => (
        <div
          key={b.path}
          title={b.path}
          className={cn(
            "absolute right-[3px] w-[6px] rounded-[1px]",
            b.read ? "bg-[#555]" : "bg-[#9a9a9a]",
          )}
          style={{ top: pct(b.top), height: `max(2px, calc(${pct(b.height)} - 2px))` }}
        />
      ))}
      {geo.dots.map((d) => (
        <div
          key={d.id}
          className={cn(
            "absolute right-[3px] size-[6px] rounded-full",
            d.kind === "thread" ? "bg-ink" : "border border-ink bg-page",
          )}
          style={{ top: `calc(${pct(d.top)} - 3px)` }}
        />
      ))}
      <div
        className="absolute right-0 left-0 rounded-[2px] bg-ink/10"
        style={{ top: pct(geo.view.top), height: pct(geo.view.height) }}
      />
    </div>
  );
}
