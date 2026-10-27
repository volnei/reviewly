import { persistedStore, useStore } from "@/effect/store";

const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

export type HistorySource = "github" | "local" | "inbox";

export interface HistoryEntry {
  readonly id: string;
  readonly at: number;
  readonly source: HistorySource;
  readonly title: string;
  readonly detail?: string;
  readonly repo?: string;
  readonly number?: number;
  readonly path?: string;
}

const current = (entries: ReadonlyArray<HistoryEntry>, now = Date.now()): HistoryEntry[] =>
  entries.filter((entry) => now - entry.at <= MAX_AGE).slice(0, MAX_ENTRIES);

function decode(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return current(
    raw.filter(
      (entry): entry is HistoryEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.at === "number" &&
        (entry.source === "github" || entry.source === "local" || entry.source === "inbox") &&
        typeof entry.title === "string",
    ),
  );
}

export const historyStore = persistedStore<HistoryEntry[]>("reviewly.v2.history", [], decode);

export function recordHistory(entry: Omit<HistoryEntry, "id" | "at">) {
  const at = Date.now();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${at}-${Math.random().toString(36).slice(2)}`;
  historyStore.set(current([{ ...entry, id, at }, ...historyStore.get()], at));
}

export const clearHistory = () => historyStore.set([]);

export function useHistory(): ReadonlyArray<HistoryEntry> {
  const entries = useStore(historyStore);
  return current(entries);
}
