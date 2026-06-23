import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect } from "react";
import { toast } from "sonner";

/** Run a download+install of an available update, then relaunch. Surfaces
 * progress via toasts. */
async function installUpdate(update: Awaited<ReturnType<typeof check>>) {
  if (!update) return;
  const id = toast.loading(`Downloading v${update.version}…`);
  try {
    await update.downloadAndInstall();
    toast.success("Update installed — restarting…", { id });
    await relaunch();
  } catch (e) {
    toast.error(`Update failed — ${String(e)}`, { id });
  }
}

/** Offer to install an available update (persistent toast with a Restart action). */
function offerUpdate(update: NonNullable<Awaited<ReturnType<typeof check>>>) {
  toast(`Update available — v${update.version}`, {
    description: "A new version of Reviewly is ready.",
    duration: Number.POSITIVE_INFINITY,
    action: { label: "Restart & install", onClick: () => void installUpdate(update) },
  });
}

/**
 * Manual "Check for updates" — gives explicit feedback (checking / up to date /
 * found / error), unlike the silent boot check.
 */
export async function checkForUpdates(): Promise<void> {
  const id = toast.loading("Checking for updates…");
  try {
    const update = await check();
    toast.dismiss(id);
    if (update) offerUpdate(update);
    else toast.success("You're on the latest version.");
  } catch (e) {
    toast.error(`Couldn't check for updates — ${String(e)}`, { id });
  }
}

/**
 * Silent update check on launch. Stays quiet when there's nothing to do or the
 * updater isn't reachable/configured (no endpoint yet) — only speaks up when an
 * update is genuinely available.
 */
export function useUpdater() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await check();
        if (!cancelled && update) offerUpdate(update);
      } catch {
        // Offline / no release yet / not configured — stay silent.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
