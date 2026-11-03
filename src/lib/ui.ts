import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Open an external URL in the system browser, swallowing the rejection that
 * happens outside Tauri (e.g. in a plain browser dev session). The single place
 * external links are opened.
 */
export function safeOpenUrl(url: string): void {
  const parsed = safeExternalUrl(url);
  if (!parsed) return;
  void openUrl(parsed).catch(() => {});
}

export function safeExternalUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const localDevelopment =
    parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && parsed.protocol !== "mailto:" && !localDevelopment)
    return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}
