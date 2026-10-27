import { toastManager } from "@/components/ui/toast";
import { describeError } from "@/effect/errors";

/** One sentence, bottom centre, gone in a few seconds. Errors say what, not sorry. */
export const toast = {
  say: (title: string, description?: string) =>
    toastManager.add({ title, description, timeout: 3200 }),
  done: (title: string, description?: string) =>
    toastManager.add({ title, description, type: "success", timeout: 3200 }),
  /** A sentence with one thing to do about it: "Undo", "Open". */
  act: (title: string, action: string, onAction: () => void, description?: string) =>
    toastManager.add({
      title,
      description,
      timeout: 8000,
      actionProps: { children: action, onClick: onAction },
    }),
  fail: (what: string, e?: unknown) =>
    toastManager.add({
      title: what,
      description: e === undefined ? undefined : describeError(e),
      type: "error",
      timeout: 6000,
    }),
};
