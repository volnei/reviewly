import { useEffect, useMemo } from "react";

import { useTeamsBilling } from "@/app/teams-billing";
import { persistedStore, useStore } from "@/effect/store";

export const teamsWorkspaceStore = persistedStore<string | null>(
  "reviewly.v2.teams-workspace",
  null,
  (raw) => (typeof raw === "string" && raw.length > 0 ? raw : null),
);

/** One paid Teams workspace shared by every Teams-only screen. */
export function useTeamsWorkspace() {
  const billing = useTeamsBilling();
  const storedOrganizationId = useStore(teamsWorkspaceStore);
  const accounts = useMemo(
    () => billing.data?.filter((account) => account.billing.access) ?? [],
    [billing.data],
  );
  const organizationId = accounts.some(
    ({ organization }) => organization.id === storedOrganizationId,
  )
    ? storedOrganizationId
    : (accounts[0]?.organization.id ?? null);

  useEffect(() => {
    if (organizationId !== storedOrganizationId) teamsWorkspaceStore.set(organizationId);
  }, [organizationId, storedOrganizationId]);

  return {
    accounts,
    organizations: accounts.map(({ organization }) => organization),
    organization: accounts.find(({ organization }) => organization.id === organizationId)
      ?.organization,
    organizationId,
    setOrganizationId: (next: string) => {
      if (accounts.some(({ organization }) => organization.id === next)) {
        teamsWorkspaceStore.set(next);
      }
    },
    isPending: billing.isPending,
    isError: billing.isError,
  };
}
