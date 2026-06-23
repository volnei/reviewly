import type { ListState } from "@/lib/prs-db";
import { syncWatched } from "@/lib/sync";
import { invoke } from "@/lib/tauri";
import { usePrFilters } from "@/stores/pr-filters";
import { useWatchedRepos } from "@/stores/watched-repos";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/**
 * Aggressively keep the local `prs` store in sync with GitHub for the watched
 * repos. Triggers: app start, watched/listState change (full reconcile, prunes),
 * window focus (delta), and a ~90s interval (every 5th run is a full reconcile).
 * Poller events (`pr:changed`/`pr:new`) also call syncWatched — see
 * src/app/use-realtime-events.ts. The list UI reads from the DB; this feeds it.
 */
export function usePrSync() {
  const qc = useQueryClient();
  const watched = useWatchedRepos((s) => s.repos);
  const states = usePrFilters((s) => s.states);
  const listState: ListState =
    states.includes("merged") || states.includes("closed") ? "all" : "open";

  // Push the watched list to the Rust poller so it can delta-watch those repos
  // and emit `repos:changed` (see src/app/use-realtime-events.ts).
  useEffect(() => {
    void invoke("set_watched_repos", { repos: watched }).catch(() => {
      /* poller not up yet — re-pushed on next change */
    });
  }, [watched]);

  // App start + watched/listState change → full reconcile (re-list open + prune).
  useEffect(() => {
    void syncWatched(qc, watched, listState, { full: true });
  }, [qc, watched, listState]);

  // Window focus → delta sync.
  useEffect(() => {
    const onFocus = () => void syncWatched(qc, watched, listState);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [qc, watched, listState]);

  // Interval fallback (~90s); every 5th run forces a full reconcile so closed
  // PRs get pruned even if no poller event fired.
  useEffect(() => {
    let n = 0;
    const id = window.setInterval(() => {
      void syncWatched(qc, watched, listState, { full: ++n % 5 === 0 });
    }, 90_000);
    return () => window.clearInterval(id);
  }, [qc, watched, listState]);
}
