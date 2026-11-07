import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { enabledFastLanePoliciesByRepository, useFastLanePolicies } from "@/app/fast-lane";
import { overlays } from "@/app/overlays";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { usePullRequestInbox, useWorkspace } from "@/app/workspace";
import { IconButton } from "@/components/icon-button";
import { run, useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { GitHub } from "@/effect/services/GitHub";
import { Inbox, type InboxData } from "@/effect/services/Inbox";
import { prefsStore, tomorrowMorning, usePrefs } from "@/effect/services/Prefs";
import type { Ranked } from "@/effect/services/Triage";
import { isNative } from "@/effect/Tauri";
import {
  type FastLaneFileFacts,
  isFastLane,
  isFastLaneCandidate,
  requiresFastLaneFiles,
} from "@/features/fast-lane";
import { applyFilter, FilterBar, isFiltering, useListFilter } from "@/features/list/filters";
import { List, ListHead, Nothing, type Section } from "@/features/list/list";
import { usePreread } from "@/features/list/preread";
import { age } from "@/features/list/row";
import { useKeepScroll } from "@/features/list/scroll";
import { SNOOZE_LABEL, snoozeUntil, type SnoozeWhen } from "@/features/list/snooze";
import { reconcileStackItems, useWithStacks } from "@/features/list/stacks";
import { APP_STORE } from "@/lib/edition";
import { syncPrs } from "@/lib/pr-sync";
import { safeOpenUrl } from "@/lib/ui";
import type { PrOrigin } from "@/lib/pr-navigation";
import { cn } from "@/lib/utils";

import { PrPeek } from "./pr-peek";

export const inboxQuery = Effect.flatMap(Inbox, (i) => i.load);

/** The field in the title bar of every list: it is the palette's door. */
export function TitleSearch() {
  return (
    <button
      type="button"
      onClick={overlays.openPalette}
      className="flex h-7 w-full max-w-[260px] items-center gap-2 rounded-md bg-raise/70 px-2.5 text-left text-ink-3 hover:bg-raise"
    >
      <Search className="size-3.5 shrink-0" strokeWidth={2} />
      <span className="flex-1 text-[13px]">Jump to anything</span>
      <kbd className="text-[11px] text-ink-3">⌘K</kbd>
    </button>
  );
}

export function useOpenItem(origin: PrOrigin = "inbox") {
  const navigate = useNavigate();
  return useCallback(
    (item: Ranked) => {
      if (
        (item.kind === "pr" || item.kind === "mention") &&
        item.owner &&
        item.repoName &&
        item.number
      ) {
        void navigate({
          to: "/pr/$owner/$repo/$number",
          params: { owner: item.owner, repo: item.repoName, number: String(item.number) },
          search: { from: origin },
        });
        return;
      }
      if (item.url) safeOpenUrl(item.url);
    },
    [navigate, origin],
  );
}

/** The one button that asks GitHub again; it spins only for its own sync. */
export function RefreshButton() {
  const qc = useQueryClient();
  const watched = usePrefs((prefs) => prefs.watchedRepos);
  const [syncing, setSyncing] = useState(false);
  return (
    <IconButton
      label="Refresh from GitHub"
      onClick={() => {
        void qc.invalidateQueries({ queryKey: ["stacks"] });
        if (isNative() && watched.length) {
          setSyncing(true);
          void syncPrs(qc, watched, true).finally(() => setSyncing(false));
        } else {
          void qc.invalidateQueries({ queryKey: ["prs"] });
          void qc.invalidateQueries({ queryKey: ["inbox"] });
        }
      }}
    >
      <RefreshCw className={cn("size-4", syncing && "animate-spin")} strokeWidth={1.75} />
    </IconButton>
  );
}

/** `e` and `s` on a row: out of the Inbox, and the list refreshes. Both undo from the toast. */
export function useItemActions() {
  const qc = useQueryClient();
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ["inbox"] }), [qc]);
  const done = useCallback(
    (item: Ranked) => {
      prefsStore.update((p) => ({ ...p, done: [...p.done, item.id] }));
      recordInboxAction("Marked item done", item);
      refresh();
      toast.act("Done with it — out of your Inbox", "Undo", () => {
        prefsStore.update((p) => ({ ...p, done: p.done.filter((d) => d !== item.id) }));
        recordInboxAction("Returned item to Inbox", item);
        refresh();
      });
      // A mention is a GitHub notification: done here is read there.
      if (item.kind === "mention" && item.notificationId) {
        const id = item.notificationId;
        run(Effect.flatMap(GitHub, (g) => g.markNotificationRead(id))).catch(() => {});
      }
    },
    [refresh],
  );
  const snoozeFor = useCallback(
    (item: Ranked, when: SnoozeWhen) => {
      const until = when === "tomorrow" ? tomorrowMorning() : snoozeUntil(when);
      prefsStore.update((p) => ({ ...p, snoozed: { ...p.snoozed, [item.id]: until } }));
      recordInboxAction(`Snoozed until ${SNOOZE_LABEL[when].toLowerCase()}`, item);
      refresh();
      toast.act(`Snoozed · ${SNOOZE_LABEL[when].toLowerCase()}`, "Undo", () => {
        prefsStore.update((p) => {
          const { [item.id]: _, ...rest } = p.snoozed;
          return { ...p, snoozed: rest };
        });
        recordInboxAction("Removed snooze", item);
        refresh();
      });
    },
    [refresh],
  );
  const snooze = useCallback((item: Ranked) => snoozeFor(item, "tomorrow"), [snoozeFor]);
  const unsnooze = useCallback(
    (item: Ranked) => {
      prefsStore.update((p) => {
        const { [item.id]: _, ...rest } = p.snoozed;
        return { ...p, snoozed: rest };
      });
      recordInboxAction("Returned item to Inbox", item);
      refresh();
      toast.say("Back in the Inbox");
    },
    [refresh],
  );
  /** `c`: the pull request checked out in its clone, when Local knows one. */
  const checkout = useCheckout();
  return { done, snooze, snoozeFor, unsnooze, checkout: APP_STORE ? undefined : checkout };
}

function recordInboxAction(title: string, item: Ranked) {
  void import("@/features/history/store").then(({ recordHistory }) =>
    recordHistory({
      source: "inbox",
      title,
      detail: `${item.repo}${item.number ? ` #${item.number}` : ""} · ${item.title}`,
      repo: item.owner && item.repoName ? `${item.owner}/${item.repoName}` : undefined,
      number: item.number ?? undefined,
    }),
  );
}

function useCheckout() {
  const repos = usePrefs((p) => p.localRepos);
  return useCallback(
    async (item: Ranked) => {
      if (!item.owner || !item.repoName || !item.number) return;
      const owner = item.owner,
        repo = item.repoName,
        number = item.number;
      const infos = await run(
        Effect.forEach(
          repos,
          (path) =>
            Effect.flatMap(Git, (g) => g.repoInfo(path)).pipe(
              Effect.map((i) => ({ path, remote: i.remote_url })),
              Effect.orElseSucceed(() => ({ path, remote: null as string | null })),
            ),
          { concurrency: 4 },
        ),
      ).catch(() => []);
      const clone = infos.find(
        (i) => i.remote && new RegExp(`[/:]${owner}/${repo}(\\.git)?/?$`, "i").test(i.remote),
      )?.path;
      if (!clone) {
        toast.say(
          `No clone of ${owner}/${repo} in Local`,
          "Add it there and `c` checks the PR out.",
        );
        return;
      }
      try {
        await run(Effect.flatMap(Git, (g) => g.checkoutPr(clone, number)));
        toast.done(`Checked out #${number}`, clone);
      } catch (e) {
        toast.fail("The checkout didn’t go through", e);
      }
    },
    [repos],
  );
}

function synced(at: number): string {
  const a = age(new Date(at).toISOString());
  return a === "now" ? "just now" : `${a} ago`;
}

function useFastLaneFileFacts(
  items: ReadonlyArray<Ranked>,
  policies: ReadonlyMap<string, import("@/effect/schema").FastLanePolicy>,
) {
  const candidates = useMemo(
    () =>
      items.filter((item) => {
        const policy = policies.get(item.repo.toLowerCase());
        return (
          policy &&
          requiresFastLaneFiles(policy) &&
          item.owner &&
          item.repoName &&
          item.number &&
          isFastLaneCandidate(item, policy)
        );
      }),
    [items, policies],
  );
  const signature = candidates
    .map((item) => item.id)
    .sort()
    .join(",");

  return useEffectQuery(
    ["teams", "fast-lane", "changed-paths", signature],
    Effect.forEach(
      candidates,
      (item) =>
        Effect.flatMap(GitHub, (github) =>
          github.files({
            owner: item.owner ?? "",
            repo: item.repoName ?? "",
            number: item.number ?? 0,
          }),
        ).pipe(
          Effect.map(
            (files) =>
              [
                item.id,
                {
                  paths: files.map((file) => file.filename),
                  changedFiles: files.length,
                  changedLines: files.reduce((sum, file) => sum + file.changes, 0),
                } satisfies FastLaneFileFacts,
              ] as const,
          ),
          Effect.orElseSucceed(() => [item.id, null] as const),
        ),
      { concurrency: 3 },
    ).pipe(
      Effect.map(
        (entries) =>
          new Map<string, FastLaneFileFacts | null>(
            entries as ReadonlyArray<readonly [string, FastLaneFileFacts | null]>,
          ),
      ),
    ),
    { enabled: candidates.length > 0, staleTime: 30_000 },
  );
}

export function InboxScreen() {
  const workspace = useWorkspace();
  const fastLanePolicies = useFastLanePolicies();
  const root = useRef<HTMLDivElement>(null);
  useTitleSlot(
    <>
      <TitleSearch />
      <span className="flex-1" />
      <RefreshButton />
    </>,
    "desk",
  );
  const inbox = usePullRequestInbox();
  useKeepScroll(`inbox:${workspace ?? "all"}`, root, !!inbox.data);
  usePreread(inbox.data?.turn ?? []);
  const open = useOpenItem();
  const { done, snooze, snoozeFor, unsnooze, checkout } = useItemActions();
  const [storedFilter, setFilter] = useListFilter("inbox");
  // Old saved views may contain non-PR kinds; type is now fixed by the Inbox itself.
  const filter = useMemo(
    () => ({
      ...storedFilter,
      kinds: new Set<Ranked["kind"]>(),
      verdicts: new Set<Ranked["verdict"]>(),
    }),
    [storedFilter],
  );
  const all = useWithStacks(
    useMemo(
      () => (inbox.data ? [...inbox.data.turn, ...inbox.data.unsorted, ...inbox.data.later] : []),
      [inbox.data],
    ),
  );
  const stackVisible = useMemo(
    () =>
      inbox.data
        ? {
            ...inbox.data,
            turn: reconcileStackItems(inbox.data.turn, all),
            unsorted: reconcileStackItems(inbox.data.unsorted, all),
            later: reconcileStackItems(inbox.data.later, all),
          }
        : undefined,
    [inbox.data, all],
  );
  const enabledFastLanePolicies = useMemo(
    () => enabledFastLanePoliciesByRepository(fastLanePolicies.data),
    [fastLanePolicies.data],
  );
  const fastLaneFiles = useFastLaneFileFacts(
    stackVisible ? [...stackVisible.turn, ...stackVisible.unsorted] : [],
    enabledFastLanePolicies,
  );
  const sections = useMemo(() => {
    return toSections(stackVisible, enabledFastLanePolicies, fastLaneFiles.data).map((s) => ({
      ...s,
      items: applyFilter(s.items, filter),
    }));
  }, [stackVisible, filter, enabledFastLanePolicies, fastLaneFiles.data]);

  return (
    <div
      ref={root}
      className="work-list screen-enter h-full overflow-y-auto bg-desk scrollbar-thin"
    >
      <ListHead title="Inbox">
        {inbox.data
          ? `Pull requests that need you. Synced ${synced(inbox.data.syncedAt)}.`
          : inbox.isError
            ? "Couldn’t reach GitHub."
            : "Looking at GitHub…"}
      </ListHead>
      {inbox.isError && !inbox.data ? (
        <Nothing
          kind="error"
          detail={String((inbox.error as Error)?.message ?? "Check your connection and try again.")}
          action={
            <button
              type="button"
              className="rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-void hover:opacity-90"
              onClick={() => inbox.refetch()}
            >
              Try again
            </button>
          }
        >
          GitHub didn’t answer
        </Nothing>
      ) : null}
      {inbox.data ? (
        <FilterBar
          id="inbox"
          items={all}
          filter={filter}
          set={setFilter}
          show={{
            repos: !workspace,
            labels: true,
            authors: true,
            codeOwners: true,
            statuses: true,
            ci: true,
            bots: true,
            stacks: true,
          }}
        />
      ) : null}
      {inbox.data ? (
        <List
          key={workspace ?? "all"}
          label={`Inbox:${workspace ?? "all"}`}
          sections={sections}
          actions={{ open, done, snooze, snoozeFor, unsnooze, checkout }}
          renderPeek={(it) => <PrPeek item={it} origin="inbox" />}
          empty={
            isFiltering(filter) ? (
              <Nothing detail="Try removing a filter or searching for something broader.">
                Nothing matches this view
              </Nothing>
            ) : (
              <Nothing detail="The next review request will show up here and in the menu bar.">
                Nothing needs you right now
              </Nothing>
            )
          }
        />
      ) : null}
    </div>
  );
}

function toSections(
  data: InboxData | undefined,
  policies: ReadonlyMap<string, import("@/effect/schema").FastLanePolicy>,
  fileFacts?: ReadonlyMap<string, FastLaneFileFacts | null>,
): Section[] {
  if (!data) return [];
  const { turn, unsorted, later } = data;
  const active = [...turn, ...unsorted];
  const fastLaneEnabled = policies.size > 0;
  const fastLane = active.filter((item) => {
    const policy = policies.get(item.repo.toLowerCase());
    return policy ? isFastLane(item, policy, fileFacts?.get(item.id)) : false;
  });
  const fastLaneIds = new Set(fastLane.map((item) => item.id));
  const waiting = later.filter((i) => i.verdict === "waiting").length;
  const snoozed = later.length - waiting;
  const groups = [
    {
      key: "review",
      title: "Review requested",
      items: active.filter((i) => !i.mine && !fastLaneIds.has(i.id)),
    },
    {
      key: "attention",
      title: "Your PRs need attention",
      items: active.filter((i) => i.mine && i.verdict !== "mergeable"),
    },
    {
      key: "merge",
      title: "Ready to merge",
      items: active.filter((i) => i.mine && i.verdict === "mergeable"),
    },
  ];
  return [
    ...groups.flatMap(({ key, title, items }, index): Section[] => [
      {
        key,
        items,
        head: (
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            {title}
            <span className="tnum text-[12px] text-ink-3">{items.length}</span>
          </p>
        ),
      },
      ...(index === 0 && fastLaneEnabled
        ? [
            {
              key: "fast-lane",
              items: fastLane,
              folded: (
                <>
                  Fast lane <span className="tnum text-ink-3">{fastLane.length}</span>
                  <span className="text-ink-3">Routine dependency updates with green checks</span>
                </>
              ),
            } satisfies Section,
          ]
        : []),
    ]),
    {
      key: "later",
      items: later,
      folded: (
        <>
          Later <span className="tnum text-ink-3">{later.length}</span>
          <span className="text-ink-3">
            {[
              waiting ? `${waiting} waiting on others` : "",
              snoozed ? `${snoozed} you snoozed` : "",
            ]
              .filter(Boolean)
              .join(", ")}
            {later.length ? " — back on top when it’s your turn" : ""}
          </span>
        </>
      ),
    },
  ];
}
