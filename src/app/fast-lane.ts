import { Effect } from "effect";

import { useTeamsBilling } from "@/app/teams-billing";
import { useEffectQuery } from "@/effect/runtime";
import type { FastLanePolicy, TeamOrganization } from "@/effect/schema";
import { Teams } from "@/effect/services/Teams";

export type FastLaneWorkspacePolicy = {
  readonly organization: TeamOrganization;
  readonly policy: FastLanePolicy;
  readonly repositories: ReadonlyArray<string>;
};

export function enabledFastLanePoliciesByRepository(
  policies: ReadonlyArray<FastLaneWorkspacePolicy> | undefined,
): ReadonlyMap<string, FastLanePolicy> {
  return new Map(
    (policies ?? []).flatMap(({ policy, repositories }) =>
      policy.enabled
        ? repositories.map((repository) => [repository.toLowerCase(), policy] as const)
        : [],
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
            repositories: service.repositories(organization.id),
          }).pipe(
            Effect.map(({ policy, repositories }) => ({
              organization,
              policy,
              repositories: repositories.repositories,
            })),
          ),
        { concurrency: 3 },
      ),
    ),
    { enabled: organizationIds.length > 0, staleTime: 30_000 },
  );
}
