import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitMerge,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { settingsCategoryStore } from "@/app/settings-navigation";
import { useTeamsPlan } from "@/app/teams-billing";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { run, useEffectQuery } from "@/effect/runtime";
import type { TeamPull, TeamQueueUpdate, TeamsInbox } from "@/effect/schema";
import { Teams, useTeams } from "@/effect/services/Teams";
import { age } from "@/features/list/row";
import { cn } from "@/lib/utils";

type QueueFilter = "unclaimed" | "mine" | "at-risk" | "all";

const NEXT_ACTIONS: ReadonlyArray<{ value: TeamPull["nextAction"]; label: string }> = [
  { value: "review", label: "Reviewer" },
  { value: "author", label: "Author" },
  { value: "ci", label: "CI" },
  { value: "conflict", label: "Conflict" },
  { value: "approval", label: "Approval" },
  { value: "merge", label: "Merge" },
];

const PRIORITIES: ReadonlyArray<{ value: TeamPull["priority"]; label: string }> = [
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function isAtRisk(pull: TeamPull, now = Date.now()): boolean {
  if (pull.priority === "urgent") return true;
  if (!pull.slaDueAt) return false;
  return Date.parse(pull.slaDueAt) - now < 2 * 60 * 60 * 1000;
}

function slaLabel(iso: string | null): { label: string; tone: string } {
  if (!iso) return { label: "Not started", tone: "text-ink-3" };
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (minutes < 0) {
    const overdue = Math.abs(minutes);
    return {
      label: `${overdue < 60 ? `${overdue}m` : `${Math.round(overdue / 60)}h`} overdue`,
      tone: "text-destructive-foreground",
    };
  }
  return {
    label: `${minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`} left`,
    tone: minutes < 120 ? "text-amber" : "text-ink-2",
  };
}

export function TeamScreen() {
  const teams = useTeams();
  const teamsPlan = useTeamsPlan();
  const [organizationId, setOrganizationId] = useState(teams.organizations[0]?.id ?? "");
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [pending, setPending] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!teams.organizations.some((organization) => organization.id === organizationId)) {
      setOrganizationId(teams.organizations[0]?.id ?? "");
    }
  }, [organizationId, teams.organizations]);

  const queryKey = ["teams", "queue", organizationId] as const;
  const queue = useEffectQuery(
    queryKey,
    Effect.flatMap(Teams, (service) => service.inbox(organizationId)),
    { enabled: teamsPlan === "teams" && !!organizationId, staleTime: 15_000 },
  );

  useTitleSlot(
    <>
      <span className="text-[12px] text-ink-3">Shared review ownership</span>
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Refresh team queue"
        onClick={() => void queue.refetch()}
      >
        <RefreshCw className={cn("size-3.5", queue.isFetching && "animate-spin")} />
      </Button>
    </>,
    "desk",
  );

  const update = async (pull: TeamPull, change: Omit<TeamQueueUpdate, "pullRequestId">) => {
    if (!organizationId || pending) return;
    const key = `${pull.id}:${Object.keys(change)[0] ?? "queue"}`;
    setPending(key);
    const previous = queryClient.getQueryData<TeamsInbox>(queryKey);
    if (previous) {
      queryClient.setQueryData<TeamsInbox>(queryKey, {
        ...previous,
        pulls: previous.pulls.map((item) => {
          if (item.id !== pull.id) return item;
          const assigneeId = change.assigneeUserId;
          return {
            ...item,
            ...(change.priority !== undefined ? { priority: change.priority } : {}),
            ...(change.nextAction ? { nextAction: change.nextAction } : {}),
            ...(change.slaDueAt !== undefined ? { slaDueAt: change.slaDueAt } : {}),
            ...(assigneeId !== undefined
              ? {
                  claimedByUserId: assigneeId,
                  claimedByLogin:
                    previous.members.find((member) => member.id === assigneeId)?.login ?? null,
                  claimedAt: assigneeId ? new Date().toISOString() : null,
                }
              : {}),
          };
        }),
      });
    }
    try {
      await run(
        Effect.flatMap(Teams, (service) =>
          service.updateQueue(organizationId, { pullRequestId: pull.id, ...change }),
        ),
      );
      void queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      if (previous) queryClient.setQueryData(queryKey, previous);
      toast.fail("Couldn’t update the team queue", error);
    } finally {
      setPending(null);
    }
  };

  const data = queue.data;
  const counts = useMemo(() => {
    const pulls = data?.pulls ?? [];
    return {
      all: pulls.length,
      unclaimed: pulls.filter((pull) => !pull.claimedByUserId).length,
      mine: pulls.filter((pull) => pull.claimedByUserId === data?.currentUserId).length,
      atRisk: pulls.filter((pull) => isAtRisk(pull)).length,
    };
  }, [data]);
  const visible = useMemo(() => {
    const pulls = data?.pulls ?? [];
    if (filter === "unclaimed") return pulls.filter((pull) => !pull.claimedByUserId);
    if (filter === "mine") {
      return pulls.filter((pull) => pull.claimedByUserId === data?.currentUserId);
    }
    if (filter === "at-risk") return pulls.filter((pull) => isAtRisk(pull));
    return pulls;
  }, [data, filter]);
  const finding = counts.unclaimed
    ? `${counts.unclaimed} ${counts.unclaimed === 1 ? "review has" : "reviews have"} no owner.`
    : counts.atRisk
      ? `${counts.atRisk} ${counts.atRisk === 1 ? "review is" : "reviews are"} close to or past SLA.`
      : "Every open review has an owner.";

  if (teamsPlan === null) {
    return (
      <div className="team-gate-loading h-full bg-desk p-8 text-ink" role="status">
        <span className="sr-only">Checking your Teams plan</span>
        <div className="h-3 w-24 rounded-sm bg-raise" />
        <div className="mt-4 h-7 w-72 max-w-full rounded-sm bg-raise" />
        <div className="mt-3 h-3 w-[420px] max-w-full rounded-sm bg-raise" />
        <div className="mt-10 h-44 max-w-[860px] rounded-lg border border-hair bg-page" />
      </div>
    );
  }

  if (teamsPlan === "hobby") {
    return (
      <div className="team-gate h-full overflow-y-auto bg-desk text-ink scrollbar-thin">
        <header className="team-gate-header">
          <p>Reviewly Teams</p>
          <h1>One queue. Clear ownership.</h1>
          <span>
            Coordinate reviews across your GitHub organization without moving source code or diffs
            to another workspace.
          </span>
        </header>

        <div className="team-gate-surface">
          <section className="team-gate-capabilities" aria-label="Teams capabilities">
            <TeamGateCapability
              icon={UsersRound}
              title="A shared review queue"
              detail="See every open review, who owns it and what needs to happen next."
            />
            <TeamGateCapability
              icon={Clock3}
              title="Priorities and SLAs"
              detail="Surface work at risk before a review quietly becomes a blocker."
            />
            <TeamGateCapability
              icon={ShieldCheck}
              title="Metadata only"
              detail="Repository source and diffs stay in GitHub and on each reviewer’s Mac."
            />
          </section>

          <aside className="team-gate-plan" aria-label="Reviewly Teams plan">
            <div>
              <p>Teams plan</p>
              <div className="team-gate-price">
                <strong>$8</strong>
                <span>
                  per member
                  <br />
                  each month
                </span>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => {
                settingsCategoryStore.set("teams");
                void navigate({ to: "/settings" });
              }}
            >
              Set up your team
            </Button>
            <span>Connect a GitHub organization, then subscribe securely with Stripe.</span>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-desk px-4 py-6 text-ink scrollbar-thin sm:px-7">
      <header className="flex items-start justify-between gap-5">
        <div>
          <h1 className="text-[24px] font-semibold tracking-[-0.015em]">Team queue</h1>
          <p className="mt-1 text-[13px] text-ink-2">{finding}</p>
        </div>
        {teams.organizations.length > 1 ? (
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span>Workspace</span>
            <Select
              value={organizationId}
              onValueChange={(value) => value !== null && setOrganizationId(value)}
            >
              <SelectTrigger
                aria-label="Workspace"
                size="sm"
                className="min-w-0 border-0 bg-transparent px-2 text-ink shadow-none hover:bg-raise/55 dark:bg-transparent"
              >
                <SelectValue>
                  {teams.organizations.find((organization) => organization.id === organizationId)
                    ?.display_name ??
                    teams.organizations.find((organization) => organization.id === organizationId)
                      ?.login}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {teams.organizations.map((organization) => (
                  <SelectItem key={organization.id} value={organization.id}>
                    {organization.display_name ?? organization.login}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        ) : (
          <span className="text-[12px] text-ink-3">
            {teams.organizations[0]?.display_name ?? teams.organizations[0]?.login}
          </span>
        )}
      </header>

      {data ? (
        <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-lg bg-page sm:grid-cols-4">
          <Metric
            label="Open reviews"
            value={counts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <Metric
            label="Without owner"
            value={counts.unclaimed}
            active={filter === "unclaimed"}
            onClick={() => setFilter("unclaimed")}
          />
          <Metric
            label="Claimed by you"
            value={counts.mine}
            active={filter === "mine"}
            onClick={() => setFilter("mine")}
          />
          <Metric
            label="At risk"
            value={counts.atRisk}
            active={filter === "at-risk"}
            onClick={() => setFilter("at-risk")}
            tone={counts.atRisk ? "text-amber" : undefined}
          />
        </div>
      ) : null}

      <section className="mt-6" aria-label="Pull requests in the team queue">
        {queue.isPending ? (
          <QueueLoading />
        ) : queue.isError ? (
          <div className="rounded-lg bg-page px-5 py-6">
            <p className="text-[14px] font-medium">The shared queue couldn’t load.</p>
            <p className="mt-1 text-[12px] text-ink-3">
              The workspace may still need an active Teams subscription.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void queue.refetch()}>
                Try again
              </Button>
              <Button variant="ghost" size="sm" render={<Link to="/settings" />}>
                Open Teams settings
              </Button>
            </div>
          </div>
        ) : visible.length ? (
          <div className="overflow-hidden rounded-lg bg-page">
            <div className="hidden grid-cols-[minmax(200px,1fr)_110px_100px_110px] items-center gap-3 px-4 py-2.5 text-[11px] text-ink-3 sm:grid xl:grid-cols-[minmax(260px,1fr)_145px_112px_96px_92px]">
              <span>Pull request</span>
              <span>Owner</span>
              <span>Next action</span>
              <span className="xl:hidden">Priority · SLA</span>
              <span className="hidden xl:block">Priority</span>
              <span className="hidden text-right xl:block">SLA</span>
            </div>
            {visible.map((pull) => (
              <QueueRow
                key={pull.id}
                pull={pull}
                data={data!}
                pending={pending?.startsWith(`${pull.id}:`) ?? false}
                onOpen={() => {
                  const [owner, repo] = pull.repository.split("/");
                  if (owner && repo) {
                    void navigate({
                      to: "/pr/$owner/$repo/$number",
                      params: { owner, repo, number: String(pull.number) },
                    });
                  }
                }}
                onUpdate={(change) => void update(pull, change)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-page px-5 py-8 text-center">
            <CheckCircle2 className="mx-auto size-5 text-add" strokeWidth={1.75} />
            <p className="mt-3 text-[14px] font-medium">Nothing in this view</p>
            <p className="mt-1 text-[12px] text-ink-3">
              {filter === "all"
                ? "The next open pull request will appear here."
                : "Choose another queue above."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function TeamGateCapability({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof UsersRound;
  title: string;
  detail: string;
}) {
  return (
    <div className="team-gate-capability">
      <Icon aria-hidden strokeWidth={1.6} />
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  active,
  onClick,
  tone,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border-r border-hair px-4 py-3.5 text-left last:border-r-0 hover:bg-raise/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink-3",
        active && "bg-raise/55",
      )}
    >
      <span className="block text-[12px] text-ink-3">{label}</span>
      <span className={cn("tnum mt-1 block text-[24px] leading-none", tone)}>{value}</span>
    </button>
  );
}

function QueueRow({
  pull,
  data,
  pending,
  onOpen,
  onUpdate,
}: {
  pull: TeamPull;
  data: TeamsInbox;
  pending: boolean;
  onOpen: () => void;
  onUpdate: (update: Omit<TeamQueueUpdate, "pullRequestId">) => void;
}) {
  const sla = slaLabel(pull.slaDueAt);
  const mine = pull.claimedByUserId === data.currentUserId;
  const me = data.members.find((member) => member.id === data.currentUserId);
  const currentMembership = data.members.find((member) => member.id === data.currentUserId);
  const canTransfer = currentMembership?.role === "owner" || currentMembership?.role === "admin";
  const StatusIcon =
    pull.nextAction === "conflict"
      ? GitMerge
      : pull.nextAction === "ci"
        ? AlertTriangle
        : pull.nextAction === "merge"
          ? CheckCircle2
          : CircleDot;

  return (
    <div className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-hair px-4 py-3 text-[12px] first:border-t-0 sm:grid-cols-[minmax(200px,1fr)_110px_100px_110px] sm:gap-y-3 sm:py-2.5 xl:grid-cols-[minmax(260px,1fr)_145px_112px_96px_92px]">
      <button
        type="button"
        onClick={onOpen}
        className="group col-span-2 min-w-0 text-left sm:col-span-1"
      >
        <span className="block truncate text-[13px] font-medium text-ink group-hover:underline">
          {pull.title ?? `${pull.repository} #${pull.number}`}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
          <span className="truncate">{pull.repository}</span>
          <span className="tnum">#{pull.number}</span>
          {pull.authorLogin ? <span className="truncate">{pull.authorLogin}</span> : null}
          <span>{age(pull.updatedAt)}</span>
        </span>
      </button>

      {pull.claimedByUserId && (mine || canTransfer) ? (
        <Select
          disabled={pending}
          value={pull.claimedByUserId}
          onValueChange={(value) => onUpdate({ assigneeUserId: value || null })}
        >
          <SelectTrigger
            aria-label={`Owner of pull request ${pull.number}`}
            size="sm"
            className="min-w-0 border-0 bg-transparent px-1.5 text-ink-2 shadow-none hover:bg-raise/55 dark:bg-transparent"
          >
            <UserRoundCheck className="size-3.5 text-ink-3" strokeWidth={1.75} />
            <SelectValue>{pull.claimedByLogin ?? me?.login ?? "Owner"}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value="">Unassigned</SelectItem>
            {(canTransfer
              ? data.members
              : data.members.filter((member) => member.id === data.currentUserId)
            ).map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.login}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : pull.claimedByLogin ? (
        <span className="truncate text-ink-2">{pull.claimedByLogin}</span>
      ) : (
        <button
          type="button"
          disabled={pending || !me}
          onClick={() => me && onUpdate({ assigneeUserId: me.id })}
          className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md border border-edge px-2 text-[11.5px] text-ink hover:border-ink-3 disabled:opacity-50"
        >
          <UserRoundCheck className="size-3.5" strokeWidth={1.75} />
          Claim
        </button>
      )}

      <div className="relative flex min-w-0 items-center">
        <StatusIcon
          className={cn(
            "pointer-events-none absolute left-2 size-3.5",
            pull.nextAction === "ci" || pull.nextAction === "conflict"
              ? "text-del"
              : pull.nextAction === "merge"
                ? "text-add"
                : "text-ink-3",
          )}
          strokeWidth={1.75}
        />
        <Select
          disabled={pending}
          value={pull.nextAction}
          onValueChange={(value) =>
            value !== null && onUpdate({ nextAction: value as TeamPull["nextAction"] })
          }
        >
          <SelectTrigger
            aria-label={`Next action for pull request ${pull.number}`}
            size="sm"
            className="min-w-0 border-0 bg-transparent pl-7 pr-1 text-ink-2 shadow-none hover:bg-raise/55 dark:bg-transparent"
          >
            <SelectValue>
              {NEXT_ACTIONS.find((action) => action.value === pull.nextAction)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {NEXT_ACTIONS.map((action) => (
              <SelectItem key={action.value} value={action.value}>
                {action.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      <div className="col-span-2 flex min-w-0 items-center justify-between gap-1 border-t border-hair pt-2 sm:col-span-1 sm:border-t-0 sm:pt-0 xl:contents">
        <Select
          disabled={pending}
          value={pull.priority}
          onValueChange={(value) =>
            value !== null && onUpdate({ priority: value as TeamPull["priority"] })
          }
        >
          <SelectTrigger
            aria-label={`Priority of pull request ${pull.number}`}
            size="sm"
            className={cn(
              "min-w-0 border-0 bg-transparent px-1.5 shadow-none hover:bg-raise/55 dark:bg-transparent",
              pull.priority === "urgent"
                ? "text-del"
                : pull.priority === "high"
                  ? "text-amber"
                  : "text-ink-2",
            )}
          >
            <SelectValue>
              {PRIORITIES.find((priority) => priority.value === pull.priority)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {PRIORITIES.map((priority) => (
              <SelectItem key={priority.value} value={priority.value}>
                {priority.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>

        <span className={cn("tnum shrink-0 text-right text-[11.5px]", sla.tone)}>{sla.label}</span>
      </div>
    </div>
  );
}

function QueueLoading() {
  return (
    <div className="overflow-hidden rounded-lg bg-page" aria-label="Loading team queue">
      <div className="h-9 px-4 py-3 text-[11px] text-ink-3">Loading shared reviews…</div>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-[58px] items-center gap-4 border-t border-hair px-4">
          <span className="h-3 w-2/5 rounded-sm bg-raise" />
          <span className="h-3 w-24 rounded-sm bg-raise" />
          <span className="h-3 w-16 rounded-sm bg-raise" />
        </div>
      ))}
    </div>
  );
}
