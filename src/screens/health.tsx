import { ExternalLink, RefreshCw } from "lucide-react";
import { useMemo, useRef } from "react";

import { useTitleSlot } from "@/app/title-slot";
import { useWorkspace, useWorkspaceInbox } from "@/app/workspace";
import { Button } from "@/components/ui/button";
import { githubWebUrl } from "@/effect/services/Auth";
import type { DependabotRepositoryStatus } from "@/effect/services/Inbox";
import { compareRanked } from "@/effect/services/Triage";
import { applyFilter, FilterBar, isFiltering, useListFilter } from "@/features/list/filters";
import { FindingPeek } from "@/features/list/finding-peek";
import { List, ListHead, Nothing } from "@/features/list/list";
import { useKeepScroll } from "@/features/list/scroll";
import { useWorkspaceHealth, workspaceFindings } from "@/features/list/workspace";
import { safeOpenUrl } from "@/lib/ui";

import { RefreshButton, TitleSearch, useItemActions, useOpenItem } from "./inbox";

/** What the repositories say about themselves: advisories, and what the Turborepo workspaces on this machine report. */
export function HealthScreen() {
  const scope = useWorkspace();
  const root = useRef<HTMLDivElement>(null);
  useTitleSlot(
    <>
      <TitleSearch />
      <span className="flex-1" />
      <RefreshButton />
    </>,
    "desk",
  );
  const inbox = useWorkspaceInbox();
  useKeepScroll("health", root, !!inbox.data);
  const health = useWorkspaceHealth();
  const open = useOpenItem();
  const { done, snooze, snoozeFor, unsnooze } = useItemActions();
  const advisories = useMemo(
    () =>
      inbox.data
        ? [...inbox.data.turn, ...inbox.data.unsorted, ...inbox.data.later]
            .filter((i) => i.kind === "finding")
            .sort(compareRanked)
        : [],
    [inbox.data],
  );
  const workspace = useMemo(
    () =>
      workspaceFindings(health)
        .filter((i) => !scope || i.repo.toLowerCase() === scope.toLowerCase())
        .sort(compareRanked),
    [health, scope],
  );
  const dependabot = inbox.data?.dependabot ?? [];
  const checked = dependabot.filter((status) => status.state === "available").length;
  const unavailable = dependabot.length - checked;
  const [filter, setFilter] = useListFilter("health");
  const all = useMemo(() => [...advisories, ...workspace], [advisories, workspace]);
  const shownAdvisories = useMemo(() => applyFilter(advisories, filter), [advisories, filter]);
  const shownWorkspace = useMemo(() => applyFilter(workspace, filter), [workspace, filter]);
  return (
    <div
      ref={root}
      className="work-list screen-enter h-full overflow-y-auto bg-desk scrollbar-thin"
    >
      <ListHead title="Health">
        {inbox.data
          ? `${advisories.length} advisor${advisories.length === 1 ? "y" : "ies"}${workspace.length ? ` · ${workspace.length} from the workspaces on this machine` : ""}${dependabot.length ? ` · ${checked}/${dependabot.length} repositories checked` : ""}.`
          : "Scanning…"}
      </ListHead>
      {inbox.data && dependabot.length ? (
        <DependabotCoverage statuses={dependabot} retry={() => void inbox.refetch()} />
      ) : null}
      {inbox.data ? (
        <FilterBar
          id="health"
          items={all}
          filter={filter}
          set={setFilter}
          show={{ repos: true, severities: true }}
        />
      ) : null}
      {inbox.data ? (
        <List
          label="Health"
          sections={[
            { key: "advisories", items: shownAdvisories },
            {
              key: "workspace",
              items: shownWorkspace,
              head: shownWorkspace.length ? (
                <p className="text-[12.5px] text-ink-3">From the Turborepo workspaces in Local.</p>
              ) : undefined,
            },
          ]}
          actions={{ open, done, snooze, snoozeFor, unsnooze }}
          renderPeek={(it) => <FindingPeek item={it} />}
          openInline
          empty={
            isFiltering(filter) ? (
              <Nothing detail="Try removing a severity or repository filter.">
                No findings match this view
              </Nothing>
            ) : (
              <Nothing
                detail={
                  unavailable
                    ? "No visible findings. Some repositories could not be checked; their status is shown above."
                    : "Reviewly will surface new advisories and workspace risks here."
                }
              >
                {unavailable ? "No visible findings" : "Your watched repositories look clear"}
              </Nothing>
            )
          }
        />
      ) : null}
    </div>
  );
}

const STATUS: Record<
  DependabotRepositoryStatus["state"],
  { label: string; detail: (status: DependabotRepositoryStatus) => string }
> = {
  available: {
    label: "Checked",
    detail: (status) =>
      status.alertCount
        ? `${status.alertCount} open alert${status.alertCount === 1 ? "" : "s"}`
        : "No open alerts",
  },
  disabled: {
    label: "Disabled",
    detail: () => "Turn on Dependabot alerts in the repository security settings.",
  },
  forbidden: {
    label: "No access",
    detail: () => "Admin or security access is required to inspect these alerts.",
  },
  error: {
    label: "Unavailable",
    detail: () => "GitHub did not return this repository’s security alerts.",
  },
};

function DependabotCoverage({
  statuses,
  retry,
}: {
  statuses: ReadonlyArray<DependabotRepositoryStatus>;
  retry: () => void;
}) {
  const unavailable = statuses.filter((status) => status.state !== "available").length;
  return (
    <section className="health-coverage" aria-labelledby="dependabot-coverage-title">
      <header className="health-coverage-head">
        <div>
          <h2 id="dependabot-coverage-title">Dependabot coverage</h2>
          <p>
            {unavailable
              ? `${unavailable} repositor${unavailable === 1 ? "y needs" : "ies need"} attention before Health is complete.`
              : `All ${statuses.length} repositories were checked.`}
          </p>
        </div>
        {unavailable ? (
          <Button variant="ghost" size="sm" onClick={retry}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        ) : null}
      </header>
      <ul className="health-coverage-list">
        {statuses.map((status) => {
          const copy = STATUS[status.state];
          return (
            <li key={status.repo}>
              <span className={`health-coverage-mark is-${status.state}`} aria-hidden="true" />
              <span className="health-coverage-repo">{status.repo}</span>
              <span className="health-coverage-detail">{copy.detail(status)}</span>
              <span className={`health-coverage-state is-${status.state}`}>{copy.label}</span>
              {status.state === "disabled" ? (
                <button
                  type="button"
                  className="health-coverage-action"
                  onClick={() =>
                    safeOpenUrl(githubWebUrl(`${status.repo}/settings/security_analysis`))
                  }
                >
                  Enable on GitHub
                  <ExternalLink className="size-3" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
