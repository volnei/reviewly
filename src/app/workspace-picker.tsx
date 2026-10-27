import { parseRepository, useWorkspace, workspaceStore } from "@/app/workspace";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { run, useEffectQuery } from "@/effect/runtime";
import { AppSettings } from "@/effect/services/AppSettings";
import { useAuth } from "@/effect/services/Auth";
import { GitHub } from "@/effect/services/GitHub";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { Check, ChevronsUpDown, FolderGit2, Plus, Search } from "lucide-react";
import { useState } from "react";

export function WorkspacePicker() {
  const auth = useAuth();
  const workspace = useWorkspace();
  const watched = usePrefs((p) => p.watchedRepos);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const repos = useEffectQuery(
    ["repos"],
    Effect.flatMap(GitHub, (g) => g.repos),
    {
      enabled: open && auth.signedIn,
      staleTime: 60_000,
    },
  );
  if (!auth.signedIn) return null;
  const candidates = [
    ...new Set([...watched, ...(repos.data ?? []), ...(workspace ? [workspace] : [])]),
  ];
  const pick = (repo: string | null) => {
    workspaceStore.set(repo);
    setOpen(false);
    setQuery("");
  };
  const add = async (input: string) => {
    const slug = parseRepository(input);
    if (!slug) {
      setError("Use owner/repository or a GitHub repository URL.");
      return;
    }
    if (watched.some((r) => r.toLowerCase() === slug.toLowerCase())) {
      pick(watched.find((r) => r.toLowerCase() === slug.toLowerCase()) ?? slug);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = [...prefsStore.get().watchedRepos, slug];
      await run(Effect.flatMap(AppSettings, (a) => a.setWatchedRepos(next)));
      prefsStore.update((p) => ({ ...p, watchedRepos: next }));
      await qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: ["prs"] });
      pick(slug);
      setDraft("");
    } catch {
      setError("Couldn’t add this repository. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="workspace-picker-trigger flex max-w-[280px] shrink-0 items-center gap-2 rounded-md px-2 py-1 text-[12px] text-ink-2 hover:bg-raise"
        aria-label="Switch or add workspace"
      >
        <span className="workspace-picker-slash text-ink-3">/</span>
        <span className="workspace-picker-label truncate">{workspace ?? "All repositories"}</span>
        <ChevronsUpDown className="size-3 shrink-0 text-ink-3" />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-[320px] max-w-[calc(100vw-24px)]">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
          Switch workspace
        </div>
        <label className="mb-2 flex items-center gap-2 rounded-md border border-edge px-2.5 py-2">
          <Search className="size-3.5 text-ink-3" />
          <input
            aria-label="Find a workspace"
            placeholder="Find a repository…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        <div className="max-h-56 overflow-y-auto">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => pick(null)}
            className="workspace-option"
          >
            <FolderGit2 className="size-4" />
            <span className="flex-1">All repositories</span>
            {!workspace ? <Check className="size-3.5" /> : null}
          </Button>
          {candidates
            .filter((r) => r.toLowerCase().includes(query.toLowerCase()))
            .map((repo) => (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                key={repo}
                disabled={busy}
                onClick={() => (watched.includes(repo) ? pick(repo) : void add(repo))}
                className="workspace-option"
              >
                <FolderGit2 className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{repo}</span>
                {workspace === repo ? (
                  <Check className="size-3.5" />
                ) : !watched.includes(repo) ? (
                  <Plus className="size-3.5" />
                ) : null}
              </Button>
            ))}
          {repos.isLoading ? (
            <p className="p-2 text-[12px] text-ink-3">Loading repositories…</p>
          ) : null}
          {repos.isError ? (
            <p className="p-2 text-[12px] text-ink-3">
              Couldn’t load suggestions. You can add a repository below.
            </p>
          ) : null}
        </div>
        <form
          className="mt-3 border-t border-hair pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add(draft);
          }}
        >
          <label
            htmlFor="new-workspace"
            className="text-[10px] uppercase tracking-wider text-ink-3"
          >
            Add repository workspace
          </label>
          <input
            id="new-workspace"
            placeholder="owner/repository or GitHub URL"
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            className="mt-2 w-full rounded-md border border-edge bg-desk px-2.5 py-2 text-[12px]"
            required
            aria-describedby={error ? "workspace-error" : undefined}
          />
          {error ? (
            <p id="workspace-error" role="alert" className="mt-2 text-[12px] text-del">
              {error}
            </p>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            type="submit"
            disabled={busy || !draft.trim()}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[12px] text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add workspace"}
          </Button>
        </form>
      </PopoverPopup>
    </Popover>
  );
}
