import { useEffect } from "react";

/**
 * Native-app polish: suppress the WebView's default right-click menu (Reload,
 * Back/Forward, Inspect Element, …) everywhere except real text fields, where
 * the Cut/Copy/Paste menu is genuinely useful. Mounted once in the app layout.
 */
export function useNativeChrome() {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      // Keep the native menu on editable fields (paste/cut/copy still work).
      if (t?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);
}
