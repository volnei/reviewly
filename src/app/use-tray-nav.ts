import { subscribe } from "@/lib/tauri";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

type TrayRoute = "/" | "/prs" | "/notifications" | "/dependabot" | "/settings";

/** Navigate when the tray's quick-nav menu fires `tray:navigate` with a route. */
export function useTrayNav() {
  const navigate = useNavigate();
  useEffect(() => {
    const unlisten = subscribe<string>("tray:navigate", (e) => {
      navigate({ to: e.payload as TrayRoute });
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, [navigate]);
}
