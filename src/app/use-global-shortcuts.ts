import { toggleShortcutsCheatsheet } from "@/components/shortcuts-cheatsheet";
import { useUi } from "@/stores/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export function useGlobalShortcuts() {
  const togglePalette = useUi((s) => s.togglePalette);
  const toggleDiffView = useUi((s) => s.toggleDiffView);
  const zoom = useUi((s) => s.zoom);
  const zoomIn = useUi((s) => s.zoomIn);
  const zoomOut = useUi((s) => s.zoomOut);
  const resetZoom = useUi((s) => s.resetZoom);
  const navigate = useNavigate();

  // Apply zoom whenever it changes — adjusts root font-size so all rem-based
  // Tailwind classes scale together.
  useEffect(() => {
    document.documentElement.style.fontSize = `${zoom * 16}px`;
  }, [zoom]);

  useEffect(() => {
    // `g` then a letter → quick navigation (Linear/GitHub style).
    let gPending = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;
    const GO: Record<string, string> = {
      d: "/",
      r: "/prs",
      l: "/repos",
      n: "/notifications",
      a: "/dependabot",
      s: "/settings",
    };

    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;

      // `?` (Shift+/) opens the keyboard-shortcuts cheatsheet. No modifier,
      // not while typing — checked before the g-chord so it can't be eaten.
      if (!mod && !typing && e.key === "?") {
        e.preventDefault();
        toggleShortcutsCheatsheet();
        return;
      }

      // g-chord navigation (no modifier, not while typing)
      if (!mod && !typing) {
        const k = e.key.toLowerCase();
        if (gPending) {
          gPending = false;
          if (gTimer) clearTimeout(gTimer);
          if (GO[k]) {
            e.preventDefault();
            if (GO[k] === "/settings") useUi.getState().setSettingsOpen(true);
            else navigate({ to: GO[k] });
          }
          return;
        }
        if (k === "g") {
          gPending = true;
          if (gTimer) clearTimeout(gTimer);
          gTimer = setTimeout(() => {
            gPending = false;
          }, 900);
          return;
        }
      }

      if (!mod) return;

      if (e.key === "k") {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (e.key === "b") {
        e.preventDefault();
        toggleDiffView();
        return;
      }
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (e.key === "-") {
        e.preventDefault();
        zoomOut();
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        resetZoom();
        return;
      }

      const map: Record<string, string> = {
        "1": "/",
        "2": "/prs",
        "3": "/repos",
        "4": "/notifications",
        "5": "/dependabot",
        ",": "/settings",
      };
      const dest = map[e.key];
      if (dest) {
        e.preventDefault();
        if (dest === "/settings") useUi.getState().setSettingsOpen(true);
        else navigate({ to: dest });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [togglePalette, toggleDiffView, zoomIn, zoomOut, resetZoom, navigate]);
}
