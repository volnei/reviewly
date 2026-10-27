import { IconButton } from "@/components/icon-button";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * ⌘F on a pull request: find in every diff on the page, including what you
 * unfolded. Matches get a hairline, the current one a raised row; ↵ and ⇧↵
 * walk them, esc puts everything back.
 */
export function FindBar({
  scrollRef,
  onClose,
}: { scrollRef: React.RefObject<HTMLDivElement>; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<HTMLElement[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const t = setTimeout(() => {
      for (const el of root.querySelectorAll("[data-hit]")) {
        el.removeAttribute("data-hit");
        el.removeAttribute("data-current");
      }
      const needle = q.trim().toLowerCase();
      if (!needle) {
        setHits([]);
        return;
      }
      const rows = [...root.querySelectorAll<HTMLElement>("tr")].filter(
        (r) => (r.id || r.querySelector("td[id]")) && r.textContent?.toLowerCase().includes(needle),
      );
      for (const r of rows) r.setAttribute("data-hit", "");
      setHits(rows);
      setI(0);
    }, 80);
    return () => clearTimeout(t);
  }, [q, scrollRef]);

  useEffect(() => {
    for (const h of hits) h.removeAttribute("data-current");
    const cur = hits[i];
    if (cur) {
      cur.setAttribute("data-current", "");
      cur.scrollIntoView({ block: "center" });
    }
  }, [hits, i]);

  useEffect(
    () => () => {
      const root = scrollRef.current;
      if (!root) return;
      for (const el of root.querySelectorAll("[data-hit]")) {
        el.removeAttribute("data-hit");
        el.removeAttribute("data-current");
      }
    },
    [scrollRef],
  );

  const step = (d: number) => {
    if (hits.length) setI((x) => (x + d + hits.length) % hits.length);
  };

  return (
    <div
      role="search"
      className="absolute top-3 right-6 z-20 flex h-8 items-center gap-1 rounded-lg border border-edge bg-card pr-1 pl-2.5 shadow-[0_1px_2px_rgba(0,0,0,.3)]"
    >
      <Search className="size-3.5 text-ink-3" strokeWidth={2} />
      <input
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find in the diff"
        aria-label="Find in the diff"
        className="w-52 bg-transparent px-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          }
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="tnum w-16 text-right text-[11.5px] text-ink-3" aria-live="polite">
        {q.trim() ? (hits.length ? `${i + 1} of ${hits.length}` : "none") : ""}
      </span>
      <IconButton size={6} label="Previous (⇧↵)" onClick={() => step(-1)} disabled={!hits.length}>
        <ChevronUp className="size-3.5" strokeWidth={2} />
      </IconButton>
      <IconButton size={6} label="Next (↵)" onClick={() => step(1)} disabled={!hits.length}>
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </IconButton>
      <IconButton size={6} label="Close (esc)" onClick={onClose}>
        <X className="size-3.5" strokeWidth={2} />
      </IconButton>
    </div>
  );
}
