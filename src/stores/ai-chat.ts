import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** USD cost of this assistant turn, when the backend reports it (Claude). */
  cost?: number;
}

/** Keep at most this many PR conversations so the persisted row stays bounded. */
const MAX_CONVERSATIONS = 30;

function evict(byPr: Record<string, ChatMessage[]>): Record<string, ChatMessage[]> {
  const keys = Object.keys(byPr);
  if (keys.length <= MAX_CONVERSATIONS) return byPr;
  // Drop the oldest-inserted keys (object key order ≈ insertion order).
  const drop = keys.slice(0, keys.length - MAX_CONVERSATIONS);
  const next = { ...byPr };
  for (const k of drop) delete next[k];
  return next;
}

interface State {
  /** Conversations keyed by `${owner}/${repo}#${number}`. Persisted so a chat
   * isn't erased by a refresh or app restart. */
  byPr: Record<string, ChatMessage[]>;
  /** In-progress (unsent) composer text per PR, so a half-typed question
   * survives navigation/refresh. Persisted alongside the conversation. */
  drafts: Record<string, string>;
  append: (key: string, msg: ChatMessage) => void;
  reset: (key: string) => void;
  /** Replace the whole transcript for a PR (used by Regenerate to rewind a turn). */
  setMessages: (key: string, msgs: ChatMessage[]) => void;
  /** Save (or clear, when empty) the unsent draft for a PR. */
  setDraft: (key: string, draft: string) => void;
}

export const useAiChat = create<State>()(
  persist(
    (set, get) => ({
      byPr: {},
      drafts: {},
      append: (key, msg) =>
        set({ byPr: evict({ ...get().byPr, [key]: [...(get().byPr[key] ?? []), msg] }) }),
      reset: (key) => {
        const next = { ...get().byPr };
        delete next[key];
        set({ byPr: next });
      },
      setMessages: (key, msgs) => set({ byPr: evict({ ...get().byPr, [key]: msgs }) }),
      setDraft: (key, draft) => {
        const next = { ...get().drafts };
        if (draft) next[key] = draft;
        else delete next[key];
        set({ drafts: next });
      },
    }),
    { name: "reviewly.ai-chat", storage: sqlStorage<State>() },
  ),
);
