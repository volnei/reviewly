import { CommandPalette } from "@/app/command-palette";
import { PinboardBar } from "@/app/pinboard-bar";
import { Sidebar } from "@/app/sidebar";
import { TitleBar } from "@/app/title-bar";
import { useAppBehaviorSync } from "@/app/use-app-behavior-sync";
import { useAuthBootstrap } from "@/app/use-auth-bootstrap";
import { useClipboardSniff } from "@/app/use-clipboard-sniff";
import { useDependabotEvents } from "@/app/use-dependabot-events";
import { useGlobalShortcuts } from "@/app/use-global-shortcuts";
import { useGuidedEvents } from "@/app/use-guided-events";
import { useNativeChrome } from "@/app/use-native-chrome";
import { useNotifSync } from "@/app/use-notif-sync";
import { usePrSync } from "@/app/use-pr-sync";
import { useRealtimeEvents } from "@/app/use-realtime-events";
import { useTrayNav } from "@/app/use-tray-nav";
import { useUpdater } from "@/app/use-updater";
import { AboutDialog } from "@/components/about-dialog";
import { SettingsDialog } from "@/components/settings-dialog";
import { ShortcutsCheatsheet } from "@/components/shortcuts-cheatsheet";
import { invoke } from "@/lib/tauri";
import { ACCENTS, useAppearance } from "@/stores/appearance";
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

/** Apply the accent + reduce-motion + app-icon preferences. */
function useAppliedAppearance() {
  const accent = useAppearance((s) => s.accent);
  const reduceMotion = useAppearance((s) => s.reduceMotion);
  const appIconBg = useAppearance((s) => s.appIconBg);

  useEffect(() => {
    const root = document.documentElement;
    const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0];
    if (a.primary) {
      root.style.setProperty("--primary", a.primary);
      root.style.setProperty("--primary-foreground", a.foreground);
    } else {
      // Violet — let the theme's own light/dark values stand.
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-foreground");
    }
  }, [accent]);

  useEffect(() => {
    document.documentElement.toggleAttribute("data-reduce-motion", reduceMotion);
  }, [reduceMotion]);

  // Swap the macOS Dock icon between the white/black-background variants.
  useEffect(() => {
    void invoke("set_app_icon", { variant: appIconBg }).catch(() => {});
  }, [appIconBg]);
}

export function AppLayout({ children }: { children: ReactNode }) {
  useAuthBootstrap();
  useGlobalShortcuts();
  useClipboardSniff();
  useRealtimeEvents();
  usePrSync();
  useGuidedEvents();
  useDependabotEvents();
  useNativeChrome();
  useNotifSync();
  useUpdater();
  const theme = useAppliedTheme();
  useAppliedAppearance();
  useAppBehaviorSync();
  useTrayNav();

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
      </div>
      <PinboardBar />
      <CommandPalette />
      <SettingsDialog />
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
