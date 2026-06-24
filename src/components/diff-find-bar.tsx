import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Cmd+F find bar for the diff. Uses the WebView's native `window.find`, which
 * walks the rendered (and now selectable) diff text and handles matches that
 * span syntax-highlight token boundaries — something a per-text-node search
 * would miss. Enter / Shift+Enter step forward / back; Esc closes.
 */
export function DiffFindBar({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function run(backwards: boolean) {
    if (!query) return;
    // `window.find` is non-standard (but present in WebKit/Chromium) and untyped.
    // Signature: find(text, caseSensitive, backwards, wrapAround, …).
    const find = (window as unknown as { find?: (...a: unknown[]) => boolean }).find;
    const found =
      typeof find === "function" ? find(query, false, backwards, true, false, false, false) : false;
    setNotFound(!found);
  }

  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-0.5 rounded-lg border border-border bg-popover/95 p-1 shadow-lg backdrop-blur-xl">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            run(e.shiftKey);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in file…"
        spellCheck={false}
        className={cn(
          "h-7 w-48 bg-transparent px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground/60",
          notFound && "text-destructive",
        )}
      />
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous match"
        disabled={!query}
        onClick={() => run(true)}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next match"
        disabled={!query}
        onClick={() => run(false)}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Close find" onClick={onClose}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
