import { useSyncExternalStore } from "react";

/** The two things that float over any screen: the palette (⌘K) and the keys (?). */
interface Overlays {
  readonly palette: boolean;
  readonly keys: boolean;
}

const listeners = new Set<() => void>();
let state: Overlays = { palette: false, keys: false };

export const overlays = {
  get: () => state,
  set: (patch: Partial<Overlays>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  openPalette: () => overlays.set({ palette: true, keys: false }),
  openKeys: () => overlays.set({ keys: true, palette: false }),
};

export const useOverlays = (): Overlays =>
  useSyncExternalStore(overlays.subscribe, overlays.get, overlays.get);
