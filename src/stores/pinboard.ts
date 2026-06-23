import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PinnedKind = "pr" | "commit" | "file";

export interface PinnedItem {
  kind: PinnedKind;
  id: string;
  label: string;
  hint?: string;
  path: string;
  pinnedAt: number;
}

interface PinboardState {
  items: PinnedItem[];
  pin: (item: Omit<PinnedItem, "pinnedAt">) => void;
  unpin: (kind: PinnedKind, id: string) => void;
  toggle: (item: Omit<PinnedItem, "pinnedAt">) => void;
  clear: () => void;
  isPinned: (kind: PinnedKind, id: string) => boolean;
}

export const usePinboard = create<PinboardState>()(
  persist(
    (set, get) => ({
      items: [],
      pin: (item) => {
        const items = get().items;
        if (items.some((x) => x.kind === item.kind && x.id === item.id)) return;
        set({ items: [...items, { ...item, pinnedAt: Date.now() }] });
      },
      unpin: (kind, id) =>
        set({ items: get().items.filter((x) => !(x.kind === kind && x.id === id)) }),
      toggle: (item) => {
        const { isPinned, pin, unpin } = get();
        if (isPinned(item.kind, item.id)) unpin(item.kind, item.id);
        else pin(item);
      },
      clear: () => set({ items: [] }),
      isPinned: (kind, id) => get().items.some((x) => x.kind === kind && x.id === id),
    }),
    { name: "reviewly.pinboard", storage: sqlStorage<PinboardState>() },
  ),
);
