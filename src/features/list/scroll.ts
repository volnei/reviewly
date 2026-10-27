import { useEffect } from "react";

/** Where each screen was scrolled to, so coming back lands where you left. */
const positions = new Map<string, number>();

export function useKeepScroll(
  key: string,
  ref: React.RefObject<HTMLElement | null>,
  ready: boolean,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: restore once the content is there
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const saved = positions.get(key);
    if (saved) el.scrollTop = saved;
    const onScroll = () => positions.set(key, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [key, ready]);
}
