import { sqlStorage } from "@/lib/sql-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AiProvider = "claude" | "codex" | "gemini" | "openai";

/** Providers that are a local CLI on PATH (vs. the HTTP OpenAI-compatible one). */
export const CLI_PROVIDERS: AiProvider[] = ["claude", "codex", "gemini"];

/** Short display name per provider (the "Thinking with …" label). */
export const PROVIDER_LABEL: Record<AiProvider, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  openai: "your model",
};

interface State {
  /** Which backend to use for reviews. */
  provider: AiProvider;
  setProvider: (provider: AiProvider) => void;
  /**
   * OpenAI-compatible endpoint config — used when provider === "openai".
   * Covers Ollama (local), LM Studio, OpenRouter, DeepSeek, Groq, etc.
   */
  baseUrl: string;
  model: string;
  /** Optional bearer key; local servers like Ollama need none. */
  apiKey: string;
  setOpenai: (cfg: Partial<Pick<State, "baseUrl" | "model" | "apiKey">>) => void;
}

export const useAiProvider = create<State>()(
  persist(
    (set) => ({
      provider: "claude",
      setProvider: (provider) => set({ provider }),
      baseUrl: "",
      model: "",
      apiKey: "",
      setOpenai: (cfg) => set(cfg),
    }),
    { name: "reviewly.ai", storage: sqlStorage<State>() },
  ),
);

/**
 * Extra invoke args for the `ai_review` / `ai_review_bg` commands. Carries the
 * OpenAI-compatible config when that provider is selected; the CLI providers
 * just get `{ provider }` and ignore the rest.
 */
export function aiInvokeArgs(): {
  provider: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
} {
  const s = useAiProvider.getState();
  if (s.provider !== "openai") return { provider: s.provider };
  return { provider: s.provider, baseUrl: s.baseUrl, model: s.model, apiKey: s.apiKey };
}
