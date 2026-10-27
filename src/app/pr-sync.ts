import { isNative } from "@/effect/Tauri";
import { useAuth } from "@/effect/services/Auth";
import { usePrefs } from "@/effect/services/Prefs";
import { syncPrs } from "@/lib/pr-sync";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** Keep the persistent mirror fresh without blocking the UI on GitHub. */
export function usePrSync(): void {
  const queryClient = useQueryClient();
  const auth = useAuth();
  const watched = usePrefs((prefs) => prefs.watchedRepos);

  useEffect(() => {
    if (!isNative() || !auth.signedIn || !watched.length) return;
    // A persisted watermark makes this incremental after the first launch.
    void syncPrs(queryClient, watched);
  }, [auth.signedIn, queryClient, watched]);

  useEffect(() => {
    if (!isNative() || !auth.signedIn || !watched.length) return;
    const onFocus = () => void syncPrs(queryClient, watched);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [auth.signedIn, queryClient, watched]);

  useEffect(() => {
    if (!isNative() || !auth.signedIn || !watched.length) return;
    let passes = 0;
    const timer = window.setInterval(() => {
      passes += 1;
      // Deltas are cheap; a periodic full pass repairs missed/deleted rows.
      void syncPrs(queryClient, watched, passes % 40 === 0);
    }, 90_000);
    return () => window.clearInterval(timer);
  }, [auth.signedIn, queryClient, watched]);
}
