import { CommandPalette } from "@/app/command-palette";
import { PinboardBar } from "@/app/pinboard-bar";
import { Sidebar } from "@/app/sidebar";
import { TitleBar } from "@/app/title-bar";
import { useAuthBootstrap } from "@/app/use-auth-bootstrap";
import { useClipboardSniff } from "@/app/use-clipboard-sniff";
import { useGlobalShortcuts } from "@/app/use-global-shortcuts";
import { useGuidedEvents } from "@/app/use-guided-events";
import { useNativeChrome } from "@/app/use-native-chrome";
import { usePrSync } from "@/app/use-pr-sync";
import { useRealtimeEvents } from "@/app/use-realtime-events";
import { useUpdater } from "@/app/use-updater";
import { AboutDialog } from "@/components/about-dialog";
import { ShortcutsCheatsheet } from "@/components/shortcuts-cheatsheet";
import { resolveTheme, useTheme } from "@/stores/theme";
import { type ReactNode, useEffect, useState } from "react";
import { Toaster } from "sonner";

/** Apply the theme preference to <html> and track the resolved scheme. */
function useAppliedTheme(): "light" | "dark" {
  const pref = useTheme((s) => s.theme);
  const [resolved, setResolved] = useState(() => resolveTheme(pref));

  useEffect(() => {
    const apply = () => {
      const scheme = resolveTheme(pref);
      setResolved(scheme);
      document.documentElement.classList.toggle("light", scheme === "light");
    };
    apply();
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  return resolved;
}

export function AppLayout({ children }: { children: ReactNode }) {
  useAuthBootstrap();
  useGlobalShortcuts();
  useClipboardSniff();
  useRealtimeEvents();
  usePrSync();
  useGuidedEvents();
  useNativeChrome();
  useUpdater();
  const theme = useAppliedTheme();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
      </div>
      <PinboardBar />
      <CommandPalette />
      <ShortcutsCheatsheet />
      <AboutDialog />
      <Toaster
        theme={theme}
        position="bottom-right"
        closeButton
        toastOptions={{
          className: "!bg-popover/80 !backdrop-blur-xl !text-foreground !rounded-xl !shadow-2xl",
        }}
      />
    </div>
  );
}
