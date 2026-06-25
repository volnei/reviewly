import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Notification reasons the desktop poller can alert on (mirror the GitHub
 * Notifications API `reason` field). */
export type NotifReason = "review_requested" | "mention" | "comment" | "ci_activity";

export const NOTIF_REASONS: { id: NotifReason; label: string; description: string }[] = [
  { id: "review_requested", label: "Review requested", description: "A PR asks for your review." },
  { id: "mention", label: "Mentions", description: "You're @-mentioned on a PR or issue." },
  { id: "comment", label: "Comments", description: "New comments on threads you follow." },
  { id: "ci_activity", label: "CI activity", description: "Checks finish on your PRs." },
];

/** Desktop (OS) notification settings — distinct from `notif-prefs`, which is
 * the in-app Notifications page filter. Synced to the Rust poller via
 * `set_notifications_enabled` / `set_notification_reasons` / `set_poll_interval`. */
interface State {
  /** Master gate — show OS notifications at all. */
  desktopEnabled: boolean;
  setDesktopEnabled: (v: boolean) => void;
  /** Which reasons may raise an alert (when desktop notifications are on). */
  reasons: Record<NotifReason, boolean>;
  setReason: (r: NotifReason, on: boolean) => void;
  /** How often the poller checks GitHub, in seconds. */
  pollSecs: number;
  setPollSecs: (s: number) => void;
}

export const useNotifSettings = create<State>()(
  persist(
    (set) => ({
      desktopEnabled: true,
      setDesktopEnabled: (desktopEnabled) => set({ desktopEnabled }),
      reasons: { review_requested: true, mention: true, comment: true, ci_activity: true },
      setReason: (r, on) => set((s) => ({ reasons: { ...s.reasons, [r]: on } })),
      pollSecs: 60,
      setPollSecs: (pollSecs) => set({ pollSecs }),
    }),
    { name: "reviewly.notif-settings", storage: sqlStorage<State>() },
  ),
);
