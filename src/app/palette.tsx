import { useNavigate } from "@tanstack/react-router";
import {
  AtSign,
  Bookmark,
  FolderGit2,
  GitPullRequest,
  HeartPulse,
  History,
  House,
  Inbox,
  Keyboard,
  type LucideIcon,
  RefreshCw,
  Settings2,
  Sparkles,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useCommands } from "@/app/commands";
import { overlays } from "@/app/overlays";
import { checkForUpdates } from "@/app/updater";
import { openWhatsNew } from "@/app/whats-new";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "@/components/ui/command";
import { useEffectQuery } from "@/effect/runtime";
import { useAuth } from "@/effect/services/Auth";
import type { Verdict } from "@/effect/services/Prefs";
import { applyView, savedViewPath, useSavedViews } from "@/features/list/filters";
import { VerdictWord } from "@/features/list/row";
import { parsePrRef } from "@/lib/pr-ref";
import { inboxQuery, useOpenItem } from "@/screens/inbox";

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly key?: string;
  readonly icon?: LucideIcon;
  readonly verdict?: Verdict;
  /** Shown whatever was typed — the entry that *is* the typed text. */
  readonly pinned?: boolean;
  readonly run: () => void;
}

const VIEWS: ReadonlyArray<{ to: string; label: string; icon: LucideIcon; key: string }> = [
  { to: "/", label: "Home", icon: House, key: "⌘1" },
  { to: "/inbox", label: "Inbox", icon: Inbox, key: "⌘2" },
  { to: "/prs", label: "Pull requests", icon: GitPullRequest, key: "⌘3" },
  { to: "/mentions", label: "Mentions", icon: AtSign, key: "⌘4" },
  { to: "/health", label: "Health", icon: HeartPulse, key: "⌘5" },
  { to: "/local", label: "Local repositories", icon: FolderGit2, key: "⌘6" },
  { to: "/history", label: "History", icon: History, key: "G Y" },
  { to: "/settings", label: "Settings", icon: Settings2, key: "⌘," },
];

const text = (e: Entry) => `${e.label} ${e.hint}`;

/**
 * ⌘K: jump to anything — a view, a pull request by title or number, Settings.
 * Paste a GitHub pull request URL (or `owner/repo#123`) and ↵ opens it, loaded
 * or not. One list, typed into; nothing here that isn't reachable elsewhere.
 */
export function Palette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const navigate = useNavigate();
  const auth = useAuth();
  const inbox = useEffectQuery(["inbox"], inboxQuery, { enabled: auth.signedIn });
  const openItem = useOpenItem();
  const commands = useCommands();
  const saved = useSavedViews();
  const [query, setQuery] = useState("");

  const entries = useMemo<Entry[]>(() => {
    const ref = parsePrRef(query, auth.host);
    const typed: Entry[] = ref
      ? [
          {
            id: `open:${ref.owner}/${ref.repo}#${ref.number}`,
            label: `Open ${ref.owner}/${ref.repo} #${ref.number}`,
            hint: "pull request",
            key: "↵",
            icon: GitPullRequest,
            pinned: true,
            run: () =>
              void navigate({
                to: "/pr/$owner/$repo/$number",
                params: { owner: ref.owner, repo: ref.repo, number: String(ref.number) },
              }),
          },
        ]
      : [];
    const actions = commands.map<Entry>((c) => ({
      id: `cmd:${c.id}`,
      label: c.label,
      hint: "action",
      key: c.key,
      icon: Zap,
      run: c.run,
    }));
    const views = VIEWS.map<Entry>((v) => ({
      id: `view:${v.to}`,
      label: v.label,
      hint: "view",
      key: v.key,
      icon: v.icon,
      run: () => void navigate({ to: v.to }),
    }));
    const savedViews = saved.map<Entry>((v) => ({
      id: `saved:${v.id}`,
      label: v.name,
      hint: `saved view · ${v.list}`,
      icon: Bookmark,
      run: () => {
        applyView(v);
        void navigate({ to: savedViewPath(v) });
      },
    }));
    const app: Entry[] = [
      {
        id: "app:keys",
        label: "Keys",
        hint: "app",
        key: "?",
        icon: Keyboard,
        run: () => overlays.set({ keys: true }),
      },
      {
        id: "app:updates",
        label: "Check for updates",
        hint: "app",
        icon: RefreshCw,
        run: () => void checkForUpdates(),
      },
      {
        id: "app:whats-new",
        label: "What’s new",
        hint: "app",
        icon: Sparkles,
        run: openWhatsNew,
      },
    ];
    const items = (
      inbox.data ? [...inbox.data.turn, ...inbox.data.unsorted, ...inbox.data.later] : []
    ).map<Entry>((it) => ({
      id: it.id,
      label: it.title,
      hint: `${it.repo.split("/").pop() ?? it.repo}${it.number ? ` #${it.number}` : ""}${it.author ? ` ${it.author}` : ""}`,
      verdict: it.kind === "pr" ? undefined : it.verdict,
      run: () => openItem(it),
    }));
    return [...typed, ...actions, ...views, ...savedViews, ...items, ...app];
  }, [inbox.data, navigate, openItem, query, commands, saved, auth.host]);

  const close = (o: boolean) => {
    if (!o) setQuery("");
    onOpenChange(o);
  };

  const pick = (e: Entry) => {
    close(false);
    e.run();
  };

  return (
    <CommandDialog open={open} onOpenChange={close}>
      <CommandDialogPopup className="max-w-[640px] rounded-xl border-edge bg-popover">
        <Command
          items={entries}
          itemToStringValue={(e) => text(e as Entry)}
          filter={(item, q) => {
            const e = item as Entry;
            return e.pinned === true || text(e).toLowerCase().includes(q.trim().toLowerCase());
          }}
          onValueChange={(value, details) => {
            if (details.reason !== "item-press") {
              setQuery(value);
              return;
            }
            const hit = entries.find((e) => text(e) === value);
            if (hit) pick(hit);
          }}
        >
          <CommandInput placeholder="Jump to anything, or paste a pull request URL" />
          <CommandPanel>
            <CommandList className="max-h-[420px]">
              <CommandEmpty>Nothing matches.</CommandEmpty>
              <CommandCollection>
                {(e: Entry) => (
                  <CommandItem key={e.id} value={e} onClick={() => pick(e)}>
                    {e.icon ? (
                      <e.icon
                        className="size-4 shrink-0 text-ink-3"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    ) : (
                      <span className="mono w-[150px] shrink-0 truncate text-[11.5px] text-ink-3">
                        {e.hint}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{e.label}</span>
                    {e.key ? (
                      <CommandShortcut className="shrink-0 rounded border border-hair px-1.5 py-0.5 text-[10px] tracking-normal">
                        {e.key}
                      </CommandShortcut>
                    ) : null}
                    {e.verdict ? <VerdictWord verdict={e.verdict} /> : null}
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
