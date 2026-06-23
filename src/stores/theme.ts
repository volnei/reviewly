import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemePref = "system" | "light" | "dark";

interface State {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
}

export const useTheme = create<State>()(
  persist(
    (set) => ({
      theme: "dark",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "reviewly.theme", storage: sqlStorage<State>() },
  ),
);

/** Resolve a preference (incl. "system") to the concrete scheme right now. */
export function resolveTheme(pref: ThemePref): "light" | "dark" {
  if (pref === "system") {
    return typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  }
  return pref;
}
