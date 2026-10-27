import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Open an external URL in the system browser, swallowing the rejection that
 * happens outside Tauri (e.g. in a plain browser dev session). The single place
 * external links are opened.
 */
export function safeOpenUrl(url: string): void {
  void openUrl(url).catch(() => {});
}
