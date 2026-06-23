import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

/**
 * Open an external URL in the system browser, swallowing the rejection that
 * happens outside Tauri (e.g. in a plain browser dev session). The single place
 * external links are opened, so behaviour (and any future confirm/logging) is
 * centralized instead of scattered as `openUrl(x).catch(() => {})`.
 */
export function safeOpenUrl(url: string): void {
  void openUrl(url).catch(() => {});
}

/**
 * Error toasts linger longer than the default success toast — a failure is
 * worth reading, and the Toaster's `closeButton` lets you dismiss it early.
 */
export const ERROR_TOAST_DURATION = 8000;

/**
 * Standard TanStack-mutation error handler — surfaces the error as a toast.
 * Use as `onError: toastError` so every mutation reports failures the same way
 * (and we can enrich error formatting/logging in one spot later).
 */
export function toastError(e: unknown): void {
  toast.error(String(e), { duration: ERROR_TOAST_DURATION });
}

/**
 * Error toast with a one-click **Retry** — for failed actions worth re-running
 * (submit review, checkout, merge). Keeps the failure recoverable in place.
 */
export function toastRetry(message: string, retry: () => void): void {
  toast.error(message, {
    duration: ERROR_TOAST_DURATION,
    action: { label: "Retry", onClick: retry },
  });
}
