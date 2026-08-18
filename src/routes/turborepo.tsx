import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TooltipFor } from "@/components/tooltip-for";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type Workspace, findCycles } from "@/lib/monorepo";
import { invoke } from "@/lib/tauri";
import { useEditorPrefs } from "@/stores/editor-prefs";
import { useLocalRepos } from "@/stores/local-repos";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Mirror of the Rust `WorkspaceScan`. */
interface WorkspaceScan extends Workspace {
  crossings: { file: string; line: number; spec: string; from_pkg: string; target: string }[];
  deps: { package: string; name: string; version: string }[];
}

interface RepoHealth {
  owner: string;
  repo: string;
  path: string;
  scan: WorkspaceScan;
  cycles: string[][];
  /** External deps declared with more than one version range across packages. */
  mismatches: { name: string; versions: { version: string; packages: string[] }[] }[];
}

/** Group each external dependency by the version ranges it is declared with;
 * one range is health, several is drift that turbo caching quietly amplifies. */
function findMismatches(scan: WorkspaceScan): RepoHealth["mismatches"] {
  const byDep = new Map<string, Map<string, string[]>>();
  for (const d of scan.deps) {
    const versions = byDep.get(d.name) ?? new Map<string, string[]>();
    const pkgs = versions.get(d.version) ?? [];
    pkgs.push(d.package);
    versions.set(d.version, pkgs);
    byDep.set(d.name, versions);
  }
  const out: RepoHealth["mismatches"] = [];
  for (const [name, versions] of byDep) {
    if (versions.size > 1) {
      out.push({
        name,
        versions: [...versions.entries()]
          .map(([version, packages]) => ({ version, packages: packages.sort() }))
          .sort((a, b) => a.version.localeCompare(b.version)),
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan every local clone; non-Turborepos simply drop out. */
async function scanAll(
  repos: { owner: string; repo: string; path: string }[],
): Promise<RepoHealth[]> {
  const results = await Promise.all(
    repos.map(async (r) => {
      const scan = await invoke<WorkspaceScan | null>("monorepo_scan", { path: r.path }).catch(
        () => null,
      );
      if (!scan) return null;
      return { ...r, scan, cycles: findCycles(scan), mismatches: findMismatches(scan) };
    }),
  );
  return results.filter((r): r is RepoHealth => r !== null);
}

export function TurborepoPage() {
  const localRepos = useLocalRepos((s) => s.repos);
  const health = useQuery({
    queryKey: ["turborepo-health", localRepos.map((r) => r.path).join(":")],
    queryFn: () => scanAll(localRepos),
    enabled: localRepos.length > 0,
    staleTime: 5 * 60_000,
  });
  const lastTargetId = useEditorPrefs((s) => s.lastTargetId);

  /** Open a finding in the user's editor; falls back with an actionable toast. */
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
  const totalProblems = repos.reduce(
    (n, r) => n + r.cycles.length + r.mismatches.length + r.scan.crossings.length,
    0,
  );

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
          <div className="flex flex-col gap-6 px-6 py-4">
            {repos.map((r) => (
              <section key={r.path}>
                <div className="mb-2 flex items-center gap-2">
                  <Boxes className="size-4 text-muted-foreground" strokeWidth={1.5} />
                  <h2 className="text-sm font-semibold text-foreground">
                    {r.owner}/{r.repo}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {r.scan.packages.length} packages
                  </span>
                </div>

                <Finding
                  title="Dependency cycles"
                  count={r.cycles.length}
                  healthy="No cycles — the package graph is a DAG."
                >
                  {r.cycles.map((cycle) => (
                    <div
                      key={cycle.join(",")}
                      className="flex min-w-0 items-center gap-1.5 py-0.5 text-xs text-warning"
                    >
                      <AlertTriangle className="size-3.5 shrink-0" />
                      <span className="truncate font-mono">{[...cycle, cycle[0]].join(" → ")}</span>
                    </div>
                  ))}
                </Finding>

                <Finding
                  title="Version mismatches"
                  count={r.mismatches.length}
                  healthy="Every external dependency is declared with one version range."
                >
                  {r.mismatches.map((m) => (
                    <div key={m.name} className="py-1 text-xs">
                      <span className="font-mono text-foreground">{m.name}</span>
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {m.versions.map((v) => (
                          <div key={v.version} className="flex min-w-0 items-center gap-2">
                            <Badge size="sm" variant="warning" className="shrink-0 font-mono">
                              {v.version}
                            </Badge>
                            <span className="truncate text-muted-foreground">
                              {v.packages.join(", ")}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </Finding>

                <Finding
                  title="Boundary crossings"
                  count={r.scan.crossings.length}
                  healthy="No import reaches into another package's internals."
                >
                  {r.scan.crossings.map((c) => (
                    <button
                      key={`${c.file}:${c.line}:${c.spec}`}
                      type="button"
                      onClick={() => openFile(r.path, c.file)}
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

                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
                  <GitBranch className="size-3" />
                  {r.path}
                </div>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

/** One finding class: a count-badged header, the rows, or the healthy line. */
function Finding({
  title,
  count,
  healthy,
  children,
}: {
  title: string;
  count: number;
  healthy: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 rounded-lg border border-hairline bg-card/40 px-3 py-2">
      <div className="mb-1 flex items-center gap-2">
        <p className="text-xs font-medium text-foreground">{title}</p>
        <Badge size="sm" variant={count > 0 ? "warning" : "success"} className="tabular-nums">
          {count}
        </Badge>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{healthy}</p>
      ) : (
        <div className="flex max-h-56 flex-col overflow-y-auto">{children}</div>
      )}
    </div>
  );
}
