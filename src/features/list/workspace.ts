import { useEffectQuery } from "@/effect/runtime";
import { Git } from "@/effect/services/Git";
import { usePrefs } from "@/effect/services/Prefs";
import type { Candidate, Ranked } from "@/effect/services/Triage";
import { type RepoHealth, type WorkspaceScan, analyze, buildReport } from "@/lib/turbo-health";
import { Effect } from "effect";
import { useMemo } from "react";

/**
 * What the Turborepo workspaces on this machine say about themselves: cycles,
 * version mismatches, boundary crossings, undeclared imports. Each kind of
 * problem is one finding in Health, with the whole report a copy away.
 */
const reports = new Map<string, RepoHealth>();

/** The report behind a workspace finding, for the peek. */
const reportFor = (id: string): RepoHealth | undefined => reports.get(id.split(":")[1] ?? "");

const KINDS: ReadonlyArray<{
  key: string;
  verdict: Ranked["verdict"];
  count: (r: RepoHealth) => number;
  title: (n: number) => string;
  why: string;
  detail: (r: RepoHealth) => string;
}> = [
  {
    key: "cycles",
    verdict: "risky",
    count: (r) => r.cycles.length,
    title: (n) => `${n} dependency cycle${n === 1 ? "" : "s"} between packages`,
    why: "a cycle means neither package can be built, tested or published alone",
    detail: (r) => r.cycles.map((c) => c.join(" → ")).join("\n"),
  },
  {
    key: "phantoms",
    verdict: "risky",
    count: (r) => r.phantoms.length,
    title: (n) => `${n} import${n === 1 ? "" : "s"} of a package nobody declared`,
    why: "works through hoisting only; breaks the moment the package is installed alone",
    detail: (r) =>
      r.phantoms
        .map(
          (p) =>
            `${p.from_pkg} uses ${p.target} ${p.count}× (e.g. ${p.example_file}:${p.example_line})`,
        )
        .join("\n"),
  },
  {
    key: "mismatches",
    verdict: "yours",
    count: (r) => r.mismatches.length,
    title: (n) => `${n} dependenc${n === 1 ? "y" : "ies"} pinned to different versions`,
    why: "two copies in the bundle, and the odd one out is usually a mistake",
    detail: (r) =>
      r.mismatches
        .map(
          (m) =>
            `${m.name}: ${m.versions.map((v) => `${v.version} (${v.packages.join(", ")})`).join(" vs ")} — most use ${m.majority}`,
        )
        .join("\n"),
  },
  {
    key: "crossings",
    verdict: "yours",
    count: (r) => r.scan.crossings.length,
    title: (n) => `${n} relative import${n === 1 ? "" : "s"} across a package boundary`,
    why: "a path into another package bypasses its public surface",
    detail: (r) =>
      r.scan.crossings
        .map((c) => `${c.file}:${c.line} imports ${c.spec} (${c.from_pkg} → ${c.target})`)
        .join("\n"),
  },
  {
    key: "unused",
    verdict: "routine",
    count: (r) => r.unused.length,
    title: (n) => `${n} declared workspace dependenc${n === 1 ? "y" : "ies"} never imported`,
    why: "dead weight in the graph; drop it and the build gets simpler",
    detail: (r) => r.unused.map((u) => `${u.from} → ${u.to} (${u.kind})`).join("\n"),
  },
];

export function workspaceFindings(health: ReadonlyArray<RepoHealth>): Ranked[] {
  const out: Ranked[] = [];
  for (const r of health) {
    const repo = `${r.owner}/${r.repo}`;
    reports.set(repo, r);
    for (const k of KINDS) {
      const n = k.count(r);
      if (!n) continue;
      const c: Candidate = {
        id: `turbo:${repo}:${k.key}`,
        kind: "finding",
        title: k.title(n),
        repo,
        owner: r.owner,
        repoName: r.repo,
        mine: false,
        author: "turborepo",
        severity: k.verdict === "risky" ? "high" : k.verdict === "yours" ? "medium" : "low",
        detail: k.detail(r),
        createdAt: null,
        updatedAt: null,
      };
      out.push({ ...c, verdict: k.verdict, why: k.why });
    }
  }
  return out;
}

export const reportText = (id: string): string | null => {
  const r = reportFor(id);
  return r ? buildReport(r) : null;
};

/** Scan every local clone that is a Turborepo; the rest drop out quietly. */
export function useWorkspaceHealth(): ReadonlyArray<RepoHealth> {
  const paths = usePrefs((p) => p.localRepos);
  const q = useEffectQuery(
    ["workspace-health", paths],
    Effect.forEach(
      paths,
      (path) =>
        Effect.flatMap(Git, (g) =>
          Effect.all([g.repoInfo(path), g.workspaceScan(path)]).pipe(
            Effect.map(([info, scan]) => {
              const full = info.remote_url?.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/);
              if (!scan || !full) return null;
              const s = scan as WorkspaceScan;
              return {
                owner: full[1],
                repo: full[2],
                path,
                scan: s,
                ...analyze(s),
              } satisfies RepoHealth;
            }),
            Effect.orElseSucceed(() => null),
          ),
        ),
      { concurrency: 2 },
    ),
    { staleTime: 10 * 60_000, enabled: paths.length > 0 },
  );
  return useMemo(() => (q.data ?? []).filter((r): r is RepoHealth => r !== null), [q.data]);
}

export const isWorkspaceFinding = (id: string) => id.startsWith("turbo:");
