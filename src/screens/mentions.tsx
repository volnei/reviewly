import { useKeyScope } from "@/app/keys";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { useWorkspaceInbox } from "@/app/workspace";
import { IconButton } from "@/components/icon-button";
import { run } from "@/effect/runtime";
import { GitHub } from "@/effect/services/GitHub";
import { isMention } from "@/effect/services/Inbox";
import { prefsStore } from "@/effect/services/Prefs";
import { persistedStore, useStore } from "@/effect/store";
import { recordHistory } from "@/features/history/store";
import { Chips, FilterBar, applyFilter, isFiltering, useListFilter } from "@/features/list/filters";
import { List, ListHead, Nothing } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { CheckCheck } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "./inbox";
import { PrPeek } from "./pr-peek";

type View = "mentions" | "reviews" | "all";
const VIEWS: ReadonlyArray<[View, string]> = [
  ["mentions", "Mentions"],
  ["reviews", "Reviews & comments"],
  ["all", "Everything"],
];
const mentionsView = persistedStore<View>("reviewly.v2.mentions-view", "mentions", (raw) =>
  raw === "reviews" || raw === "all" ? raw : "mentions",
);

/**
 * Where someone wrote your name and is waiting for an answer. The two wider
 * views are the rest of your GitHub notifications: review requests and
 * comments, then everything. 1 2 3 switch them.
 */
export function MentionsScreen() {
  const root = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const inbox = useWorkspaceInbox();
  useKeepScroll("mentions", root, !!inbox.data);
  const open = useOpenItem();
  const { done, snooze, snoozeFor, unsnooze, checkout } = useItemActions();
  const view = useStore(mentionsView);
  const pick = useCallback((v: View) => {
    mentionsView.set(v);
  }, []);
  const all = useMemo(() => {
    const ns = inbox.data?.notifications ?? [];
    if (view === "mentions") return ns.filter((n) => isMention(n.reason ?? ""));
    if (view === "reviews")
      return ns.filter((n) => n.reason === "review_requested" || n.reason === "comment");
    return ns;
  }, [inbox.data, view]);
  const [filter, setFilter] = useListFilter("mentions");
  const items = useMemo(() => applyFilter(all, filter), [all, filter]);

  useKeyScope(
    "mentions-views",
    useCallback(
      (e: KeyboardEvent) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        const i = ["1", "2", "3"].indexOf(e.key);
        if (i < 0) return false;
        pick(VIEWS[i][0]);
        return true;
      },
      [pick],
    ),
  );

  // Every one of these read at once, on GitHub too. Undo brings them back here; GitHub keeps them read.
  const markAll = useCallback(async () => {
    const ids = items.map((i) => i.id);
    if (!ids.length) return;
    try {
      await run(
        Effect.flatMap(GitHub, (g) =>
          Effect.forEach(
            items,
            (item) =>
              item.notificationId ? g.markNotificationRead(item.notificationId) : Effect.void,
            { concurrency: 4 },
          ),
        ),
      );
    } catch (e) {
      toast.fail("GitHub didn’t take it", e);
      return;
    }
    prefsStore.update((p) => ({ ...p, done: [...p.done, ...ids] }));
    recordHistory({
      source: "inbox",
      title: `Marked ${ids.length} notification${ids.length === 1 ? "" : "s"} read`,
      detail: view === "all" ? "All notifications" : VIEWS.find(([key]) => key === view)?.[1],
    });
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    toast.act(`Marked ${ids.length} read`, "Undo", () => {
      prefsStore.update((p) => ({ ...p, done: p.done.filter((d) => !ids.includes(d)) }));
      void qc.invalidateQueries({ queryKey: ["inbox"] });
    });
  }, [items, qc, view]);

  useTitleSlot(
    <>
      <TitleSearch />
      <span className="flex-1" />
      <RefreshButton />
      <IconButton label="Mark all read" onClick={markAll} disabled={items.length === 0}>
        <CheckCheck className="size-4" strokeWidth={1.75} />
      </IconButton>
    </>,
    "desk",
    [items.length, markAll],
  );

  const blurb =
    view === "mentions"
      ? items.length
        ? `${items.length} waiting for a word from you.`
        : "Nobody is waiting on a word from you."
      : items.length
        ? `${items.length} unread.`
        : "Nothing unread.";
  return (
    <div
      ref={root}
      className="work-list screen-enter h-full overflow-y-auto bg-desk scrollbar-thin"
    >
      <ListHead title="Mentions">{inbox.data ? blurb : "Looking at GitHub…"}</ListHead>
      {inbox.data ? (
        <FilterBar
          id="mentions"
          items={all}
          filter={filter}
          set={setFilter}
          show={{ repos: true, authors: true, bots: true }}
          lead={<Chips label="Notifications" value={view} onChange={pick} options={VIEWS} />}
        />
      ) : null}
      {inbox.data ? (
        <List
          label="Mentions"
          sections={[{ key: view, items }]}
          actions={{ open, done, snooze, snoozeFor, unsnooze, checkout }}
          renderPeek={(it) =>
            it.kind === "pr" || it.kind === "mention" ? <PrPeek item={it} /> : null
          }
          empty={
            isFiltering(filter) ? (
              <Nothing detail="Try removing a filter or searching for something broader.">
                No notifications match this view
              </Nothing>
            ) : view === "mentions" ? (
              <Nothing detail="When someone mentions you in a pull request or issue, it will land here.">
                Nobody has mentioned you lately
              </Nothing>
            ) : (
              <Nothing detail="New reviews and comments from GitHub will appear here automatically.">
                You’re all caught up
              </Nothing>
            )
          }
        />
      ) : null}
    </div>
  );
}
