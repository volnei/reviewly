import {
  type PackageStats,
  type Workspace,
  findCycles,
  graphDepth,
  packageStats,
  realCyclePath,
} from "@/lib/monorepo";
import { invoke } from "@/lib/tauri";
import { toast } from "sonner";

/** Mirror of the Rust `WorkspaceScan`. */
export interface WorkspaceScan extends Workspace {
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

export interface Mismatch {
  name: string;
  versions: { version: string; packages: string[] }[];
  /** The range most of the workspace already agrees on. */
  majority: string;
}

export interface RepoHealth {
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

export function analyze(scan: WorkspaceScan): Omit<RepoHealth, "owner" | "repo" | "path" | "scan"> {
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

/** Scan every clone; repos without a `turbo.json` simply drop out. */
export async function scanAll(
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

export const problemCount = (r: RepoHealth): number =>
  r.cycles.length + r.mismatches.length + r.scan.crossings.length + r.phantoms.length;

/**
 * The workspace report as paste-ready markdown. Written for an AGENT, not for a
 * human who already saw the page: every finding is self-contained (package,
 * path, line, count) and phrased as the change to make, so pasting it into a
 * coding assistant is a complete work order with no follow-up questions.
 */
export function buildReport(r: RepoHealth): string {
  const kindOf = (from: string, to: string): string =>
    r.scan.dep_edges.find((e) => e.from === from && e.to === to)?.kind ?? "undeclared";
  const dirOf = (name: string): string => r.scan.packages.find((p) => p.name === name)?.dir ?? "";
  const lines: string[] = [
    `# Turborepo health — ${r.owner}/${r.repo}`,
    "",
    `Repo root: ${r.path}`,
    `${r.scan.packages.length} packages · ${r.scan.edges.length} internal edges · dependency chains up to ${r.depth} deep`,
    "",
  ];

  lines.push(`## Dependency cycles (${r.cycles.length})`);
  if (r.cycles.length === 0) lines.push("None — the package graph is a DAG.");
  for (const scc of r.cycles) {
    const path = realCyclePath(scc, r.scan);
    const hops = path
      .slice(0, -1)
      .map((from, i) => `${from} → ${path[i + 1]} (${kindOf(from, path[i + 1])})`)
      .join(", ");
    lines.push(
      `- Cycle: ${path.join(" → ")}. Edges: ${hops}. Break it by removing or inverting one of these declarations (a devDependencies back-edge is usually the one to cut).`,
    );
  }
  lines.push("");

  lines.push(`## Phantom dependencies (${r.phantoms.length})`);
  if (r.phantoms.length === 0) lines.push("None — every member import is declared.");
  for (const u of r.phantoms) {
    lines.push(
      `- ${u.from_pkg} imports ${u.target} ${u.count}× without declaring it (e.g. ${u.example_file}:${u.example_line}). Fix: add "${u.target}" to the dependencies of ${dirOf(u.from_pkg)}/package.json.`,
    );
  }
  lines.push("");

  lines.push(`## Version mismatches (${r.mismatches.length})`);
  if (r.mismatches.length === 0)
    lines.push("None — every external dependency has one version range.");
  for (const m of r.mismatches) {
    const total = m.versions.reduce((n, v) => n + v.packages.length, 0);
    const outliers = m.versions
      .slice(1)
      .map((v) => `${v.version} in ${v.packages.join(", ")}`)
      .join("; ");
    lines.push(
      `- ${m.name}: align to ${m.majority} (${m.versions[0].packages.length} of ${total} already there). Outliers: ${outliers}.`,
    );
  }
  lines.push("");

  lines.push(`## Boundary crossings (${r.scan.crossings.length})`);
  if (r.scan.crossings.length === 0)
    lines.push("None — no import reaches into another package's internals.");
  for (const c of r.scan.crossings) {
    lines.push(
      `- ${c.file}:${c.line} imports "${c.spec}" — reaches into ${c.target}'s internals. Fix: import from ${c.target}'s public surface, or export what is needed.`,
    );
  }

  if (r.unused.length > 0) {
    lines.push("");
    lines.push(`## Declared but never imported (${r.unused.length}) — verify before removing`);
    lines.push(
      "No import found in scanned source; may still be used by scripts, configs, or binaries.",
    );
    for (const e of r.unused) lines.push(`- ${e.from} → ${e.to} (${e.kind})`);
  }
  return lines.join("\n");
}

/** Copy `text`, with the toast the rest of the app uses. */
export function copyReport(text: string, what: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => toast.success(`${what} copied — paste it to your agent`))
    .catch(() => toast.error("Couldn't copy to clipboard"));
}
