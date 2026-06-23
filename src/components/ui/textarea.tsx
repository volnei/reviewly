"use client";

import { getCaretCoordinates } from "@/lib/caret";
import { type EmojiMatch, searchEmoji } from "@/lib/emoji";
import { cn } from "@/lib/utils";
import * as React from "react";
import { createPortal } from "react-dom";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Accepted for compat with coss/ui input-group; ignored here. */
  unstyled?: boolean;
  /** Disable the `:shortcode:` emoji autocomplete (on by default). */
  noEmoji?: boolean;
};

/** A `:` immediately after start/whitespace, followed by ≥1 shortcode char. */
function detectColon(value: string, caret: number): { query: string; from: number } | null {
  const before = value.slice(0, caret);
  const m = before.match(/(?:^|[\s(])(:)([a-z0-9_+]+)$/i);
  if (!m) return null;
  const query = m[2];
  return { query, from: caret - query.length - 1 };
}

/** Set a controlled textarea's value so React's onChange fires (native setter). */
function setNativeValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, unstyled: _unstyled, noEmoji, onChange, onKeyDown, onBlur, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    };

    const [matches, setMatches] = React.useState<EmojiMatch[]>([]);
    const [active, setActive] = React.useState(0);
    const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
    const fromRef = React.useRef(0);
    const open = !noEmoji && pos !== null && matches.length > 0;

    const close = () => setPos(null);

    // The popup is fixed-positioned at coordinates captured when it opened; a
    // window scroll or resize invalidates them, so dismiss it rather than let it
    // float in the wrong place. (Capture phase catches scrolls on any ancestor.)
    React.useEffect(() => {
      if (pos === null) return;
      const onMove = () => setPos(null);
      window.addEventListener("scroll", onMove, true);
      window.addEventListener("resize", onMove);
      return () => {
        window.removeEventListener("scroll", onMove, true);
        window.removeEventListener("resize", onMove);
      };
    }, [pos]);

    function refresh(el: HTMLTextAreaElement) {
      if (noEmoji) return;
      const caret = el.selectionStart ?? el.value.length;
      const found = detectColon(el.value, caret);
      const hits = found ? searchEmoji(found.query) : [];
      if (!found || hits.length === 0) {
        close();
        return;
      }
      fromRef.current = found.from;
      setMatches(hits);
      setActive(0);
      const c = getCaretCoordinates(el, caret);
      const rect = el.getBoundingClientRect();
      setPos({
        x: rect.left + c.left - el.scrollLeft,
        y: rect.top + c.top - el.scrollTop + c.height + 4,
      });
    }

    function pick(m: EmojiMatch) {
      const el = innerRef.current;
      if (!el) return;
      const caret = el.selectionStart ?? el.value.length;
      const insert = `${m.char} `;
      const next = el.value.slice(0, fromRef.current) + insert + el.value.slice(caret);
      setNativeValue(el, next);
      const at = fromRef.current + insert.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(at, at);
      });
      close();
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      onChange?.(e);
      refresh(e.currentTarget);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((i) => (i + 1) % matches.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((i) => (i - 1 + matches.length) % matches.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          pick(matches[active]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
          return;
        }
        // Caret-moving keys leave the value unchanged (so `refresh` won't fire),
        // but move the caret away from the `:query` — close so the popup can't
        // linger detached from the token it was anchored to.
        if (
          e.key === "ArrowLeft" ||
          e.key === "ArrowRight" ||
          e.key === "Home" ||
          e.key === "End"
        ) {
          close();
          // fall through so the textarea still handles the caret move
        }
      }
      onKeyDown?.(e);
    }

    return (
      <>
        <textarea
          ref={setRefs}
          className={cn(
            "flex min-h-20 w-full rounded-lg border border-input bg-background dark:bg-input/32 px-3.5 py-2.5 text-sm font-mono shadow-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24 disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={(e) => {
            close();
            onBlur?.(e);
          }}
          {...props}
        />
        {open &&
          pos &&
          createPortal(
            // biome-ignore lint/a11y/useKeyWithMouseEvents: keyboard handled on the textarea
            <div
              className="fixed z-[100] max-h-60 w-56 overflow-y-auto rounded-lg border border-border/60 bg-popover/95 p-1 text-sm shadow-xl backdrop-blur-xl"
              style={{ left: pos.x, top: pos.y }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {matches.map((m, i) => (
                <button
                  key={m.shortcode}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(m);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left",
                    i === active ? "bg-primary/15 text-foreground" : "text-muted-foreground",
                  )}
                >
                  <span className="text-base leading-none">{m.char}</span>
                  <span className="truncate font-mono text-xs">:{m.shortcode}:</span>
                </button>
              ))}
            </div>,
            document.body,
          )}
      </>
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
