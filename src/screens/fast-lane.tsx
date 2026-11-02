import { useRef } from "react";

import { useFastLaneItems } from "@/app/fast-lane-items";
import { useTitleSlot } from "@/app/title-slot";
import { List, ListHead, Nothing } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { PrPeek } from "@/screens/pr-peek";
import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "@/screens/inbox";

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

  return (
    <div ref={root} className="work-list screen-enter h-full overflow-y-auto bg-desk scrollbar-thin">
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
        empty={
          <Nothing detail="PRs appear here when they match every rule defined by your team.">
            The track is clear
          </Nothing>
        }
      />
    </div>
  );
}
