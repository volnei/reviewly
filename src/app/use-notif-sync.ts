import { invoke } from "@/lib/tauri";
import { useNotifSettings } from "@/stores/notif-settings";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { useEffect } from "react";

/**
 * Keep the Rust poller's desktop-notification gate in sync with the Settings
 * toggle, and ask the OS for notification permission the first time it's on.
 * Mounted once in the app layout.
 */
export function useNotifSync() {
  const enabled = useNotifSettings((s) => s.desktopEnabled);

  useEffect(() => {
    void invoke("set_notifications_enabled", { enabled });
    if (!enabled) return;
    void (async () => {
      try {
        const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
        // If the user denied at the OS level, flip our toggle off so the UI
        // doesn't promise alerts that can't appear.
        if (!granted) useNotifSettings.getState().setDesktopEnabled(false);
      } catch {
        // Notification plugin unavailable (e.g. non-desktop) — leave as-is.
      }
    })();
  }, [enabled]);
}
