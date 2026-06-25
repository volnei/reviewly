import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type LandingPage = "/" | "/prs" | "/repos" | "/notifications" | "/dependabot";

interface State {
  /** Ask for a confirmation before a review is actually submitted to GitHub. */
  confirmBeforeSubmit: boolean;
  setConfirmBeforeSubmit: (v: boolean) => void;
  /** Where the app lands on launch (once signed in). */
  defaultLandingPage: LandingPage;
  setDefaultLandingPage: (v: LandingPage) => void;
}

export const useAppBehavior = create<State>()(
  persist(
    (set) => ({
      confirmBeforeSubmit: false,
      setConfirmBeforeSubmit: (confirmBeforeSubmit) => set({ confirmBeforeSubmit }),
      defaultLandingPage: "/",
      setDefaultLandingPage: (defaultLandingPage) => set({ defaultLandingPage }),
    }),
    { name: "reviewly.app-behavior", storage: sqlStorage<State>() },
  ),
);

export const LANDING_OPTIONS: { value: LandingPage; label: string }[] = [
  { value: "/", label: "Dashboard" },
  { value: "/prs", label: "Pull requests" },
  { value: "/repos", label: "Repositories" },
  { value: "/notifications", label: "Notifications" },
  { value: "/dependabot", label: "Dependabot" },
];
