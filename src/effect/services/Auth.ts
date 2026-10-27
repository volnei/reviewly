import { Context, Effect, Layer, Schema } from "effect";
import { useSyncExternalStore } from "react";

import { preparePrCacheForHost } from "@/lib/prs-db";

import * as S from "../schema";
import { Tauri } from "../Tauri";

export interface AuthState {
  readonly loading: boolean;
  readonly signedIn: boolean;
  readonly viewer: S.Viewer | null;
  readonly host: string;
}

const listeners = new Set<() => void>();
let state: AuthState = { loading: true, signedIn: false, viewer: null, host: "github.com" };
export const authStore = {
  get: () => state,
  set: (next: AuthState) => {
    state = next;
    for (const l of listeners) l();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
export const useAuth = (): AuthState =>
  useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);

export const githubWebUrl = (path = "") =>
  `https://${authStore.get().host}${path ? `/${path.replace(/^\/+/, "")}` : ""}`;

export class Auth extends Context.Service<
  Auth,
  {
    /** Ask the backend once and push the answer into the store. */
    readonly bootstrap: Effect.Effect<AuthState>;
    readonly deviceStart: Effect.Effect<S.DeviceStart, import("../errors").AppError>;
    readonly devicePoll: (
      deviceCode: string,
      interval: number,
    ) => Effect.Effect<S.Viewer, import("../errors").AppError>;
    readonly ghCliAvailable: (host: string) => Effect.Effect<boolean>;
    readonly useGhCli: (host: string) => Effect.Effect<S.Viewer, import("../errors").AppError>;
    readonly useToken: (
      host: string,
      token: string,
    ) => Effect.Effect<S.Viewer, import("../errors").AppError>;
    readonly signOut: Effect.Effect<void, import("../errors").AppError>;
  }
>()("reviewly/Auth") {}

export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const t = yield* Tauri;

    const signedIn = (viewer: S.Viewer, host = authStore.get().host) =>
      authStore.set({ loading: false, signedIn: true, viewer, host });

    const prepareHost = (host: string) =>
      Effect.promise(() => preparePrCacheForHost(host)).pipe(Effect.orElseSucceed(() => undefined));

    const bootstrap = t.invoke("auth_status", {}, S.AuthStatus).pipe(
      Effect.map((s) => ({
        loading: false,
        signedIn: s.signed_in,
        viewer: s.viewer,
        host: s.host,
      })),
      Effect.orElseSucceed((): AuthState => ({
        loading: false,
        signedIn: false,
        viewer: null,
        host: "github.com",
      })),
      Effect.tap((s) => (s.signedIn ? prepareHost(s.host) : Effect.void)),
      Effect.tap((s) => Effect.sync(() => authStore.set(s))),
    );

    const deviceStart = t.invoke("auth_device_start", {}, S.DeviceStart);
    const devicePoll = Effect.fn("Auth.devicePoll")(function* (
      deviceCode: string,
      interval: number,
    ) {
      const viewer = yield* t.invoke("auth_device_poll", { deviceCode, interval }, S.Viewer);
      yield* prepareHost("github.com");
      signedIn(viewer, "github.com");
      return viewer;
    });
    const ghCliAvailable = (host: string) =>
      t
        .invoke("auth_gh_available", { host }, Schema.Boolean)
        .pipe(Effect.orElseSucceed(() => false));
    const useGhCli = (host: string) =>
      t
        .invoke("auth_use_gh_cli", { host }, S.Viewer)
        .pipe(Effect.tap(() => prepareHost(host)))
        .pipe(Effect.tap((v) => Effect.sync(() => signedIn(v, host))));
    const useToken = (host: string, token: string) =>
      t
        .invoke("auth_use_token", { host, token }, S.Viewer)
        .pipe(Effect.tap(() => prepareHost(host)))
        .pipe(Effect.tap((v) => Effect.sync(() => signedIn(v, host))));
    const signOut = t.invoke("auth_sign_out", {}, S.Unit).pipe(
      Effect.tap(() =>
        Effect.sync(() =>
          authStore.set({ loading: false, signedIn: false, viewer: null, host: state.host }),
        ),
      ),
      Effect.asVoid,
    );

    return { bootstrap, deviceStart, devicePoll, ghCliAvailable, useGhCli, useToken, signOut };
  }),
);
