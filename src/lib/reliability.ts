export type FailureKind =
  | "auth"
  | "permission"
  | "not-found"
  | "validation"
  | "rate-limit"
  | "offline"
  | "timeout"
  | "server"
  | "decode"
  | "canceled"
  | "unknown";

/** Normalize errors from Effect, Tauri, fetch and the AI CLIs before showing or classifying them. */
export function failureText(error: unknown): string {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "Unknown error");
  return raw
    .replace(/^(Error|TauriError|AiError|FiberFailure):\s*/i, "")
    .replace(/^An error has occurred\s*/i, "")
    .trim();
}

export function classifyFailure(error: unknown): FailureKind {
  const text = failureText(error).toLowerCase();
  if (/cancel(?:ed|led)|interrupted|abort(?:ed)?/.test(text)) return "canceled";
  if (/not signed in|sign in|login|unauthori[sz]ed|\b401\b|expired (?:token|session)/.test(text))
    return "auth";
  if (/forbidden|permission|missing.*scope|\b403\b/.test(text)) return "permission";
  if (/rate.?limit|too many requests|secondary limit|\b429\b/.test(text)) return "rate-limit";
  if (/offline|network|connection|dns|socket|failed to fetch|host unreachable/.test(text))
    return "offline";
  if (/timed? out|timeout|deadline|took longer than|no activity for/.test(text))
    return "timeout";
  if (/unexpected answer|decode|deseriali[sz]|invalid (?:json|response|payload)/.test(text))
    return "decode";
  if (/\b404\b|not found|no longer exists/.test(text)) return "not-found";
  if (/\b400\b|\b409\b|\b422\b|validation|unprocessable/.test(text)) return "validation";
  if (/\b5\d\d\b|server error|bad gateway|service unavailable|upstream/.test(text)) return "server";
  return "unknown";
}

export function retryLimit(error: unknown): number {
  switch (classifyFailure(error)) {
    case "rate-limit":
      return 4;
    case "offline":
    case "timeout":
    case "server":
      return 3;
    case "unknown":
      return 2;
    default:
      return 0;
  }
}

/** TanStack passes the number of failures already observed. */
export const shouldRetry = (failureCount: number, error: unknown): boolean =>
  failureCount < retryLimit(error);

function serverDelay(text: string): number | null {
  const seconds = text.match(/retry[- ]after[:= ]+(\d+)/i)?.[1];
  if (seconds) return Number(seconds) * 1000;
  const wait = text.match(/(?:try again|reset) in (\d+)\s*(ms|milliseconds?|s|seconds?)/i);
  if (!wait) return null;
  return Number(wait[1]) * (/^m/i.test(wait[2]) ? 1 : 1000);
}

export function retryDelay(attempt: number, error: unknown): number {
  const explicit = serverDelay(failureText(error));
  if (explicit != null) return Math.min(Math.max(explicit, 250), 60_000);
  const base = classifyFailure(error) === "rate-limit" ? 2_000 : 650;
  // Deterministic jitter prevents every query in a PR from retrying on the same millisecond.
  const jitter = ((attempt + 1) * 137) % 300;
  return Math.min(base * 2 ** attempt + jitter, 30_000);
}

export function recoveryHint(error: unknown): string {
  switch (classifyFailure(error)) {
    case "auth":
      return "Sign in again, then retry.";
    case "permission":
      return "Reconnect GitHub to grant the missing permission.";
    case "rate-limit":
      return "GitHub is limiting requests. Reviewly will retry automatically.";
    case "offline":
      return "Showing cached data where possible. It will retry when the connection returns.";
    case "timeout":
      return "The request took too long. Retry, or narrow the operation.";
    case "server":
      return "The service is temporarily unavailable. Reviewly will retry automatically.";
    case "decode":
      return "The service returned an unexpected response. Refresh before trying again.";
    case "not-found":
      return "This item may have been removed or made private.";
    case "validation":
      return "Refresh the pull request before trying the action again.";
    case "canceled":
      return "Canceled.";
    default:
      return "Try again. Existing cached data has been kept.";
  }
}

export const aiCanRetryAutomatically = (error: unknown, receivedCharacters: number): boolean =>
  receivedCharacters === 0 && retryLimit(error) > 0 && classifyFailure(error) !== "rate-limit";
