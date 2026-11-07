import { Context, Effect, Layer, Schema } from "effect";
import { useSyncExternalStore } from "react";

import * as S from "../schema";
import { Tauri } from "../Tauri";

export interface TeamsState {
  readonly loading: boolean;
  readonly signedIn: boolean;
  readonly organizations: ReadonlyArray<S.TeamOrganization>;
}

export function teamsStateAfterBootstrapFailure(current: TeamsState): TeamsState {
  return { ...current, loading: false };
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
    readonly installUrl: Effect.Effect<string, import("../errors").AppError>;
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
    readonly repositories: (
      organizationId: string,
    ) => Effect.Effect<S.TeamRepositories, import("../errors").AppError>;
    readonly fastLaneRepositoryPolicies: (
      organizationId: string,
    ) => Effect.Effect<S.FastLaneRepositoryPolicies, import("../errors").AppError>;
    readonly updateFastLanePolicy: (
      organizationId: string,
      policy: S.FastLanePolicy,
    ) => Effect.Effect<S.FastLanePolicy, import("../errors").AppError>;
    readonly updateFastLaneRepositoryPolicy: (
      organizationId: string,
      repository: string,
      policy: S.FastLanePolicy,
    ) => Effect.Effect<S.FastLaneRepositoryPolicy, import("../errors").AppError>;
    readonly resetFastLaneRepositoryPolicy: (
      organizationId: string,
      repository: string,
    ) => Effect.Effect<S.FastLaneRepositoryPolicy, import("../errors").AppError>;
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
    readonly environments: (
      organizationId: string,
    ) => Effect.Effect<S.TeamEnvironments, import("../errors").AppError>;
    readonly createEnvironment: (
      organizationId: string,
      environment: unknown,
    ) => Effect.Effect<string, import("../errors").AppError>;
    readonly updateEnvironment: (
      organizationId: string,
      environmentId: string,
      environment: unknown,
    ) => Effect.Effect<void, import("../errors").AppError>;
    readonly deleteEnvironment: (
      organizationId: string,
      environmentId: string,
    ) => Effect.Effect<void, import("../errors").AppError>;
    readonly runEnvironmentCommand: (
      organizationId: string,
      environmentId: string,
      command: S.EnvironmentCommand,
      cwd: string,
    ) => Effect.Effect<S.CommandRunResult, import("../errors").AppError>;
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
      Effect.orElseSucceed(() => teamsStateAfterBootstrapFailure(teamsStore.get())),
      Effect.tap((next) => Effect.sync(() => teamsStore.set(next))),
    );
    const installUrl = tauri.invoke("teams_install_url", {}, Schema.String);
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
    const repositories = (organizationId: string) =>
      tauri.invoke("teams_repositories", { organizationId }, S.TeamRepositories);
    const fastLaneRepositoryPolicies = (organizationId: string) =>
      tauri.invoke(
        "teams_fast_lane_repository_policies",
        { organizationId },
        S.FastLaneRepositoryPolicies,
      );
    const updateFastLanePolicy = (organizationId: string, policy: S.FastLanePolicy) =>
      tauri.invoke("teams_fast_lane_policy_update", { organizationId, policy }, S.FastLanePolicy);
    const updateFastLaneRepositoryPolicy = (
      organizationId: string,
      repository: string,
      policy: S.FastLanePolicy,
    ) =>
      tauri.invoke(
        "teams_fast_lane_repository_policy_update",
        { organizationId, repository, policy },
        S.FastLaneRepositoryPolicy,
      );
    const resetFastLaneRepositoryPolicy = (organizationId: string, repository: string) =>
      tauri.invoke(
        "teams_fast_lane_repository_policy_reset",
        { organizationId, repository },
        S.FastLaneRepositoryPolicy,
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
      tauri.invoke("teams_integration_start", { organizationId, provider }, S.TeamsBillingUrl);
    const environments = (organizationId: string) =>
      tauri.invoke("teams_environments", { organizationId }, S.TeamEnvironments);
    const createEnvironment = (organizationId: string, environment: unknown) =>
      tauri
        .invoke(
          "teams_environment_create",
          { organizationId, environment },
          Schema.Struct({ id: Schema.String }),
        )
        .pipe(Effect.map((created) => created.id));
    const updateEnvironment = (
      organizationId: string,
      environmentId: string,
      environment: unknown,
    ) =>
      tauri
        .invoke("teams_environment_update", { organizationId, environmentId, environment }, S.Unit)
        .pipe(Effect.asVoid);
    const deleteEnvironment = (organizationId: string, environmentId: string) =>
      tauri
        .invoke("teams_environment_delete", { organizationId, environmentId }, S.Unit)
        .pipe(Effect.asVoid);
    const runEnvironmentCommand = (
      organizationId: string,
      environmentId: string,
      command: S.EnvironmentCommand,
      cwd: string,
    ) =>
      tauri.invoke(
        "teams_environment_command_run",
        {
          organizationId,
          environmentId,
          commandId: command.id,
          expectedCommand: command.command,
          expectedWorkingDirectory: command.workingDirectory,
          expectedTimeoutSeconds: command.timeoutSeconds,
          cwd,
        },
        S.CommandRunResult,
      );
    const signOut = tauri
      .invoke("teams_sign_out", {}, S.Unit)
      .pipe(
        Effect.ensuring(
          Effect.sync(() => teamsStore.set({ loading: false, signedIn: false, organizations: [] })),
        ),
        Effect.asVoid,
      );
    return {
      bootstrap,
      installUrl,
      linkStart,
      linkPoll,
      inbox,
      updateQueue,
      fastLanePolicy,
      repositories,
      fastLaneRepositoryPolicies,
      updateFastLanePolicy,
      updateFastLaneRepositoryPolicy,
      resetFastLaneRepositoryPolicy,
      billing,
      checkout,
      billingPortal,
      integrations,
      integrationStart,
      environments,
      createEnvironment,
      updateEnvironment,
      deleteEnvironment,
      runEnvironmentCommand,
      signOut,
    };
  }),
);
