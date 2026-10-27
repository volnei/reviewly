import { persistedStore, useStore } from "@/effect/store";

/**
 * How each Dependabot fix the model ran ended: the pull request it opened, or
 * why it didn't. Kept so a finding still says so after a restart.
 */
export interface FixResult {
  readonly ok: boolean;
  readonly url?: string;
  readonly error?: string;
  readonly at: number;
}
interface State {
  readonly byKey: Record<string, FixResult>;
}
const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function decode(raw: unknown): State {
  const out: Record<string, FixResult> = {};
  const src = isRecord(raw) && isRecord(raw.byKey) ? raw.byKey : {};
  for (const [k, v] of Object.entries(src)) {
    if (!isRecord(v) || typeof v.ok !== "boolean" || typeof v.at !== "number") continue;
    out[k] = {
      ok: v.ok,
      url: typeof v.url === "string" ? v.url : undefined,
      error: typeof v.error === "string" ? v.error : undefined,
      at: v.at,
    };
  }
  return { byKey: out };
}

const fixesStore = persistedStore<State>("reviewly.v2.fixes", { byKey: {} }, decode);

export const recordFix = (key: string, r: Omit<FixResult, "at">) =>
  fixesStore.update((s) => ({ byKey: { ...s.byKey, [key]: { ...r, at: Date.now() } } }));
export const useFixResult = (key: string): FixResult | null =>
  useStore(fixesStore, (s) => s.byKey[key] ?? null);
