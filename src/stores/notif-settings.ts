import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Desktop (OS) notification settings — distinct from `notif-prefs`, which is
 * the in-app Notifications page filter. Synced to the Rust poller via
 * `set_notifications_enabled`; the poller's only alert today is a review
 * request, so this gates exactly that. */
interface State {
  /** Show an OS notification when a PR requests your review. */
  desktopEnabled: boolean;
  setDesktopEnabled: (v: boolean) => void;
}

export const useNotifSettings = create<State>()(
  persist(
    (set) => ({
      desktopEnabled: true,
      setDesktopEnabled: (desktopEnabled) => set({ desktopEnabled }),
    }),
    { name: "reviewly.notif-settings", storage: sqlStorage<State>() },
  ),
);
