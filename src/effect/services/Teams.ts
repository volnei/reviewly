import { Context, Effect, Layer } from "effect";
import { useSyncExternalStore } from "react";

import * as S from "../schema";
import { Tauri } from "../Tauri";

export interface TeamsState {
  readonly loading: boolean;
  readonly signedIn: boolean;
  readonly organizations: ReadonlyArray<S.TeamOrganization>;
}

const listeners = new Set<() => void>();
let state: TeamsState = { loading: true, signedIn: false, organizations: [] };
export const teamsStore = {
  get: () => state,
  set: (next: TeamsState) => {
    state = next;
    for (const listener of listeners) listener();
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
export const useTeams = (): TeamsState =>
  useSyncExternalStore(teamsStore.subscribe, teamsStore.get, teamsStore.get);

export class Teams extends Context.Service<
  Teams,
  {
    readonly bootstrap: Effect.Effect<TeamsState>;
    readonly linkStart: Effect.Effect<S.TeamsLinkStart, import("../errors").AppError>;
    readonly linkPoll: (
      linkId: string,
      deviceCode: string,
    ) => Effect.Effect<S.TeamsLinkPoll, import("../errors").AppError>;
    readonly inbox: (
      organizationId: string,
    ) => Effect.Effect<S.TeamsInbox, import("../errors").AppError>;
    readonly signOut: Effect.Effect<void, import("../errors").AppError>;
  }
>()("reviewly/Teams") {}

export const TeamsLive = Layer.effect(
  Teams,
  Effect.gen(function* () {
    const tauri = yield* Tauri;
    const fromStatus = (status: S.TeamsStatus): TeamsState => ({
      loading: false,
      signedIn: status.signed_in,
      organizations: status.organizations,
    });
    const bootstrap = tauri.invoke("teams_status", {}, S.TeamsStatus).pipe(
      Effect.map(fromStatus),
      Effect.orElseSucceed((): TeamsState => ({
        loading: false,
        signedIn: false,
        organizations: [],
      })),
      Effect.tap((next) => Effect.sync(() => teamsStore.set(next))),
    );
    const linkStart = tauri.invoke("teams_link_start", {}, S.TeamsLinkStart);
    const linkPoll = (linkId: string, deviceCode: string) =>
      tauri.invoke("teams_link_poll", { linkId, deviceCode }, S.TeamsLinkPoll).pipe(
        Effect.tap((answer) =>
          answer.status === "authorized"
            ? Effect.sync(() =>
                teamsStore.set({
                  loading: false,
                  signedIn: true,
                  organizations: answer.organizations,
                }),
              )
            : Effect.void,
        ),
      );
    const inbox = (organizationId: string) =>
      tauri.invoke("teams_inbox", { organizationId }, S.TeamsInbox);
    const signOut = tauri.invoke("teams_sign_out", {}, S.Unit).pipe(
      Effect.tap(() =>
        Effect.sync(() => teamsStore.set({ loading: false, signedIn: false, organizations: [] })),
      ),
      Effect.asVoid,
    );
    return { bootstrap, linkStart, linkPoll, inbox, signOut };
  }),
);
