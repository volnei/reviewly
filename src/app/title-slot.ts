import { type ReactNode, useEffect, useSyncExternalStore } from "react";

/**
 * One 44px title bar across the window; each screen decides what sits in it.
 * Screens call `useTitleSlot` and the bar re-renders with their node.
 */
const listeners = new Set<() => void>();
let slot: { node: ReactNode; tone: "desk" | "page" } = { node: null, tone: "desk" };

const titleSlot = {
  get: () => slot,
  set: (next: typeof slot) => {
    slot = next;
    for (const l of listeners) l();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useTitleSlotValue = () =>
  useSyncExternalStore(titleSlot.subscribe, titleSlot.get, titleSlot.get);

/** `tone` is the screen's own colour, so the bar never looks like a separate band. */
export function useTitleSlot(
  node: ReactNode,
  tone: "desk" | "page" = "desk",
  deps: ReadonlyArray<unknown> = [],
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller names what the node depends on
  useEffect(() => {
    titleSlot.set({ node, tone });
    return () => titleSlot.set({ node: null, tone: "desk" });
  }, [tone, ...deps]);
}
