import { toast } from "@/app/toast";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { describeError, describeRecovery } from "@/effect/errors";
import { run, useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import {
  Check,
  ChevronRight,
  CircleMinus,
  Clock3,
  ExternalLink,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CHECK_LABEL, checkDuration, checkState, groupChecks } from "./checks-model";
import { Markdown } from "./markdown";
import { Section } from "./section";

const isFailed = (r: S.CheckRun) => checkState(r) === "failed";

/** Which Actions scope a check run lives in, read off its URL. */
function scope(r: S.CheckRun): { jobId?: number; runId?: number } {
  const url = r.details_url ?? r.html_url;
  const job = url.match(/\/actions\/runs\/(\d+)\/jobs?\/(\d+)/);
  if (job) return { runId: Number(job[1]), jobId: Number(job[2]) };
  const run = url.match(/\/actions\/runs\/(\d+)/);
  return run ? { runId: Number(run[1]) } : {};
}

function durationText(r: S.CheckRun): string {
  return durationTextAt(r, Date.now());
}

function durationTextAt(r: S.CheckRun, now: number): string {
  const measured = checkDuration(r);
  const started = r.started_at ? Date.parse(r.started_at) : Number.NaN;
  const ms =
    measured ??
    (r.status !== "completed" && Number.isFinite(started) ? Math.max(0, now - started) : null);
  if (ms == null) return r.status !== "completed" ? "Starting…" : "—";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatusIcon({ run }: { run: S.CheckRun }) {
  const state = checkState(run);
  const Icon =
    state === "passed"
      ? Check
      : state === "failed"
        ? X
        : state === "running"
          ? Clock3
          : CircleMinus;
  return (
    <span className={`check-status check-status-${state}`} title={CHECK_LABEL[state]}>
      <Icon size={13} aria-hidden />
      <span className="sr-only">{CHECK_LABEL[state]}</span>
    </span>
  );
}

/**
 * One line, folded: every check on the head commit. Red only when a *required*
 * check failed; optional failures say so instead of shouting. Each row carries
 * its duration on one shared axis and a re-run that goes as narrow as it can.
 */
export function ChecksSection({
  prRef,
  runs,
  onJump,
  expanded = false,
  error,
  refreshing = false,
  onRetry,
}: {
  expanded?: boolean;
  prRef: PrRef;
  runs: ReadonlyArray<S.CheckRun> | undefined;
  error?: unknown;
  refreshing?: boolean;
  onRetry?: () => void;
  /** Jump to a line a check pointed at, when that file is in the diff. */
  onJump?: (path: string, line: number) => void;
}) {
  const required = useEffectQuery(
    ["required-checks", prRef.owner, prRef.repo, prRef.number],
    Effect.flatMap(GitHub, (g) => g.requiredContexts(prRef)),
    { staleTime: 10 * 60_000 },
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "attention" | "required">("all");
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());
  const req = new Set(required.data ?? []);
  const list = runs ?? [];
  const counts = { failed: 0, running: 0, passed: 0, skipped: 0, cancelled: 0, other: 0 };
  for (const r of list) counts[checkState(r)]++;
  useEffect(() => {
    if (!counts.running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [counts.running]);
  const completed = list.filter((r) => r.status === "completed").length;
  const progress = list.length ? Math.round((completed / list.length) * 100) : 0;
  const visible = list.filter(
    (r) =>
      r.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter !== "attention" || checkState(r) === "failed" || checkState(r) === "running") &&
      (filter !== "required" || req.has(r.name)),
  );
  const groups = groupChecks(visible);
  const row = (r: S.CheckRun) => (
    <CheckRow
      key={r.id}
      r={r}
      prRef={prRef}
      required={req.has(r.name)}
      onJump={onJump}
      now={now}
    />
  );
  const content = (
    <div className="checks-v2">
      <header className="checks-heading">
        <div>
          <h2>Checks</h2>
          <p>
            {error && runs === undefined
              ? "GitHub checks are temporarily unavailable."
              : runs === undefined
                ? "Loading check runs…"
                : !list.length
                  ? "No checks reported for this commit."
                  : counts.failed
                    ? `${counts.failed} failed check${counts.failed === 1 ? " needs" : "s need"} a look.`
                    : counts.running
                      ? "Checks are still running."
                      : counts.passed === list.length
                        ? "All checks passed."
                        : "No failures. See individual results below."}
          </p>
        </div>
        <span className="checks-total">{refreshing ? "Refreshing…" : `${list.length} total`}</span>
      </header>
      {counts.running ? (
        <div className="checks-live" aria-live="polite">
          <div className="checks-live-copy">
            <span className="checks-live-dot" aria-hidden />
            <strong>CI is running</strong>
            <span>
              {completed} of {list.length} finished · {counts.running} active
            </span>
            <span className="checks-live-percent tnum">{progress}%</span>
          </div>
          <div
            className="checks-live-track"
            role="progressbar"
            aria-label="CI progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="checks-recovery" role="alert">
          <div>
            <strong>{describeError(error)}</strong>
            <p>{describeRecovery(error)}</p>
            {list.length ? <small>Showing the last check results we received.</small> : null}
          </div>
          {onRetry ? (
            <Button variant="outline" size="sm" type="button" onClick={onRetry}>
              <RotateCw className={cn("size-3.5", refreshing && "animate-spin")} />
              Retry now
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="checks-summary">
        {(["failed", "running", "passed", "skipped", "cancelled", "other"] as const)
          .filter((state) => counts[state] > 0)
          .map((state) => (
            <span key={state} className={`check-count check-count-${state}`}>
              <b>{counts[state]}</b> {CHECK_LABEL[state].toLowerCase()}
            </span>
          ))}
      </div>
      <div className="checks-tools">
        <div className="checks-filters" aria-label="Filter checks">
          {(
            [
              ["all", "All"],
              ["attention", "Needs attention"],
              ...(required.data?.length ? [["required", "Required"]] : []),
            ] as Array<[typeof filter, string]>
          ).map(([value, label]) => (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="checks-search">
          <Search size={13} aria-hidden />
          <input
            aria-label="Search checks"
            placeholder="Find a check…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      {required.isError ? (
        <p className="checks-hint">
          Required-check information is unavailable.{" "}
          <button type="button" onClick={() => void required.refetch()}>
            Retry
          </button>
        </p>
      ) : null}
      <div className="checks-columns" aria-hidden>
        <span>Check / suite</span>
        <span>Duration</span>
        <span />
      </div>
      <div className="checks-results">
        {groups.map((group) => {
          if (group.runs.length === 1) return <ul key={group.key}>{row(group.runs[0])}</ul>;
          const open = folds[group.key] ?? (group.attention || !!query || filter !== "all");
          const passed = group.runs.filter((r) => checkState(r) === "passed").length;
          const failed = group.runs.filter(isFailed).length;
          const running = group.runs.filter((r) => checkState(r) === "running").length;
          const requiredCount = group.runs.filter((r) => req.has(r.name)).length;
          return (
            <div className="check-suite" key={group.key}>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                className="check-suite-toggle"
                aria-expanded={open}
                onClick={() => setFolds((prev) => ({ ...prev, [group.key]: !open }))}
              >
                <ChevronRight size={14} className={open ? "rotate-90" : ""} />
                <StatusIcon run={group.runs[0]} />
                <span className="check-suite-name">{group.label}</span>
                <span className="check-suite-count">{group.runs.length} jobs</span>
                {requiredCount ? (
                  <span className="check-required">{requiredCount} required</span>
                ) : null}
                <span className="check-suite-summary">
                  {[
                    failed ? `${failed} failed` : "",
                    running ? `${running} running` : "",
                    passed ? `${passed} passed` : "",
                    group.runs.length - failed - running - passed
                      ? `${group.runs.length - failed - running - passed} other`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Button>
              {open ? <ul className="check-suite-rows">{group.runs.map(row)}</ul> : null}
            </div>
          );
        })}
      </div>
      {runs !== undefined && !visible.length && list.length > 0 ? (
        <p className="checks-empty">No checks match this view.</p>
      ) : null}
    </div>
  );
  return expanded ? (
    content
  ) : (
    <Section
      title={`${list.length} checks · ${counts.failed ? `${counts.failed} failed` : counts.running ? `${counts.running} running` : counts.passed === list.length && list.length ? "all passed" : "results"}`}
    >
      {content}
    </Section>
  );
}

function CheckRow({
  r,
  prRef,
  required,
  onJump,
  now,
}: {
  r: S.CheckRun;
  prRef: PrRef;
  required: boolean;
  onJump?: (path: string, line: number) => void;
  now: number;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  useEffect(() => {
    if (r.status !== "completed") setQueued(false);
  }, [r.status]);
  const failed = isFailed(r);
  const running = r.status !== "completed";
  const ann = useEffectQuery(
    ["annotations", prRef.owner, prRef.repo, r.id],
    Effect.flatMap(GitHub, (g) => g.annotations(prRef.owner, prRef.repo, r.id)),
    { enabled: open && r.status === "completed", staleTime: 60_000 },
  );
  const jobId = scope(r).jobId;
  const job = useEffectQuery(
    ["actions-job", prRef.owner, prRef.repo, jobId ?? 0],
    Effect.flatMap(GitHub, (g) => g.actionsJob(prRef.owner, prRef.repo, jobId ?? 0)),
    {
      enabled: open && !!jobId,
      staleTime: 1_500,
      refetchInterval: (query) =>
        query.state.data && query.state.data.status !== "completed" ? 2_500 : false,
    },
  );
  const expandable = failed || !!r.output?.summary || !!jobId;

  // Re-run as narrowly as the check allows, never the whole suite: one Actions
  // job; else that run's failed jobs; else the single check.
  const rerun = async () => {
    if (queued || rerunning) return;
    setRerunning(true);
    const s = scope(r);
    try {
      await run(
        Effect.flatMap(GitHub, (g) =>
          s.jobId
            ? g.rerunJob(prRef.owner, prRef.repo, s.jobId)
            : s.runId
              ? g.rerunFailedJobs(prRef.owner, prRef.repo, s.runId)
              : g.rerunCheck(prRef.owner, prRef.repo, r.id),
        ),
      );
      setQueued(true);
      toast.say(`Re-run queued for ${r.name}`);
      for (const delay of [1_500, 5_000, 12_000])
        setTimeout(
          () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("checks") }),
          delay,
        );
    } catch (e) {
      toast.fail(`Couldn’t re-run ${r.name}`, e);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <li className={cn("check-result", running && "check-result-running")}>
      <div className="check-result-line">
        <StatusIcon run={r} />
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          onClick={() => expandable && setOpen((o) => !o)}
          className={cn("check-result-name", failed && "text-ink")}
          title={r.name}
        >
          <span>{r.name}</span>
          {running ? <span className="check-running-label">Live</span> : null}
          {required ? <span className="check-required">Required</span> : null}
          {expandable ? (
            <ChevronRight size={12} className={open ? "rotate-90 shrink-0" : "shrink-0"} />
          ) : null}
        </Button>
        <span className="check-duration tnum" title={CHECK_LABEL[checkState(r)]}>
          {r.status === "completed" ? durationText(r) : durationTextAt(r, now)}
        </span>
        <div className="check-row-actions">
          {r.status === "completed" ? (
            <IconButton
              label={queued ? `Re-run queued for ${r.name}` : `Re-run ${r.name}`}
              disabled={queued || rerunning}
              onClick={rerun}
            >
              <RotateCw className={cn("size-3.5", rerunning && "animate-spin")} />
            </IconButton>
          ) : null}
          <IconButton
            label={`Open ${r.name} on GitHub`}
            onClick={() => safeOpenUrl(r.details_url ?? r.html_url)}
          >
            <ExternalLink className="size-3.5" />
          </IconButton>
        </div>
      </div>
      {running && !open ? <span className="check-running-line" aria-hidden /> : null}
      {open ? (
        <div className="check-result-detail">
          {r.status !== "completed" && jobId ? (
            <LiveJobProgress job={job.data} fetching={job.isFetching} />
          ) : null}
          {r.output?.summary ? (
            <Markdown className="text-ink-2">{r.output.summary}</Markdown>
          ) : null}
          {r.output?.text && r.output.text !== r.output.summary ? (
            <Markdown className="mt-2 text-ink-2">{r.output.text}</Markdown>
          ) : null}
          {job.data?.steps?.length ? (
            <ol
              className={cn(
                "check-result-steps grid gap-0.5",
                (r.output?.summary || r.output?.text) && "mt-2",
              )}
            >
              {job.data.steps.map((st) => {
                const ms =
                  st.started_at && st.completed_at
                    ? Date.parse(st.completed_at) - Date.parse(st.started_at)
                    : null;
                const bad = st.conclusion === "failure" || st.conclusion === "timed_out";
                return (
                  <li
                    key={st.number}
                    className="grid min-w-0 grid-cols-[14px_minmax(0,1fr)_56px] items-center gap-2"
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        st.status !== "completed"
                          ? "animate-pulse bg-ink-3"
                          : st.conclusion === "success"
                            ? "bg-add"
                            : bad
                              ? "bg-del"
                              : "bg-ink-3",
                      )}
                    />
                    <span className={cn("truncate", bad ? "text-ink" : "text-ink-2")}>
                      {st.name}
                      {st.conclusion && st.conclusion !== "success" && !bad ? (
                        <span className="ml-2 text-ink-3">{st.conclusion}</span>
                      ) : null}
                    </span>
                    <span className="tnum text-right text-ink-3">
                      {ms == null
                        ? ""
                        : ms < 60_000
                          ? `${Math.round(ms / 1000)}s`
                          : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : job.isPending && jobId ? (
            <p className="text-ink-3">Loading the steps…</p>
          ) : job.isError && jobId ? (
            <p className="checks-hint">
              Couldn’t load the job steps.{" "}
              <button type="button" onClick={() => void job.refetch()}>
                Retry
              </button>
            </p>
          ) : null}
          {ann.isPending ? <p className="text-ink-3">Loading what it said…</p> : null}
          {ann.data?.length ? (
            <ul className={cn("check-result-annotations grid gap-1", r.output?.summary && "mt-2")}>
              {ann.data.map((a, i) => (
                <li key={`${a.path}:${a.start_line}:${i}`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onJump?.(a.path, a.start_line)}
                    className="min-w-0 max-w-full whitespace-normal text-left hover:text-ink"
                  >
                    <span className="mono text-ink-3">
                      {a.path}:{a.start_line}
                    </span>{" "}
                    <span className={a.annotation_level === "failure" ? "text-ink" : "text-ink-2"}>
                      {a.title ? `${a.title} — ` : ""}
                      {a.message}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {ann.data && !ann.data.length && !r.output?.summary ? (
            <p className="text-ink-3">The check didn’t say where.</p>
          ) : null}
          {ann.isError ? (
            <p className="checks-hint">
              Couldn’t load failure annotations.{" "}
              <button type="button" onClick={() => void ann.refetch()}>
                Retry
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LiveJobProgress({
  job,
  fetching,
}: {
  job: S.ActionsJob | undefined;
  fetching: boolean;
}) {
  const steps = job?.steps ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const active = steps.find((step) => step.status !== "completed");
  const progress = steps.length ? Math.round((completed / steps.length) * 100) : 0;
  return (
    <div className="check-job-live" aria-live="polite">
      <div className="check-job-live-copy">
        <span className="checks-live-dot" aria-hidden />
        <strong>{active?.name ?? (steps.length ? "Finishing the job…" : "Starting the job…")}</strong>
        <span className="tnum">
          {steps.length ? `${completed}/${steps.length} steps` : "Waiting for steps"}
        </span>
        {fetching ? <RotateCw className="size-3 animate-spin" aria-label="Refreshing" /> : null}
      </div>
      <div
        className="check-job-live-track"
        role="progressbar"
        aria-label="Job progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
