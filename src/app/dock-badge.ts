import { usePullRequestInbox } from "@/app/workspace";
import { isNative } from "@/effect/Tauri";
import { useEffect } from "react";

/** Tauri clears the native badge when the count is omitted. */
export const nativeInboxBadge = (count: number | undefined): number | undefined =>
  count && count > 0 ? count : undefined;

/** Keep the OS app icon in lockstep with the actionable Inbox shown in the rail. */
export function useDockInboxBadge() {
  const inbox = usePullRequestInbox();
  const count = nativeInboxBadge(inbox.data?.counts.inbox);

  useEffect(() => {
    if (!isNative()) return;
    let current = true;
    void Promise.all([import("@tauri-apps/api/window"), import("@tauri-apps/api/core")])
      .then(([{ getCurrentWindow }, { invoke }]) =>
        current
          ? Promise.all([
              getCurrentWindow().setBadgeCount(count),
              invoke("tray_set_inbox_count", { count: count ?? 0 }),
            ])
          : undefined,
      )
      .catch((error) => console.warn("[dock-badge] could not update badge", error));
    return () => {
      current = false;
    };
  }, [count]);
}
