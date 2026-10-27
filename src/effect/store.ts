import { useSyncExternalStore } from "react";

/**
 * A tiny external store persisted on the machine: React subscribes without a
 * provider, effects read it directly, and one bad field never takes the rest
 * down — `decode` is the store's own leniency.
 */
export interface Store<T> {
  readonly get: () => T;
  readonly set: (next: T) => void;
  readonly update: (f: (t: T) => T) => void;
  readonly subscribe: (l: () => void) => () => void;
}

export function persistedStore<T>(key: string, fallback: T, decode: (raw: unknown) => T): Store<T> {
  const listeners = new Set<() => void>();
  let current: T = fallback;
  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(key);
      if (raw) current = decode(JSON.parse(raw));
    } catch {
      current = fallback;
    }
  }
  // Another window of this app (the detached Ask window) wrote the same key:
  // take its value, so one review state and one conversation live in both.
  if (typeof window !== "undefined")
    window.addEventListener("storage", (e) => {
      if (e.key !== key) return;
      if (e.newValue == null) {
        current = fallback;
        for (const l of listeners) l();
        return;
      }
      try {
        current = decode(JSON.parse(e.newValue));
      } catch {
        return;
      }
      for (const l of listeners) l();
    });
  const store: Store<T> = {
    get: () => current,
    set: (next) => {
      if (next === current) return;
      current = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode, quota: the session still works */
      }
      for (const l of listeners) l();
    },
    update: (f) => store.set(f(current)),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return store;
}

/** Subscribe to a store, or to one selection of it. The selector must return stable values. */
export function useStore<T>(store: Store<T>): T;
export function useStore<T, U>(store: Store<T>, select: (t: T) => U): U;
export function useStore<T, U>(store: Store<T>, select?: (t: T) => U) {
  return useSyncExternalStore(
    store.subscribe,
    () => (select ? select(store.get()) : store.get()),
    () => (select ? select(store.get()) : store.get()),
  );
}
