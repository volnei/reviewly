import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { isNative } from "@/effect/Tauri";
import { prefsStore } from "@/effect/services/Prefs";
import { WHATS_NEW, cmpVersion } from "@/lib/whats-new";
import { useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let open = false;
const store = {
  get: () => open,
  set: (o: boolean) => {
    open = o;
    for (const l of listeners) l();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
export const openWhatsNew = () => store.set(true);

/** After an update, once: what changed. Also from Settings → About. */
export function useWhatsNew() {
  useEffect(() => {
    if (!isNative()) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((version) => {
        const seen = prefsStore.get().lastSeenVersion;
        if (seen && cmpVersion(version, seen) > 0 && WHATS_NEW.some((e) => e.version === version))
          store.set(true);
        if (seen !== version) prefsStore.update((p) => ({ ...p, lastSeenVersion: version }));
      })
      .catch(() => {});
  }, []);
}

export function WhatsNewDialog() {
  const isOpen = useSyncExternalStore(store.subscribe, store.get, store.get);
  return (
    <Dialog open={isOpen} onOpenChange={store.set}>
      <DialogPopup className="max-w-[560px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">What’s new</DialogTitle>
          <DialogDescription className="text-[12.5px] text-ink-3">
            The releases, newest first.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid max-h-[60vh] gap-5 overflow-y-auto px-6 scrollbar-thin">
          {WHATS_NEW.map((e) => (
            <section key={e.version}>
              <h3 className="flex items-baseline gap-2 text-[13px] font-medium text-ink">
                {e.version}
                {e.date ? (
                  <span className="tnum text-[11.5px] font-normal text-ink-3">{e.date}</span>
                ) : null}
              </h3>
              <ul className="mt-1.5 grid gap-1.5">
                {e.items.map((it) => (
                  <li key={it.title} className="text-[13px]">
                    <span className="text-ink">{it.title}</span>
                    {it.detail ? <span className="text-ink-2"> — {it.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </DialogPanel>
        <DialogFooter className="px-6 pb-5">
          <button
            type="button"
            onClick={() => store.set(false)}
            className="h-7 rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
          >
            Close
          </button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
