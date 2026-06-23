import { invoke } from "@/lib/tauri";
import { useAiProvider } from "@/stores/ai";
import { useQuery } from "@tanstack/react-query";

/** Whether the selected provider's CLI is on PATH — so AI surfaces can show an
 * install hint instead of letting the user wait for a 180s spawn failure. */
export function useAiAvailable(): { provider: string; available: boolean | undefined } {
  const provider = useAiProvider((s) => s.provider);
  const baseUrl = useAiProvider((s) => s.baseUrl);
  const q = useQuery({
    queryKey: ["ai-available", provider],
    queryFn: () => invoke<boolean>("ai_available", { provider }),
    staleTime: 5 * 60_000,
    retry: false,
    enabled: provider !== "openai",
  });
  // The OpenAI-compatible backend has no CLI to probe — it's "available" once a
  // base URL is configured in Settings.
  if (provider === "openai") return { provider, available: baseUrl.trim().length > 0 };
  return { provider, available: q.data };
}
