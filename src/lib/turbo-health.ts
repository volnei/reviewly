import {
  type PackageStats,
  type Workspace,
  findCycles,
  graphDepth,
  packageStats,
  realCyclePath,
} from "@/lib/monorepo";
import type { FileActivity } from "@/effect/schema";
import { type CodeownersRule, ownersFor } from "@/lib/codeowners";

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

interface Mismatch {
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

/** One package as the architecture explorer sees it. Everything here is
 * derived from the workspace graph and source imports, so selecting a package
 * answers an operational question (what changes with it?) rather than merely
 * drawing a node. */
export interface ArchitectureNode {
  name: string;
  dir: string;
  kind: "app" | "package";
  dependencies: string[];
  dependents: string[];
  transitiveDependencies: string[];
  transitiveDependents: string[];
  importsIn: number;
  importsOut: number;
  boundaryFindings: number;
  phantomFindings: number;
  inCycle: boolean;
}

export interface ArchitectureSignal {
  name: string;
  files: number;
  testFiles: number;
  churn: number;
  owners: string[];
  contributors: { name: string; churn: number }[];
  hotspots: FileActivity[];
  lastChanged: FileActivity | null;
}

export interface ArchitectureAction {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  category: "cycle" | "dependency" | "boundary" | "version" | "tests" | "ownership";
  title: string;
  fix: string;
  why: string;
  scope: string;
  file: string;
  line?: number;
}

const TEST_PATH = /(^|\/)(__tests__|tests?|spec|e2e|cypress)(\/|$)|\.(test|spec)\.[^.]+$/i;

/** Add the time and people dimensions to the dependency graph. `fileActivity`
 * is sourced from git, while owners come from the repository's CODEOWNERS. */
export function architectureSignals(
  r: RepoHealth,
  files: ReadonlyArray<string>,
  activity: ReadonlyArray<FileActivity>,
  owners: ReadonlyArray<CodeownersRule>,
): ArchitectureSignal[] {
  return r.scan.packages.map((pkg) => {
    const prefix = `${pkg.dir}/`;
    const packageFiles = files.filter((file) => file.startsWith(prefix));
    const packageActivity = activity
      .filter((item) => item.path.startsWith(prefix))
      .sort((a, b) => b.churn - a.churn || b.last_time - a.last_time);
    const contributors = new Map<string, number>();
    for (const item of packageActivity) {
      contributors.set(item.last_author, (contributors.get(item.last_author) ?? 0) + item.churn);
    }
    const codeowners = new Set<string>();
    for (const file of packageFiles) {
      for (const owner of ownersFor([...owners], file)) codeowners.add(owner);
    }
    return {
      name: pkg.name,
      files: packageFiles.length,
      testFiles: packageFiles.filter((file) => TEST_PATH.test(file)).length,
      churn: packageActivity.reduce((total, item) => total + item.churn, 0),
      owners: [...codeowners].sort(),
      contributors: [...contributors.entries()]
        .map(([name, churn]) => ({ name, churn }))
        .sort((a, b) => b.churn - a.churn || a.name.localeCompare(b.name))
        .slice(0, 4),
      hotspots: packageActivity.slice(0, 4),
      lastChanged: [...packageActivity].sort((a, b) => b.last_time - a.last_time)[0] ?? null,
    } satisfies ArchitectureSignal;
  });
}

function reachable(start: string, adjacency: ReadonlyMap<string, ReadonlyArray<string>>): string[] {
  const seen = new Set<string>();
  const pending = [...(adjacency.get(start) ?? [])];
  while (pending.length) {
    const next = pending.pop();
    if (!next || next === start || seen.has(next)) continue;
    seen.add(next);
    pending.push(...(adjacency.get(next) ?? []));
  }
  return [...seen].sort();
}

/** Build the interactive, evidence-backed view of a workspace architecture. */
export function architectureNodes(r: RepoHealth): ArchitectureNode[] {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();
  for (const p of r.scan.packages) {
    forward.set(p.name, []);
    reverse.set(p.name, []);
  }
  for (const [from, to] of r.scan.edges) {
    forward.get(from)?.push(to);
    reverse.get(to)?.push(from);
  }
  const cycles = new Set(r.cycles.flat());
  return r.scan.packages
    .map((p) => {
      const usesOut = r.scan.member_uses.filter((u) => u.from_pkg === p.name);
      const usesIn = r.scan.member_uses.filter((u) => u.target === p.name);
      return {
        name: p.name,
        dir: p.dir,
        kind: p.dir.startsWith("apps/") ? "app" : "package",
        dependencies: [...(forward.get(p.name) ?? [])].sort(),
        dependents: [...(reverse.get(p.name) ?? [])].sort(),
        transitiveDependencies: reachable(p.name, forward),
        transitiveDependents: reachable(p.name, reverse),
        importsIn: usesIn.reduce((total, use) => total + use.count, 0),
        importsOut: usesOut.reduce((total, use) => total + use.count, 0),
        boundaryFindings: r.scan.crossings.filter(
          (crossing) => crossing.from_pkg === p.name || crossing.target === p.name,
        ).length,
        phantomFindings: r.phantoms.filter(
          (use) => use.from_pkg === p.name || use.target === p.name,
        ).length,
        inCycle: cycles.has(p.name),
      } satisfies ArchitectureNode;
    })
    .sort(
      (a, b) =>
        b.transitiveDependents.length - a.transitiveDependents.length ||
        b.importsIn - a.importsIn ||
        a.name.localeCompare(b.name),
    );
}

/** Turn architectural evidence into a repair queue. Every item names the
 * concrete edit, why it matters and the file that proves it. */
export function architectureActions(
  r: RepoHealth,
  signals: ReadonlyArray<ArchitectureSignal> = [],
): ArchitectureAction[] {
  const actions: Array<ArchitectureAction & { score: number }> = [];
  const dirOf = (name: string): string => r.scan.packages.find((p) => p.name === name)?.dir ?? "";
  const blastOf = (name: string): number =>
    r.stats.find((stat) => stat.name === name)?.blast ?? dependentsFrom(name, r.scan.edges).size;

  for (const members of r.cycles) {
    const inside = new Set(members);
    const candidates = r.scan.dep_edges.filter(
      (edge) => inside.has(edge.from) && inside.has(edge.to),
    );
    const edge =
      candidates.find((candidate) => candidate.kind === "devDependencies") ?? candidates[0];
    const path = edge ? realCyclePath(members, r.scan).join(" → ") : members.join(" ↔ ");
    actions.push({
      id: `cycle:${members.join(":")}`,
      priority: "critical",
      category: "cycle",
      title: `Break the ${members.length}-package dependency cycle`,
      fix: edge
        ? edge.kind === "devDependencies"
          ? `Remove or invert ${edge.from} → ${edge.to} in ${edge.kind}; start with the development-only back-edge.`
          : `Remove or invert ${edge.from} → ${edge.to} in ${edge.kind}; if both packages need the contract, extract it below them.`
        : "Extract the shared contract into a lower-level package and remove one back-edge.",
      why: "Packages in a cycle cannot be built, tested or released independently.",
      scope: path,
      file: edge ? `${dirOf(edge.from)}/package.json` : `${dirOf(members[0])}/package.json`,
      score: 1_000 + members.reduce((total, name) => total + blastOf(name), 0),
    });
  }

  for (const use of r.phantoms) {
    actions.push({
      id: `phantom:${use.from_pkg}:${use.target}`,
      priority: "high",
      category: "dependency",
      title: `Declare ${use.target} in ${use.from_pkg}`,
      fix: `Add ${use.target} to dependencies in ${dirOf(use.from_pkg)}/package.json using the workspace range used by this repository.`,
      why: `${use.count} import${use.count === 1 ? "" : "s"} work through hoisting only and can fail in isolated builds.`,
      scope: `${blastOf(use.from_pkg)} downstream packages`,
      file: use.example_file,
      line: use.example_line,
      score: 700 + use.count + blastOf(use.from_pkg) * 5,
    });
  }

  const crossings = new Map<string, WorkspaceScan["crossings"]>();
  for (const crossing of r.scan.crossings) {
    const key = `${crossing.from_pkg}→${crossing.target}`;
    crossings.set(key, [...(crossings.get(key) ?? []), crossing]);
  }
  for (const [flow, items] of crossings) {
    const first = items[0];
    actions.push({
      id: `boundary:${flow}`,
      priority: "high",
      category: "boundary",
      title: `Restore the public boundary between ${first.from_pkg} and ${first.target}`,
      fix: `Export the required contract from ${first.target}'s public surface, then replace ${items.length} deep import${items.length === 1 ? "" : "s"} in ${first.from_pkg}.`,
      why: "Deep imports couple consumers to private files and turn internal refactors into breaking changes.",
      scope: `${items.length} imports · ${blastOf(first.target)} downstream packages`,
      file: first.file,
      line: first.line,
      score: 650 + items.length * 2 + blastOf(first.target) * 5,
    });
  }

  for (const mismatch of r.mismatches) {
    const outliers = mismatch.versions.slice(1).flatMap((version) => version.packages);
    const first = outliers[0];
    actions.push({
      id: `version:${mismatch.name}`,
      priority: "medium",
      category: "version",
      title: `Align ${mismatch.name} to ${mismatch.majority}`,
      fix: `Update ${outliers.length} outlier package${outliers.length === 1 ? "" : "s"} to ${mismatch.majority} and regenerate the lockfile.`,
      why: "Competing ranges can install duplicate runtimes and make behavior depend on the package manager layout.",
      scope: `${mismatch.versions.reduce((sum, version) => sum + version.packages.length, 0)} packages declare it`,
      file: first ? `${dirOf(first)}/package.json` : "package.json",
      score: 400 + outliers.length,
    });
  }

  const important = Math.max(3, Math.ceil(r.scan.packages.length * 0.15));
  for (const signal of signals) {
    const blast = blastOf(signal.name);
    if (signal.files > 0 && signal.testFiles === 0 && blast >= important) {
      actions.push({
        id: `tests:${signal.name}`,
        priority: signal.churn >= 10 ? "high" : "medium",
        category: "tests",
        title: `Add a contract test around ${signal.name}`,
        fix: `Cover its public surface first; use the hottest file as the first test target and run the test from the package in isolation.`,
        why: `${blast} packages can receive a regression from here, but no test file was found in this package.`,
        scope: `${signal.files} files · ${signal.churn} touches in 90 days`,
        file: signal.hotspots[0]?.path ?? `${dirOf(signal.name)}/package.json`,
        score: 550 + blast * 5 + signal.churn,
      });
    }
    if (signal.files > 0 && signal.owners.length === 0 && blast >= important) {
      actions.push({
        id: `owner:${signal.name}`,
        priority: "medium",
        category: "ownership",
        title: `Assign an owner to ${signal.name}`,
        fix: `Add ${dirOf(signal.name)}/ to CODEOWNERS and choose a team that can approve changes to its public contract.`,
        why: `${blast} packages depend on it, but no CODEOWNERS rule covers its files.`,
        scope: signal.contributors.length
          ? `Recent knowledge: ${signal.contributors.map((person) => person.name).join(", ")}`
          : "No recent maintainer signal",
        file: `${dirOf(signal.name)}/package.json`,
        score: 350 + blast * 5,
      });
    }
  }

  return actions
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .map(({ score: _score, ...action }) => action);
}

function dependentsFrom(
  name: string,
  edges: ReadonlyArray<readonly [string, string]>,
): Set<string> {
  const reverse = new Map<string, string[]>();
  for (const [from, to] of edges) reverse.set(to, [...(reverse.get(to) ?? []), from]);
  const seen = new Set<string>();
  const pending = [...(reverse.get(name) ?? [])];
  while (pending.length) {
    const next = pending.pop();
    if (!next || next === name || seen.has(next)) continue;
    seen.add(next);
    pending.push(...(reverse.get(next) ?? []));
  }
  return seen;
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
