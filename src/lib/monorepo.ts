import { parsePatch } from "@/lib/diff";
import type { LayerPlan, ReviewLayer } from "@/lib/layers";
import type { PullFile } from "@/lib/tauri";

/** Mirror of the Rust `Workspace` — a Turborepo's packages and dependency
 * edges (`[from, to]` = from depends on to). */
export interface Workspace {
  packages: { name: string; dir: string }[];
  edges: [string, string][];
}

/** The package owning `path`: the member whose dir is its longest prefix.
 * Longest, not first — nested packages ("apps/web" inside a glob that also
 * matched "apps") must win over their ancestors. */
export function ownerOf(path: string, ws: Workspace): string | null {
  let best: { name: string; len: number } | null = null;
  for (const p of ws.packages) {
    const prefix = `${p.dir}/`;
    if (path.startsWith(prefix) && (!best || prefix.length > best.len)) {
      best = { name: p.name, len: prefix.length };
    }
  }
  return best?.name ?? null;
}

/** Every package that depends on one of `roots`, directly or transitively —
 * the blast radius. `roots` themselves are not included. */
export function dependentsOf(roots: Set<string>, ws: Workspace): Set<string> {
  // Reverse adjacency: dep -> its dependents.
  const rev = new Map<string, string[]>();
  for (const [from, to] of ws.edges) {
    const list = rev.get(to);
    if (list) list.push(from);
    else rev.set(to, [from]);
  }
  const out = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const cur = queue.pop();
    if (cur === undefined) break;
    for (const dependent of rev.get(cur) ?? []) {
      if (!out.has(dependent) && !roots.has(dependent)) {
        out.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return out;
}

/** `names` in dependency order — a package always after everything it depends
 * on — plus the members of any dependency cycle among them (which Kahn's
 * algorithm leaves unplaced; they are appended so no package is lost). */
function topoOrder(names: Set<string>, ws: Workspace): { order: string[]; cycle: string[] } {
  // Restrict the graph to `names`: order among touched packages must not be
  // perturbed by untouched intermediaries.
  const deps = new Map<string, Set<string>>();
  for (const n of names) deps.set(n, new Set());
  for (const [from, to] of ws.edges) {
    if (names.has(from) && names.has(to)) deps.get(from)?.add(to);
  }
  const order: string[] = [];
  const placed = new Set<string>();
  let moved = true;
  while (moved) {
    moved = false;
    for (const [name, ds] of deps) {
      if (placed.has(name)) continue;
      if ([...ds].every((d) => placed.has(d))) {
        order.push(name);
        placed.add(name);
        moved = true;
      }
    }
  }
  const cycle = [...names].filter((n) => !placed.has(n)).sort();
  return { order: [...order, ...cycle], cycle };
}

/**
 * Split a PR by workspace package, in dependency order — the layered-review
 * plan a Turborepo can state exactly, where the path heuristic and the model
 * both guess. Files outside any package land in a trailing workspace-root
 * layer; anything else `reconcileLayers` catches at read time as usual.
 */
export function buildPackagePlan(files: PullFile[], ws: Workspace): LayerPlan {
  const byPkg = new Map<string, string[]>();
  const rootFiles: string[] = [];
  for (const f of files) {
    const owner = ownerOf(f.filename, ws);
    if (owner === null) {
      rootFiles.push(f.filename);
      continue;
    }
    const list = byPkg.get(owner);
    if (list) list.push(f.filename);
    else byPkg.set(owner, [f.filename]);
  }

  const touched = new Set(byPkg.keys());
  const { order, cycle } = topoOrder(touched, ws);
  const blast = dependentsOf(touched, ws);

  // Direct dependents per touched package, for the per-layer briefing.
  const directDependents = new Map<string, number>();
  for (const [, to] of ws.edges) {
    if (touched.has(to)) directDependents.set(to, (directDependents.get(to) ?? 0) + 1);
  }

  const layers: ReviewLayer[] = order.map((pkg) => {
    const dir = ws.packages.find((p) => p.name === pkg)?.dir ?? "";
    const dependents = directDependents.get(pkg) ?? 0;
    return {
      id: pkg,
      title: pkg,
      intent: `${dir} — ${dependents} package${dependents === 1 ? "" : "s"} in this repo depend on it${dependents > 0 ? ", so read it before them." : "."}`,
      focus:
        dependents > 0
          ? [
              `A changed export here ripples into ${dependents} dependent package${dependents === 1 ? "" : "s"}`,
            ]
          : [],
      // Attention follows consequence: a package nothing depends on can be
      // read lightly; one with many dependents cannot.
      risk: dependents >= 3 ? "high" : dependents > 0 ? "medium" : "low",
      files: byPkg.get(pkg) ?? [],
    };
  });
  if (rootFiles.length > 0) {
    layers.push({
      id: "workspace-root",
      title: "Workspace root",
      intent: "Files outside every package — workspace config, lockfiles, CI.",
      focus: [],
      risk: "low",
      files: rootFiles,
    });
  }

  const cycleNote =
    cycle.length > 0
      ? ` Dependency cycle among ${cycle.join(" ↔ ")} — their order is arbitrary, and the cycle itself is worth a comment.`
      : "";
  return {
    summary: `Touches ${touched.size} of ${ws.packages.length} packages · ${blast.size} more depend on them.`,
    strategy: `Packages in dependency order, from the repo's own graph — each layer only depends on layers already read.${cycleNote}`,
    layers,
  };
}

/* ─────────────────────────── workspace insights ─────────────────────────── */

/** Dependency cycles in the workspace: every strongly-connected component with
 * more than one member (or a self-edge). A cycle is invisible in any diff and
 * exactly the kind of thing a reviewer is expected to catch — so it is computed
 * from the graph, not from the change. */
export function findCycles(ws: Workspace): string[][] {
  // Tarjan. The graphs are tiny (tens of packages), recursion is fine.
  const adj = new Map<string, string[]>();
  for (const p of ws.packages) adj.set(p.name, []);
  for (const [from, to] of ws.edges) adj.get(from)?.push(to);

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const strongconnect = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, idx.get(w) ?? 0));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = [];
      while (true) {
        const w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      const selfLoop = scc.length === 1 && (adj.get(v) ?? []).includes(v);
      if (scc.length > 1 || selfLoop) cycles.push(scc.sort());
    }
  };
  for (const p of ws.packages) {
    if (!idx.has(p.name)) strongconnect(p.name);
  }
  return cycles;
}

/** One import in this diff that reaches across a package boundary into another
 * package's internals. */
export interface BoundaryCrossing {
  file: string;
  /** New-file line of the added import. */
  line: number;
  /** The import specifier as written. */
  spec: string;
  /** The package whose internals are being reached into. */
  target: string;
  /** How it crosses: a deep bare import ("@acme/ui/src/…") or a relative path
   * escaping its own package ("../../ui/src/…"). */
  kind: "deep-import" | "relative-escape";
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

/** Resolve `spec` relative to `fromDir`, collapsing `.` and `..`. Returns null
 * when the path escapes the repo root. */
function resolveRelative(fromDir: string, spec: string): string | null {
  const parts = fromDir === "" ? [] : fromDir.split("/");
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return parts.join("/");
}

/**
 * Scan the ADDED lines of a PR for imports that cross into another workspace
 * package's internals. Two shapes count, both diff-provable:
 *
 * - a bare specifier reaching past a package's public surface into `src/` or
 *   `dist/` ("@acme/ui/src/button") — subpath exports like "@acme/ui/styles.css"
 *   are deliberately NOT flagged, since packages legitimately export subpaths;
 * - a relative path that walks out of its own package and lands inside a
 *   different one ("../../packages/ui/src/x"), which no exports map sanctions.
 *
 * Only added lines are scanned: a pre-existing crossing is the repo's debt, not
 * this PR's.
 */
export function boundaryCrossings(files: PullFile[], ws: Workspace): BoundaryCrossing[] {
  const out: BoundaryCrossing[] = [];
  for (const f of files) {
    if (!f.patch) continue;
    const owner = ownerOf(f.filename, ws);
    if (owner === null) continue; // root files play by different rules
    const fileDir = f.filename.split("/").slice(0, -1).join("/");
    for (const hunk of parsePatch(f.patch)) {
      for (const line of hunk.lines) {
        if (line.kind !== "add" || line.newLine === null) continue;
        for (const m of line.text.matchAll(IMPORT_RE)) {
          const spec = m[1];
          if (spec.startsWith(".")) {
            const resolved = resolveRelative(fileDir, spec);
            if (resolved === null) continue;
            const target = ownerOf(resolved, ws) ?? ownerOf(`${resolved}/x`, ws);
            if (target !== null && target !== owner) {
              out.push({
                file: f.filename,
                line: line.newLine,
                spec,
                target,
                kind: "relative-escape",
              });
            }
          } else {
            const pkg = ws.packages.find((p) => p.name !== owner && spec.startsWith(`${p.name}/`));
            if (pkg) {
              const subpath = spec.slice(pkg.name.length + 1);
              if (
                subpath.startsWith("src/") ||
                subpath.startsWith("dist/") ||
                subpath.startsWith("lib/")
              ) {
                out.push({
                  file: f.filename,
                  line: line.newLine,
                  spec,
                  target: pkg.name,
                  kind: "deep-import",
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

/** An actual directed cycle through `scc`, as a path ending where it starts —
 * Tarjan yields the *members*, but showing them alphabetically joined by
 * arrows would draw edges that don't exist. This walks real edges. */
export function realCyclePath(scc: string[], ws: Workspace): string[] {
  const inScc = new Set(scc);
  const adj = new Map<string, string[]>();
  for (const [from, to] of ws.edges) {
    if (inScc.has(from) && inScc.has(to)) {
      const list = adj.get(from);
      if (list) list.push(to);
      else adj.set(from, [to]);
    }
  }
  const start = scc[0];
  const path: string[] = [start];
  const seen = new Set([start]);
  let cur = start;
  // Greedy walk: inside one SCC every node reaches every other, so following
  // any unvisited edge (or closing back to start) always terminates.
  for (let i = 0; i < scc.length * 2; i++) {
    const nexts = adj.get(cur) ?? [];
    if (nexts.includes(start) && path.length > 1) return [...path, start];
    const next = nexts.find((n) => !seen.has(n)) ?? nexts[0];
    if (next === undefined) break;
    if (seen.has(next)) return [...path.slice(path.indexOf(next)), next];
    path.push(next);
    seen.add(next);
    cur = next;
  }
  return [...scc, scc[0]];
}

/** Per-package graph position: what it pulls in, who sits on top of it, and
 * how far a change to it ripples. */
export interface PackageStats {
  name: string;
  dir: string;
  /** Workspace packages it depends on directly. */
  deps: number;
  /** Packages that depend on it directly. */
  dependents: number;
  /** Packages that depend on it directly or transitively — the blast radius. */
  blast: number;
}

export function packageStats(ws: Workspace): PackageStats[] {
  const depCount = new Map<string, number>();
  const dependentCount = new Map<string, number>();
  for (const [from, to] of ws.edges) {
    depCount.set(from, (depCount.get(from) ?? 0) + 1);
    dependentCount.set(to, (dependentCount.get(to) ?? 0) + 1);
  }
  return ws.packages
    .map((p) => ({
      name: p.name,
      dir: p.dir,
      deps: depCount.get(p.name) ?? 0,
      dependents: dependentCount.get(p.name) ?? 0,
      blast: dependentsOf(new Set([p.name]), ws).size,
    }))
    .sort(
      (a, b) => b.blast - a.blast || b.dependents - a.dependents || a.name.localeCompare(b.name),
    );
}

/** Length in edges of the longest dependency chain — how deep a rebuild can
 * cascade. Back-edges (cycles) count zero so the walk terminates. */
export function graphDepth(ws: Workspace): number {
  const adj = new Map<string, string[]>();
  for (const [from, to] of ws.edges) {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  }
  const memo = new Map<string, number>();
  const onStack = new Set<string>();
  const depth = (n: string): number => {
    const hit = memo.get(n);
    if (hit !== undefined) return hit;
    if (onStack.has(n)) return 0;
    onStack.add(n);
    let best = 0;
    for (const next of adj.get(n) ?? []) best = Math.max(best, 1 + depth(next));
    onStack.delete(n);
    memo.set(n, best);
    return best;
  };
  let max = 0;
  for (const p of ws.packages) max = Math.max(max, depth(p.name));
  return max;
}
