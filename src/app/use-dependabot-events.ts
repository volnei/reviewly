import { subscribe } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { useDependabotGen } from "@/stores/dependabot-gen";
import { useEffect } from "react";
import { toast } from "sonner";

interface DependabotDone {
  key: string;
  ok: boolean;
  url?: string;
  error?: string;
  package?: string;
}

/**
 * Bridge the backend `dependabot:done` event (an AI security fix finished in its
 * Rust background task) into the store + a toast. Mounted app-wide, so a fix
 * kicked off on the Dependabot screen still reports its result — the opened PR,
 * or the failure — even after you've navigated away or refreshed.
 */
export function useDependabotEvents() {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      unsub = await subscribe<DependabotDone>("dependabot:done", (e) => {
        const { key, ok, url, error, package: pkg } = e.payload;
        const gen = useDependabotGen.getState();
        const name = pkg ?? key;
        if (!ok || !url) {
          gen.fail(key, error ?? "The AI fix failed.");
          toast.error(`AI fix failed · ${name}`, {
            description: error ? String(error) : undefined,
          });
          return;
        }
        gen.succeed(key, url);
        toast.success(`Draft PR opened · ${name}`, {
          description: "Review the changes on GitHub before merging.",
          action: { label: "Open PR", onClick: () => safeOpenUrl(url) },
        });
      });
    })();
    return () => unsub?.();
  }, []);
}
