import type * as S from "@/effect/schema";
import type { InboxData } from "@/effect/services/Inbox";
import { persistedStore, useStore } from "@/effect/store";

interface HomeSnapshot {
  readonly savedAt: number;
  readonly inbox?: InboxData;
  readonly activity?: S.Activity;
}

type HomeCache = Record<string, HomeSnapshot>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isInbox = (value: unknown): value is InboxData =>
  isObject(value) &&
  Array.isArray(value.turn) &&
  Array.isArray(value.unsorted) &&
  Array.isArray(value.later) &&
  Array.isArray(value.notifications) &&
  isObject(value.counts) &&
  typeof value.syncedAt === "number";

const isActivity = (value: unknown): value is S.Activity =>
  isObject(value) &&
  typeof value.commits === "number" &&
  typeof value.mergedPrs === "number" &&
  Array.isArray(value.days);

function decodeCache(raw: unknown): HomeCache {
  if (!isObject(raw)) return {};
  const cache: HomeCache = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isObject(value) || typeof value.savedAt !== "number") continue;
    const inbox = isInbox(value.inbox) ? value.inbox : undefined;
    const activity = isActivity(value.activity) ? value.activity : undefined;
    if (inbox || activity) cache[key] = { savedAt: value.savedAt, inbox, activity };
  }
  return cache;
}

const homeCache = persistedStore<HomeCache>("reviewly.v2.home-cache", {}, decodeCache);

export const homeCacheKey = (login: string, workspace: string | null) =>
  login ? `${login}:${workspace?.toLowerCase() ?? "*"}` : "";

export function useHomeSnapshot(key: string): HomeSnapshot | null {
  return useStore(homeCache, (cache) => cache[key] ?? null);
}

export function saveHomeSnapshot(key: string, patch: Omit<HomeSnapshot, "savedAt">) {
  if (!key) return;
  homeCache.update((cache) => {
    const next: HomeCache = {
      ...cache,
      [key]: { ...cache[key], ...patch, savedAt: Date.now() },
    };
    const recent = Object.entries(next)
      .sort(([, a], [, b]) => b.savedAt - a.savedAt)
      .slice(0, 8);
    return Object.fromEntries(recent);
  });
}

export function clearHomeCache() {
  homeCache.set({});
}
