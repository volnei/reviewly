import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { APP_STORE } from "@/lib/edition";

const GROUPS: ReadonlyArray<{ title: string; keys: ReadonlyArray<[string, string]> }> = [
  {
    title: "Everywhere",
    keys: [
      ["⌘K", "jump to anything"],
      APP_STORE
        ? ["⌘1 – ⌘5", "Home, Inbox, Pull requests, Mentions, Health"]
        : ["⌘1 – ⌘6", "Home, Inbox, Pull requests, Mentions, Health, Local"],
      ["⌘,", "settings"],
      APP_STORE
        ? ["g then h i p m a s", "go to Home, Inbox, PRs, Mentions, heAlth, Settings"]
        : ["g then h i p m a l s", "go to Home, Inbox, PRs, Mentions, heAlth, Local, Settings"],
      ["⌘= ⌘- ⌘0", "zoom in, out, reset"],
      ["?", "these keys"],
    ],
  },
  {
    title: "In a list",
    keys: [
      ["j k", "move"],
      ["↵", "open"],
      ["/", "filter the list"],
      ["space", "peek, where there is more to see"],
      ["e", "done — out of the Inbox"],
      ["s", "snooze until tomorrow"],
      ["o", "open on GitHub"],
      ...(APP_STORE ? [] : [["c", "check it out in its clone"] as [string, string]]),
      ["home end", "first, last row"],
      ["1 2 3", "in Mentions: mentions, reviews & comments, everything"],
    ],
  },
  {
    title: "On a pull request",
    keys: [
      ["j k", "next, previous file"],
      ["v", "mark the file read"],
      ["f", "hide the files column"],
      ["⌘B", "split or unified diff"],
      ["r", "write the review"],
      ["a", "ask about this PR"],
      [
        "space ⇧space",
        "next, previous thing that needs a look: a changed block, a thread, a stop; past the last, decide",
      ],
      ["n / p", "next / previous changed block"],
      ["u", "next unread file"],
      ["⌘F", "find in the diff"],
      ["⌘P", "filter the files (in a clone: open a file)"],
      ["x", "put the tour's stop aside"],
      ["⌥ click", "where a name is defined, from your clone"],
      ["s", "snooze"],
      ["] [", "next, previous in the Inbox"],
      ["} {", "up, down the stack it is a layer of"],
      ["esc", "back to the list"],
    ],
  },
  {
    title: "While writing",
    keys: [
      ["⌘↵", "send"],
      ["esc", "cancel"],
      ["↑", "in Ask, the last question again"],
    ],
  },
];

/** `?` — every key, in one place, and nothing that isn't also reachable by pointer. */
export function KeysDialog({
  open,
  onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[620px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">Keys</DialogTitle>
        </DialogHeader>
        <DialogPanel className="grid grid-cols-2 gap-x-8 gap-y-5 px-6 pb-6">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-[12px] text-ink-3">{g.title}</p>
              <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-1.5 text-[12.5px]">
                {g.keys.map(([k, what]) => (
                  <div key={k} className="contents">
                    <dt>
                      <kbd className="rounded-[3px] bg-raise px-1.5 py-px text-[11px] text-ink">
                        {k}
                      </kbd>
                    </dt>
                    <dd className="text-ink-2">{what}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
