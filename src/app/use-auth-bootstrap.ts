import type { AuthStatus } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { useAppBehavior } from "@/stores/app-behavior";
import { useAuth } from "@/stores/auth";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/**
 * On app boot, ask Rust whether we have valid credentials. If not, send the
 * user to /onboarding. Re-runs whenever the auth state flips.
 */
export function useAuthBootstrap() {
  const { loading, signedIn, set } = useAuth();
  const navigate = useNavigate();
  const { location } = useRouterState();
  const defaultLandingPage = useAppBehavior((s) => s.defaultLandingPage);
  // Only honor the landing-page preference once, on the very first boot — never
  // bounce the user away from "/" when they navigate there later by hand.
  const landed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await invoke<AuthStatus>("auth_status");
        if (cancelled) return;
        set({
          loading: false,
          signedIn: status.signed_in,
          viewer: status.viewer,
        });
      } catch {
        if (!cancelled) set({ loading: false, signedIn: false, viewer: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [set]);

  useEffect(() => {
    if (loading) return;
    const onOnboarding = location.pathname.startsWith("/onboarding");
    // Send unauthenticated users to the wizard. We do NOT auto-bounce a signed-in
    // user OFF /onboarding — the wizard has post-auth steps (pick repos → ready)
    // and navigates to "/" itself when finished.
    if (!signedIn && !onOnboarding) {
      navigate({ to: "/onboarding" });
      return;
    }
    // First signed-in render: honor the preferred landing page if we booted onto
    // the dashboard ("/"). Anything else means a deep link — leave it be.
    if (signedIn && !landed.current) {
      landed.current = true;
      if (defaultLandingPage !== "/" && location.pathname === "/") {
        navigate({ to: defaultLandingPage });
      }
    }
  }, [loading, signedIn, location.pathname, navigate, defaultLandingPage]);
}
