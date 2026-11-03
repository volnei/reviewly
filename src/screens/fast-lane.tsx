import { useRef } from "react";

import { useFastLaneItems } from "@/app/fast-lane-items";
import { useTitleSlot } from "@/app/title-slot";
import { List, ListHead, Nothing } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "@/screens/inbox";
import { PrPeek } from "@/screens/pr-peek";

export function FastLaneScreen() {
  const root = useRef<HTMLDivElement>(null);
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

  const empty = fastLane.isError ? (
    <Nothing kind="error" detail="Check your connection and try again.">
      Couldn’t check the Fast lane configuration
    </Nothing>
  ) : fastLane.workspace && !fastLane.isPending && !fastLane.isConnected ? (
    <Nothing detail="Connect this repository or switch workspaces.">
      Fast lane isn’t configured for <span className="font-mono">{fastLane.workspace}</span>
    </Nothing>
  ) : fastLane.workspace && !fastLane.isPending && !fastLane.isConfigured ? (
    <Nothing detail="Enable it in Teams settings or switch workspaces.">
      Fast lane is off for <span className="font-mono">{fastLane.workspace}</span>
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
      <ListHead title="Fast lane">
        {fastLane.isPending
          ? "Checking your team policy…"
          : `${fastLane.items.length} routine PR${fastLane.items.length === 1 ? "" : "s"}, safely out of the main queue.`}
      </ListHead>
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
