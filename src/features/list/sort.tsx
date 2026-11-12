import { compareRanked, type Ranked } from "@/effect/services/Triage";
import { persistedStore, useStore } from "@/effect/store";

import { Chips } from "./filters";
import { estimateReviewMinutes } from "./review-time";

export const SORT_OPTIONS = [
  ["priority", "Needs action first"],
  ["review-short", "Shortest review"],
  ["review-long", "Longest review"],
  ["updated", "Recently updated"],
  ["updated-asc", "Least recently updated"],
  ["created", "Newest first"],
  ["created-asc", "Oldest first"],
  ["title", "Title"],
] as const;
export type ListSort = (typeof SORT_OPTIONS)[number][0];
export const LIST_SORTS: readonly ListSort[] = SORT_OPTIONS.map(([value]) => value);

export function compareListItems(sort: ListSort, a: Ranked, b: Ranked): number {
  if (sort === "review-short" || sort === "review-long") {
    const left = estimateReviewMinutes(a);
    const right = estimateReviewMinutes(b);
    if (left === null || right === null)
      return left === right ? compareRanked(a, b) : left === null ? 1 : -1;
    return (sort === "review-short" ? left - right : right - left) || compareRanked(a, b);
  }
  if (sort === "title") return a.title.localeCompare(b.title) || compareRanked(a, b);
  if (sort === "priority") return compareRanked(a, b);
  const field = sort.startsWith("updated") ? "updatedAt" : "createdAt";
  const left = a[field] ?? "";
  const right = b[field] ?? "";
  if (!left || !right) return left === right ? compareRanked(a, b) : !left ? 1 : -1;
  return (
    (sort.endsWith("-asc") ? left.localeCompare(right) : right.localeCompare(left)) ||
    compareRanked(a, b)
  );
}

const stores = new Map<string, ReturnType<typeof makeStore>>();
function makeStore(key: string) {
  return persistedStore<ListSort>(key, "priority", (raw) =>
    LIST_SORTS.includes(raw as ListSort) ? (raw as ListSort) : "priority",
  );
}
export function useListSort(id: string, workspace: string | null) {
  const key = `reviewly.v2.sort.${id}:${workspace ?? "all"}`;
  let store = stores.get(key);
  if (!store) {
    store = makeStore(key);
    stores.set(key, store);
  }
  const value = useStore(store);
  return [value, (next: ListSort) => store!.set(next)] as const;
}
export function SortControl({
  value,
  onChange,
}: {
  value: ListSort;
  onChange: (sort: ListSort) => void;
}) {
  return <Chips label="Sort" value={value} onChange={onChange} options={SORT_OPTIONS} />;
}
