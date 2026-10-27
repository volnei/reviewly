import type { Ranked } from "@/effect/services/Triage";

/** One row, or the layers of a stack kept together where the first of them ranks. */
export type Block =
  | { kind: "one"; item: Ranked }
  | { kind: "stack"; key: string; base: string; size: number; items: Ranked[] };

const stackKey = (r: Ranked) => (r.stack ? `${r.repo}#stack${r.stack.number}` : null);

export function blocksOf(items: ReadonlyArray<Ranked>): Block[] {
  const out: Block[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const key = stackKey(it);
    if (!key || !it.stack) {
      out.push({ kind: "one", item: it });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const members = items
      .filter((x) => stackKey(x) === key)
      .sort((a, b) => (a.stack?.position ?? 0) - (b.stack?.position ?? 0));
    out.push({ kind: "stack", key, base: it.stack.base, size: it.stack.size, items: members });
  }
  return out;
}
