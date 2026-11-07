import { Effect } from "effect";

import { useTeamsBilling } from "@/app/teams-billing";
import { useEffectQuery } from "@/effect/runtime";
import type { FastLanePolicy, FastLaneRepositoryPolicy, TeamOrganization } from "@/effect/schema";
import { Teams } from "@/effect/services/Teams";

export type FastLaneWorkspacePolicy = {
  readonly organization: TeamOrganization;
  readonly policy: FastLanePolicy;
  readonly repositoryPolicies: ReadonlyArray<FastLaneRepositoryPolicy>;
};

export function isFastLanePolicyDraftDirty(
  draft: FastLanePolicy,
  persisted: FastLanePolicy,
  options: { readonly inherited?: boolean; readonly customizing?: boolean } = {},
): boolean {
  if (options.inherited) return options.customizing === true;
  return JSON.stringify(draft) !== JSON.stringify(persisted);
}

export function enabledFastLanePoliciesByRepository(
  policies: ReadonlyArray<FastLaneWorkspacePolicy> | undefined,
): ReadonlyMap<string, FastLanePolicy> {
  return new Map(
    (policies ?? []).flatMap(({ policy: workspacePolicy, repositoryPolicies }) =>
      repositoryPolicies.flatMap(({ repository, policy }) => {
        const resolved = policy ?? workspacePolicy;
        return resolved.enabled ? [[repository.toLowerCase(), resolved] as const] : [];
      }),
    ),
  );
}

export const fastLanePoliciesKey = (organizationIds: ReadonlyArray<string>) => [
  "teams",
  "fast-lane",
  organizationIds.join(","),
];

export function useFastLanePolicies(organizationId?: string | null) {
  const billing = useTeamsBilling();
  const accounts =
    billing.data?.filter(
      (account) =>
        account.billing.access &&
        (organizationId === undefined || account.organization.id === organizationId),
    ) ?? [];
  const organizationIds = accounts.map(({ organization }) => organization.id);

  return useEffectQuery(
    fastLanePoliciesKey(organizationIds),
    Effect.flatMap(Teams, (service) =>
      Effect.forEach(
        accounts,
        ({
          organization,
        }): Effect.Effect<FastLaneWorkspacePolicy, import("@/effect/errors").AppError> =>
          Effect.all({
            policy: service.fastLanePolicy(organization.id),
            repositoryPolicies: service.fastLaneRepositoryPolicies(organization.id),
          }).pipe(
            Effect.map(({ policy, repositoryPolicies }) => ({
              organization,
              policy,
              repositoryPolicies: repositoryPolicies.repositories,
            })),
          ),
        { concurrency: 3 },
      ),
    ),
    { enabled: organizationIds.length > 0, staleTime: 30_000 },
  );
}
