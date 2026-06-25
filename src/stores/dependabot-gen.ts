import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Tracks Dependabot AI-fix jobs, keyed by alert (`repo#number`).
 *
 * `inFlight` is in-memory — the backend (`dependabot_inflight`) is the source of
 * truth while a fix runs, and it's restored on mount. The *outcome* (`result` =
 * opened PR url, or `error`) is **persisted** to SQLite, so reopening the app
 * still shows "Draft PR opened" / "Fix failed" on the alert you acted on.
 */
interface State {
  inFlight: Record<string, boolean>;
  error: Record<string, string | undefined>;
  /** Opened draft-PR url, once a fix succeeds. */
  result: Record<string, string | undefined>;
  start: (key: string) => void;
  succeed: (key: string, url: string) => void;
  fail: (key: string, message: string) => void;
  /** Re-mark keys as in-flight when restoring from the backend on mount. */
  restore: (keys: string[]) => void;
}

export const useDependabotGen = create<State>()(
  persist(
    (set) => ({
      inFlight: {},
      error: {},
      result: {},
      start: (key) =>
        set((s) => ({
          inFlight: { ...s.inFlight, [key]: true },
          error: { ...s.error, [key]: undefined },
          result: { ...s.result, [key]: undefined },
        })),
      succeed: (key, url) =>
        set((s) => ({
          inFlight: { ...s.inFlight, [key]: false },
          result: { ...s.result, [key]: url },
        })),
      fail: (key, message) =>
        set((s) => ({
          inFlight: { ...s.inFlight, [key]: false },
          error: { ...s.error, [key]: message },
        })),
      restore: (keys) =>
        set((s) => {
          const inFlight = { ...s.inFlight };
          for (const k of keys) inFlight[k] = true;
          return { inFlight };
        }),
    }),
    {
      name: "reviewly.dependabot-fixes",
      storage: sqlStorage<Pick<State, "result" | "error">>(),
      // Persist only the outcome; `inFlight` is recovered from the backend.
      partialize: (s) => ({ result: s.result, error: s.error }),
    },
  ),
);
