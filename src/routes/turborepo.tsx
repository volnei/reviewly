import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TooltipFor } from "@/components/tooltip-for";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type PackageStats,
  type Workspace,
  findCycles,
  graphDepth,
  packageStats,
  realCyclePath,
} from "@/lib/monorepo";
import { invoke } from "@/lib/tauri";
import { useEditorPrefs } from "@/stores/editor-prefs";
import { useLocalRepos } from "@/stores/local-repos";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ExternalLink,
  Ghost,
  GitBranch,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

/** Mirror of the Rust `WorkspaceScan`. */
interface WorkspaceScan extends Workspace {
  dep_edges: { from: string; to: string; kind: string }[];
  crossings: { file: string; line: number; spec: string; from_pkg: string; target: string }[];
  member_uses: {
    from_pkg: string;
    target: string;
    count: number;
    example_file: string;
    example_line: number;
  }[];
  deps: { package: string; name: string; version: string }[];
}

interface Mismatch {
  name: string;
  versions: { version: string; packages: string[] }[];
  /** The range most of the workspace already agrees on. */
  majority: string;
}

interface RepoHealth {
  owner: string;
  repo: string;
  path: string;
  scan: WorkspaceScan;
  cycles: string[][];
  mismatches: Mismatch[];
  /** Imports of a member with no declared dependency — works only through
   * hoisting, breaks the moment the package is built or installed alone. */
  phantoms: WorkspaceScan["member_uses"];
  /** Declared workspace deps never imported in scanned source. */
  unused: { from: string; to: string; kind: string }[];
  stats: PackageStats[];
  depth: number;
}

function analyze(scan: WorkspaceScan): Omit<RepoHealth, "owner" | "repo" | "path" | "scan"> {
  // Version mismatches, majority range first — "align to X" beats "pick one".
  const byDep = new Map<string, Map<string, string[]>>();
  for (const d of scan.deps) {
    const versions = byDep.get(d.name) ?? new Map<string, string[]>();
    const pkgs = versions.get(d.version) ?? [];
    pkgs.push(d.package);
    versions.set(d.version, pkgs);
    byDep.set(d.name, versions);
  }
  const mismatches: Mismatch[] = [];
  for (const [name, versions] of byDep) {
    if (versions.size < 2) continue;
    const sorted = [...versions.entries()]
      .map(([version, packages]) => ({ version, packages: packages.sort() }))
      .sort((a, b) => b.packages.length - a.packages.length);
    mismatches.push({ name, versions: sorted, majority: sorted[0].version });
  }
  mismatches.sort((a, b) => a.name.localeCompare(b.name));

  // Phantom: used in source, declared nowhere. Unused: declared, never
  // imported — peerDependencies excluded, they are contracts, not imports.
  const declared = new Set(scan.dep_edges.map((e) => `${e.from}→${e.to}`));
  const used = new Set(scan.member_uses.map((u) => `${u.from_pkg}→${u.target}`));
  const phantoms = scan.member_uses.filter((u) => !declared.has(`${u.from_pkg}→${u.target}`));
  const unused = scan.dep_edges.filter(
    (e) => e.kind !== "peerDependencies" && !used.has(`${e.from}→${e.to}`),
  );

  return {
    cycles: findCycles(scan),
    mismatches,
    phantoms,
    unused,
    stats: packageStats(scan),
    depth: graphDepth(scan),
  };
}

async function scanAll(
  repos: { owner: string; repo: string; path: string }[],
): Promise<RepoHealth[]> {
  const results = await Promise.all(
    repos.map(async (r) => {
      const scan = await invoke<WorkspaceScan | null>("monorepo_scan", { path: r.path }).catch(
        () => null,
      );
      if (!scan) return null;
      return { ...r, scan, ...analyze(scan) };
    }),
  );
  return results.filter((r): r is RepoHealth => r !== null);
}

const problemCount = (r: RepoHealth): number =>
  r.cycles.length + r.mismatches.length + r.scan.crossings.length + r.phantoms.length;

export function TurborepoPage() {
  const localRepos = useLocalRepos((s) => s.repos);
  const health = useQuery({
    queryKey: ["turborepo-health", localRepos.map((r) => r.path).join(":")],
    queryFn: () => scanAll(localRepos),
    enabled: localRepos.length > 0,
    staleTime: 5 * 60_000,
  });
  const lastTargetId = useEditorPrefs((s) => s.lastTargetId);

  const openFile = async (clonePath: string, file: string) => {
    try {
      const targets = await invoke<{ id: string }[]>("local_editor_targets");
      const target = targets.find((t) => t.id === lastTargetId) ?? targets[0];
      if (!target) throw new Error("no editor found");
      await invoke("open_local_editor", { path: `${clonePath}/${file}`, targetId: target.id });
    } catch (e) {
      toast.error(`Couldn't open the file — ${String(e)}`);
    }
  };

  const repos = health.data ?? [];
  const totalProblems = repos.reduce((n, r) => n + problemCount(r), 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Turborepo"
        subtitle={
          repos.length === 0
            ? "Workspace health for the monorepos you have cloned"
            : `${repos.length} workspace${repos.length === 1 ? "" : "s"} · ${totalProblems} finding${totalProblems === 1 ? "" : "s"}`
        }
        actions={
          <TooltipFor label="Re-scan the workspaces">
            <button
              type="button"
              aria-label="Re-scan"
              onClick={() => health.refetch()}
              disabled={health.isFetching}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={health.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
            </button>
          </TooltipFor>
        }
      />
      <ScrollArea className="flex-1">
        {localRepos.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No local clones"
            description="Clone a repository under Repositories — workspace health needs the code on disk."
          />
        ) : health.isLoading ? (
          <p className="px-6 py-4 text-xs text-muted-foreground">Scanning workspaces…</p>
        ) : repos.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No Turborepo found"
            description="None of your local clones carries a turbo.json at its root."
          />
        ) : (
          <div className="flex flex-col gap-8 px-6 py-4">
            {repos.map((r) => (
              <WorkspaceSection key={r.path} r={r} onOpenFile={(f) => openFile(r.path, f)} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function WorkspaceSection({
  r,
  onOpenFile,
}: { r: RepoHealth; onOpenFile: (file: string) => void }) {
  const kindOf = (from: string, to: string): string =>
    r.scan.dep_edges.find((e) => e.from === from && e.to === to)?.kind ?? "undeclared";
  const external = new Set(r.scan.deps.map((d) => d.name)).size;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <Boxes className="size-4 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-sm font-semibold text-foreground">
          {r.owner}/{r.repo}
        </h2>
        <Badge
          size="sm"
          variant={problemCount(r) > 0 ? "warning" : "success"}
          className="tabular-nums"
        >
          {problemCount(r)} finding{problemCount(r) === 1 ? "" : "s"}
        </Badge>
      </div>

      {/* The workspace at a glance — the denominators every finding is read against. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{r.scan.packages.length}</span> packages
        </span>
        <span>
          <span className="font-medium text-foreground">{r.scan.edges.length}</span> internal edges
        </span>
        <span>
          <span className="font-medium text-foreground">{external}</span> external deps
        </span>
        <span>
          dependency chains up to <span className="font-medium text-foreground">{r.depth}</span>{" "}
          deep
        </span>
      </div>

      {/* Load-bearing packages: where a change costs the most. */}
      <div className="mb-2 rounded-lg border border-hairline bg-card/40 px-3 py-2">
        <p className="mb-1.5 text-xs font-medium text-foreground">Load-bearing packages</p>
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {r.stats.slice(0, 8).map((s) => (
            <div key={s.name} className="flex min-w-0 items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">{s.name}</span>
              <TooltipFor
                label={`${s.dependents} direct dependent${s.dependents === 1 ? "" : "s"} · a change ripples into ${s.blast} package${s.blast === 1 ? "" : "s"} · pulls in ${s.deps}`}
              >
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  ← {s.dependents} · ripples {s.blast}
                </span>
              </TooltipFor>
            </div>
          ))}
        </div>
      </div>

      <Finding
        title="Dependency cycles"
        icon={AlertTriangle}
        count={r.cycles.length}
        healthy="No cycles — the package graph is a DAG."
      >
        {r.cycles.map((scc) => {
          const path = realCyclePath(scc, r.scan);
          return (
            <div key={scc.join(",")} className="py-1">
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-warning">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span className="truncate font-mono">{path.join(" → ")}</span>
              </div>
              {/* Which declaration forges each edge — a devDependencies
                  back-edge is usually the one to cut. */}
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-5 text-[11px] text-muted-foreground">
                {path.slice(0, -1).map((from, i) => (
                  <span key={`${from}-${path[i + 1]}`} className="font-mono">
                    {from.split("/").pop()} → {path[i + 1].split("/").pop()}{" "}
                    <span className="text-muted-foreground/60">({kindOf(from, path[i + 1])})</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </Finding>

      <Finding
        title="Phantom dependencies"
        icon={Ghost}
        count={r.phantoms.length}
        healthy="Every member import is backed by a declared dependency."
      >
        {r.phantoms.map((u) => (
          <button
            key={`${u.from_pkg}→${u.target}`}
            type="button"
            onClick={() => onOpenFile(u.example_file)}
            title={`${u.example_file}:${u.example_line}`}
            className="group flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-foreground/[0.05]"
          >
            <Ghost className="size-3 shrink-0 text-warning" />
            <span className="shrink-0 font-mono text-foreground">{u.from_pkg}</span>
            <span className="shrink-0 text-muted-foreground">imports</span>
            <span className="shrink-0 font-mono text-warning">{u.target}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {u.count}× without declaring it · works only through hoisting
            </span>
          </button>
        ))}
      </Finding>

      <Finding
        title="Version mismatches"
        icon={PackageOpen}
        count={r.mismatches.length}
        healthy="Every external dependency is declared with one version range."
      >
        {r.mismatches.map((m) => (
          <div key={m.name} className="py-1 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-foreground">{m.name}</span>
              <span className="text-muted-foreground">
                align to <span className="font-mono text-foreground">{m.majority}</span> (
                {m.versions[0].packages.length} of{" "}
                {m.versions.reduce((n, v) => n + v.packages.length, 0)} already there)
              </span>
            </div>
            <div className="mt-0.5 flex flex-col gap-0.5">
              {m.versions.map((v, i) => (
                <div key={v.version} className="flex min-w-0 items-center gap-2">
                  <Badge
                    size="sm"
                    variant={i === 0 ? "success" : "warning"}
                    className="shrink-0 font-mono"
                  >
                    {v.version}
                  </Badge>
                  <span className="truncate text-muted-foreground">{v.packages.join(", ")}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Finding>

      <Finding
        title="Boundary crossings"
        icon={ArrowRight}
        count={r.scan.crossings.length}
        healthy="No import reaches into another package's internals."
      >
        {r.scan.crossings.map((c) => (
          <button
            key={`${c.file}:${c.line}:${c.spec}`}
            type="button"
            onClick={() => onOpenFile(c.file)}
            title={`${c.file}:${c.line} imports ${c.spec}`}
            className="group flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-foreground/[0.05]"
          >
            <ExternalLink className="size-3 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
            <span className="truncate font-mono text-muted-foreground group-hover:text-foreground">
              {c.file}:{c.line}
            </span>
            <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
            <span className="shrink-0 text-warning">{c.target}</span>
          </button>
        ))}
      </Finding>

      {r.unused.length > 0 && (
        <Finding
          title="Declared but never imported"
          icon={PackageOpen}
          count={r.unused.length}
          healthy=""
          soft
        >
          <p className="pb-1 text-[11px] text-muted-foreground/70">
            No import found in scanned source — may still be used by scripts, configs, or binaries.
          </p>
          {r.unused.map((e) => (
            <div
              key={`${e.from}→${e.to}`}
              className="flex min-w-0 items-center gap-1.5 py-0.5 text-xs"
            >
              <span className="shrink-0 font-mono text-foreground">{e.from}</span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground/50" />
              <span className="shrink-0 font-mono text-muted-foreground">{e.to}</span>
              <span className="truncate text-muted-foreground/70">({e.kind})</span>
            </div>
          ))}
        </Finding>
      )}

      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <GitBranch className="size-3" />
        {r.path}
      </div>
    </section>
  );
}

function Finding({
  title,
  icon: Icon,
  count,
  healthy,
  soft = false,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  healthy: string;
  /** Informational rather than a problem — neutral badge, never amber. */
  soft?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 rounded-lg border border-hairline bg-card/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <Icon className="size-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-foreground">{title}</p>
        <Badge
          size="sm"
          variant={count === 0 ? "success" : soft ? "secondary" : "warning"}
          className="tabular-nums"
        >
          {count}
        </Badge>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{healthy}</p>
      ) : (
        <div className="flex max-h-64 flex-col overflow-y-auto">{children}</div>
      )}
    </div>
  );
}
