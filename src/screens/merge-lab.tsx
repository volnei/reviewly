import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { run, useEffectQuery } from "@/effect/runtime";
import type { MergeLabResult as LocalProofResult } from "@/effect/schema";
import { useAuth } from "@/effect/services/Auth";
import { Git } from "@/effect/services/Git";
import { GitHub, splitRepo } from "@/effect/services/GitHub";
import { fromSummary } from "@/effect/services/Inbox";
import { usePrefs } from "@/effect/services/Prefs";
import type { Ranked } from "@/effect/services/Triage";
import { Triage } from "@/effect/services/Triage";
import { ListHead, Nothing } from "@/features/list/list";
import { useWorkspaceHealth } from "@/features/list/workspace";
import {
  type MergeBundle,
  type MergeCandidate,
  type MergeSimulation,
  simulateMerge,
} from "@/features/merge-lab/model";
import { APP_STORE } from "@/lib/edition";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import { ArrowRight, FlaskConical, GitMerge, LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

type RunState = "idle" | "fetching" | "analyzing" | "complete";

const remoteSlug = (remote: string | null) =>
  remote
    ?.replace(/^git@github\.com:/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "") ?? null;

const candidateOf = (item: Ranked): MergeCandidate | null =>
  item.number
    ? {
        id: item.id,
        repo: item.repo,
        number: item.number,
        title: item.title,
        author: item.author,
        ci: item.ci,
        draft: item.draft,
        conflicting: item.conflicting,
        stackPosition: item.stack?.position,
      }
    : null;

export function MergeLabScreen() {
  useTitleSlot(<span className="text-[13px] text-ink-2">Labs / Merge Lab</span>, "desk");
  const auth = useAuth();
  const watched = usePrefs((prefs) => prefs.watchedRepos);
  const localPaths = usePrefs((prefs) => prefs.localRepos);
  const workspaces = useWorkspaceHealth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [runState, setRunState] = useState<RunState>("idle");
  const [simulation, setSimulation] = useState<MergeSimulation | null>(null);
  const [editingSet, setEditingSet] = useState(true);
  const [proof, setProof] = useState<LocalProofResult | null>(null);
  const [proving, setProving] = useState(false);
  const localClones = useEffectQuery(
    ["merge-lab-local-clones", localPaths],
    Effect.gen(function* () {
      const git = yield* Git;
      return yield* Effect.forEach(
        localPaths,
        (path) =>
          git.repoInfo(path).pipe(
            Effect.map((info) => ({ path, slug: remoteSlug(info.remote_url) })),
            Effect.orElseSucceed(() => null),
          ),
        { concurrency: 4 },
      );
    }),
    { enabled: localPaths.length > 0, staleTime: 60_000 },
  );
  const cached = useEffectQuery(
    ["merge-lab", watched, auth.viewer?.login],
    Effect.gen(function* () {
      const gh = yield* GitHub;
      const triage = yield* Triage;
      const lists = yield* Effect.forEach(
        watched,
        (full) => {
          const repo = splitRepo(full);
          return repo
            ? gh.repoPulls(repo.owner, repo.repo).pipe(Effect.orElseSucceed(() => []))
            : Effect.succeed([]);
        },
        { concurrency: 4 },
      );
      return yield* triage.rank(
        lists.flat().map((pull) => fromSummary(pull, auth.viewer?.login ?? null)),
      );
    }),
    { enabled: watched.length > 0, staleTime: 60_000 },
  );
  const candidates = useMemo(
    () =>
      (cached.data ?? [])
        .filter((item) => item.kind === "pr" && item.state !== "closed" && !item.merged)
        .sort((a, b) => a.repo.localeCompare(b.repo) || (a.number ?? 0) - (b.number ?? 0)),
    [cached.data],
  );
  const chosen = candidates.filter((item) => selected.has(item.id));
  const localRepos = new Set(workspaces.map((workspace) => `${workspace.owner}/${workspace.repo}`));
  const chosenRepos = new Set(chosen.map((item) => item.repo));
  const chosenRepo = chosenRepos.size === 1 ? [...chosenRepos][0] : null;
  const localClone =
    (localClones.data ?? []).find((clone) => clone?.slug === chosenRepo) ??
    workspaces
      .filter((workspace) => `${workspace.owner}/${workspace.repo}` === chosenRepo)
      .map((workspace) => ({ path: workspace.path, slug: chosenRepo }))[0] ??
    null;

  const toggle = (id: string) => {
    setSimulation(null);
    setProof(null);
    setRunState("idle");
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 8) next.add(id);
      else toast.say("Merge Lab accepts up to 8 PRs per simulation");
      return next;
    });
  };

  const simulate = async () => {
    const pulls = chosen.map(candidateOf).filter((item): item is MergeCandidate => item !== null);
    if (!pulls.length) return;
    setRunState("fetching");
    setSimulation(null);
    setProof(null);
    try {
      const bundles = await run(
        Effect.gen(function* () {
          const gh = yield* GitHub;
          return yield* Effect.forEach(
            pulls,
            (pull) => {
              const split = splitRepo(pull.repo);
              return split
                ? gh
                    .files({ owner: split.owner, repo: split.repo, number: pull.number })
                    .pipe(Effect.map((files): MergeBundle => ({ pull, files })))
                : Effect.succeed({ pull, files: [] } satisfies MergeBundle);
            },
            { concurrency: 4 },
          );
        }),
      );
      setRunState("analyzing");
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      setSimulation(simulateMerge(bundles));
      setEditingSet(false);
      setRunState("complete");
    } catch (error) {
      setRunState("idle");
      toast.fail("Couldn’t simulate this merge set", error);
    }
  };

  const proveLocally = async () => {
    if (!localClone || !simulation) return;
    setProving(true);
    setProof(null);
    try {
      const result = await run(
        Effect.flatMap(Git, (git) =>
          git.mergeLab(
            localClone.path,
            simulation.order.map((pull) => pull.number),
          ),
        ),
      );
      setProof(result);
    } catch (error) {
      toast.fail("Local proof failed", error);
    } finally {
      setProving(false);
    }
  };

  return (
    <div className="screen-enter h-full overflow-y-auto bg-desk scrollbar-thin">
      <div className="flex items-baseline justify-between pr-5">
        <ListHead title="Merge Lab">
          Simulate the repository after several pull requests land together.
        </ListHead>
        {selected.size ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(new Set());
              setSimulation(null);
              setProof(null);
              setRunState("idle");
              setEditingSet(true);
            }}
          >
            <RotateCcw className="size-3.5" /> Reset set
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          "mx-auto grid grid-cols-1 items-start gap-5 px-5 pb-14",
          simulation && !editingSet
            ? "max-w-[1180px]"
            : "max-w-[1380px] xl:grid-cols-[360px_minmax(0,1fr)]",
        )}
      >
        {!simulation || editingSet ? (
          <section className="overflow-hidden rounded-lg border border-hair bg-page">
            <header className="flex items-center justify-between border-b border-hair px-4 py-3">
              <div>
                <h2 className="text-[13px] font-medium text-ink">Choose the future</h2>
                <p className="mt-0.5 text-[11px] text-ink-3">Select up to 8 open PRs</p>
              </div>
              <span className="tnum text-[12px] text-ink-3">{selected.size}/8</span>
            </header>
            <div className="max-h-[calc(100vh-205px)] overflow-y-auto scrollbar-thin">
              {candidates.length ? (
                candidates.map((item, index) => (
                  <label
                    key={item.id}
                    htmlFor={`merge-lab-${index}`}
                    className={cn(
                      "grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] gap-3 px-4 py-3 hover:bg-raise/55",
                      index > 0 && "border-t border-hair",
                      selected.has(item.id) && "bg-raise",
                    )}
                  >
                    <Checkbox
                      id={`merge-lab-${index}`}
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                      aria-label={`Select ${item.title}`}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-ink">{item.title}</span>
                      <span className="mt-1 flex items-center gap-2 text-[11px] text-ink-3">
                        <span className="truncate">{item.repo}</span>
                        <span className="tnum">#{item.number}</span>
                        {item.draft ? <span>Draft</span> : null}
                        {item.ci === "failure" ? (
                          <span className="text-negative">CI failing</span>
                        ) : null}
                      </span>
                    </span>
                  </label>
                ))
              ) : (
                <Nothing detail="Watch a repository in Settings so its cached PRs are available here.">
                  No open pull requests
                </Nothing>
              )}
            </div>
          </section>
        ) : null}

        <main className="min-w-0">
          <SimulationHeader
            chosen={chosen}
            runState={runState}
            simulation={simulation}
            onSimulate={simulate}
            onEdit={() => setEditingSet(true)}
          />
          {simulation ? (
            <SimulationResult
              result={simulation}
              localRepos={localRepos}
              localClone={localClone?.path ?? null}
              proof={proof}
              proving={proving}
              onProve={proveLocally}
              onOpen={(pull) => {
                const repo = splitRepo(pull.repo);
                if (repo)
                  void navigate({
                    to: "/pr/$owner/$repo/$number",
                    params: { owner: repo.owner, repo: repo.repo, number: String(pull.number) },
                  });
              }}
              onArchitecture={() => void navigate({ to: "/turbo" })}
            />
          ) : (
            <EmptySimulation selected={chosen.length} runState={runState} />
          )}
        </main>
      </div>
    </div>
  );
}
function SimulationHeader({
  chosen,
  runState,
  simulation,
  onSimulate,
  onEdit,
}: {
  chosen: Ranked[];
  runState: RunState;
  simulation: MergeSimulation | null;
  onSimulate: () => void;
  onEdit: () => void;
}) {
  const busy = runState === "fetching" || runState === "analyzing";
  return (
    <section
      className={cn(
        simulation
          ? "flex items-center justify-between gap-5 border-b border-hair pb-4"
          : "rounded-lg border border-hair bg-page p-5",
      )}
    >
      <div className="flex items-start justify-between gap-5">
        <div>
          <p className="text-[11px] text-ink-3">Future merge set</p>
          <h2 className="mt-1 text-[18px] font-medium tracking-[-0.02em] text-ink">
            {chosen.length
              ? `${chosen.length} PR${chosen.length === 1 ? "" : "s"} in this future`
              : "No PRs selected"}
          </h2>
          {!simulation ? (
            <p className="mt-2 max-w-[620px] text-[12px] leading-relaxed text-ink-3">
              Merge Lab reads the real changed files, known checks and stack order. It never touches
              your checkout.
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {simulation ? (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit set
          </Button>
        ) : null}
        <Button disabled={!chosen.length || busy} onClick={onSimulate}>
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <FlaskConical className="size-4" />
          )}
          {runState === "fetching"
            ? "Reading patches"
            : runState === "analyzing"
              ? "Building future"
              : simulation
                ? "Refresh future"
                : "Simulate merge"}
        </Button>
      </div>
      {!simulation ? (
        <div className="mt-5 flex min-h-9 items-center gap-2 border-t border-hair pt-4">
          {chosen.length ? (
            chosen.map((item, index) => (
              <span key={item.id} className="flex min-w-0 items-center gap-2">
                {index ? <ArrowRight className="size-3 shrink-0 text-ink-3" /> : null}
                <span className="max-w-40 truncate text-[11px] text-ink-2">
                  #{item.number} {item.title}
                </span>
              </span>
            ))
          ) : (
            <span className="text-[11px] text-ink-3">
              Choose PRs from the queue to compose a future state.
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}

function EmptySimulation({ selected, runState }: { selected: number; runState: RunState }) {
  const steps = [
    ["Patches", "Read the exact changed files"],
    ["Collision", "Find cross-PR overlap"],
    ["Checks", "Carry forward known CI state"],
    ["Architecture", "Locate dependency-sensitive changes"],
  ];
  return (
    <section className="mt-5 rounded-lg border border-hair bg-page p-5">
      <p className="text-[13px] font-medium text-ink">What the simulation will prove</p>
      <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-hair bg-hair sm:grid-cols-2">
        {steps.map(([title, detail], index) => (
          <div key={title} className="bg-page p-4">
            <span className="tnum text-[11px] text-ink-3">0{index + 1}</span>
            <p className="mt-2 text-[12px] text-ink">{title}</p>
            <p className="mt-1 text-[11px] text-ink-3">{detail}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-ink-3">
        {runState === "fetching"
          ? "Reading GitHub’s cached file metadata…"
          : selected
            ? "Ready to simulate this set."
            : "Select at least one PR to begin."}
      </p>
    </section>
  );
}

function SimulationResult({
  result,
  localRepos,
  localClone,
  proof,
  proving,
  onProve,
  onOpen,
  onArchitecture,
}: {
  result: MergeSimulation;
  localRepos: Set<string>;
  localClone: string | null;
  proof: LocalProofResult | null;
  proving: boolean;
  onProve: () => void;
  onOpen: (pull: MergeCandidate) => void;
  onArchitecture: () => void;
}) {
  const status =
    result.status === "blocked"
      ? "Blocked"
      : result.status === "attention"
        ? "Needs attention"
        : "Safe to stage";
  const breakpoint = result.stages.find((stage) => stage.state === "blocked");
  const attention = result.stages.find((stage) => stage.state === "attention");
  const nextStage = breakpoint ?? attention ?? result.stages[0];
  const headline = breakpoint
    ? `Breaks at #${breakpoint.pull.number}`
    : attention
      ? `Clear path, one review at #${attention.pull.number}`
      : "Clear path to main";
  const explanation = breakpoint
    ? `${breakpoint.pull.title} — ${breakpoint.reason}.`
    : attention
      ? `${attention.pull.title} — ${attention.reason}.`
      : `All ${result.order.length} PRs can be staged in this order without a predicted collision.`;
  return (
    <div className="mt-5 space-y-5">
      <section className="overflow-hidden rounded-lg border border-hair bg-page">
        <div className="grid items-end gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-[11px] text-ink-3">Merge forecast · {status}</p>
            <h2
              className={cn(
                "mt-2 text-[26px] font-medium tracking-[-0.035em] text-ink",
                breakpoint && "text-negative",
                !breakpoint && !attention && "text-positive",
              )}
            >
              {headline}
            </h2>
            <p className="mt-2 max-w-[680px] text-[12px] leading-relaxed text-ink-2">
              {explanation}
            </p>
          </div>
          {nextStage ? (
            <Button
              className="justify-self-start lg:justify-self-end"
              onClick={() => onOpen(nextStage.pull)}
            >
              {breakpoint ? "Review blocker" : attention ? "Review warning" : "Review first"}
              <ArrowRight className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-2 border-t border-hair px-6 py-3 text-[11px] text-ink-3">
          <span>
            <strong className="tnum font-medium text-ink">{result.score}</strong> risk
          </span>
          <span>
            <strong className="tnum font-medium text-ink">{result.files}</strong> files
          </span>
          <span>
            <strong className="tnum font-medium text-ink">{result.lines}</strong> changed lines
          </span>
          <span>
            <strong className="tnum font-medium text-ink">{result.order.length}</strong> merge steps
          </span>
        </div>
        <FutureBranch stages={result.stages} onOpen={onOpen} />
      </section>

      {/* Proving needs Git on a local clone, which the App Store sandbox can't reach. */}
      {APP_STORE ? null : (
        <LocalProof
          path={localClone}
          proof={proof}
          proving={proving}
          count={result.order.length}
          onProve={onProve}
        />
      )}

      <section className="grid items-start gap-5 lg:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-lg border border-hair bg-page p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-[13px] font-medium text-ink">Do next</h3>
              <p className="mt-1 text-[11px] text-ink-3">
                Actions in the order that unlocks the set.
              </p>
            </div>
            {result.surfaces.some(
              (surface) => localRepos.size && /^(apps|packages)\//.test(surface.name),
            ) ? (
              <Button variant="ghost" size="sm" onClick={onArchitecture}>
                Architecture <ArrowRight className="size-3.5" />
              </Button>
            ) : null}
          </div>
          <div className="mt-4 divide-y divide-hair border-y border-hair">
            {result.findings.map((finding, index) => (
              <div key={finding.title} className="grid grid-cols-[22px_minmax(0,1fr)] gap-3 py-3.5">
                <span className="tnum pt-0.5 text-[10px] text-ink-3">0{index + 1}</span>
                <div>
                  <p className="text-[12.5px] text-ink">{finding.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{finding.detail}</p>
                  {finding.files.length ? (
                    <p className="mt-2 truncate font-mono text-[10px] text-ink-3">
                      {finding.files.slice(0, 3).join(" · ")}
                      {finding.files.length > 3 ? ` · +${finding.files.length - 3}` : ""}
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-hair bg-page p-5">
          <h3 className="text-[13px] font-medium text-ink">Blast radius</h3>
          <div className="mt-4 space-y-3">
            {result.surfaces.slice(0, 6).map((surface) => (
              <div key={surface.name}>
                <div className="flex justify-between gap-3 text-[11px]">
                  <span className="truncate text-ink-2">{surface.name}</span>
                  <span className="tnum text-ink-3">
                    {surface.files} files · {surface.lines} lines
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raise">
                  <div
                    className="h-full bg-workspace"
                    style={{
                      width: `${Math.max(6, Math.min(100, (surface.lines / Math.max(1, result.lines)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function FutureBranch({
  stages,
  onOpen,
}: {
  stages: MergeSimulation["stages"];
  onOpen: (pull: MergeCandidate) => void;
}) {
  return (
    <div className="border-t border-hair px-6 py-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h3 className="text-[13px] font-medium text-ink">Future branch</h3>
        <p className="text-[10px] text-ink-3">main → proposed landing order</p>
      </div>
      <div className="overflow-x-auto pb-1 scrollbar-thin">
        <div className="flex min-w-max items-start">
          <div className="w-24 shrink-0 border-t-2 border-ink pt-3">
            <p className="font-mono text-[10px] text-ink-3">CURRENT</p>
            <p className="mt-1 text-[12px] font-medium text-ink">main</p>
            <p className="mt-2 text-[10px] text-ink-3">known good</p>
          </div>
          {stages.map((stage, index) => (
            <div key={stage.pull.id} className="flex items-start">
              <div className="mt-0.5 flex w-9 shrink-0 items-center gap-1 px-1">
                <span className="h-px flex-1 bg-hair" />
                <ArrowRight className="size-3 text-ink-3" />
              </div>
              <button
                type="button"
                onClick={() => onOpen(stage.pull)}
                className={cn(
                  "w-44 shrink-0 border-t-2 pt-3 text-left outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-workspace/40",
                  stage.state === "blocked"
                    ? "border-negative"
                    : stage.state === "attention"
                      ? "border-warning"
                      : "border-positive",
                )}
              >
                <span className="flex items-center justify-between gap-3 font-mono text-[10px] text-ink-3">
                  <span>STEP {String(index + 1).padStart(2, "0")}</span>
                  <span>#{stage.pull.number}</span>
                </span>
                <span className="mt-1.5 block truncate text-[12px] font-medium text-ink">
                  {stage.pull.title}
                </span>
                <span
                  className={cn(
                    "mt-2 block text-[10px] leading-relaxed text-ink-3",
                    stage.state === "blocked" && "text-negative",
                    stage.state === "attention" && "text-warning",
                  )}
                >
                  {stage.reason}
                </span>
                <span className="tnum mt-2 block text-[10px] text-ink-3">
                  {stage.files} files · {stage.lines} lines
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LocalProof({
  path,
  proof,
  proving,
  count,
  onProve,
}: {
  path: string | null;
  proof: LocalProofResult | null;
  proving: boolean;
  count: number;
  onProve: () => void;
}) {
  return (
    <section className="rounded-lg border border-hair bg-page p-5">
      <div className="flex items-start justify-between gap-5">
        <div className="flex min-w-0 gap-3">
          <GitMerge className="mt-0.5 size-4 shrink-0 text-ink-2" />
          <div>
            <h3 className="text-[13px] font-medium text-ink">Local proof</h3>
            {path ? (
              <p className="mt-1 max-w-[680px] text-[11px] leading-relaxed text-ink-3">
                Apply all {count} PRs in a disposable worktree from{" "}
                <span className="font-mono">{path}</span>. Your checkout and branches stay
                untouched.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-ink-3">
                Connect a local clone of this repository to prove the merge with Git.
              </p>
            )}
          </div>
        </div>
        <Button
          variant={proof ? "outline" : "default"}
          size="sm"
          disabled={!path || proving}
          onClick={onProve}
        >
          {proving ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <GitMerge className="size-3.5" />
          )}
          {proving ? "Building worktree" : proof ? "Run again" : "Prove locally"}
        </Button>
      </div>
      {proof ? (
        <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-hair bg-hair sm:grid-cols-3">
          <ProofMetric
            label="Git result"
            value={proof.clean ? "Clean" : "Conflict"}
            tone={proof.clean ? "positive" : "negative"}
          />
          <ProofMetric label="Applied" value={`${proof.applied.length}/${count} PRs`} />
          <ProofMetric label="Time" value={`${(proof.durationMs / 1000).toFixed(1)}s`} />
          {proof.conflicts.length ? (
            <div className="bg-page p-4 sm:col-span-3">
              <p className="text-[11px] text-ink-3">Files Git could not merge</p>
              <p className="mt-2 font-mono text-[11px] text-negative">
                {proof.conflicts.join(" · ")}
              </p>
            </div>
          ) : (
            <div className="bg-page p-4 sm:col-span-3">
              <p className="text-[11px] text-positive">
                All selected heads merged cleanly in isolation. The temporary worktree was removed.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ProofMetric({
  label,
  value,
  tone,
}: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="bg-page p-4">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p
        className={cn(
          "tnum mt-1 text-[17px] text-ink",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </p>
    </div>
  );
}
