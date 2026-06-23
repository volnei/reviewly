import { create } from "zustand";

export type DiffView = "unified" | "split" | "guided";

interface UiState {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;

  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  diffView: DiffView;
  setDiffView: (v: DiffView) => void;
  toggleDiffView: () => void;

  focusMode: boolean;
  setFocusMode: (v: boolean) => void;
  toggleFocusMode: () => void;

  /** Zoom level. 1 = default. Stored as a multiplier applied to html root font-size. */
  zoom: number;
  setZoom: (z: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

const ZOOM_STEPS = [0.75, 0.85, 0.95, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2];

function snapZoom(z: number, dir: 1 | -1): number {
  const i = ZOOM_STEPS.findIndex((v) => Math.abs(v - z) < 0.001);
  if (i === -1) return dir === 1 ? 1.1 : 0.95;
  const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))];
  return next;
}

export const useUi = create<UiState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),

  aboutOpen: false,
  setAboutOpen: (aboutOpen) => set({ aboutOpen }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  diffView: "unified",
  setDiffView: (diffView) => set({ diffView }),
  // ⌘B cycles unified ↔ split only (guided is its own explicit toggle).
  toggleDiffView: () => set((s) => ({ diffView: s.diffView === "split" ? "unified" : "split" })),

  focusMode: false,
  setFocusMode: (focusMode) => set({ focusMode }),
  toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),

  zoom: 1,
  setZoom: (zoom) => set({ zoom }),
  zoomIn: () => set((s) => ({ zoom: snapZoom(s.zoom, 1) })),
  zoomOut: () => set((s) => ({ zoom: snapZoom(s.zoom, -1) })),
  resetZoom: () => set({ zoom: 1 }),
}));
