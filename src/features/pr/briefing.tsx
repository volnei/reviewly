import { Button } from "@/components/ui/button";
import type * as S from "@/effect/schema";
import { age } from "@/features/list/row";
import type { Thread } from "@/features/pr/model";
import type { Draft } from "@/features/pr/thread";
import type { GuidedPlan, GuidedStep } from "@/lib/guided";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { useMemo } from "react";

export interface BriefingReach {
  readonly touched: ReadonlyArray<string>;
  readonly dependents: ReadonlyArray<string>;
  readonly crossings: number;
  readonly total: number;
}

interface ReviewBriefingProps {
  readonly pull: S.PullDetail;
  readonly files: ReadonlyArray<S.PullFile>;
  readonly plan: GuidedPlan | null;
  readonly planRunning: boolean;
  readonly reach: BriefingReach | null;
  readonly reviews: ReadonlyArray<S.Review>;
  readonly viewerLogin: string | null;
  readonly viewed: ReadonlySet<string>;
  readonly threads: ReadonlyArray<Thread>;
  readonly drafts: ReadonlyArray<Draft>;
  readonly checks: S.CheckRuns | undefined;
  readonly onGenerate: () => void;
  readonly onJumpStep: (index: number) => void;
  readonly onJumpFile: (path: string) => void;
  readonly onFinish?: () => void;
}

type Area = { name: string; files: S.PullFile[]; changes: number };

const areaName = (path: string): string => {
  const parts = path.split("/");
  if (parts[0] === "apps" || parts[0] === "packages" || parts[0] === "services")
    return parts[1] ?? parts[0];
  if (/migrations?|schema|database|prisma|sql/i.test(path)) return "Data";
  if (/tests?|specs?|__tests__|playwright|cypress/i.test(path)) return "Tests";
  if (/docs?|readme|changelog/i.test(path)) return "Docs";
  if (/\.github|infra|docker|terraform|scripts/i.test(path)) return "Operations";
  return parts[0] || "Root";
};

const filePriority = (file: S.PullFile): number => {
  const path = file.filename;
  if (/migrations?|schema|database|prisma|\.sql$/i.test(path)) return 0;
  if (/types?|contracts?|api|route|service|core/i.test(path)) return 1;
  if (/tests?|specs?|__tests__|playwright|cypress/i.test(path)) return 3;
  if (/lock|snapshot|generated|docs?|readme/i.test(path)) return 4;
  return 2;
};

const uniqueSteps = (steps: ReadonlyArray<GuidedStep>) => {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.path)) return false;
    seen.add(step.path);
    return true;
  });
};

const isGuidedStep = (item: GuidedStep | S.PullFile): item is GuidedStep => "path" in item;

const reviewWord = (state: string) =>
  state === "APPROVED"
    ? "approved"
    : state === "CHANGES_REQUESTED"
      ? "requested changes"
      : "commented";

export function ReviewBriefing({
  pull,
  files,
  plan,
  planRunning,
  reach,
  reviews,
  viewerLogin,
  viewed,
  threads,
  drafts,
  checks,
  onGenerate,
  onJumpStep,
  onJumpFile,
  onFinish,
}: ReviewBriefingProps) {
  const areas = useMemo(() => {
    const grouped = new Map<string, S.PullFile[]>();
    for (const file of files) {
      const name = areaName(file.filename);
      grouped.set(name, [...(grouped.get(name) ?? []), file]);
    }
    return [...grouped.entries()]
      .map(
        ([name, groupedFiles]): Area => ({
          name,
          files: groupedFiles,
          changes: groupedFiles.reduce((sum, file) => sum + file.changes, 0),
        }),
      )
      .sort((a, b) => b.changes - a.changes)
      .slice(0, 6);
  }, [files]);
  const totalChanges = Math.max(
    1,
    areas.reduce((sum, area) => sum + area.changes, 0),
  );
  const planFiles = plan ? uniqueSteps(plan.steps) : [];
  const fallbackFiles = [...files]
    .sort((a, b) => filePriority(a) - filePriority(b) || b.changes - a.changes)
    .slice(0, 4);
  const reading = planFiles.length ? planFiles.slice(0, 4) : fallbackFiles;
  const unresolved = threads.filter((thread) => !thread.resolved).length;
  const failing =
    checks?.check_runs.filter((run) =>
      ["failure", "timed_out", "cancelled", "action_required"].includes(run.conclusion ?? ""),
    ).length ?? 0;
  const pending = checks?.check_runs.filter((run) => run.status !== "completed").length ?? 0;
  const concerns = plan?.steps.filter((step) => step.kind === "concern").length ?? 0;
  const myReview = reviews
    .filter((review) => review.user.login === viewerLogin)
    .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""))[0];
  const read = files.filter((file) => viewed.has(file.filename)).length;
  const complete = files.length > 0 && read === files.length;
  const readiness = failing
    ? `${failing} failing check${failing === 1 ? "" : "s"}`
    : unresolved
      ? `${unresolved} unresolved thread${unresolved === 1 ? "" : "s"}`
      : pending
        ? `${pending} check${pending === 1 ? "" : "s"} still running`
        : complete
          ? "Ready for your decision"
          : `${files.length - read} file${files.length - read === 1 ? "" : "s"} left to read`;

  const summary =
    plan?.summary ||
    `This change moves through ${areas.length} ${areas.length === 1 ? "area" : "areas"}, led by ${areas[0]?.name ?? "the repository"}.`;

  return (
    <section className="review-briefing" aria-labelledby="review-briefing-title">
      <div className="review-briefing-lead">
        <div>
          <p className="review-briefing-eyebrow">Review briefing</p>
          <h2 id="review-briefing-title">{summary}</h2>
          <p>
            {plan?.tour ||
              `${files.length} files · ${pull.additions ?? 0} additions · ${pull.deletions ?? 0} deletions. Start with the structural decisions, then verify behavior and tests.`}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onGenerate} className="review-briefing-ai">
          <Sparkles className="size-3.5" aria-hidden />
          {planRunning ? "Building briefing…" : plan ? "Open guided review" : "Deepen with AI"}
        </Button>
      </div>

      <div className="review-change-map-block">
        <div className="review-change-map-heading">
          <span>Change map</span>
          <span className="tnum">
            {files.length} {files.length === 1 ? "file" : "files"} · {totalChanges.toLocaleString()}{" "}
            changed lines
          </span>
        </div>
        <div className="review-change-map" aria-label="Change map">
          {areas.map((area, index) => {
            const share = Math.max(1, Math.round((area.changes / totalChanges) * 100));
            const fileLabel = area.files.length === 1 ? "file" : "files";
            return (
              <button
                type="button"
                key={area.name}
                onClick={() => area.files[0] && onJumpFile(area.files[0].filename)}
                className={cn("review-change-area", `review-change-area-${(index % 4) + 1}`)}
                style={{ flex: `${Math.max(1, area.changes)} 1 0` }}
                aria-label={`${area.name}: ${area.files.length} ${fileLabel}, ${area.changes} changed lines, ${share}% of the change`}
              >
                <span className="review-change-mark" />
                <span className="review-change-name">
                  <strong>{area.name}</strong>
                  <span className="review-change-share tnum">{share}%</span>
                </span>
                <small>
                  <span>
                    {area.files.length} {fileLabel}
                  </span>
                  <span className="review-change-lines">
                    {" · "}
                    {area.changes.toLocaleString()} lines
                  </span>
                </small>
              </button>
            );
          })}
        </div>
      </div>

      <div className="review-briefing-grid">
        <section className="review-briefing-block">
          <header>
            <h3>Read in this order</h3>
            <span>{plan ? "guided" : "suggested"}</span>
          </header>
          <ol className="review-reading-order">
            {reading.map((item, index) => {
              const step = isGuidedStep(item) ? item : null;
              const path = isGuidedStep(item) ? item.path : item.filename;
              return (
                <li key={path}>
                  <button
                    type="button"
                    onClick={() =>
                      step ? onJumpStep(plan?.steps.indexOf(step) ?? 0) : onJumpFile(path)
                    }
                  >
                    <span className="tnum">{index + 1}</span>
                    <span>
                      <strong>{step?.title ?? path.split("/").pop()}</strong>
                      <small className="mono">{path}</small>
                    </span>
                    <ArrowRight className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="review-briefing-block">
          <header>
            <h3>Blast radius</h3>
            <span>{reach ? "from local graph" : "from changed paths"}</span>
          </header>
          {reach ? (
            <div className="review-blast">
              <p>
                <strong className="tnum">{reach.touched.length}</strong>
                <span>packages changed</span>
              </p>
              <p>
                <strong className="tnum">{reach.dependents.length}</strong>
                <span>dependent packages</span>
              </p>
              <p>
                <strong className="tnum">{reach.crossings}</strong>
                <span>boundary crossings</span>
              </p>
              <small>
                {reach.touched.slice(0, 4).join(" · ")}
                {reach.touched.length > 4 ? ` · +${reach.touched.length - 4}` : ""}
              </small>
            </div>
          ) : (
            <div className="review-blast-fallback">
              <strong>{areas.map((area) => area.name).join(" · ")}</strong>
              <span>Add the local clone to map package dependents and cross-boundary imports.</span>
            </div>
          )}
          <div className="review-signals">
            <span>{concerns} review concerns</span>
            <span>{failing} failing checks</span>
            <span>{unresolved} open threads</span>
          </div>
        </section>

        <section className="review-briefing-block review-memory">
          <header>
            <h3>Your memory</h3>
            <span>across visits</span>
          </header>
          {myReview ? (
            <>
              <p>
                You {reviewWord(myReview.state)} this PR
                {myReview.submitted_at ? ` ${age(myReview.submitted_at)} ago` : ""}.
              </p>
              {myReview.body ? <blockquote>{myReview.body.slice(0, 180)}</blockquote> : null}
            </>
          ) : read ? (
            <p>
              You have already read <strong>{read}</strong> of {files.length} files. Reviewly will
              resume from what remains.
            </p>
          ) : (
            <p>
              This is your first pass. Files, comments and your decision will be remembered here.
            </p>
          )}
        </section>
      </div>

      <footer className="review-briefing-finish">
        <div>
          <span className={cn("review-finish-state", !failing && !unresolved && "is-clear")}>
            {!failing && !unresolved ? <Check className="size-3.5" aria-hidden /> : null}
            {read}/{files.length} files read
          </span>
          <strong>{readiness}</strong>
          <small>
            {drafts.length ? `${drafts.length} draft comments ready` : "No draft comments yet"}
          </small>
        </div>
        {onFinish ? (
          <Button variant="outline" size="sm" onClick={onFinish}>
            Finish review <ArrowRight className="size-3.5" aria-hidden />
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
