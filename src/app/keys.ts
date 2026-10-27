import { useEffect } from "react";

/**
 * The keyboard, in one place. Screens register a scope ("list", "pr") with
 * handlers; the shell owns the global chords (⌘K, ⌘1–6, ⌘,, ?). Single-letter
 * keys never fire while typing.
 */
export type KeyHandler = (e: KeyboardEvent) => boolean | undefined;

const scopes = new Map<string, KeyHandler>();

export function useKeyScope(name: string, handler: KeyHandler, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    scopes.set(name, handler);
    return () => {
      if (scopes.get(name) === handler) scopes.delete(name);
    };
  }, [name, handler, enabled]);
}

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
    t.isContentEditable ||
    t.closest('[role="dialog"]') !== null);

/** Chords like "mod+k", "shift+?", "j", "escape". */
export function chord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && e.key.length > 1) parts.push("shift");
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase());
  return parts.join("+");
}

export function dispatchScopes(e: KeyboardEvent): boolean {
  for (const h of scopes.values()) if (h(e)) return true;
  return false;
}
