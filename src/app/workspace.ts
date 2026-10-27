import { run, useEffectQuery } from "@/effect/runtime";
import { authStore, useAuth } from "@/effect/services/Auth";
import { Inbox, type InboxData, countMentions, pullRequestInbox } from "@/effect/services/Inbox";
import { persistedStore, useStore } from "@/effect/store";
import { readInboxSnapshot, saveInboxSnapshot } from "@/features/inbox/cache";
import type { QueryClient } from "@tanstack/react-query";
import { Effect } from "effect";

export const workspaceStore = persistedStore<string | null>("reviewly.v2.workspace", null, (raw) =>
  typeof raw === "string" && /^[^/\s]+\/[^/\s]+$/.test(raw) ? raw : null,
);
export const useWorkspace = () => useStore(workspaceStore);

export function parseRepository(input: string): string | null {
  const slug = input
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  return /^[a-z\d][a-z\d-]*\/[a-z\d_.-]+$/i.test(slug) ? slug : null;
}

export function scopeInbox(data: InboxData, workspace: string | null): InboxData {
  if (!workspace) {
    const mentions = countMentions(data.notifications);
    return mentions === data.counts.mentions
      ? data
      : { ...data, counts: { ...data.counts, mentions } };
  }
  const matches = (item: { repo: string }) => item.repo.toLowerCase() === workspace.toLowerCase();
  const turn = data.turn.filter(matches);
  const unsorted = data.unsorted.filter(matches);
  const later = data.later.filter(matches);
  const notifications = data.notifications.filter(matches);
  const dependabot = (data.dependabot ?? []).filter((status) => matches({ repo: status.repo }));
  const items = [...turn, ...unsorted, ...later];
  return {
    ...data,
    turn,
    unsorted,
    later,
    notifications,
    dependabot,
    counts: {
      inbox: [...turn, ...unsorted].filter((i) => i.kind === "pr").length,
      prs: items.filter((i) => i.kind === "pr").length,
      mentions: countMentions(notifications),
      health: items.filter((i) => i.kind === "finding").length,
    },
  };
}

export function useWorkspaceInbox(pullRequestsOnly = false) {
  const workspace = useWorkspace();
  const auth = useAuth();
  const login = auth.viewer?.login ?? "";
  const snapshot = readInboxSnapshot(login);
  return useEffectQuery(["inbox", login], loadAndCacheInbox(login), {
    enabled: !!login,
    initialData: snapshot?.data,
    initialDataUpdatedAt: snapshot?.savedAt,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    select: (data) => {
      const scoped = scopeInbox(data, workspace);
      return pullRequestsOnly ? pullRequestInbox(scoped) : scoped;
    },
  });
}

export const usePullRequestInbox = () => useWorkspaceInbox(true);

const loadAndCacheInbox = (login: string) =>
  Effect.flatMap(Inbox, (inbox) => inbox.load).pipe(
    Effect.tap((data) =>
      Effect.sync(() => {
        if (authStore.get().viewer?.login.toLowerCase() === login.toLowerCase()) {
          saveInboxSnapshot(login, data);
        }
      }),
    ),
  );

let watcherRefresh: Promise<unknown> | null = null;
let watcherRefreshAgain = false;

/** Reconcile the persistent snapshot when the native GitHub watcher sees movement. */
export function refreshInboxFromWatcher(queryClient: QueryClient): Promise<unknown> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
  if (watcherRefresh) {
    watcherRefreshAgain = true;
    return watcherRefresh;
  }
  watcherRefresh = (async () => {
    do {
      watcherRefreshAgain = false;
      const login = authStore.get().viewer?.login ?? "";
      if (!login) return;
      await queryClient
        .fetchQuery({
          queryKey: ["inbox", login],
          queryFn: () => run(loadAndCacheInbox(login)),
          staleTime: 0,
        })
        .catch((error) => {
          console.warn("[inbox-cache] watcher refresh failed", error);
        });
    } while (watcherRefreshAgain);
  })().finally(() => {
    watcherRefresh = null;
  });
  return watcherRefresh;
}
