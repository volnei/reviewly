import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { toast } from "@/app/toast";
import { useAuth } from "@/effect/services/Auth";
import { isNative } from "@/effect/Tauri";
import { parsePrRef } from "@/lib/pr-ref";

/**
 * Copy a pull request link anywhere and the app offers to open it. The
 * clipboard plugin has no change event, so this looks every few seconds; a
 * link you ignored or dismissed is never offered twice.
 */
export function useClipboardSniff() {
  const navigate = useNavigate();
  const auth = useAuth();
  useEffect(() => {
    if (!isNative()) return;
    let last: string | null = null;
    let stopped = false;
    const offered = new Set<string>();
    let read: (() => Promise<string>) | null = null;
    const tick = async () => {
      try {
        if (!read) read = (await import("@tauri-apps/plugin-clipboard-manager")).readText;
        const text = (await read()).trim();
        if (stopped || !text || text === last) return;
        last = text;
        const ref = parsePrRef(text, auth.host);
        if (!ref) return;
        const key = `${ref.owner}/${ref.repo}#${ref.number}`;
        if (offered.has(key)) return;
        offered.add(key);
        toast.act(`Open ${key}?`, "Open", () =>
          navigate({
            to: "/pr/$owner/$repo/$number",
            params: { owner: ref.owner, repo: ref.repo, number: String(ref.number) },
          }),
        );
      } catch {
        /* clipboard not readable right now */
      }
    };
    const timer = window.setInterval(tick, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [navigate, auth.host]);
}
