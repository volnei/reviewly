import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { create } from "zustand";

/**
 * Self-contained open-state for the shortcuts cheatsheet. Kept local (not in the
 * shared `ui` store) so the `?` shortcut and the layout-rendered overlay can talk
 * without touching unrelated stores.
 */
interface CheatsheetState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useShortcutsCheatsheet = create<CheatsheetState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

/** Imperative opener used by the global `?` shortcut. */
export function toggleShortcutsCheatsheet(): void {
  useShortcutsCheatsheet.getState().toggle();
}

interface Shortcut {
  keys: string[];
  label: string;
}

interface Group {
  title: string;
  items: Shortcut[];
}

const GROUPS: Group[] = [
  {
    title: "Go to",
    items: [
      { keys: ["g", "d"], label: "Dashboard" },
      { keys: ["g", "r"], label: "Pull requests" },
      { keys: ["g", "l"], label: "Repositories" },
      { keys: ["g", "n"], label: "Notifications" },
      { keys: ["g", "a"], label: "Dependabot" },
      { keys: ["g", "s"], label: "Settings" },
    ],
  },
  {
    title: "Navigate",
    items: [
      { keys: ["⌘", "1"], label: "Dashboard" },
      { keys: ["⌘", "2"], label: "Pull requests" },
      { keys: ["⌘", "3"], label: "Repositories" },
      { keys: ["⌘", "4"], label: "Notifications" },
      { keys: ["⌘", "5"], label: "Dependabot" },
      { keys: ["⌘", ","], label: "Settings" },
    ],
  },
  {
    title: "Review",
    items: [
      { keys: ["]"], label: "Next file" },
      { keys: ["["], label: "Previous file" },
      { keys: ["n"], label: "Mark viewed & jump to next file" },
      { keys: ["⌘", "B"], label: "Toggle unified / split diff" },
    ],
  },
  {
    title: "App",
    items: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["⌘", "+"], label: "Zoom in" },
      { keys: ["⌘", "−"], label: "Zoom out" },
      { keys: ["⌘", "0"], label: "Reset zoom" },
      { keys: ["?"], label: "This cheatsheet" },
    ],
  },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className="inline-flex min-w-5 items-center justify-center rounded border border-border/50 bg-card/60 px-1.5 py-0.5 font-mono text-[11px] leading-none text-foreground/80"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Keyboard-shortcuts cheatsheet overlay, opened with `?` (Shift+/). Lists the
 * g-chords, ⌘1-5 navigation, review keys (] / [ / n), ⌘B and the zoom chords.
 */
export function ShortcutsCheatsheet() {
  const open = useShortcutsCheatsheet((s) => s.open);
  const setOpen = useShortcutsCheatsheet((s) => s.setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move faster — most actions have a key.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {GROUPS.map((group) => (
              <section key={group.title} className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
                  {group.title}
                </p>
                <ul className="space-y-1">
                  {group.items.map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-foreground/90">{s.label}</span>
                      <Keys keys={s.keys} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
