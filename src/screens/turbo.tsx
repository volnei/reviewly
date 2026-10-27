import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import { ListHead, Nothing } from "@/features/list/list";
import { useWorkspaceHealth } from "@/features/list/workspace";
import { parseCodeowners } from "@/lib/codeowners";
import { toLocalId } from "@/lib/local-id";
import {
  type ArchitectureNode,
  type ArchitectureSignal,
  type RepoHealth,
  architectureActions,
  architectureNodes,
  architectureSignals,
  buildReport,
  problemCount,
} from "@/lib/turbo-health";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";

type FindingKind = "boundaries" | "phantoms" | "versions" | "cycles";

interface BoundaryGroup {
  key: string;
  from: string;
  target: string;
  count: number;
  file: string;
  line: number;
}

const PAGE_SIZE = 80;
const CODEOWNERS_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

/** A Labs tool for turning a raw Turbo scan into a ranked, actionable repair queue. */
export function TurboScreen() {
  useTitleSlot(<span className="text-[13px] text-ink-2">Labs / Living architecture</span>, "desk");
  const paths = usePrefs((p) => p.localRepos);
  const workspaces = useWorkspaceHealth();
  const qc = useQueryClient();
  const [selectedPath, setSelectedPath] = useState("");
  const workspace = workspaces.find((item) => item.path === selectedPath) ?? workspaces[0] ?? null;

  const refresh = () => void qc.invalidateQueries({ queryKey: ["workspace-health"] });
  const copy = () => {
    if (!workspace) return;
    navigator.clipboard
      .writeText(buildReport(workspace))
      .then(() => toast.say("Turbo report copied", "Ready to paste into your coding agent."))
      .catch(() => toast.fail("Couldn’t copy the report"));
  };

  return (
    <div className="screen-enter h-full overflow-y-auto bg-desk scrollbar-thin">
      <div className="flex items-baseline justify-between pr-5">
        <ListHead title="Living architecture">
          {workspace
            ? `${workspace.owner}/${workspace.repo} · ${workspace.scan.packages.length} packages · scanned locally.`
            : "Package boundaries and dependency hygiene for local Turbo workspaces."}
        </ListHead>
        <span className="flex items-center gap-1">
          {workspace ? (
            <Button variant="ghost" size="sm" onClick={copy}>
              <Copy className="size-3.5" /> Copy agent brief
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="size-3.5" /> Scan again
          </Button>
        </span>
      </div>

      {workspace ? (
        <div className="mx-auto max-w-[1280px] px-5 pb-14">
          {workspaces.length > 1 ? (
            <div className="mb-5 flex gap-5 border-b border-hair" aria-label="Turbo workspaces">
              {workspaces.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => setSelectedPath(item.path)}
                  className={cn(
                    "relative h-9 text-[12.5px] text-ink-3 hover:text-ink",
                    item.path === workspace.path &&
                      "after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-px after:bg-workspace text-ink",
                  )}
                >
                  {item.owner}/{item.repo}
                </button>
              ))}
            </div>
          ) : null}
          <WorkspaceDiagnosis workspace={workspace} />
        </div>
      ) : (
        <Nothing
          detail={
            paths.length
              ? "None of your local repositories contains a turbo.json yet. This Lab appears automatically when Reviewly detects one."
              : "Add a local repository first. Reviewly enables this Lab automatically when it finds turbo.json."
          }
        >
          No Turborepo workspace detected
        </Nothing>
      )}
    </div>
  );
}

function WorkspaceDiagnosis({ workspace }: { workspace: RepoHealth }) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<FindingKind>("boundaries");
  const [mode, setMode] = useState<"actions" | "architecture" | "findings">("actions");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const total = problemCount(workspace);
  const tabs: ReadonlyArray<{
    key: FindingKind;
    label: string;
    count: number;
    description: string;
  }> = [
    {
      key: "boundaries",
      label: "Boundary crossings",
      count: workspace.scan.crossings.length,
      description: "Imports that bypass another package’s public surface.",
    },
    {
      key: "phantoms",
      label: "Undeclared imports",
      count: workspace.phantoms.length,
      description: "Workspace packages used without a dependency declaration.",
    },
    {
      key: "versions",
      label: "Version mismatches",
      count: workspace.mismatches.length,
      description: "External dependencies pinned to competing ranges.",
    },
    {
      key: "cycles",
      label: "Dependency cycles",
      count: workspace.cycles.length,
      description: "Package chains that cannot be built in isolation.",
    },
  ];
  const active = tabs.find((tab) => tab.key === kind) ?? tabs[0];
  const boundaryGroups = useMemo(() => groupBoundaries(workspace), [workspace]);
  const live = useArchitectureSignals(workspace);
  const actions = useMemo(() => architectureActions(workspace, live), [workspace, live]);

  const openFile = async (file: string, line?: number) => {
    await navigate({
      to: "/local/$id",
      params: { id: toLocalId(workspace.path) },
      search: { file, line, from: "living-architecture" },
    });
  };

  return (
    <div>
      <div
        className="mb-4 flex h-9 items-center border-b border-hair"
        role="tablist"
        aria-label="Workspace views"
      >
        {(["actions", "architecture", "findings"] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={mode === view}
            onClick={() => setMode(view)}
            className={cn(
              "relative h-9 px-3 text-[12.5px] capitalize text-ink-3 hover:text-ink",
              mode === view &&
                "text-ink after:absolute after:right-2 after:bottom-[-1px] after:left-2 after:h-px after:bg-workspace",
            )}
          >
            {view === "actions"
              ? `Action plan · ${actions.length}`
              : view === "architecture"
                ? "Impact explorer"
                : `Raw findings · ${total}`}
          </button>
        ))}
      </div>

      {mode === "actions" ? (
        <ActionPlan workspace={workspace} actions={actions} openFile={openFile} />
      ) : mode === "architecture" ? (
        <ArchitectureExplorer workspace={workspace} live={live} openFile={openFile} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)] xl:gap-6">
          <aside className="rounded-lg bg-page p-4 xl:sticky xl:top-4">
            <p className="text-[12px] text-ink-3">Issues to resolve</p>
            <p className="tnum mt-1 text-[32px] leading-none text-ink">{total}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              Across {workspace.scan.packages.length} packages and {workspace.scan.edges.length}{" "}
              internal dependencies.
            </p>

            <div className="mt-5 grid" role="tablist" aria-label="Finding types">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={kind === tab.key}
                  onClick={() => {
                    setKind(tab.key);
                    setQuery("");
                    setLimit(PAGE_SIZE);
                  }}
                  className={cn(
                    "relative grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-l border-hair px-3 text-left text-[12.5px] text-ink-3 hover:text-ink",
                    kind === tab.key &&
                      "border-workspace text-ink before:absolute before:top-0 before:bottom-0 before:left-[-1px] before:w-px before:bg-workspace",
                  )}
                >
                  <span className="truncate">{tab.label}</span>
                  <span className="tnum text-[12px]">{tab.count}</span>
                </button>
              ))}
            </div>

            <dl className="mt-5 grid gap-2 border-t border-hair pt-4 text-[11.5px] text-ink-3">
              <div className="flex justify-between gap-3">
                <dt>Graph depth</dt>
                <dd className="tnum text-ink-2">{workspace.depth}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>External dependencies</dt>
                <dd className="tnum text-ink-2">{workspace.scan.deps.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Unused declarations</dt>
                <dd className="tnum text-ink-2">{workspace.unused.length}</dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() =>
                void navigate({ to: "/local/$id", params: { id: toLocalId(workspace.path) } })
              }
              className="mt-4 flex h-8 w-full items-center justify-between rounded-md px-2 text-[12px] text-ink-2 hover:bg-raise hover:text-ink"
            >
              Open local repository <ExternalLink className="size-3.5" />
            </button>
          </aside>

          <main className="min-w-0 rounded-lg bg-page px-5 pt-4 pb-6">
            <header className="flex flex-wrap items-end justify-between gap-5 border-b border-hair pb-4">
              <div>
                <h2 className="text-[17px] font-medium text-ink">{active.label}</h2>
                <p className="mt-1 text-[12.5px] text-ink-3">{active.description}</p>
              </div>
              <label className="flex h-8 w-full items-center gap-2 rounded-md border border-edge px-2.5 text-ink-3 focus-within:border-ink-3 sm:w-[280px]">
                <Search className="size-3.5 shrink-0" />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(PAGE_SIZE);
                  }}
                  placeholder={`Filter ${active.label.toLowerCase()}`}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
                />
              </label>
            </header>

            {kind === "boundaries" ? (
              <BoundaryList
                workspace={workspace}
                groups={boundaryGroups}
                query={query}
                limit={limit}
                setLimit={setLimit}
                openFile={openFile}
              />
            ) : null}
            {kind === "phantoms" ? (
              <PhantomList workspace={workspace} query={query} openFile={openFile} />
            ) : null}
            {kind === "versions" ? <VersionList workspace={workspace} query={query} /> : null}
            {kind === "cycles" ? <CycleList workspace={workspace} query={query} /> : null}
          </main>
        </div>
      )}
    </div>
  );
}

function ActionPlan({
  workspace,
  actions,
  openFile,
}: {
  workspace: RepoHealth;
  actions: ReturnType<typeof architectureActions>;
  openFile: (file: string, line?: number) => Promise<void>;
}) {
  const urgent = actions.filter(
    (action) => action.priority === "critical" || action.priority === "high",
  ).length;
  const copyAction = (action: (typeof actions)[number]) => {
    const task = [
      `# Architecture task — ${workspace.owner}/${workspace.repo}`,
      "",
      `## ${action.title}`,
      "",
      action.fix,
      "",
      `Why: ${action.why}`,
      `Scope: ${action.scope}`,
      `Evidence: ${action.file}${action.line ? `:${action.line}` : ""}`,
    ].join("\n");
    navigator.clipboard
      .writeText(task)
      .then(() => toast.say("Architecture task copied", "Ready to hand to a coding agent."))
      .catch(() => toast.fail("Couldn’t copy the task"));
  };

  return (
    <div className="overflow-hidden rounded-lg bg-page">
      <header className="grid gap-5 border-b border-hair px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <h2 className="text-[17px] font-medium text-ink">Fix these in this order</h2>
          <p className="mt-1 max-w-[720px] text-[12.5px] leading-relaxed text-ink-3">
            Each task names the edit, why it matters and the file that proves it. Rescan after a fix
            and resolved tasks disappear.
          </p>
        </div>
        <p className="text-right text-[11.5px] text-ink-3">
          <span className="tnum text-[18px] text-ink">{urgent}</span>
          <br />
          urgent of {actions.length}
        </p>
      </header>

      {actions.length ? (
        <ol>
          {actions.map((action, index) => (
            <li
              key={action.id}
              className="grid gap-4 border-b border-hair px-5 py-5 last:border-b-0 lg:grid-cols-[36px_minmax(0,1fr)_minmax(220px,0.75fr)_auto] lg:items-start"
            >
              <span className="tnum pt-0.5 text-[12px] text-ink-3">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      "text-[10.5px] capitalize",
                      action.priority === "critical" || action.priority === "high"
                        ? "text-amber"
                        : "text-ink-3",
                    )}
                  >
                    {action.priority}
                  </span>
                  <span className="text-[10.5px] text-ink-3">{action.category}</span>
                </div>
                <h3 className="mt-1 text-[14px] font-medium text-ink">{action.title}</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-2">{action.fix}</p>
              </div>
              <div className="min-w-0 text-[11.5px] leading-relaxed">
                <p className="text-ink-3">{action.why}</p>
                <p className="mt-2 text-ink-2">{action.scope}</p>
                <button
                  type="button"
                  onClick={() => void openFile(action.file, action.line)}
                  className="mono mt-2 block max-w-full truncate text-[10.5px] text-ink-3 hover:text-ink"
                  title={`${action.file}${action.line ? `:${action.line}` : ""}`}
                >
                  {action.file}
                  {action.line ? `:${action.line}` : ""}
                </button>
              </div>
              <div className="flex gap-1 lg:justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void openFile(action.file, action.line)}
                >
                  Open evidence
                </Button>
                <Button variant="ghost" size="sm" onClick={() => copyAction(action)}>
                  <Copy className="size-3.5" /> Copy task
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-5 py-16 text-center">
          <h3 className="text-[14px] font-medium text-ink">No architecture work is queued</h3>
          <p className="mt-2 text-[12px] text-ink-3">
            The graph, package declarations, boundaries, ownership and test surface are coherent.
          </p>
        </div>
      )}
    </div>
  );
}

function ArchitectureExplorer({
  workspace,
  live,
  openFile,
}: {
  workspace: RepoHealth;
  live: ArchitectureSignal[];
  openFile: (file: string, line?: number) => Promise<void>;
}) {
  const nodes = useMemo(() => architectureNodes(workspace), [workspace]);
  const [selectedName, setSelectedName] = useState(nodes[0]?.name ?? "");
  const [query, setQuery] = useState("");
  const selected = nodes.find((node) => node.name === selectedName) ?? nodes[0];
  const signal = live.find((item) => item.name === selected.name) ?? null;
  const byName = useMemo(() => new Map(nodes.map((node) => [node.name, node])), [nodes]);
  const needle = query.trim().toLowerCase();
  const visible = nodes.filter((node) => `${node.name} ${node.dir}`.toLowerCase().includes(needle));
  if (!selected) return <EmptyResult query="" clear="No workspace packages found." />;

  const issueCount =
    selected.boundaryFindings + selected.phantomFindings + (selected.inCycle ? 1 : 0);
  const sampleUses = workspace.scan.member_uses
    .filter((use) => use.target === selected.name || use.from_pkg === selected.name)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return (
    <div className="overflow-hidden rounded-lg bg-page">
      <header className="grid gap-4 border-b border-hair px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h2 className="text-[17px] font-medium text-ink">
            What moves when this package changes?
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Select a package to trace its contracts, consumers and transitive blast radius from real
            imports.
          </p>
        </div>
        <p className="text-[11.5px] text-ink-3">
          {workspace.scan.edges.length} declared edges · {workspace.scan.member_uses.length}{" "}
          observed flows
        </p>
      </header>

      <div className="grid min-h-[560px] lg:grid-cols-[280px_minmax(440px,1fr)_260px]">
        <section className="border-b border-hair lg:border-r lg:border-b-0">
          <div className="border-b border-hair p-3">
            <label className="flex h-8 items-center gap-2 rounded-md border border-edge px-2.5 text-ink-3 focus-within:border-ink-3">
              <Search className="size-3.5 shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a package"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-ink-3"
              />
            </label>
          </div>
          <ol className="max-h-[510px] overflow-y-auto py-1 scrollbar-thin">
            {visible.map((node) => (
              <li key={node.name}>
                <button
                  type="button"
                  onClick={() => setSelectedName(node.name)}
                  className={cn(
                    "grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 text-left hover:bg-raise/45",
                    node.name === selected.name && "bg-raise text-ink",
                  )}
                >
                  <span className="min-w-0">
                    <span className="mono block truncate text-[11.5px] text-ink-2">
                      {node.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                      {node.dir}
                    </span>
                  </span>
                  <span className="tnum text-[11px] text-ink-3" title="Transitive blast radius">
                    → {node.transitiveDependents.length}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <section className="min-w-0 border-b border-hair px-5 py-5 lg:border-r lg:border-b-0">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hair pb-5">
            <div className="min-w-0">
              <p className="text-[11px] text-ink-3">
                {selected.kind === "app" ? "Application" : "Package"}
              </p>
              <h3 className="mono mt-1 truncate text-[18px] text-ink">{selected.name}</h3>
              <button
                type="button"
                onClick={() => void openFile(`${selected.dir}/package.json`)}
                className="mono mt-1 text-[11px] text-ink-3 hover:text-ink"
              >
                {selected.dir}/package.json
              </button>
            </div>
            <div className="text-right">
              <p className="tnum text-[26px] leading-none text-ink">
                {selected.transitiveDependents.length}
              </p>
              <p className="mt-1 text-[11px] text-ink-3">packages in blast radius</p>
            </div>
          </div>

          <div className="grid gap-5 py-5 md:grid-cols-[minmax(0,1fr)_44px_minmax(0,1fr)] md:items-start">
            <FlowColumn
              label="Depends on"
              items={selected.dependencies}
              detail={`${selected.transitiveDependencies.length} including transitive`}
              direction="left"
              onSelect={setSelectedName}
              byName={byName}
            />
            <div className="hidden h-full items-center justify-center border-x border-hair text-ink-3 md:flex">
              <ArrowRight className="size-4" />
            </div>
            <FlowColumn
              label="Direct consumers"
              items={selected.dependents}
              detail={`${selected.transitiveDependents.length} including transitive`}
              direction="right"
              onSelect={setSelectedName}
              byName={byName}
            />
          </div>

          <div className="border-t border-hair pt-4">
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <h4 className="text-[12px] font-medium text-ink">Observed source flows</h4>
              <span className="text-[10.5px] text-ink-3">click to open evidence</span>
            </div>
            {sampleUses.length ? (
              <ol>
                {sampleUses.map((use) => (
                  <li
                    key={`${use.from_pkg}:${use.target}`}
                    className="border-t border-hair first:border-t-0"
                  >
                    <button
                      type="button"
                      onClick={() => void openFile(use.example_file, use.example_line)}
                      className="grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left hover:text-ink"
                    >
                      <span className="mono truncate text-[11px] text-ink-2">
                        {use.from_pkg} → {use.target}
                      </span>
                      <span className="tnum text-[10.5px] text-ink-3">{use.count} imports</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-6 text-[12px] text-ink-3">No package-to-package imports observed.</p>
            )}
          </div>
        </section>

        <aside className="p-5">
          <h4 className="text-[12px] font-medium text-ink">Architecture evidence</h4>
          <dl className="mt-3 grid gap-0 text-[11.5px]">
            <Metric label="Incoming imports" value={selected.importsIn} />
            <Metric label="Outgoing imports" value={selected.importsOut} />
            <Metric label="Direct consumers" value={selected.dependents.length} />
            <Metric label="Transitive consumers" value={selected.transitiveDependents.length} />
          </dl>

          <LiveSignals signal={signal} openFile={openFile} />

          <div className="mt-6 border-t border-hair pt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-[12px] font-medium text-ink">Structural debt</h4>
              <span className={cn("tnum text-[11px]", issueCount ? "text-amber" : "text-ink-3")}>
                {issueCount}
              </span>
            </div>
            <dl className="mt-2 grid gap-2 text-[11.5px] text-ink-3">
              <div className="flex justify-between gap-3">
                <dt>Boundary crossings</dt>
                <dd className="tnum">{selected.boundaryFindings}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Undeclared flows</dt>
                <dd className="tnum">{selected.phantomFindings}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Dependency cycle</dt>
                <dd>{selected.inCycle ? "Yes" : "No"}</dd>
              </div>
            </dl>
          </div>

          <p className="mt-6 border-t border-hair pt-4 text-[11.5px] leading-relaxed text-ink-3">
            {selected.transitiveDependents.length
              ? `A public contract changed here can reach ${selected.transitiveDependents.length} of ${nodes.length} workspace packages.`
              : "This is a leaf in the reverse dependency graph; changes stop here."}
          </p>
        </aside>
      </div>
    </div>
  );
}

function useArchitectureSignals(workspace: RepoHealth): ArchitectureSignal[] {
  const query = useEffectQuery(
    ["living-architecture", workspace.path, "signals"],
    Effect.gen(function* () {
      const git = yield* Git;
      const [files, activity] = yield* Effect.all([
        git.lsFiles(workspace.path),
        git.fileActivity(workspace.path, 90),
      ]);
      let rules = [] as ReturnType<typeof parseCodeowners>;
      for (const path of CODEOWNERS_PATHS) {
        const source = yield* git
          .readFile(`${workspace.path}/${path}`)
          .pipe(Effect.orElseSucceed(() => null));
        if (source !== null) {
          rules = parseCodeowners(source);
          break;
        }
      }
      return architectureSignals(workspace, files, activity, rules);
    }),
    { staleTime: 5 * 60_000, retry: false },
  );
  return query.data ?? [];
}

function LiveSignals({
  signal,
  openFile,
}: {
  signal: ArchitectureSignal | null;
  openFile: (file: string, line?: number) => Promise<void>;
}) {
  return (
    <div className="mt-6 border-t border-hair pt-4">
      <h4 className="text-[12px] font-medium text-ink">Last 90 days</h4>
      {signal ? (
        <>
          <dl className="mt-2 grid gap-0 text-[11.5px]">
            <Metric label="Tracked files" value={signal.files} />
            <Metric label="Test files" value={signal.testFiles} />
            <Metric label="File touches" value={signal.churn} />
          </dl>

          {signal.lastChanged ? (
            <button
              type="button"
              onClick={() => void openFile(signal.lastChanged?.path ?? "")}
              className="mt-4 block w-full text-left"
              title={signal.lastChanged.path}
            >
              <span className="block text-[11px] text-ink-3">Latest change</span>
              <span className="mt-1 block truncate text-[11.5px] text-ink-2">
                {signal.lastChanged.last_subject}
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                {signal.lastChanged.last_author} ·{" "}
                {formatActivityDate(signal.lastChanged.last_time)}
              </span>
            </button>
          ) : null}

          <div className="mt-4">
            <p className="text-[11px] text-ink-3">CODEOWNERS</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
              {signal.owners.length ? signal.owners.join(" · ") : "No matching rule"}
            </p>
          </div>

          <div className="mt-4">
            <p className="text-[11px] text-ink-3">Recent knowledge</p>
            {signal.contributors.length ? (
              <ol className="mt-1 grid gap-1">
                {signal.contributors.map((person) => (
                  <li key={person.name} className="flex justify-between gap-3 text-[11.5px]">
                    <span className="truncate text-ink-2">{person.name}</span>
                    <span className="tnum text-ink-3">{person.churn} touches</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-1 text-[11.5px] text-ink-3">No recent commits in this package.</p>
            )}
          </div>

          {signal.hotspots.length ? (
            <div className="mt-4">
              <p className="text-[11px] text-ink-3">Hot files</p>
              <ol className="mt-1 grid gap-1">
                {signal.hotspots.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => void openFile(file.path)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 text-left text-[11px] hover:text-ink"
                      title={`${file.last_subject} · ${file.last_author}`}
                    >
                      <span className="mono truncate text-ink-2">{file.path.split("/").pop()}</span>
                      <span className="tnum text-ink-3">{file.churn}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
          Reading git history and ownership…
        </p>
      )}
    </div>
  );
}

function formatActivityDate(seconds: number): string {
  const elapsed = Math.max(0, Date.now() - seconds * 1000);
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function FlowColumn({
  label,
  items,
  detail,
  direction,
  onSelect,
  byName,
}: {
  label: string;
  items: string[];
  detail: string;
  direction: "left" | "right";
  onSelect: (name: string) => void;
  byName: Map<string, ArchitectureNode>;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h4 className="text-[12px] font-medium text-ink">{label}</h4>
        <span className="text-[10.5px] text-ink-3">{detail}</span>
      </div>
      {items.length ? (
        <ol className="grid gap-1">
          {items.slice(0, 8).map((name) => (
            <li key={name}>
              <button
                type="button"
                onClick={() => onSelect(name)}
                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-raise"
              >
                {direction === "left" ? <ArrowLeft className="size-3 shrink-0 text-ink-3" /> : null}
                <span className="mono min-w-0 flex-1 truncate text-[11px] text-ink-2">{name}</span>
                <span className="tnum text-[10px] text-ink-3">
                  → {byName.get(name)?.transitiveDependents.length ?? 0}
                </span>
                {direction === "right" ? (
                  <ArrowRight className="size-3 shrink-0 text-ink-3" />
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="flex min-h-20 items-center text-[11.5px] text-ink-3">
          None. This side of the flow ends here.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 border-t border-hair first:border-t-0">
      <dt className="text-ink-3">{label}</dt>
      <dd className="tnum text-ink-2">{value}</dd>
    </div>
  );
}

function BoundaryList({
  workspace,
  groups,
  query,
  limit,
  setLimit,
  openFile,
}: {
  workspace: RepoHealth;
  groups: BoundaryGroup[];
  query: string;
  limit: number;
  setLimit: (value: number) => void;
  openFile: (file: string, line?: number) => Promise<void>;
}) {
  const needle = query.trim().toLowerCase();
  const crossings = workspace.scan.crossings.filter((item) =>
    `${item.from_pkg} ${item.target} ${item.file} ${item.spec}`.toLowerCase().includes(needle),
  );

  return (
    <>
      {!needle && groups.length ? (
        <section className="py-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-medium text-ink">Start with these package flows</h3>
            <span className="text-[11.5px] text-ink-3">Ranked by crossing count</span>
          </div>
          <ol className="grid grid-cols-2 gap-x-5">
            {groups.slice(0, 6).map((group) => (
              <li key={group.key} className="border-b border-hair">
                <button
                  type="button"
                  onClick={() => void openFile(group.file, group.line)}
                  className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-left hover:text-ink"
                >
                  <span className="min-w-0">
                    <span className="mono block truncate text-[12px] text-ink-2">
                      {group.from} → {group.target}
                    </span>
                    <span className="mt-1 block truncate text-[11px] text-ink-3">
                      {group.file}:{group.line}
                    </span>
                  </span>
                  <span className="tnum text-[16px] text-ink">{group.count}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className={cn(!needle && groups.length && "border-t border-hair pt-4")}>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13px] font-medium text-ink">
            {needle ? "Matching crossings" : "Every crossing"}
          </h3>
          <span className="tnum text-[11.5px] text-ink-3">{crossings.length} imports</span>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.4fr)_minmax(180px,1fr)] gap-4 px-2 py-2 text-[11px] text-ink-3">
              <span>Package flow</span>
              <span>Source</span>
              <span>Import</span>
            </div>
            <ol>
              {crossings.slice(0, limit).map((item, index) => (
                <li
                  key={`${item.file}:${item.line}:${item.spec}:${index}`}
                  className="border-t border-hair"
                >
                  <button
                    type="button"
                    onClick={() => void openFile(item.file, item.line)}
                    className="grid min-h-11 w-full grid-cols-[minmax(190px,0.8fr)_minmax(260px,1.4fr)_minmax(180px,1fr)] items-center gap-4 px-2 text-left hover:bg-raise/40"
                  >
                    <span className="mono truncate text-[11.5px] text-ink-2">
                      {item.from_pkg} → {item.target}
                    </span>
                    <span className="mono truncate text-[11px] text-ink-3">
                      {item.file}:{item.line}
                    </span>
                    <span className="mono truncate text-[11px] text-ink-3">{item.spec}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
        {crossings.length > limit ? (
          <button
            type="button"
            onClick={() => setLimit(limit + PAGE_SIZE)}
            className="mt-3 h-8 w-full rounded-md text-[12px] text-ink-2 hover:bg-raise hover:text-ink"
          >
            Show {Math.min(PAGE_SIZE, crossings.length - limit)} more
          </button>
        ) : null}
        {!crossings.length ? <EmptyResult query={query} /> : null}
      </section>
    </>
  );
}

function PhantomList({
  workspace,
  query,
  openFile,
}: {
  workspace: RepoHealth;
  query: string;
  openFile: (file: string, line?: number) => Promise<void>;
}) {
  const needle = query.trim().toLowerCase();
  const rows = workspace.phantoms.filter((item) =>
    `${item.from_pkg} ${item.target} ${item.example_file}`.toLowerCase().includes(needle),
  );
  return (
    <FindingRows empty={<EmptyResult query={query} />}>
      {rows.map((item) => (
        <button
          key={`${item.from_pkg}:${item.target}`}
          type="button"
          onClick={() => void openFile(item.example_file, item.example_line)}
          className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-hair px-2 text-left hover:bg-raise/40"
        >
          <span className="min-w-0">
            <span className="mono block truncate text-[12px] text-ink-2">
              {item.from_pkg} imports {item.target}
            </span>
            <span className="mono mt-1 block truncate text-[11px] text-ink-3">
              {item.example_file}:{item.example_line}
            </span>
          </span>
          <span className="tnum text-[12px] text-ink-3">{item.count} imports</span>
        </button>
      ))}
    </FindingRows>
  );
}

function VersionList({ workspace, query }: { workspace: RepoHealth; query: string }) {
  const needle = query.trim().toLowerCase();
  const rows = workspace.mismatches.filter((item) =>
    `${item.name} ${item.majority} ${item.versions.map((version) => version.version).join(" ")}`
      .toLowerCase()
      .includes(needle),
  );
  return (
    <FindingRows empty={<EmptyResult query={query} />}>
      {rows.map((item) => (
        <div
          key={item.name}
          className="grid min-h-14 grid-cols-[minmax(180px,0.7fr)_minmax(0,1.3fr)] items-center gap-6 border-b border-hair px-2"
        >
          <span>
            <span className="mono block text-[12px] text-ink-2">{item.name}</span>
            <span className="mt-1 block text-[11px] text-ink-3">Align to {item.majority}</span>
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
            {item.versions.map((version) => (
              <span key={version.version} className="mono whitespace-nowrap">
                {version.version} · {version.packages.length} packages
              </span>
            ))}
          </span>
        </div>
      ))}
    </FindingRows>
  );
}

function CycleList({ workspace, query }: { workspace: RepoHealth; query: string }) {
  const needle = query.trim().toLowerCase();
  const rows = workspace.cycles.filter((cycle) => cycle.join(" ").toLowerCase().includes(needle));
  return (
    <FindingRows empty={<EmptyResult query={query} clear="No dependency cycles found." />}>
      {rows.map((cycle) => (
        <div
          key={cycle.join(">")}
          className="mono flex min-h-12 items-center border-b border-hair px-2 text-[12px] text-ink-2"
        >
          {cycle.join(" → ")} → {cycle[0]}
        </div>
      ))}
    </FindingRows>
  );
}

function FindingRows({ children, empty }: { children: React.ReactNode; empty: React.ReactNode }) {
  const count = Array.isArray(children) ? children.length : children ? 1 : 0;
  return <div className="pt-3">{count ? children : empty}</div>;
}

function EmptyResult({
  query,
  clear = "Nothing in this category.",
}: { query: string; clear?: string }) {
  return (
    <p className="py-16 text-center text-[12.5px] text-ink-3">
      {query ? "No findings match this filter." : clear}
    </p>
  );
}

function groupBoundaries(workspace: RepoHealth): BoundaryGroup[] {
  const groups = new Map<string, BoundaryGroup>();
  for (const crossing of workspace.scan.crossings) {
    const key = `${crossing.from_pkg}→${crossing.target}`;
    const current = groups.get(key);
    if (current) current.count += 1;
    else {
      groups.set(key, {
        key,
        from: crossing.from_pkg,
        target: crossing.target,
        count: 1,
        file: crossing.file,
        line: crossing.line,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
