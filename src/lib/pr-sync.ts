import { Tauri } from "@/effect/Tauri";
import { run } from "@/effect/runtime";
import { Dashboard, PullStack, PullSummary } from "@/effect/schema";
import {
  applyDashboardPrs,
  applyRepoStacks,
  getRepoSync,
  pruneOpen,
  setRepoSync,
  upsertPrs,
} from "@/lib/prs-db";
import type { QueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

const pendingRepos = new Set<string>();
let pendingFull = false;
let syncJob: Promise<void> | null = null;

const fetchPulls = (command: string, args: Record<string, unknown>) =>
  run(Effect.flatMap(Tauri, (tauri) => tauri.invoke(command, args, Schema.Array(PullSummary))));

function newest(pulls: ReadonlyArray<{ updated_at: string }>): string | null {
  let value: string | null = null;
  for (const pull of pulls) if (value == null || pull.updated_at > value) value = pull.updated_at;
  return value;
}

async function syncOne(repo: string, forceFull: boolean): Promise<void> {
  let status = await getRepoSync(repo);
  const reconciledAllOpen = forceFull || !status?.updated_high;
  if (reconciledAllOpen) {
    const startedAt = Date.now();
    const pulls = await fetchPulls("gh_list_repos_open_prs", {
      repos: [repo],
      prState: "open",
    });
    await upsertPrs(repo, pulls);
    await pruneOpen(
      repo,
      pulls.map((pull) => pull.id),
      startedAt,
    );
    await setRepoSync(repo, {
      open_synced_at: startedAt,
      updated_high: newest(pulls) ?? status?.updated_high ?? new Date().toISOString(),
      last_error: null,
    });
    status = await getRepoSync(repo);
  }

  // One bounded historical pass makes merged/closed filters local too. Future
  // transitions arrive through the normal delta watermark.
  if (!status?.all_backfilled) {
    const since = new Date(Date.now() - 366 * 86_400_000).toISOString();
    const history = await fetchPulls("gh_list_repo_pulls_delta", {
      repo,
      prState: "all",
      since,
    });
    await upsertPrs(repo, history);
    await setRepoSync(repo, {
      all_backfilled: 1,
      updated_high:
        [status?.updated_high, newest(history)]
          .filter((value): value is string => !!value)
          .sort()
          .at(-1) ?? new Date().toISOString(),
      last_error: null,
    });
    status = await getRepoSync(repo);
  }

  if (reconciledAllOpen) {
    return;
  }

  // `all` is essential: this catches open → closed/merged transitions too.
  const changed = await fetchPulls("gh_list_repo_pulls_delta", {
    repo,
    prState: "all",
    since: status?.updated_high,
  });
  await upsertPrs(repo, changed);
  await setRepoSync(repo, {
    updated_high: newest(changed) ?? status?.updated_high ?? new Date().toISOString(),
    last_error: null,
  });
}

async function syncInboxSignals(repos: ReadonlyArray<string>): Promise<void> {
  const repoQualifier = repos.map((repo) => `repo:${repo}`).join(" ");
  const dashboard = await run(
    Effect.flatMap(Tauri, (tauri) => tauri.invoke("gh_dashboard", { repoQualifier }, Dashboard)),
  );
  await applyDashboardPrs(repos, dashboard);
}

async function syncStackSignals(repos: ReadonlyArray<string>): Promise<void> {
  await Promise.allSettled(
    repos.map(async (repo) => {
      const [owner, name] = repo.split("/");
      if (!owner || !name) return;
      const stacks = await run(
        Effect.flatMap(Tauri, (tauri) =>
          tauri.invoke("gh_repo_stacks", { owner, repo: name }, Schema.Array(PullStack)),
        ),
      );
      await applyRepoStacks(repo, stacks);
    }),
  );
}

async function syncPass(
  queryClient: QueryClient,
  repos: ReadonlyArray<string>,
  forceFull: boolean,
): Promise<void> {
  await Promise.allSettled(
    repos.map((repo) =>
      syncOne(repo, forceFull).catch(async (error) => {
        await setRepoSync(repo, { last_error: String(error) });
        throw error;
      }),
    ),
  );
  // The complete REST mirror and the reviewer-specific GraphQL signals have
  // different jobs, but both land in the same canonical table.
  await Promise.all([
    syncInboxSignals(repos).catch((error) => {
      console.warn("[pr-sync] inbox signal enrichment failed", error);
    }),
    syncStackSignals(repos),
  ]);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["prs"] }),
    queryClient.invalidateQueries({ queryKey: ["inbox"] }),
    queryClient.invalidateQueries({ queryKey: ["merge-lab"] }),
    queryClient.invalidateQueries({ queryKey: ["local-open-prs"] }),
  ]);
}

async function drainSyncs(queryClient: QueryClient): Promise<void> {
  while (pendingRepos.size) {
    const repos = [...pendingRepos];
    const forceFull = pendingFull;
    pendingRepos.clear();
    pendingFull = false;
    await syncPass(queryClient, repos, forceFull);
  }
}

/**
 * GitHub → SQLite. Every trigger joins one global run; events that arrive
 * during it collapse into one follow-up pass instead of starting overlapping
 * GraphQL, stack and SQLite work.
 */
export function syncPrs(
  queryClient: QueryClient,
  repos: ReadonlyArray<string>,
  forceFull = false,
): Promise<void> {
  for (const repo of repos) pendingRepos.add(repo);
  pendingFull ||= forceFull;
  if (!pendingRepos.size) return Promise.resolve();
  if (!syncJob) {
    syncJob = drainSyncs(queryClient).finally(() => {
      syncJob = null;
      if (pendingRepos.size) void syncPrs(queryClient, []);
    });
  }
  return syncJob;
}
