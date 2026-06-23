import { syncWatched } from "@/lib/sync";
import type { Viewer } from "@/lib/tauri";
import { invoke, subscribe } from "@/lib/tauri";
import { useAuth } from "@/stores/auth";
import { usePrFilters } from "@/stores/pr-filters";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Bridge background-worker events (pr:new, pr:tick, auth:ready) into
 * TanStack Query invalidations + the auth store, so the UI auto-refreshes
 * without scattering listeners across every route.
 */
export function useRealtimeEvents() {
  const qc = useQueryClient();
  const setAuth = useAuth((s) => s.set);

  useEffect(() => {
    let unsubs: Array<() => void> = [];

    // GitHub moved → for watched repos, reconcile the local DB (sync owns the
    // ["prs","db"] invalidation); otherwise refetch the search-backed list.
    const refresh = () => {
      const repos = useWatchedRepos.getState().repos;
      if (repos.length > 0) {
        const states = usePrFilters.getState().states;
        const listState = states.includes("merged") || states.includes("closed") ? "all" : "open";
        void syncWatched(qc, repos, listState);
      } else {
        qc.invalidateQueries({ queryKey: ["prs"] });
      }
      // The inbox (dashboard) lives outside ["prs","db"], so syncWatched doesn't
      // touch it — refresh it (and the review queue) on any detected change.
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["prs", "review-requested"] });
    };

    (async () => {
      const u1 = await subscribe<number[]>("pr:new", () => {
        refresh();
        qc.invalidateQueries({ queryKey: ["notifications"] });
      });
      const u2 = await subscribe<number>("pr:tick", (event) => {
        // Total pending-review count every cycle → menu-bar tray only. We no
        // longer refetch the lists here; that happens on `pr:changed`, so an
        // unchanged cycle costs nothing.
        const count = event.payload ?? 0;
        invoke<void>("tray_set_title", { title: count > 0 ? String(count) : "" }).catch(() => {
          /* tray not available (linux/win) */
        });
      });
      // Only reconcile when the poller's delta saw real changes.
      const u5 = await subscribe<number>("pr:changed", () => {
        refresh();
      });
      // Targeted: the poller saw movement in specific watched repos → reconcile
      // just those into the local DB (sync owns the ["prs","db"] invalidation).
      const u6 = await subscribe<string[]>("repos:changed", (event) => {
        const watched = useWatchedRepos.getState().repos;
        const moved = (event.payload ?? []).filter((r) => watched.includes(r));
        if (moved.length === 0) return;
        const states = usePrFilters.getState().states;
        const listState = states.includes("merged") || states.includes("closed") ? "all" : "open";
        void syncWatched(qc, moved, listState);
      });
      const u3 = await subscribe<Viewer>("auth:ready", (event) => {
        setAuth({ signedIn: true, viewer: event.payload, loading: false });
        qc.invalidateQueries();
      });
      const u4 = await subscribe<unknown>("auth:signed_out", () => {
        setAuth({ signedIn: false, viewer: null, loading: false });
        qc.clear();
      });
      unsubs.push(u1, u2, u3, u4, u5, u6);
    })();

    return () => {
      for (const u of unsubs) u();
      unsubs = [];
    };
  }, [qc, setAuth]);
}
