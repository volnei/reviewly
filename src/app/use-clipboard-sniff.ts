import { parsePullUrl } from "@/lib/tauri";
import { useNavigate } from "@tanstack/react-router";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Poll the OS clipboard for a github.com PR URL — when found, offer a
 * toast that jumps straight to the PR detail page. Polling rather than
 * subscribing because the Tauri clipboard plugin doesn't expose a
 * change event yet.
 */
export function useClipboardSniff() {
  const navigate = useNavigate();

  useEffect(() => {
    let last: string | null = null;
    let cancelled = false;
    // URLs the user has explicitly dismissed — never re-suggest them, even when
    // the same link cycles back through the clipboard.
    const dismissed = new Set<string>();

    async function tick() {
      try {
        const text = (await readText()).trim();
        if (cancelled || !text || text === last) return;
        last = text;
        const parsed = parsePullUrl(text);
        if (!parsed) return;
        const key = `${parsed.owner}/${parsed.repo}#${parsed.number}`;
        if (dismissed.has(key)) return;
        toast(`Open ${key}?`, {
          // Stable id keyed on the PR → re-copying the same link updates the
          // existing toast instead of stacking duplicates; duration auto-expires
          // a suggestion you ignore.
          id: `clipboard-pr:${key}`,
          duration: 8000,
          // Remember a dismissal (manual or auto-close) so it isn't re-shown
          // every clipboard cycle.
          onDismiss: () => dismissed.add(key),
          onAutoClose: () => dismissed.add(key),
          action: {
            label: "Open",
            onClick: () => {
              dismissed.add(key);
              navigate({
                to: "/prs/$owner/$repo/$number",
                params: {
                  owner: parsed.owner,
                  repo: parsed.repo,
                  number: String(parsed.number),
                },
              });
            },
          },
        });
      } catch {
        /* clipboard plugin not available */
      }
    }

    const interval = window.setInterval(tick, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [navigate]);
}
