import { Context, Effect, Layer, Schema } from "effect";
import { useSyncExternalStore } from "react";
import { Tauri } from "../Tauri";
import * as S from "../schema";

export interface AuthState {
  readonly loading: boolean;
  readonly signedIn: boolean;
  readonly viewer: S.Viewer | null;
}

const listeners = new Set<() => void>();
let state: AuthState = { loading: true, signedIn: false, viewer: null };
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
    readonly ghCliAvailable: Effect.Effect<boolean>;
    readonly useGhCli: Effect.Effect<S.Viewer, import("../errors").AppError>;
    readonly signOut: Effect.Effect<void, import("../errors").AppError>;
  }
>()("reviewly/Auth") {}

export const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const t = yield* Tauri;

    const signedIn = (viewer: S.Viewer) =>
      authStore.set({ loading: false, signedIn: true, viewer });

    const bootstrap = t.invoke("auth_status", {}, S.AuthStatus).pipe(
      Effect.map((s) => ({ loading: false, signedIn: s.signed_in, viewer: s.viewer })),
      Effect.orElseSucceed((): AuthState => ({ loading: false, signedIn: false, viewer: null })),
      Effect.tap((s) => Effect.sync(() => authStore.set(s))),
    );

    const deviceStart = t.invoke("auth_device_start", {}, S.DeviceStart);
    const devicePoll = Effect.fn("Auth.devicePoll")(function* (
      deviceCode: string,
      interval: number,
    ) {
      const viewer = yield* t.invoke("auth_device_poll", { deviceCode, interval }, S.Viewer);
      signedIn(viewer);
      return viewer;
    });
    const ghCliAvailable = t
      .invoke("auth_gh_available", {}, Schema.Boolean)
      .pipe(Effect.orElseSucceed(() => false));
    const useGhCli = t
      .invoke("auth_use_gh_cli", {}, S.Viewer)
      .pipe(Effect.tap((v) => Effect.sync(() => signedIn(v))));
    const signOut = t.invoke("auth_sign_out", {}, S.Unit).pipe(
      Effect.tap(() =>
        Effect.sync(() => authStore.set({ loading: false, signedIn: false, viewer: null })),
      ),
      Effect.asVoid,
    );

    return { bootstrap, deviceStart, devicePoll, ghCliAvailable, useGhCli, signOut };
  }),
);
