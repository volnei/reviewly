import { useTitleSlot } from "@/app/title-slot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type HistoryEntry, type HistorySource, useHistory } from "@/features/history/store";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { FolderGit2, GitPullRequest, History, Inbox, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { TitleSearch } from "./inbox";

type Scope = "all" | HistorySource;

const SCOPES: ReadonlyArray<readonly [Scope, string]> = [
  ["all", "All"],
  ["github", "GitHub"],
  ["local", "Local"],
  ["inbox", "Inbox"],
];

const SOURCE = {
  github: { label: "GitHub", icon: GitPullRequest },
  local: { label: "Local", icon: FolderGit2 },
  inbox: { label: "Inbox", icon: Inbox },
} satisfies Record<HistorySource, { label: string; icon: typeof History }>;

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function HistoryScreen() {
  useTitleSlot(
    <>
      <TitleSearch />
      <span className="flex-1" />
      <span className="hidden text-[12px] text-ink-3 sm:block">Stored only on this machine</span>
    </>,
    "desk",
  );
  const navigate = useNavigate();
  const entries = useHistory();
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (scope === "all" || entry.source === scope) &&
        (!needle || `${entry.title} ${entry.detail ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [entries, query, scope]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const groups = [
    { label: "Today", entries: shown.filter((entry) => entry.at >= today.getTime()) },
    { label: "Earlier", entries: shown.filter((entry) => entry.at < today.getTime()) },
  ].filter((group) => group.entries.length);

  const open = (entry: HistoryEntry) => {
    if (!entry.repo || !entry.number) return;
    const [owner, repo] = entry.repo.split("/");
    if (!owner || !repo) return;
    void navigate({
      to: "/pr/$owner/$repo/$number",
      params: { owner, repo, number: String(entry.number) },
    });
  };

  return (
    <div className="screen-enter h-full overflow-y-auto bg-desk scrollbar-thin">
      <header className="history-head px-5 pt-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] font-medium tracking-[-0.025em] text-ink">History</h1>
          <p className="text-[12.5px] text-ink-3">
            {entries.length} action{entries.length === 1 ? "" : "s"} from the last 24 hours
          </p>
        </div>
        <p className="mt-1 text-[12px] text-ink-3">The newest 200 completed actions are kept.</p>
      </header>

      <div className="history-tools mx-5 mt-5 flex items-center gap-3">
        <div className="flex items-center gap-1" aria-label="Filter by source">
          {SCOPES.map(([value, label]) => (
            <Button
              key={value}
              variant="ghost"
              size="sm"
              aria-pressed={scope === value}
              className={cn(scope === value && "bg-raise text-ink")}
              onClick={() => setScope(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label htmlFor="history-filter" className="relative ml-auto block w-full max-w-[260px]">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3"
            strokeWidth={1.75}
          />
          <Input
            id="history-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter history"
            aria-label="Filter history"
            className="h-8 pl-8"
          />
        </label>
      </div>

      {groups.length ? (
        <div className="history-list mx-5 mt-6 pb-10">
          {groups.map((group) => (
            <section key={group.label} className="history-group">
              <h2>{group.label}</h2>
              <div>
                {group.entries.map((entry) => {
                  const meta = SOURCE[entry.source];
                  const Icon = meta.icon;
                  const canOpen = !!entry.repo && !!entry.number;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      disabled={!canOpen}
                      className="history-row"
                      onClick={() => open(entry)}
                    >
                      <Icon className="size-4 shrink-0 text-ink-3" strokeWidth={1.65} />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {entry.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                          {entry.detail ?? meta.label}
                        </span>
                      </span>
                      <span className="tnum shrink-0 text-[11px] text-ink-3">
                        {time.format(entry.at)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mx-auto flex min-h-[320px] max-w-[460px] flex-col items-center justify-center px-8 text-center">
          <History className="mb-4 size-7 text-ink-3" strokeWidth={1.5} />
          <h2 className="text-[17px] font-medium text-ink">
            {entries.length
              ? "No actions match this filter"
              : "Your recent actions will appear here"}
          </h2>
          <p className="mt-2 text-[13px] leading-5 text-ink-3">
            {entries.length
              ? "Try another source or a broader search."
              : "Reviews, comments, pull request changes, and local Git work are recorded after they complete."}
          </p>
        </div>
      )}
    </div>
  );
}
