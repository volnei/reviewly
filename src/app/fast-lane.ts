import { Effect } from "effect";

import { useTeamsBilling } from "@/app/teams-billing";
import { useEffectQuery } from "@/effect/runtime";
import type { FastLanePolicy, TeamOrganization } from "@/effect/schema";
import { Teams } from "@/effect/services/Teams";

export type FastLaneWorkspacePolicy = {
  readonly organization: TeamOrganization;
  readonly policy: FastLanePolicy;
};

export const fastLanePoliciesKey = (organizationIds: ReadonlyArray<string>) => [
  "teams",
  "fast-lane",
  organizationIds.join(","),
];

export function useFastLanePolicies() {
  const billing = useTeamsBilling();
  const accounts = billing.data?.filter((account) => account.billing.access) ?? [];
  const organizationIds = accounts.map(({ organization }) => organization.id);

  return useEffectQuery(
    fastLanePoliciesKey(organizationIds),
    Effect.flatMap(Teams, (service) =>
      Effect.forEach(
        accounts,
        ({ organization }): Effect.Effect<FastLaneWorkspacePolicy, import("@/effect/errors").AppError> =>
          service
            .fastLanePolicy(organization.id)
            .pipe(Effect.map((policy) => ({ organization, policy }))),
        { concurrency: 3 },
      ),
    ),
    { enabled: organizationIds.length > 0, staleTime: 30_000 },
  );
}
