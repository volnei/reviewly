import { parseGuided } from "@/lib/guided";
import { subscribe } from "@/lib/tauri";
import { useGuided } from "@/stores/guided";
import { useGuidedGen } from "@/stores/guided-gen";
import { useEffect } from "react";
import { toast } from "sonner";

interface AiDone {
  key: string;
  ok: boolean;
  output?: string;
  error?: string;
  provider?: string;
  headSha?: string;
  canceled?: boolean;
}

/**
 * Bridge the backend `ai:done` event (a guided-tour generation finished in its
 * Rust background task) into the stores. Mounted app-wide, so a tour started on
 * one screen still lands even after you navigate away or refresh — the result is
 * written to the persisted `useGuided` store whenever it completes.
 */
export function useGuidedEvents() {
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      unsub = await subscribe<AiDone>("ai:done", (e) => {
        const { key, ok, output, error, provider, headSha, canceled } = e.payload;
        const gen = useGuidedGen.getState();
        gen.done(key);
        // Canceled by the user — just clear the pending state, no error/toast.
        if (canceled) return;
        // `key` is `owner/repo#number` — show a friendly short ref in the toast.
        const ref = key.split("/").pop() ?? key;
        if (!ok) {
          gen.fail(key, error ?? "The AI review failed.");
          toast.error(`Guided tour failed · ${ref}`);
          return;
        }
        const plan = parseGuided(output ?? "");
        if (!plan) {
          gen.fail(key, "The AI didn't return a usable tour. Try again.");
          toast.error(`Guided tour failed · ${ref}`);
          return;
        }
        useGuided.getState().set(key, plan, { headSha: headSha ?? "", provider: provider ?? "" });
        toast.success(`Guided tour ready · ${ref}`);
      });
    })();
    return () => unsub?.();
  }, []);
}
