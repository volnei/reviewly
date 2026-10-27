import { toast } from "@/app/toast";
import { isNative } from "@/effect/Tauri";
import { useEffect } from "react";

type Update = NonNullable<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>>;

async function install(update: Update) {
  toast.say(`Downloading ${update.version}…`);
  try {
    await update.downloadAndInstall();
    toast.done("Installed. Restarting…");
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    toast.fail("The update didn’t install", e);
  }
}

const offer = (update: Update) =>
  toast.act(`${update.version} is ready`, "Restart & install", () => void install(update));

/** Settings → About → Check for updates: says what it found, either way. */
export async function checkForUpdates(): Promise<void> {
  if (!isNative()) {
    toast.say("Updates come with the desktop app");
    return;
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) offer(update);
    else toast.done("You’re on the latest version");
  } catch (e) {
    toast.fail("Couldn’t check for updates", e);
  }
}

/** A quiet check on launch: speaks only when there is something to install. */
export function useUpdater() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const update = await check();
        if (!cancelled && update) offer(update);
      } catch {
        /* offline, or no release yet */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
