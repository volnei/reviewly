import type { PullFile } from "@/effect/schema";

export interface MergeCandidate {
  readonly id: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly author?: string;
  readonly ci?: string;
  readonly draft?: boolean;
  readonly conflicting?: boolean;
  readonly stackPosition?: number;
}

export interface MergeBundle {
  readonly pull: MergeCandidate;
  readonly files: ReadonlyArray<PullFile>;
}

export interface MergeFinding {
  readonly severity: "blocker" | "warning" | "clear";
  readonly title: string;
  readonly detail: string;
  readonly files: ReadonlyArray<string>;
}

export interface MergeStage {
  readonly pull: MergeCandidate;
  readonly state: "clear" | "attention" | "blocked";
  readonly files: number;
  readonly lines: number;
  readonly collisions: ReadonlyArray<string>;
  readonly reason: string;
}

export interface MergeSimulation {
  readonly status: "blocked" | "attention" | "ready";
  readonly score: number;
  readonly files: number;
  readonly lines: number;
  readonly surfaces: ReadonlyArray<{ name: string; files: number; lines: number }>;
  readonly findings: ReadonlyArray<MergeFinding>;
  readonly order: ReadonlyArray<MergeCandidate>;
  readonly stages: ReadonlyArray<MergeStage>;
}

const architectureFile = (path: string) =>
  /(^|\/)(turbo\.json|package\.json|tsconfig[^/]*\.json|CODEOWNERS)$/i.test(path) ||
  /(^|\/)(packages|apps)\/[^/]+\/src\//.test(path);

export function changeSurface(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if ((parts[0] === "apps" || parts[0] === "packages") && parts[1]) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0] || "root";
}

export function simulateMerge(bundles: ReadonlyArray<MergeBundle>): MergeSimulation {
  const byFile = new Map<string, Array<{ pull: MergeCandidate; file: PullFile }>>();
  const surfaces = new Map<string, { files: Set<string>; lines: number }>();
  let lines = 0;
  for (const bundle of bundles) {
    for (const file of bundle.files) {
      byFile.set(file.filename, [
        ...(byFile.get(file.filename) ?? []),
        { pull: bundle.pull, file },
      ]);
      const surface = changeSurface(file.filename);
      const current = surfaces.get(surface) ?? { files: new Set<string>(), lines: 0 };
      current.files.add(file.filename);
      current.lines += file.changes;
      surfaces.set(surface, current);
      lines += file.changes;
    }
  }

  const findings: MergeFinding[] = [];
  const overlaps = [...byFile.entries()].filter(([, entries]) => {
    const pulls = new Set(entries.map((entry) => entry.pull.id));
    return pulls.size > 1;
  });
  if (overlaps.length) {
    findings.push({
      severity: "blocker",
      title: `${overlaps.length} file${overlaps.length === 1 ? " is" : "s are"} changed by multiple PRs`,
      detail: "Merge or rebase these in sequence; the patches share the same files.",
      files: overlaps.map(([file]) => file),
    });
  }

  const explicit = bundles.filter((bundle) => bundle.pull.conflicting);
  if (explicit.length) {
    findings.push({
      severity: "blocker",
      title: `${explicit.length} PR${explicit.length === 1 ? " already conflicts" : "s already conflict"} with its base`,
      detail: "Resolve the existing base conflict before combining this set.",
      files: [],
    });
  }

  const failed = bundles.filter((bundle) => bundle.pull.ci === "failure");
  if (failed.length) {
    findings.push({
      severity: "blocker",
      title: `${failed.length} selected PR${failed.length === 1 ? " has" : "s have"} failing checks`,
      detail: "The future state cannot be considered safe while required checks are red.",
      files: [],
    });
  }

  const architecture = [...byFile.keys()].filter(architectureFile);
  if (architecture.length) {
    findings.push({
      severity: "warning",
      title: `${architecture.length} architecture-sensitive file${architecture.length === 1 ? "" : "s"} change`,
      detail: "Re-scan Living architecture after the merge to catch boundary or dependency drift.",
      files: architecture,
    });
  }

  const tests = [...byFile.keys()].filter((file) =>
    /(^|\/)(__tests__|tests?|specs?)(\/|\.)/i.test(file),
  );
  const source = [...byFile.keys()].filter((file) =>
    /\.(ts|tsx|js|jsx|rs|go|py|java|kt)$/.test(file),
  );
  if (source.length > 4 && tests.length === 0) {
    findings.push({
      severity: "warning",
      title: "Source changes have no test changes in this set",
      detail: "Confirm existing coverage reaches the affected paths before merging.",
      files: source.slice(0, 8),
    });
  }
  if (!findings.length) {
    findings.push({
      severity: "clear",
      title: "No cross-PR collision found",
      detail: "The selected patches touch separate files and report no known check failures.",
      files: [],
    });
  }

  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const score = Math.min(
    100,
    blockers * 28 + warnings * 11 + overlaps.length * 7 + Math.floor(lines / 400),
  );
  const order = bundles
    .map((bundle) => bundle.pull)
    .sort((a, b) => {
      const repo = a.repo.localeCompare(b.repo);
      if (repo) return repo;
      const stack =
        (a.stackPosition ?? Number.MAX_SAFE_INTEGER) - (b.stackPosition ?? Number.MAX_SAFE_INTEGER);
      if (stack) return stack;
      const aBlocked = Number(a.conflicting || a.ci === "failure");
      const bBlocked = Number(b.conflicting || b.ci === "failure");
      return aBlocked - bBlocked || a.number - b.number;
    });
  const bundleByPull = new Map(bundles.map((bundle) => [bundle.pull.id, bundle]));
  const seenFiles = new Set<string>();
  const stages = order.map((pull): MergeStage => {
    const bundle = bundleByPull.get(pull.id);
    const files = bundle?.files ?? [];
    const collisions = files
      .map((file) => file.filename)
      .filter((filename) => seenFiles.has(filename));
    for (const file of files) seenFiles.add(file.filename);
    const changedLines = files.reduce((total, file) => total + file.changes, 0);
    const architectureChanges = files.filter((file) => architectureFile(file.filename)).length;
    const blocked = pull.conflicting || pull.ci === "failure" || collisions.length > 0;
    const attention = pull.draft || architectureChanges > 0;
    const reason = pull.conflicting
      ? "Already conflicts with its base"
      : pull.ci === "failure"
        ? "Required checks are failing"
        : collisions.length
          ? `${collisions.length} file${collisions.length === 1 ? " collides" : "s collide"} with an earlier PR`
          : pull.draft
            ? "Draft must be made ready"
            : architectureChanges
              ? `${architectureChanges} architecture-sensitive file${architectureChanges === 1 ? "" : "s"}`
              : "No collision found";
    return {
      pull,
      state: blocked ? "blocked" : attention ? "attention" : "clear",
      files: files.length,
      lines: changedLines,
      collisions,
      reason,
    };
  });

  return {
    status: blockers ? "blocked" : warnings ? "attention" : "ready",
    score,
    files: byFile.size,
    lines,
    surfaces: [...surfaces.entries()]
      .map(([name, value]) => ({ name, files: value.files.size, lines: value.lines }))
      .sort((a, b) => b.lines - a.lines),
    findings,
    order,
    stages,
  };
}
