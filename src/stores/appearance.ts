import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AccentId = "violet" | "blue" | "cyan" | "emerald" | "rose" | "pink";

/** Dock-icon background variant (macOS). */
export type AppIconBg = "white" | "black";

interface State {
  /** Accent that drives `--primary` app-wide. "violet" keeps the theme default. */
  accent: AccentId;
  /** Kill animations + transitions across the app. */
  reduceMotion: boolean;
  /** White- vs black-background app (Dock) icon. */
  appIconBg: AppIconBg;
  setAccent: (a: AccentId) => void;
  setReduceMotion: (v: boolean) => void;
  setAppIconBg: (v: AppIconBg) => void;
}

export const useAppearance = create<State>()(
  persist(
    (set) => ({
      accent: "violet",
      reduceMotion: false,
      appIconBg: "white",
      setAccent: (accent) => set({ accent }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      setAppIconBg: (appIconBg) => set({ appIconBg }),
    }),
    { name: "reviewly.appearance", storage: sqlStorage<State>() },
  ),
);

/**
 * Accent presets. `primary` is the `--primary` override (null = leave the
 * theme's own value, which differs per light/dark). `swatch` is what the picker
 * dot shows. `foreground` keeps text legible on a filled accent.
 */
export const ACCENTS: {
  id: AccentId;
  label: string;
  swatch: string;
  primary: string | null;
  foreground: string;
}[] = [
  {
    id: "violet",
    label: "Violet",
    swatch: "oklch(0.6 0.19 268)",
    primary: null,
    foreground: "oklch(0.98 0.012 268)",
  },
  {
    id: "blue",
    label: "Blue",
    swatch: "oklch(0.62 0.17 245)",
    primary: "oklch(0.62 0.17 245)",
    foreground: "oklch(0.99 0.01 245)",
  },
  {
    id: "cyan",
    label: "Cyan",
    swatch: "oklch(0.7 0.12 215)",
    primary: "oklch(0.7 0.12 215)",
    foreground: "oklch(0.2 0.03 215)",
  },
  {
    id: "emerald",
    label: "Emerald",
    swatch: "oklch(0.66 0.15 158)",
    primary: "oklch(0.66 0.15 158)",
    foreground: "oklch(0.99 0.01 158)",
  },
  {
    id: "rose",
    label: "Rose",
    swatch: "oklch(0.64 0.2 14)",
    primary: "oklch(0.64 0.2 14)",
    foreground: "oklch(0.99 0.01 14)",
  },
  {
    id: "pink",
    label: "Pink",
    swatch: "oklch(0.66 0.2 342)",
    primary: "oklch(0.66 0.2 342)",
    foreground: "oklch(0.99 0.01 342)",
  },
];
