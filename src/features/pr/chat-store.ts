import { persistedStore, useStore } from "@/effect/store";
import type { ChatMessage } from "./ai";

/**
 * The Ask conversations, one per pull request, kept on the machine with the
 * question you had not sent yet. Thirty at most; the oldest goes first.
 */
export interface ChatEntry {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly draft: string;
  readonly at: number;
}
interface State {
  readonly byPr: Record<string, ChatEntry>;
}

const MAX = 30;
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function decode(raw: unknown): State {
  const out: Record<string, ChatEntry> = {};
  const src = isRecord(raw) && isRecord(raw.byPr) ? raw.byPr : {};
  for (const [k, v] of Object.entries(src)) {
    if (!isRecord(v) || !Array.isArray(v.messages)) continue;
    const messages = v.messages.filter(
      (m): m is ChatMessage =>
        isRecord(m) &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    );
    out[k] = {
      messages,
      draft: typeof v.draft === "string" ? v.draft : "",
      at: typeof v.at === "number" ? v.at : 0,
    };
  }
  return { byPr: out };
}

function cap(r: Record<string, ChatEntry>): Record<string, ChatEntry> {
  const keys = Object.keys(r);
  if (keys.length <= MAX) return r;
  const keep = keys.sort((a, b) => r[b].at - r[a].at).slice(0, MAX);
  return Object.fromEntries(keep.map((k) => [k, r[k]]));
}

const chatStore = persistedStore<State>("reviewly.v2.chat", { byPr: {} }, decode);

const EMPTY: ChatEntry = { messages: [], draft: "", at: 0 };
export const useChat = (prKey: string): ChatEntry =>
  useStore(chatStore, (s) => s.byPr[prKey] ?? EMPTY);

const patch = (prKey: string, f: (e: ChatEntry) => Partial<ChatEntry>) =>
  chatStore.update((s) => {
    const e = s.byPr[prKey] ?? EMPTY;
    return { byPr: cap({ ...s.byPr, [prKey]: { ...e, ...f(e), at: Date.now() } }) };
  });

export const setChatMessages = (prKey: string, messages: ReadonlyArray<ChatMessage>) =>
  patch(prKey, () => ({ messages }));
export const setChatDraft = (prKey: string, draft: string) => {
  if ((chatStore.get().byPr[prKey]?.draft ?? "") === draft) return;
  patch(prKey, () => ({ draft }));
};
/** Wipe the conversation; what it was comes back, for an undo. */
export function clearChat(prKey: string): ReadonlyArray<ChatMessage> {
  const was = chatStore.get().byPr[prKey]?.messages ?? [];
  patch(prKey, () => ({ messages: [] }));
  return was;
}
