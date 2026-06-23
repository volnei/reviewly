import { checkForUpdates } from "@/app/use-updater";
import { ReviewlyGlyph } from "@/components/reviewly-glyph";
import { Button } from "@/components/ui/button";
import { safeOpenUrl } from "@/lib/ui";
import { useUi } from "@/stores/ui";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { Github, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Branded About panel — replaces the generic native macOS one. Opened from ⌘K,
 * Settings, or the "About Reviewly" app-menu item (which emits `menu:about`).
 */
export function AboutDialog() {
  const open = useUi((s) => s.aboutOpen);
  const setOpen = useUi((s) => s.setAboutOpen);
  const [version, setVersion] = useState("");

  // The native app-menu "About Reviewly" routes here via this event.
  useEffect(() => {
    const un = listen("menu:about", () => setOpen(true));
    return () => {
      un.then((f) => f());
    };
  }, [setOpen]);

  useEffect(() => {
    if (open)
      getVersion()
        .then(setVersion)
        .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="About Reviewly"
        onClick={(e) => e.stopPropagation()}
        className="relative w-[22rem] overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-3 top-3 text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        {/* Hero — the gem on a soft halo */}
        <div className="flex flex-col items-center gap-3 px-6 pt-9 pb-5 text-center">
          <div className="relative flex size-16 items-center justify-center">
            <span aria-hidden className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl" />
            <ReviewlyGlyph size={56} className="relative" />
          </div>
          <div>
            <h2 className="font-display text-lg font-medium tracking-tight text-foreground">
              Reviewly
            </h2>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {version ? `Version ${version}` : "Desktop pull-request review console"}
            </p>
          </div>
          <p className="max-w-[18rem] text-xs leading-relaxed text-muted-foreground">
            A local-first console for reviewing GitHub pull requests — guided AI tours, inline
            review, checks and Dependabot, all on your machine.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-hairline p-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              void checkForUpdates();
            }}
          >
            <RefreshCw className="size-3.5" />
            Check for updates
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => safeOpenUrl("https://github.com/volnei/reviewly")}
          >
            <Github className="size-3.5" />
            GitHub
          </Button>
        </div>

        <div className="flex items-center justify-center gap-1.5 border-t border-hairline px-4 py-2.5 text-[11px] text-muted-foreground/60">
          <ShieldCheck className="size-3 text-success" />
          Runs on your machine · © {new Date().getFullYear()} Volnei Munhoz
        </div>
      </div>
    </div>
  );
}
