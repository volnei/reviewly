import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle2,
  Code,
  FileCode2,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyScope } from "@/app/keys";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { type AppServices, run, useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { providerName } from "@/effect/services/Ai";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import { age } from "@/features/list/row";
import { FilePreview } from "@/features/local/file-browser";
import { QuickOpen } from "@/features/local/quick-open";
import { useAiRun } from "@/features/pr/ai";
import { Diff } from "@/features/pr/diff";
import { Section } from "@/features/pr/section";
import { COMMIT_PROMPT } from "@/lib/ai/prompts";
import { fromLocalId } from "@/lib/local-id";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";

type Fx = Effect.Effect<unknown, unknown, AppServices>;

/** A local working tree with a persistent commit sidebar and separate history and branch views. */
export function LocalRepoScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as {
    file?: string;
    line?: number;
    from?: "spec-lens" | "living-architecture";
  };
  const path = fromLocalId(id);
  const name = path.split("/").pop() ?? path;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const wrap = usePrefs((p) => p.wrapLines);

  const info = useEffectQuery(
    ["local-repo", path, "info"],
    Effect.flatMap(Git, (g) => g.repoInfo(path)),
  );
  const tree = useEffectQuery(
    ["local-repo", path, "status"],
    Effect.flatMap(Git, (g) => g.status(path)),
    { refetchInterval: 5000 },
  );
  const log = useEffectQuery(
    ["local-repo", path, "log"],
    Effect.flatMap(Git, (g) => g.log(path, 100)),
  );
  const branches = useEffectQuery(
    ["local-repo", path, "branches"],
    Effect.flatMap(Git, (g) => g.localBranches(path)),
  );
  const remote = useEffectQuery(
    ["local-repo", path, "remote-branches"],
    Effect.flatMap(Git, (g) => g.branches(path)),
    { staleTime: 10 * 60_000, retry: false },
  );
  const worktrees = useEffectQuery(
    ["local-repo", path, "worktrees"],
    Effect.flatMap(Git, (g) => g.worktrees(path)),
  );
  const changes = useEffectQuery(
    ["local-repo", path, "branch-changes"],
    Effect.flatMap(Git, (g) => g.branchChanges(path)),
    { retry: false },
  );
  const editors = useEffectQuery(
    ["editors"],
    Effect.flatMap(Git, (g) => g.editorTargets),
    { staleTime: Number.POSITIVE_INFINITY },
  );
  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: ["local-repo", path] }),
    [qc, path],
  );

  const t = tree.data;
  const files = useMemo(
    () => [
      ...(t?.staged ?? []).map((f) => ({ ...f, staged: true })),
      ...(t?.unstaged ?? []).map((f) => ({ ...f, staged: false })),
    ],
    [t],
  );
  const [view, setView] = useState<"changes" | "history" | "branches">("changes");
  const [fileFilter, setFileFilter] = useState("");
  const visibleFile = (file: S.FileChange) =>
    file.path.toLowerCase().includes(fileFilter.trim().toLowerCase());
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const keyOf = (f: { path: string; staged: boolean }) => `${f.staged ? "s" : "u"}:${f.path}`;
  const index = Math.max(
    0,
    files.findIndex((f) => keyOf(f) === currentKey),
  );
  const current = files[index] ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const openFile = useCallback(
    (rel: string, line?: number) => {
      const target = editors.data?.[0];
      if (!target) {
        toast.say("No editor found on this machine");
        return;
      }
      const location = `${path}/${rel}${line ? `:${line}` : ""}`;
      run(Effect.flatMap(Git, (git) => git.openEditor(location, target.id))).catch((error) =>
        toast.fail(`Couldn’t open ${rel}`, error),
      );
    },
    [editors.data, path],
  );
  const message = useRef<HTMLTextAreaElement>(null);
  const back = useCallback(() => navigate({ to: "/local" }), [navigate]);
  const closeFile = useCallback(() => {
    if (search.from === "spec-lens") return navigate({ to: "/spec-lens" });
    if (search.from === "living-architecture") return navigate({ to: "/turbo" });
    return navigate({
      to: "/local/$id",
      params: { id },
      search: {},
    });
  }, [navigate, id, search.from]);

  const act = useCallback(
    async (label: string, fx: Fx, done?: string) => {
      setBusy(label);
      try {
        await run(fx);
        await refresh();
        if (done) toast.done(done);
        return true;
      } catch (e) {
        toast.fail(`${label} didn’t go through`, e);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );
  const git = <A,>(f: (g: Git["Service"]) => Effect.Effect<A, unknown, never>) =>
    Effect.flatMap(Git, f);

  const stage = (file: string | null) =>
    act(
      "Stage",
      git((g) => g.stage(path, file)),
    );
  const unstage = (file: string | null) =>
    act(
      "Unstage",
      git((g) => g.unstage(path, file)),
    );
  const discard = (f: { path: string; status: string }) =>
    act(
      "Discard",
      git((g) => g.discard(path, f.path, f.status === "?")),
      `Discarded ${f.path}`,
    );
  const jump = (k: string) => {
    setView("changes");
    setCurrentKey(k);
    document
      .getElementById(`lf-${k.replace(/[^a-z0-9]+/gi, "-")}`)
      ?.scrollIntoView({ block: "start" });
  };

  useKeyScope(
    "local-repo",
    // biome-ignore lint/correctness/useExhaustiveDependencies: stage, unstage and jump close over stable state
    useCallback(
      (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
          setQuickOpen(true);
          return true;
        }
        if (prOpen || quickOpen || e.metaKey || e.ctrlKey || e.altKey) return false;
        switch (e.key) {
          case "Escape":
            void back();
            return true;
          case "j":
          case "k": {
            if (view !== "changes") return false;
            const visible = files.filter(visibleFile);
            const position = Math.max(
              0,
              visible.findIndex(
                (file) => keyOf(file) === keyOf(current ?? { path: "", staged: false }),
              ),
            );
            const next =
              visible[
                Math.min(visible.length - 1, Math.max(0, position + (e.key === "j" ? 1 : -1)))
              ];
            if (next) jump(keyOf(next));
            return true;
          }
          case " ":
            if (view !== "changes" || search.file) return false;
            if (current) void (current.staged ? unstage(current.path) : stage(current.path));
            return !!current;
          case "c":
            setView("changes");
            requestAnimationFrame(() => message.current?.focus());
            return true;
        }
        return false;
      },
      [prOpen, quickOpen, back, files, index, current, view, search.file, fileFilter],
    ),
  );

  const defaultBranch = remote.data?.default ?? "main";
  const onBranch = t?.branch ?? info.data?.current_branch ?? "";
  const canPr = !!t && onBranch !== defaultBranch && (t.ahead > 0 || !t.upstream);
  const canPush = !!t && (t.ahead > 0 || !t.upstream);

  useTitleSlot(
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={back}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-ink-2 hover:bg-raise hover:text-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={2} /> Local
      </Button>
      <span className="text-[13px] text-ink">{name}</span>
      {t ? (
        <span className="mono truncate text-[12px] text-ink-3">
          {t.branch}
          {t.upstream ? (
            <span className="tnum ml-2">
              ↑{t.ahead} ↓{t.behind}
            </span>
          ) : (
            <span className="ml-2 font-sans">never pushed</span>
          )}
        </span>
      ) : null}
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => setQuickOpen(true)}
        className="flex h-7 items-center gap-2 rounded-md bg-raise/70 px-2.5 text-[12.5px] text-ink-3 hover:bg-raise"
      >
        Open a file <kbd className="text-[11px]">⌘P</kbd>
      </Button>
      <IconButton
        label="Fetch"
        disabled={busy !== null}
        onClick={() =>
          void act(
            "Fetch",
            git((g) => g.fetch(path)),
            "Fetched",
          )
        }
      >
        <RefreshCw
          className={cn("size-4", busy === "Fetch" && "animate-spin")}
          strokeWidth={1.75}
        />
      </IconButton>
      <IconButton
        label="Pull"
        disabled={busy !== null || !t?.upstream}
        onClick={() =>
          void act(
            "Pull",
            git((g) => g.pull(path)),
            "Pulled",
          )
        }
      >
        <ArrowDownToLine className="size-4" strokeWidth={1.75} />
      </IconButton>
      {editors.data?.[0] ? (
        <IconButton
          label={`Open in ${editors.data[0].label}`}
          onClick={() =>
            void act(
              "Open in editor",
              git((g) => g.openEditor(path, editors.data[0].id)),
            )
          }
        >
          <Code className="size-4" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {canPush ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void act(
              "Push",
              git((g) => g.push(path)),
              "Pushed",
            )
          }
          className="h-7 rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink disabled:opacity-50"
        >
          {busy === "Push" ? "Pushing…" : "Push"}
        </Button>
      ) : null}
      {canPr ? (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setPrOpen(true)}
          className="h-7 rounded-md border border-ink bg-ink px-2.5 text-[12.5px] font-medium text-[#141414]"
        >
          Open a pull request
        </Button>
      ) : null}
    </>,
    "page",
    [name, t, busy, canPush, canPr, editors.data],
  );

  if (tree.isError) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <div className="max-w-md text-center">
          <p className="text-[13px] text-ink">Couldn’t read {name}.</p>
          <p className="mt-1 text-[12.5px] text-ink-3">{String((tree.error as Error).message)}</p>
        </div>
      </div>
    );
  }
  if (!t) return <div className="h-full bg-page p-8 text-[12.5px] text-ink-3">Reading {name}…</div>;

  const stagedCount = t.staged.length;
  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        setView(value as typeof view);
        if (search.file) void navigate({ to: "/local/$id", params: { id }, search: {} });
      }}
      className="flex h-full flex-col bg-page"
    >
      <header className="shrink-0 border-b border-hair px-5 pt-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="text-[18px] font-semibold tracking-tight text-ink">{name}</h1>
              <span className="inline-flex max-w-80 items-center gap-1.5 rounded-md border border-hair bg-raise/40 px-2 py-1 text-[11px] text-ink-2">
                <GitBranch className="size-3.5 shrink-0" />
                <span className="truncate">{t.branch}</span>
              </span>
            </div>
            <p
              className="mt-1 truncate text-[11px] text-ink-3"
              title={info.data?.remote_url ?? path}
            >
              {path}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-ink-3">
            {t.ahead ? <span>{t.ahead} to push</span> : null}
            {t.behind ? <span>{t.behind} behind upstream</span> : null}
            {!t.ahead && !t.behind && t.upstream ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5" /> Up to date
              </span>
            ) : null}
          </div>
        </div>
        <TabsList variant="underline">
          <TabsTab value="changes">
            <FileCode2 className="size-3.5" /> Changes{" "}
            <span className="text-ink-3">{files.length}</span>
          </TabsTab>
          <TabsTab value="history">
            <GitCommitHorizontal className="size-3.5" /> History
          </TabsTab>
          <TabsTab value="branches">
            <GitBranch className="size-3.5" /> Branches{" "}
            <span className="text-ink-3">{branches.data?.all.length ?? 0}</span>
          </TabsTab>
        </TabsList>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Working tree"
          className={cn(
            "flex h-full w-[300px] shrink-0 flex-col border-r border-hair bg-desk max-lg:w-[260px]",
            view !== "changes" && "hidden",
          )}
        >
          <div className="relative p-3">
            <Search className="pointer-events-none absolute left-5 top-5 size-3.5 text-ink-3" />
            <Input
              value={fileFilter}
              onChange={(event) => setFileFilter(event.target.value)}
              aria-label="Filter changed files"
              placeholder="Filter changed files…"
              size="sm"
              className="pl-7"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-6 scrollbar-thin">
            {fileFilter.trim() && !files.some(visibleFile) ? (
              <p className="px-4 py-3 text-[12px] text-ink-3">No files match your search.</p>
            ) : null}
            <Group
              title="Staged"
              count={t.staged.length}
              action={
                t.staged.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => void unstage(null)}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    Unstage all
                  </Button>
                ) : null
              }
            >
              {t.staged.filter(visibleFile).map((f) => (
                <ChangeRow
                  key={`s:${f.path}`}
                  f={f}
                  current={current?.staged === true && current.path === f.path}
                  onSelect={() => jump(`s:${f.path}`)}
                  actions={
                    <IconButton size={6} label="Unstage" onClick={() => void unstage(f.path)}>
                      <Minus className="size-3.5" strokeWidth={2} />
                    </IconButton>
                  }
                />
              ))}
            </Group>
            <Group
              title="Changes"
              count={t.unstaged.length}
              action={
                t.unstaged.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => void stage(null)}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    Stage all
                  </Button>
                ) : null
              }
            >
              {t.unstaged.filter(visibleFile).map((f) => (
                <ChangeRow
                  key={`u:${f.path}`}
                  f={f}
                  current={current?.staged === false && current.path === f.path}
                  onSelect={() => jump(`u:${f.path}`)}
                  actions={
                    <>
                      <IconButton size={6} label="Stage" onClick={() => void stage(f.path)}>
                        <Plus className="size-3.5" strokeWidth={2} />
                      </IconButton>
                      <IconButton
                        size={6}
                        label={f.status === "?" ? "Delete the file" : "Discard the change"}
                        onClick={() => void discard(f)}
                      >
                        <Undo2 className="size-3.5" strokeWidth={2} />
                      </IconButton>
                    </>
                  }
                />
              ))}
            </Group>
          </div>
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-hair p-3">
            <CommitBox
              inputRef={message}
              staged={stagedCount}
              busy={busy === "Commit"}
              repo={path}
              lastSubject={log.data?.[0]?.subject ?? ""}
              onCommit={async (m, amend) => {
                const ok = await act(
                  "Commit",
                  git((g) => g.commit(path, m, amend)),
                  amend ? "Amended" : "Committed",
                );
                return ok;
              }}
            />
          </div>
        </aside>
        <div className="relative h-full min-w-0 flex-1 overflow-y-auto bg-page scrollbar-thin">
          {search.file ? (
            <div className="mx-auto max-w-[1120px] px-8 pt-5 pb-24">
              <div className="mb-4 flex items-center justify-between border-b border-hair pb-3">
                <div className="min-w-0">
                  <p className="text-[11px] text-ink-3">
                    {search.from === "spec-lens"
                      ? "Opened from Spec Lens"
                      : search.from === "living-architecture"
                        ? "Architecture evidence"
                        : "Repository file"}
                  </p>
                  <h2 className="mono mt-1 truncate text-[13px] text-ink">{search.file}</h2>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void closeFile()}
                  className="h-7 rounded-md px-2.5 text-[12px] text-ink-2 hover:bg-raise hover:text-ink"
                >
                  {search.from === "spec-lens"
                    ? "Back to Spec Lens"
                    : search.from === "living-architecture"
                      ? "Back to architecture"
                      : "Back to changes"}
                </Button>
              </div>
              <FilePreview repo={path} rel={search.file} line={search.line} wrap={wrap} />
            </div>
          ) : (
            <div className="p-5 pb-12">
              <TabsPanel value="changes">
                {view === "changes" ? (
                  current ? (
                    <FileDiff
                      key={keyOf(current)}
                      repo={path}
                      f={current}
                      wrap={wrap}
                      id={`lf-${keyOf(current).replace(/[^a-z0-9]+/gi, "-")}`}
                      onToggle={() =>
                        void (current.staged ? unstage(current.path) : stage(current.path))
                      }
                    />
                  ) : (
                    <div className="grid min-h-[360px] place-content-center justify-items-center gap-2 text-center">
                      <CheckCircle2 className="mb-2 size-8 text-ink-3" />
                      <h2 className="text-[15px] font-medium text-ink">Working tree is clean</h2>
                      <p className="max-w-xs text-[12px] text-ink-3">
                        Your local changes will appear here. Browse history or switch branches
                        above.
                      </p>
                    </div>
                  )
                ) : null}
              </TabsPanel>
              {view === "history" ? (
                <TabsPanel value="history">
                  <div className="mb-4">
                    <h2 className="text-[15px] font-semibold text-ink">Commit history</h2>
                    <p className="mt-1 text-[12px] text-ink-3">
                      {log.data?.length ?? 0} recent commits · {t.branch}
                    </p>
                  </div>
                  {log.isError ? (
                    <p className="text-[12px] text-del">Couldn’t load commit history.</p>
                  ) : log.isPending ? (
                    <p className="text-[12px] text-ink-3">Reading commits…</p>
                  ) : null}
                  {changes.data?.files.length ? (
                    <Section
                      title={`Against ${changes.data.base ?? defaultBranch}: ${changes.data.files.length} file${changes.data.files.length === 1 ? "" : "s"}`}
                    >
                      <ul className="grid gap-1">
                        {changes.data.files.map((f) => (
                          <li
                            key={f.path}
                            className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-[12.5px]"
                          >
                            <span className="mono truncate text-ink-2">{f.path}</span>
                            <span className="tnum">
                              <span className="text-add">+{f.additions}</span>{" "}
                              <span className="text-del">−{f.deletions}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Section>
                  ) : null}
                  <div className="rounded-xl border border-hair bg-desk p-3">
                    <ol className="grid gap-1">
                      {(log.data ?? []).map((c) => (
                        <CommitRow key={c.hash} repo={path} c={c} wrap={wrap} />
                      ))}
                    </ol>
                  </div>
                </TabsPanel>
              ) : null}
              {view === "branches" ? (
                <TabsPanel value="branches">
                  <div className="mb-4">
                    <h2 className="text-[15px] font-semibold text-ink">Local branches</h2>
                    <p className="mt-1 text-[12px] text-ink-3">
                      Switch branches, create a branch or manage worktrees.
                    </p>
                  </div>
                  {branches.isError ? (
                    <p className="text-[12px] text-del">Couldn’t load branches.</p>
                  ) : branches.isPending ? (
                    <p className="text-[12px] text-ink-3">Reading branches…</p>
                  ) : null}

                  <Branches
                    current={t.branch}
                    all={branches.data?.all ?? []}
                    worktrees={worktrees.data ?? []}
                    busy={busy !== null}
                    onSwitch={(b) =>
                      void act(
                        "Switch branch",
                        git((g) => g.checkout(path, b)),
                        `On ${b}`,
                      )
                    }
                    onCreate={(b) =>
                      void act(
                        "New branch",
                        git((g) => g.createBranch(path, b)),
                        `On ${b}`,
                      )
                    }
                    onDelete={async (b) => {
                      const ok = await act(
                        "Delete branch",
                        git((g) => g.deleteBranch(path, b, false)),
                        `Deleted ${b}`,
                      );
                      if (!ok && window.confirm(`${b} isn’t fully merged. Delete it anyway?`))
                        void act(
                          "Delete branch",
                          git((g) => g.deleteBranch(path, b, true)),
                          `Deleted ${b}`,
                        );
                    }}
                  />
                </TabsPanel>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <QuickOpen repo={path} open={quickOpen} onOpenChange={setQuickOpen} onPick={openFile} />
      <PrDialog
        open={prOpen}
        onOpenChange={setPrOpen}
        subject={log.data?.[0]?.subject ?? ""}
        head={t.branch}
        base={defaultBranch}
        bases={remote.data?.branches ?? [defaultBranch]}
        busy={busy === "Open a pull request"}
        onConfirm={async (title, body, base) => {
          setBusy("Open a pull request");
          try {
            const url = await run(git((g) => g.createPr(path, title, body, base)));
            setPrOpen(false);
            await refresh();
            void qc.invalidateQueries({ queryKey: ["inbox"] });
            toast.act("Pull request opened", "Open it", () => safeOpenUrl(url));
          } catch (e) {
            toast.fail("The pull request didn’t open", e);
          } finally {
            setBusy(null);
          }
        }}
      />
    </Tabs>
  );
}

function Group({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="flex items-center gap-2 px-3 pt-3 pb-2 text-[11px] font-medium text-ink-3">
        <span>
          {title} <span className="tnum">{count}</span>
        </span>
        <span className="ml-auto">{action}</span>
      </p>
      {count === 0 ? <p className="px-4 pb-1 text-[12px] text-ink-3">No files</p> : children}
    </div>
  );
}

const STATUS: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  "?": "new",
};

export function ChangeRow({
  f,
  current,
  onSelect,
  actions,
}: {
  f: S.FileChange;
  current: boolean;
  onSelect: () => void;
  actions: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group mx-2 mb-1 grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-lg px-2",
        current ? "bg-raise" : "hover:bg-raise/50",
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onSelect}
        aria-current={current ? "true" : undefined}
        className={cn(
          "h-auto min-w-0 justify-start gap-2 px-0 py-1 text-left text-[12.5px]",
          current ? "text-ink" : "text-ink-2 hover:text-ink",
        )}
      >
        <span className="mono text-[10.5px] text-ink-3" title={STATUS[f.status] ?? f.status}>
          {f.status}
        </span>
        <span className="min-w-0 flex-1" title={f.path}>
          <span className="block truncate text-[12px] font-medium">
            {f.path
              .replace(/[/\\]+$/, "")
              .split(/[/\\]/)
              .pop()}
          </span>
          <span className="block truncate text-[10px] text-ink-3">
            {f.path.endsWith("/")
              ? "Untracked directory"
              : f.path.includes("/")
                ? f.path.slice(0, f.path.lastIndexOf("/"))
                : (STATUS[f.status] ?? f.status)}
          </span>
        </span>
      </Button>
      <span className="flex items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        {actions}
      </span>
    </div>
  );
}

function FileDiff({
  repo,
  f,
  wrap,
  id,
  onToggle,
}: {
  repo: string;
  f: S.FileChange & { staged: boolean };
  wrap: boolean;
  id: string;
  onToggle: () => void;
}) {
  const diff = useEffectQuery(
    ["local-repo", repo, "diff", f.staged, f.path],
    Effect.flatMap(Git, (g) => g.diffFile(repo, f.path, f.staged)),
    { retry: false },
  );
  return (
    <section id={id} className="scroll-mt-10 overflow-clip rounded-xl border border-hair bg-page">
      <header className="sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-3 border-b border-hair bg-desk px-4 py-2">
        <span className="mono min-w-0 flex-1 truncate text-[12px] text-ink">{f.path}</span>
        <span className="text-[11px] text-ink-3">
          {STATUS[f.status] ?? f.status} · {f.staged ? "staged" : "not staged"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onToggle}
          className="h-6 rounded-md px-2 text-[12px] text-ink-2 hover:bg-raise hover:text-ink"
        >
          {f.staged ? "Unstage" : "Stage"}
        </Button>
      </header>
      {f.path.endsWith("/") ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
          <Folder className="size-8 text-ink-3" />
          <h3 className="text-[14px] font-medium text-ink">Untracked directory</h3>
          <p className="max-w-sm text-[12px] leading-5 text-ink-3">
            Git is showing this directory as one entry. Stage it to list the files Git can include.
          </p>
        </div>
      ) : diff.isPending ? (
        <p className="p-5 text-[12px] text-ink-3">Reading local changes…</p>
      ) : diff.isError ? (
        <p className="p-5 text-[12px] text-del">
          Couldn’t read this local diff. Refresh to try again.
        </p>
      ) : f.status === "?" && !diff.data ? (
        <FilePreview repo={repo} rel={f.path} wrap={wrap} />
      ) : !diff.data?.trim() ? (
        <p className="p-5 text-[12px] text-ink-3">
          No text changes to display. This may be a binary file, a rename, or a file mode change.
        </p>
      ) : (
        <Diff
          filename={f.path}
          patch={diff.data}
          split={false}
          wrap={wrap}
          under={() => null}
          idPrefix={id}
        />
      )}
    </section>
  );
}

const CommitBox = ({
  inputRef,
  staged,
  busy,
  repo,
  lastSubject,
  onCommit,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  staged: number;
  busy: boolean;
  repo: string;
  /** The last commit's subject, for an amend. */
  lastSubject: string;
  onCommit: (message: string, amend: boolean) => Promise<boolean>;
}) => {
  const [m, setM] = useState("");
  const [amend, setAmend] = useState(false);
  const provider = usePrefs((p) => p.ai.provider);
  const ai = useAiRun();
  const can = (staged > 0 || amend) && m.trim().length > 0 && !busy;
  const send = async () => {
    if (!can) return;
    if (await onCommit(m.trim(), amend)) {
      setM("");
      setAmend(false);
    }
  };
  /** The staged diff goes to the model; its message lands in the box. */
  const draft = async () => {
    try {
      const diff = await run(Effect.flatMap(Git, (g) => g.stagedDiff(repo)));
      if (!diff.trim()) {
        toast.say("Stage something first");
        return;
      }
      ai.start(
        `commit:${repo}`,
        COMMIT_PROMPT + diff,
        (text) => setM(text.trim()),
        "Writing",
        repo,
      );
    } catch (e) {
      toast.fail("Couldn’t read the staged diff", e);
    }
  };
  return (
    <div className="space-y-3">
      <p className="flex items-center justify-between text-[11px] font-medium text-ink-2">
        <span>Commit changes</span>
        <span className="text-ink-3">{staged} staged</span>
      </p>
      <Textarea
        ref={inputRef}
        value={ai.running && ai.text ? ai.text : m}
        onChange={(e) => setM(e.target.value)}
        rows={3}
        placeholder={
          staged || amend ? "What this commit does, in a line." : "Write a commit message…"
        }
        className="selectable w-full resize-y rounded-md border border-input bg-sink px-2.5 py-1.5 font-sans text-[13px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          size="sm"
          type="button"
          disabled={!can}
          onClick={() => void send()}
          className="w-full"
        >
          {busy ? "Committing…" : "Commit"}{" "}
          <kbd className="ml-1 font-sans text-[11px] opacity-70">⌘↵</kbd>
        </Button>

        <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <Checkbox
            checked={amend}
            onCheckedChange={(checked) => {
              setAmend(checked);
              if (checked && !m.trim()) setM(lastSubject);
            }}
          />
          Amend last commit
        </label>
        <span className="flex-1" />
        {ai.running ? (
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={ai.cancel}
            className="text-[12px] text-ink-2 hover:text-ink"
          >
            Stop
          </Button>
        ) : (
          <IconButton
            size={6}
            label={`Write the message with ${providerName(provider)}`}
            disabled={staged === 0}
            onClick={() => void draft()}
          >
            <Sparkles className="ai-spark size-3.5" strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
    </div>
  );
};

/** `git show` for one commit, split into one diff per file. */
function splitUnifiedDiff(text: string): Array<{ file: string; patch: string }> {
  const out: Array<{ file: string; patch: string }> = [];
  for (const chunk of text.split(/^(?=diff --git )/m)) {
    const m = chunk.match(/^diff --git a\/(.+?) b\//);
    if (m) out.push({ file: m[1], patch: chunk });
  }
  return out;
}

function CommitRow({ repo, c, wrap }: { repo: string; c: S.LocalCommit; wrap: boolean }) {
  const [open, setOpen] = useState(false);
  const show = useEffectQuery(
    ["local-repo", repo, "show", c.hash],
    Effect.flatMap(Git, (g) => g.show(repo, c.hash)),
    { enabled: open, staleTime: Number.POSITIVE_INFINITY },
  );
  const parts = useMemo(() => (show.data ? splitUnifiedDiff(show.data) : []), [show.data]);
  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-auto min-h-11 w-full grid-cols-[64px_minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg px-3 py-2 text-left text-[12.5px] hover:bg-raise/50"
      >
        <span className="mono text-ink-3">{c.short}</span>
        <span className="truncate text-ink">{c.subject}</span>
        <span className="text-ink-3">{c.author}</span>
        <span className="tnum text-ink-3">{age(c.date)}</span>
      </Button>
      {open ? (
        <div className="mt-2 mb-3 grid gap-3 pl-[76px]">
          {show.isPending ? <p className="text-[12.5px] text-ink-3">Loading the commit…</p> : null}
          {parts.map((p) => (
            <section key={p.file} className="rounded-lg border border-edge bg-page">
              <header className="flex h-8 items-center border-b border-hair px-3">
                <span className="mono truncate text-[12px] text-ink">{p.file}</span>
              </header>
              <Diff
                filename={p.file}
                patch={p.patch}
                split={false}
                wrap={wrap}
                under={() => null}
                idPrefix={`c-${c.short}-${p.file.replace(/[^a-z0-9]+/gi, "-")}`}
              />
            </section>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Branches({
  current,
  all,
  worktrees,
  busy,
  onSwitch,
  onCreate,
  onDelete,
}: {
  current: string;
  all: ReadonlyArray<string>;
  worktrees: ReadonlyArray<S.Worktree>;
  busy: boolean;
  onSwitch: (b: string) => void;
  onCreate: (b: string) => void;
  onDelete: (b: string) => void;
}) {
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const shown = q.trim()
    ? all.filter((b) => b.toLowerCase().includes(q.trim().toLowerCase()))
    : all;
  return (
    <div className="grid max-w-[960px] gap-3">
      {all.length > 8 ? (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Filter ${all.length} branches`}
          className="mono h-7 w-64 rounded-md border border-input bg-sink px-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : null}
      <ul className="grid gap-2">
        {shown.map((b) => (
          <li
            key={b}
            className="group grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border border-hair px-3 py-2 text-[12.5px]"
          >
            <span className={cn("mono truncate", b === current ? "text-ink" : "text-ink-2")}>
              {b}
              {b === current ? <span className="ml-2 font-sans text-ink-3">here</span> : null}
            </span>
            {b !== current ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => onSwitch(b)}
                className="h-6 rounded-md px-2 text-[12px] text-ink-2 hover:bg-raise hover:text-ink disabled:opacity-50"
              >
                Switch
              </Button>
            ) : (
              <span />
            )}
            {b !== current ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete the branch ${b}?`)) onDelete(b);
                }}
                className="h-6 rounded-md px-2 text-[12px] text-ink-3 opacity-0 hover:bg-raise hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const b = name.trim();
          if (b) {
            onCreate(b);
            setName("");
          }
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="new-branch-name"
          className="mono h-7 w-64 rounded-md border border-input bg-sink px-2 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button
          variant="ghost"
          size="sm"
          type="submit"
          disabled={!name.trim() || busy}
          className="h-7 rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink disabled:opacity-50"
        >
          New branch from here
        </Button>
      </form>
      {worktrees.length > 1 ? (
        <div>
          <p className="text-[11px] text-ink-3">worktrees</p>
          <ul className="mt-1 grid gap-0.5 text-[12.5px]">
            {worktrees.map((w) => (
              <li key={w.path} className="mono truncate text-ink-2">
                {w.path}
                {w.branch ? <span className="ml-2 text-ink-3">{w.branch}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PrDialog({
  open,
  onOpenChange,
  subject,
  head,
  base,
  bases,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subject: string;
  head: string;
  base: string;
  bases: ReadonlyArray<string>;
  busy: boolean;
  onConfirm: (title: string, body: string, base: string) => void;
}) {
  const [title, setTitle] = useState(subject);
  const [body, setBody] = useState("");
  const [into, setInto] = useState(base);
  useEffect(() => {
    if (open) {
      setTitle(subject);
      setInto(base);
    }
  }, [open, subject, base]);
  const inputCls =
    "selectable w-full rounded-md border border-input bg-sink px-2.5 py-1.5 font-sans text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-edge";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[560px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">
            Open a pull request
          </DialogTitle>
          <DialogDescription className="text-[12.5px] text-ink-3">
            <span className="mono">{head}</span> into <span className="mono">{into}</span>, pushed
            first if it has to be.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3 px-6">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className={cn(inputCls, "h-8")}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="What this change is, and why. Markdown is fine."
            className={cn(inputCls, "resize-y leading-[1.5]")}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
            into
            <Select
              value={into}
              onValueChange={(value) => {
                if (value !== null) setInto(value);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label="Target branch"
                className="min-w-0 w-auto max-w-64"
              >
                <SelectValue>{into}</SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {[...new Set([base, ...bases])].map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    {branch}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </DialogPanel>
        <DialogFooter className="px-6 pb-5">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:bg-raise"
          >
            Not yet
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={!title.trim() || busy}
            onClick={() => onConfirm(title.trim(), body, into)}
            className="w-full"
          >
            {busy ? "Opening…" : "Open a pull request"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
