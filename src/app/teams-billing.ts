import { Effect } from "effect";

import type { AppError } from "@/effect/errors";
import { useEffectQuery } from "@/effect/runtime";
import type { TeamBilling, TeamOrganization } from "@/effect/schema";
import { Teams, useTeams } from "@/effect/services/Teams";

export type TeamsBillingAccount = {
  readonly organization: TeamOrganization;
  readonly billing: TeamBilling;
};

export function useTeamsBilling() {
  const teams = useTeams();
  const organizationKey = teams.organizations.map((organization) => organization.id).join(",");

  return useEffectQuery(
    ["teams", "billing", organizationKey],
    Effect.flatMap(Teams, (service) =>
      Effect.forEach(
        teams.organizations,
        (organization): Effect.Effect<TeamsBillingAccount, AppError> =>
          service
            .billing(organization.id)
            .pipe(Effect.map((billing) => ({ organization, billing }))),
        { concurrency: 3 },
      ),
    ),
    {
      enabled: teams.signedIn && teams.organizations.length > 0,
      staleTime: 30_000,
    },
  );
}

export function useTeamsPlan(): "hobby" | "teams" | null {
  const teams = useTeams();
  const billing = useTeamsBilling();

  if (teams.loading) return null;
  if (!teams.signedIn || teams.organizations.length === 0) return "hobby";
  if (!billing.data) return null;
  return billing.data.some((account) => account.billing.access) ? "teams" : "hobby";
}
