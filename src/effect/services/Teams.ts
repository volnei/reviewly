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
    readonly updateQueue: (
      organizationId: string,
      update: S.TeamQueueUpdate,
    ) => Effect.Effect<void, import("../errors").AppError>;
    readonly fastLanePolicy: (
      organizationId: string,
    ) => Effect.Effect<S.FastLanePolicy, import("../errors").AppError>;
    readonly updateFastLanePolicy: (
      organizationId: string,
      policy: S.FastLanePolicy,
    ) => Effect.Effect<S.FastLanePolicy, import("../errors").AppError>;
    readonly billing: (
      organizationId: string,
    ) => Effect.Effect<S.TeamBilling, import("../errors").AppError>;
    readonly checkout: (
      organizationId: string,
    ) => Effect.Effect<S.TeamsBillingUrl, import("../errors").AppError>;
    readonly billingPortal: (
      organizationId: string,
    ) => Effect.Effect<S.TeamsBillingUrl, import("../errors").AppError>;
    readonly integrations: (
      organizationId: string,
    ) => Effect.Effect<S.TeamIntegrations, import("../errors").AppError>;
    readonly integrationStart: (
      organizationId: string,
      provider: "gitlab" | "slack",
    ) => Effect.Effect<S.TeamsBillingUrl, import("../errors").AppError>;
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
    const updateQueue = (organizationId: string, update: S.TeamQueueUpdate) =>
      tauri.invoke("teams_queue_update", { organizationId, update }, S.Unit).pipe(Effect.asVoid);
    const fastLanePolicy = (organizationId: string) =>
      tauri.invoke("teams_fast_lane_policy", { organizationId }, S.FastLanePolicy);
    const updateFastLanePolicy = (organizationId: string, policy: S.FastLanePolicy) =>
      tauri.invoke(
        "teams_fast_lane_policy_update",
        { organizationId, policy },
        S.FastLanePolicy,
      );
    const billing = (organizationId: string) =>
      tauri.invoke("teams_billing", { organizationId }, S.TeamBilling);
    const checkout = (organizationId: string) =>
      tauri.invoke("teams_checkout", { organizationId }, S.TeamsBillingUrl);
    const billingPortal = (organizationId: string) =>
      tauri.invoke("teams_billing_portal", { organizationId }, S.TeamsBillingUrl);
    const integrations = (organizationId: string) =>
      tauri.invoke("teams_integrations", { organizationId }, S.TeamIntegrations);
    const integrationStart = (organizationId: string, provider: "gitlab" | "slack") =>
      tauri.invoke(
        "teams_integration_start",
        { organizationId, provider },
        S.TeamsBillingUrl,
      );
    const signOut = tauri.invoke("teams_sign_out", {}, S.Unit).pipe(
      Effect.tap(() =>
        Effect.sync(() => teamsStore.set({ loading: false, signedIn: false, organizations: [] })),
      ),
      Effect.asVoid,
    );
    return {
      bootstrap,
      linkStart,
      linkPoll,
      inbox,
      updateQueue,
      fastLanePolicy,
      updateFastLanePolicy,
      billing,
      checkout,
      billingPortal,
      integrations,
      integrationStart,
      signOut,
    };
  }),
);
