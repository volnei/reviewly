import { useEffect, useSyncExternalStore } from "react";

/** What the screen you are on can do, offered in ⌘K beside the places to go. */
export interface Command {
  readonly id: string;
  readonly label: string;
  readonly key?: string;
  readonly run: () => void;
}

const listeners = new Set<() => void>();
let current: ReadonlyArray<Command> = [];
const set = (next: ReadonlyArray<Command>) => {
  current = next;
  for (const l of listeners) l();
};

export function useCommands(): ReadonlyArray<Command> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** Offer these while the component is mounted. */
export function useRegisterCommands(commands: ReadonlyArray<Command>) {
  useEffect(() => {
    set(commands);
    return () => set([]);
  }, [commands]);
}
