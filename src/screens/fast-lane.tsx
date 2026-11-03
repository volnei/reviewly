import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useFastLaneItems } from "@/app/fast-lane-items";
import { useTeamsPlan } from "@/app/teams-billing";
import { useTitleSlot } from "@/app/title-slot";
import { TeamsWorkspaceSelect } from "@/components/teams-workspace-select";
import { List, Nothing } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "@/screens/inbox";
import { PrPeek } from "@/screens/pr-peek";

export function FastLaneScreen() {
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const teamsPlan = useTeamsPlan();
  const fastLane = useFastLaneItems();
  const open = useOpenItem();
  const { done, snooze, snoozeFor, checkout } = useItemActions();
  useKeepScroll("fast-lane", root, !fastLane.isPending);
  useTitleSlot(
    <>
      <TitleSearch />
      <span className="flex-1" />
      <RefreshButton />
    </>,
    "desk",
  );
  useEffect(() => {
    if (teamsPlan === "hobby") void navigate({ to: "/team", replace: true });
  }, [navigate, teamsPlan]);

  if (teamsPlan !== "teams") {
    return (
      <div className="h-full bg-desk p-8" role="status">
        <span className="sr-only">Checking your Teams plan</span>
        <div className="h-7 w-32 rounded-sm bg-raise" />
        <div className="mt-3 h-3 w-72 max-w-full rounded-sm bg-raise" />
      </div>
    );
  }

  const empty = fastLane.isError ? (
    <Nothing kind="error" detail="Check your connection and try again.">
      Couldn’t check the Fast lane configuration
    </Nothing>
  ) : fastLane.organization && !fastLane.isPending && !fastLane.isConnected ? (
    <Nothing detail="Connect repositories in Teams settings or switch workspaces.">
      Fast lane has no connected repositories for{" "}
      <span className="font-mono">{fastLane.organization.login}</span>
    </Nothing>
  ) : fastLane.organization && !fastLane.isPending && !fastLane.isConfigured ? (
    <Nothing detail="Enable it in Teams settings or switch workspaces.">
      Fast lane is off for <span className="font-mono">{fastLane.organization.login}</span>
    </Nothing>
  ) : (
    <Nothing detail="PRs appear here when they match every rule defined by your team.">
      The track is clear
    </Nothing>
  );

  return (
    <div
      ref={root}
      className="work-list screen-enter h-full overflow-y-auto bg-desk scrollbar-thin"
    >
      <header className="list-head flex items-start justify-between gap-5 px-5 pt-6 pb-4">
        <div className="min-w-0">
          <h1 className="text-[20px] font-medium tracking-[-0.025em] text-ink">Fast lane</h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {fastLane.isPending
              ? "Checking your team policy…"
              : `${fastLane.items.length} routine PR${fastLane.items.length === 1 ? "" : "s"}, safely out of the main queue.`}
          </p>
        </div>
        <TeamsWorkspaceSelect
          organizations={fastLane.organizations}
          value={fastLane.organizationId}
          onValueChange={fastLane.setOrganizationId}
        />
      </header>
      <List
        label="Fast lane"
        sections={[{ key: "fast-lane", items: fastLane.items }]}
        actions={{ open, done, snooze, snoozeFor, checkout }}
        renderPeek={(item) => <PrPeek item={item} />}
        empty={empty}
      />
    </div>
  );
}
