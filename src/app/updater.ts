import { toast } from "@/app/toast";
import { isNative } from "@/effect/Tauri";
import { APP_STORE } from "@/lib/edition";
import { useEffect } from "react";

type Update = NonNullable<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>>;

const CHECK_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

let checkInFlight: Promise<Update | null> | null = null;
let installing = false;

/** One native updater request at a time. Settings and the launch check can overlap. */
async function findUpdate(): Promise<Update | null> {
  if (checkInFlight) return checkInFlight;
  checkInFlight = import("@tauri-apps/plugin-updater")
    .then(({ check }) => check({ timeout: CHECK_TIMEOUT_MS }))
    .finally(() => {
      checkInFlight = null;
    });
  return checkInFlight;
}

async function install(update: Update) {
  if (installing) {
    toast.say("The update is already downloading");
    return;
  }
  installing = true;
  toast.say(`Downloading ${update.version}…`);
  try {
    await update.downloadAndInstall(undefined, { timeout: DOWNLOAD_TIMEOUT_MS });
    toast.done("Installed. Restarting…");
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    toast.fail("The update didn’t install", e);
  } finally {
    installing = false;
  }
}

const offer = (update: Update) =>
  toast.act(`${update.version} is ready`, "Restart & install", () => void install(update));

/** Settings → About → Check for updates: says what it found, either way. */
export async function checkForUpdates(): Promise<void> {
  if (APP_STORE) return;
  if (!isNative()) {
    toast.say("Updates come with the desktop app");
    return;
  }
  try {
    const update = await findUpdate();
    if (update) offer(update);
    else toast.done("You’re on the latest version");
  } catch (e) {
    toast.fail("Couldn’t check for updates", e);
  }
}

/** A quiet check on launch: speaks only when there is something to install. */
export function useUpdater() {
  useEffect(() => {
    // The App Store updates the store build itself.
    if (APP_STORE || !isNative()) return;
    let cancelled = false;
    void (async () => {
      try {
        const update = await findUpdate();
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
