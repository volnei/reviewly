import { type QueryKey, type UseQueryOptions, useQuery } from "@tanstack/react-query";
import { type Effect, Layer, ManagedRuntime } from "effect";
import { type Tauri, TauriLive, isNative } from "./Tauri";
import { TauriFixtures } from "./fixtures";
import { type Ai, AiLive } from "./services/Ai";
import { type AppSettings, AppSettingsLive } from "./services/AppSettings";
import { type Auth, AuthLive } from "./services/Auth";
import { type Git, GitLive } from "./services/Git";
import { type GitHub, GitHubLive } from "./services/GitHub";
import { type Inbox, InboxLive } from "./services/Inbox";
import { PrefsLive, type PrefsService } from "./services/Prefs";
import { type Triage, TriageRules } from "./services/Triage";

/**
 * The application layer. Inside the Tauri shell the Rust side answers; in a
 * plain browser (`bun run dev`) the fixtures do, so every screen can be built
 * and looked at without GitHub.
 */
const TauriLayer = isNative() ? TauriLive : TauriFixtures;

const AppLayer = Layer.mergeAll(
  TauriLayer,
  PrefsLive,
  TriageRules,
  AuthLive.pipe(Layer.provide(TauriLayer)),
  GitHubLive.pipe(Layer.provide(TauriLayer)),
  GitLive.pipe(Layer.provide(TauriLayer)),
  AppSettingsLive.pipe(Layer.provide(TauriLayer)),
  AiLive.pipe(Layer.provide(Layer.mergeAll(TauriLayer, PrefsLive))),
  InboxLive.pipe(
    Layer.provide(
      Layer.mergeAll(GitHubLive.pipe(Layer.provide(TauriLayer)), PrefsLive, TriageRules),
    ),
  ),
);

export type AppServices =
  | Tauri
  | PrefsService
  | Triage
  | Auth
  | GitHub
  | Git
  | AppSettings
  | Inbox
  | Ai;

export const runtime = ManagedRuntime.make(AppLayer);

/** Run an effect against the app runtime; rejections carry the typed error. */
export const run = <A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> =>
  runtime.runPromise(effect);

/** A TanStack query whose fetcher is an Effect. The cache is Query's; the work is Effect's. */
export function useEffectQuery<A, E, TData = A>(
  queryKey: QueryKey,
  effect: Effect.Effect<A, E, AppServices>,
  options?: Omit<UseQueryOptions<A, E, TData, QueryKey>, "queryKey" | "queryFn">,
) {
  return useQuery<A, E, TData, QueryKey>({ queryKey, queryFn: () => run(effect), ...options });
}
