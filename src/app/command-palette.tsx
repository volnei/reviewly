import { checkForUpdates } from "@/app/use-updater";
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import type { PullSummary } from "@/lib/tauri";
import { parsePullUrl, parseRepoUrl } from "@/lib/tauri";
import { useUi } from "@/stores/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Bell,
  Bot,
  CornerDownLeft,
  FolderGit2,
  GitPullRequest,
  Hash,
  Info,
  LayoutDashboard,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useMemo, useState } from "react";

interface LoadedPr {
  id: number;
  owner: string;
  repo: string;
  number: number;
  title: string;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [input, setInput] = useState("");

  const close = () => {
    setOpen(false);
    setInput("");
  };

  const go = (to: string) => {
    navigate({ to });
    close();
  };

  // Pull every loaded PR out of the React Query cache (the queue + search lists
  // are all keyed under `["prs", ...]`) so they're jump-to-able by title/number.
  // Only computed while the palette is open — the dialog unmounts otherwise.
  const loadedPrs = useMemo<LoadedPr[]>(() => {
    if (!open) return [];
    const lists = qc.getQueriesData<PullSummary[]>({ queryKey: ["prs"] });
    const byId = new Map<number, LoadedPr>();
    for (const [, data] of lists) {
      if (!Array.isArray(data)) continue;
      for (const p of data) {
        if (byId.has(p.id)) continue;
        const r = parseRepoUrl(p.repository_url);
        if (!r) continue;
        byId.set(p.id, {
          id: p.id,
          owner: r.owner,
          repo: r.repo,
          number: p.number,
          title: p.title,
        });
      }
    }
    return [...byId.values()];
  }, [open, qc]);

  const trimmed = input.trim();
  const url = parsePullUrl(trimmed);
  const shorthand = trimmed.match(/^([^/]+)\/([^/]+)#(\d+)$/);
  const target =
    url ??
    (shorthand ? { owner: shorthand[1], repo: shorthand[2], number: Number(shorthand[3]) } : null);

  const goPR = () => {
    if (!target) return;
    navigate({
      to: "/prs/$owner/$repo/$number",
      params: {
        owner: target.owner,
        repo: target.repo,
        number: String(target.number),
      },
    });
    close();
  };

  const goLoadedPr = (pr: LoadedPr) => {
    navigate({
      to: "/prs/$owner/$repo/$number",
      params: { owner: pr.owner, repo: pr.repo, number: String(pr.number) },
    });
    close();
  };

  return (
    <CommandDialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
      <CommandInput
        placeholder="Search PRs, owner/repo#123, github.com PR url, or jump to a section…"
        value={input}
        onValueChange={setInput}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        {target && (
          <CommandGroup>
            <Heading>Open pull request</Heading>
            <CommandItem
              value={`__pr__ ${target.owner}/${target.repo}#${target.number}`}
              onSelect={goPR}
            >
              <Hash />
              <span className="truncate">
                {target.owner}/{target.repo}{" "}
                <span className="font-mono text-foreground">#{target.number}</span>
              </span>
              <CommandShortcut>
                <CornerDownLeft className="size-3" />
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
        )}

        {target && <CommandSeparator />}

        {loadedPrs.length > 0 && (
          <>
            <CommandGroup>
              <Heading>Pull requests</Heading>
              {loadedPrs.map((pr) => (
                <CommandItem
                  key={pr.id}
                  // Include repo + number in the searchable value so cmdk matches
                  // on title, "owner/repo", and the bare/`#`-prefixed PR number.
                  value={`${pr.title} ${pr.owner}/${pr.repo} #${pr.number} ${pr.number}`}
                  onSelect={() => goLoadedPr(pr)}
                >
                  <GitPullRequest />
                  <span className="min-w-0 flex-1 truncate">{pr.title}</span>
                  <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground/70">
                    {pr.owner}/{pr.repo}#{pr.number}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup>
          <Heading>Navigate</Heading>
          <CommandItem onSelect={() => go("/")}>
            <LayoutDashboard /> <span>Dashboard</span>
            <CommandShortcut>⌘1</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/prs")}>
            <GitPullRequest /> <span>Pull requests</span>
            <CommandShortcut>⌘2</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/repos")}>
            <FolderGit2 /> <span>Repositories</span>
            <CommandShortcut>⌘3</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/notifications")}>
            <Bell /> <span>Notifications</span>
            <CommandShortcut>⌘4</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/dependabot")}>
            <Bot /> <span>Dependabot</span>
            <CommandShortcut>⌘5</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go("/settings")}>
            <Settings /> <span>Settings</span>
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup>
          <Heading>App</Heading>
          <CommandItem
            onSelect={() => {
              close();
              void checkForUpdates();
            }}
          >
            <RefreshCw /> <span>Check for updates</span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              close();
              useUi.getState().setAboutOpen(true);
            }}
          >
            <Info /> <span>About Reviewly</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      <CommandFooter>
        <span className="inline-flex items-center gap-1">
          <CornerDownLeft className="size-3" />
          Open
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <ArrowRight className="size-3" />
          Actions
        </span>
        <span className="text-muted-foreground/60">esc to close</span>
      </CommandFooter>
    </CommandDialog>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div
      cmdk-group-heading=""
      className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </div>
  );
}
