import { Data } from "effect";
import { failureText, recoveryHint } from "@/lib/reliability";

/** A Tauri command rejected. `message` is the Rust-side error string. */
export class TauriError extends Data.TaggedError("TauriError")<{
  readonly cmd: string;
  readonly message: string;
}> {}

/** A command answered, but not in the shape the schema expects. */
export class DecodeError extends Data.TaggedError("DecodeError")<{
  readonly cmd: string;
  readonly message: string;
}> {}

/** The user is not signed in to GitHub (first run, or signed out). */
class NotSignedIn extends Data.TaggedError("NotSignedIn")<Record<never, never>> {}

export type AppError = TauriError | DecodeError | NotSignedIn;

/** One sentence for a toast or an inline notice. */
export function describeError(e: unknown): string {
  if (e instanceof TauriError) return failureText(e.message || `${e.cmd} failed`);
  if (e instanceof DecodeError) return `Unexpected answer from ${e.cmd}`;
  if (e instanceof NotSignedIn) return "Sign in to GitHub first";
  return failureText(e);
}

/** A second sentence reserved for persistent error states, not transient toasts. */
export const describeRecovery = (e: unknown): string => recoveryHint(e);
