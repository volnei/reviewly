import { isNative } from "@/effect/Tauri";
import { run } from "@/effect/runtime";
import { AppSettings } from "@/effect/services/AppSettings";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import { Effect } from "effect";
import { useEffect } from "react";

/**
 * Settings → Appearance, applied: the theme on <html> (`data-theme` for our
 * tokens, `.dark` for the registry's variants) and the webview zoom. "System"
 * follows the OS and changes with it.
 */
export function useAppearance() {
  const appearance = usePrefs((p) => p.appearance);
  const zoom = usePrefs((p) => p.zoom);
  const reduceMotion = usePrefs((p) => p.reduceMotion);
  const appIcon = usePrefs((p) => p.appIcon);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-motion", reduceMotion);
  }, [reduceMotion]);
  useEffect(() => {
    if (!isNative()) return;
    run(Effect.flatMap(AppSettings, (a) => a.setAppIcon(appIcon))).catch(() => {});
  }, [appIcon]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const resolved = appearance === "system" ? (mq.matches ? "light" : "dark") : appearance;
      const root = document.documentElement;
      root.dataset.theme = resolved;
      root.classList.toggle("dark", resolved !== "light" && resolved !== "clouds");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [appearance]);

  useEffect(() => {
    if (isNative()) {
      void import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(zoom))
        .catch(() => {
          (document.documentElement.style as unknown as { zoom: string }).zoom = String(zoom);
        });
    } else (document.documentElement.style as unknown as { zoom: string }).zoom = String(zoom);
  }, [zoom]);
}

const STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];
export const zoomBy = (dir: 1 | -1) =>
  prefsStore.update((p) => {
    const i = STEPS.findIndex((s) => Math.abs(s - p.zoom) < 0.01);
    const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
    return { ...p, zoom: next };
  });
export const zoomReset = () => prefsStore.update((p) => ({ ...p, zoom: 1 }));
