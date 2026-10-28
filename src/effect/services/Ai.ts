import { Cause, Context, Data, Effect, Layer, Queue, Schema, Stream } from "effect";
import { Tauri } from "../Tauri";
import * as S from "../schema";
import { PrefsService } from "./Prefs";
import { APP_STORE } from "@/lib/edition";

/**
 * The review assistant: a CLI on this machine (claude, codex, gemini) or an
 * OpenAI-compatible endpoint, driven by the Rust side. One run = one key;
 * the answer arrives as `ai:chunk` deltas and ends with `ai:complete`.
 */
export class AiError extends Data.TaggedError("AiError")<{ readonly message: string }> {}

const ALL_PROVIDERS = [
  ["claude", "Claude CLI"],
  ["codex", "Codex CLI"],
  ["gemini", "Gemini CLI"],
  ["openai", "OpenAI-compatible endpoint"],
] as const;
export type Provider = (typeof ALL_PROVIDERS)[number][0];
/** The App Store edition can't spawn CLIs from the sandbox: endpoint only. */
export const PROVIDERS: ReadonlyArray<(typeof ALL_PROVIDERS)[number]> = APP_STORE
  ? ALL_PROVIDERS.filter(([id]) => id === "openai")
  : ALL_PROVIDERS;

/** The short name the UI says ("Reading with Claude…"). */
export const providerName = (p: string): string =>
  ({ claude: "Claude", codex: "Codex", gemini: "Gemini", openai: "your model" })[p] ?? p;

export const MODEL_SUGGESTIONS: Record<Provider, ReadonlyArray<string>> = {
  claude: ["sonnet", "opus", "haiku", "claude-opus-5", "claude-sonnet-5", "claude-fable-5-1"],
  codex: ["gpt-5-codex", "gpt-5", "o3", "o4-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openai: [],
};

const Chunk = Schema.Struct({ key: Schema.String, delta: Schema.String });
const Progress = Schema.Struct({
  key: Schema.String,
  provider: Schema.String,
  phase: Schema.String,
  message: Schema.String,
  model: Schema.optionalKey(Schema.NullOr(Schema.String)),
  sessionId: Schema.optionalKey(Schema.NullOr(Schema.String)),
  inputTokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  outputTokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  cachedTokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  costUsd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  durationMs: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  turns: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
export interface AiProgress extends Schema.Schema.Type<typeof Progress> {}
const Complete = Schema.Struct({
  key: Schema.String,
  ok: Schema.Boolean,
  output: Schema.optionalKey(Schema.NullOr(Schema.String)),
  error: Schema.optionalKey(Schema.NullOr(Schema.String)),
  costUsd: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});
const Done = Schema.Struct({ key: Schema.String, canceled: Schema.optionalKey(Schema.Boolean) });

export class Ai extends Context.Service<
  Ai,
  {
    readonly available: (provider: string) => Effect.Effect<boolean>;
    /** Deltas as they come; ends when the model is done, fails when it couldn't answer. */
    readonly stream: (
      key: string,
      prompt: string,
      cwd?: string,
      onProgress?: (progress: AiProgress) => void,
    ) => Stream.Stream<string, AiError>;
    /** Explicit edit mode for a local implementation workflow. Never commits or pushes. */
    readonly apply: (prompt: string, cwd: string) => Effect.Effect<string, AiError>;
    readonly cancel: (key: string) => Effect.Effect<void>;
  }
>()("reviewly/Ai") {}

export const AiLive = Layer.effect(
  Ai,
  Effect.gen(function* () {
    const t = yield* Tauri;
    const prefs = yield* PrefsService;

    const available = (provider: string) =>
      t
        .invoke("ai_available", { provider }, Schema.Boolean)
        .pipe(Effect.orElseSucceed(() => false));

    const cancel = (key: string) =>
      t.invoke("ai_cancel", { key }, S.Unit).pipe(
        Effect.asVoid,
        Effect.orElseSucceed(() => undefined),
      );

    const stream = (
      key: string,
      prompt: string,
      cwd?: string,
      onProgress?: (progress: AiProgress) => void,
    ) =>
      Stream.callback<string, AiError>((queue) =>
        Effect.gen(function* () {
          const state = { characters: 0, done: false };
          // listeners first, so the first delta can't slip past
          const unChunk = yield* t.listen("ai:chunk", Chunk, (c) => {
            if (c.key !== key || state.done || !c.delta) return;
            state.characters += c.delta.length;
            Queue.offerUnsafe(queue, c.delta);
          });
          const unProgress = yield* t.listen("ai:progress", Progress, (progress) => {
            if (progress.key === key && !state.done) onProgress?.(progress);
          });
          const unDone = yield* t.listen("ai:complete", Complete, (c) => {
            if (c.key !== key || state.done) return;
            state.done = true;
            if (c.ok) {
              // The final event carries the complete answer. It recovers a rare
              // lost first chunk without duplicating a stream we already saw.
              if (state.characters === 0 && c.output) Queue.offerUnsafe(queue, c.output);
              if (state.characters === 0 && !c.output) {
                Queue.failCauseUnsafe(
                  queue,
                  Cause.fail(new AiError({ message: "The model finished without an answer." })),
                );
              } else Queue.endUnsafe(queue);
            } else
              Queue.failCauseUnsafe(
                queue,
                Cause.fail(
                  new AiError({ message: c.error ?? "The model stopped without an answer." }),
                ),
              );
          });
          const unCancel = yield* t.listen("ai:done", Done, (d) => {
            if (d.key === key && d.canceled && !state.done) {
              state.done = true;
              Queue.endUnsafe(queue);
            }
          });
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              unChunk();
              unProgress();
              unDone();
              unCancel();
            }),
          );
          const a = (yield* prefs.get).ai;
          yield* t
            .invoke(
              "ai_stream",
              {
                key,
                provider: a.provider,
                prompt,
                cwd: cwd ?? null,
                baseUrl: a.baseUrl || null,
                model: a.model || null,
                apiKey: a.apiKey || null,
                timeoutSecs: a.timeoutSecs > 0 ? a.timeoutSecs : null,
              },
              S.Unit,
            )
            .pipe(Effect.mapError((e) => new AiError({ message: e.message })));
        }),
      );

    const apply = (prompt: string, cwd: string) =>
      Effect.gen(function* () {
        const a = (yield* prefs.get).ai;
        return yield* t
          .invoke(
            "ai_apply",
            {
              provider: a.provider,
              prompt,
              cwd,
              model: a.model || null,
            },
            Schema.String,
          )
          .pipe(Effect.mapError((error) => new AiError({ message: error.message })));
      });

    return { available, stream, apply, cancel };
  }),
);
