import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import { DecodeError, TauriError } from "./errors";

/**
 * The only door to the Rust side. Every command is invoked through `invoke`,
 * with the schema of what it answers, so nothing untyped leaks upward; every
 * backend event is a `Stream`, or a raw listener when the caller must be
 * subscribed before it fires the command (the AI stream).
 */
export interface TauriShape {
  /** True inside the Tauri shell; false in a plain browser (dev fixtures). */
  readonly native: boolean;
  readonly invoke: <A>(
    cmd: string,
    args: Record<string, unknown>,
    schema: Schema.Codec<A, unknown>,
  ) => Effect.Effect<A, TauriError | DecodeError>;
  /** Events emitted by the Rust workers (`pr:changed`, `auth:ready`, `ai:chunk`…). */
  readonly events: <A>(name: string, schema: Schema.Codec<A, unknown>) => Stream.Stream<A>;
  /** Subscribe now, get the unsubscribe back. Payloads that don't decode are dropped. */
  readonly listen: <A>(
    name: string,
    schema: Schema.Codec<A, unknown>,
    handler: (a: A) => void,
  ) => Effect.Effect<() => void>;
}

export class Tauri extends Context.Service<Tauri, TauriShape>()("reviewly/Tauri") {}

export const isNative = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The real thing: `@tauri-apps/api` behind Effect. */
export const TauriLive = Layer.effect(
  Tauri,
  Effect.gen(function* () {
    const invoke = <A>(
      cmd: string,
      args: Record<string, unknown>,
      schema: Schema.Codec<A, unknown>,
    ) =>
      Effect.tryPromise({
        try: () => tauriInvoke<unknown>(cmd, args),
        catch: (e) => new TauriError({ cmd, message: errorText(e) }),
      }).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(schema)(raw).pipe(
            Effect.mapError((issue) => new DecodeError({ cmd, message: String(issue) })),
          ),
        ),
        Effect.tap((result) =>
          Effect.promise(() =>
            import("@/features/history/commands").then(({ recordCompletedCommand }) =>
              recordCompletedCommand(cmd, args, result),
            ),
          ),
        ),
        Effect.withSpan(`tauri.${cmd}`),
      );

    const listen = <A>(name: string, schema: Schema.Codec<A, unknown>, handler: (a: A) => void) => {
      const decode = Schema.decodeUnknownSync(schema);
      return Effect.promise(() =>
        tauriListen<unknown>(name, (ev) => {
          try {
            handler(decode(ev.payload));
          } catch {
            /* a payload we don't understand is not an event */
          }
        }),
      );
    };

    const events = <A>(name: string, schema: Schema.Codec<A, unknown>) =>
      Stream.callback<A>((queue) =>
        Effect.acquireRelease(
          listen(name, schema, (a) => void Queue.offerUnsafe(queue, a)),
          (unlisten) => Effect.sync(() => unlisten()),
        ).pipe(Effect.asVoid),
      );

    return { native: true, invoke, events, listen } satisfies TauriShape;
  }),
);

function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e)
    return String((e as { message: unknown }).message);
  return String(e);
}
