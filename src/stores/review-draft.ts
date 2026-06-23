import { sqlStorage } from "@/lib/sql-storage";
import type { DraftComment } from "@/lib/tauri";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface PRKey {
  owner: string;
  repo: string;
  number: number;
}

export function prKey(k: PRKey): string {
  return `${k.owner}/${k.repo}#${k.number}`;
}

interface Draft {
  body: string;
  comments: DraftComment[];
  updatedAt: number;
}

interface ReviewDraftState {
  drafts: Record<string, Draft>;
  get: (k: PRKey) => Draft;
  setBody: (k: PRKey, body: string) => void;
  addComment: (k: PRKey, c: DraftComment) => void;
  removeComment: (k: PRKey, idx: number) => void;
  clear: (k: PRKey) => void;
}

const empty = (): Draft => ({ body: "", comments: [], updatedAt: Date.now() });

export const useReviewDraft = create<ReviewDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      get: (k) => get().drafts[prKey(k)] ?? empty(),
      setBody: (k, body) => {
        const key = prKey(k);
        const cur = get().drafts[key] ?? empty();
        set({ drafts: { ...get().drafts, [key]: { ...cur, body, updatedAt: Date.now() } } });
      },
      addComment: (k, c) => {
        const key = prKey(k);
        const cur = get().drafts[key] ?? empty();
        set({
          drafts: {
            ...get().drafts,
            [key]: { ...cur, comments: [...cur.comments, c], updatedAt: Date.now() },
          },
        });
      },
      removeComment: (k, idx) => {
        const key = prKey(k);
        const cur = get().drafts[key] ?? empty();
        set({
          drafts: {
            ...get().drafts,
            [key]: {
              ...cur,
              comments: cur.comments.filter((_, i) => i !== idx),
              updatedAt: Date.now(),
            },
          },
        });
      },
      clear: (k) => {
        const key = prKey(k);
        const rest = { ...get().drafts };
        delete rest[key];
        set({ drafts: rest });
      },
    }),
    { name: "reviewly.review-drafts", storage: sqlStorage<ReviewDraftState>() },
  ),
);
