import type { InboxData } from "@/effect/services/Inbox";
import { persistedStore } from "@/effect/store";

interface InboxSnapshot {
  readonly savedAt: number;
  readonly data: InboxData;
}

type InboxCache = Record<string, InboxSnapshot>;
const MAX_AGE = 30 * 24 * 60 * 60_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isInboxData = (value: unknown): value is InboxData =>
  isObject(value) &&
  Array.isArray(value.turn) &&
  Array.isArray(value.unsorted) &&
  Array.isArray(value.later) &&
  Array.isArray(value.notifications) &&
  isObject(value.counts) &&
  typeof value.counts.inbox === "number" &&
  typeof value.counts.prs === "number" &&
  typeof value.counts.mentions === "number" &&
  typeof value.counts.health === "number" &&
  typeof value.syncedAt === "number";

function decodeCache(raw: unknown): InboxCache {
  if (!isObject(raw)) return {};
  const decoded: InboxCache = {};
  for (const [login, value] of Object.entries(raw)) {
    if (
      !isObject(value) ||
      typeof value.savedAt !== "number" ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > Date.now() + 60_000 ||
      Date.now() - value.savedAt > MAX_AGE ||
      !isInboxData(value.data)
    ) {
      continue;
    }
    decoded[login.toLowerCase()] = {
      savedAt: value.savedAt,
      data: {
        ...value.data,
        // Snapshots written before Dependabot coverage was recorded remain usable.
        dependabot: Array.isArray(value.data.dependabot) ? value.data.dependabot : [],
      },
    };
  }
  return decoded;
}

const inboxCache = persistedStore<InboxCache>("reviewly.v2.inbox-cache", {}, decodeCache);

const keyOf = (login: string) => login.trim().toLowerCase();

export function readInboxSnapshot(login: string): InboxSnapshot | null {
  return inboxCache.get()[keyOf(login)] ?? null;
}

export function saveInboxSnapshot(login: string, data: InboxData): void {
  const key = keyOf(login);
  if (!key) return;
  inboxCache.update((cache) => {
    if (cache[key]?.data.syncedAt === data.syncedAt) return cache;
    const next: InboxCache = { ...cache, [key]: { savedAt: Date.now(), data } };
    return Object.fromEntries(
      Object.entries(next)
        .sort(([, a], [, b]) => b.savedAt - a.savedAt)
        .slice(0, 4),
    );
  });
}

export function clearInboxCache(): void {
  inboxCache.set({});
}
