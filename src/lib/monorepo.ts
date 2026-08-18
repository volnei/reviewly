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
