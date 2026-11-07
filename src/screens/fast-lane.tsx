import { useNavigate } from "@tanstack/react-router";
import { Gauge, ShieldCheck, TrainFront, type LucideIcon } from "lucide-react";
import { useRef } from "react";

import { useFastLaneItems } from "@/app/fast-lane-items";
import { settingsCategoryStore } from "@/app/settings-navigation";
import { useTeamsPlan } from "@/app/teams-billing";
import { useTitleSlot } from "@/app/title-slot";
import { TeamsWorkspaceSelect } from "@/components/teams-workspace-select";
import { Button } from "@/components/ui/button";
import { List, Nothing } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "@/screens/inbox";
import { PrPeek } from "@/screens/pr-peek";

export function FastLaneScreen() {
  const root = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const teamsPlan = useTeamsPlan();
  const fastLane = useFastLaneItems();
  const open = useOpenItem("fast-lane");
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
  if (teamsPlan === null) {
    return (
      <div className="h-full bg-desk p-8" role="status">
        <span className="sr-only">Checking your Teams plan</span>
        <div className="h-7 w-32 rounded-sm bg-raise" />
        <div className="mt-3 h-3 w-72 max-w-full rounded-sm bg-raise" />
      </div>
    );
  }

  if (teamsPlan === "hobby") {
    return (
      <div className="team-gate h-full overflow-y-auto bg-desk text-ink scrollbar-thin">
        <header className="team-gate-header">
          <p>Fast lane · Reviewly Teams</p>
          <h1>Routine changes keep moving.</h1>
          <span>
            Your team defines the exact rules. Reviewly separates matching pull requests without
            approving or merging them.
          </span>
        </header>
        <div className="team-gate-surface">
          <section className="team-gate-capabilities" aria-label="Fast lane capabilities">
            <FastLaneGateCapability
              icon={TrainFront}
              title="A queue for routine work"
              detail="Keep low-risk dependency, documentation and maintenance changes out of the main queue."
            />
            <FastLaneGateCapability
              icon={Gauge}
              title="Rules owned by the team"
              detail="Set limits for files, changed lines, authors, labels and paths per workspace."
            />
            <FastLaneGateCapability
              icon={ShieldCheck}
              title="Never an automatic approval"
              detail="Fast lane only changes where a review waits. GitHub protections remain in control."
            />
          </section>
          <aside className="team-gate-plan" aria-label="Unlock Fast lane">
            <div>
              <p>Teams feature</p>
              <h2>Fast lane follows the workspace, not the local repository.</h2>
            </div>
            <Button
              size="sm"
              onClick={() => {
                settingsCategoryStore.set("teams");
                void navigate({ to: "/settings" });
              }}
            >
              Set up Reviewly Teams
            </Button>
            <span>Connect a GitHub organization and choose the repositories your team controls.</span>
          </aside>
        </div>
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
        renderPeek={(item) => <PrPeek item={item} origin="fast-lane" />}
        empty={empty}
      />
    </div>
  );
}

function FastLaneGateCapability({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="team-gate-capability">
      <Icon size={18} />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}
