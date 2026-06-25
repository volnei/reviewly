import { invoke } from "@/lib/tauri";
import { useAppBehavior } from "@/stores/app-behavior";
import { useEffect } from "react";

/**
 * Reconcile the OS-backed app-behavior prefs on boot:
 * - seed the Launch-at-login toggle from the real OS autostart state (the OS is
 *   the source of truth — it may have been changed outside the app);
 * - re-assert the Start-in-tray flag file so it matches the persisted pref.
 * Per-toggle changes push to Rust directly from the Settings switches.
 */
export function useAppBehaviorSync() {
  useEffect(() => {
    void (async () => {
      try {
        const actual = await invoke<boolean>("get_launch_at_login");
        useAppBehavior.getState().setLaunchAtLogin(actual);
      } catch {
        // Autostart unavailable (e.g. dev/non-desktop) — leave the pref as-is.
      }
    })();
    void invoke("set_start_in_tray", {
      enabled: useAppBehavior.getState().startInTray,
    }).catch(() => {});
  }, []);
}
