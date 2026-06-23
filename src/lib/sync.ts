import { type ListState, getRepoSync, pruneOpen, setRepoSync, upsertPrs } from "@/lib/prs-db";
import { invoke } from "@/lib/tauri";
import type { PullSummary } from "@/lib/tauri";
import type { QueryClient } from "@tanstack/react-query";

/**
 * The sync engine: reconciles GitHub → the local `prs` store (src/lib/prs-db).
 * The UI reads only from the DB; this keeps it fresh. Aggressively driven from
 * src/app/use-pr-sync.ts (start/focus/interval/watched-change) and the poller
 * events (src/app/use-realtime-events.ts).
 */

// One in-flight reconcile per repo so overlapping triggers (focus + poller +
// interval) coalesce into a single network pass instead of N concurrent ones.
const inFlight = new Map<string, Promise<void>>();
// Separate coalescing for the (heavy, one-time) merged/closed history backfill,
// so the on-demand "all" read and the background sync share a single fetch.
const backfillInFlight = new Map<string, Promise<void>>();

async function backfillHistoryInner(repo: string): Promise<void> {
  const sync = await getRepoSync(repo);
  if (sync?.all_backfilled) return;
  const hist = await invoke<PullSummary[]>("gh_list_repos_open_prs", {
    repos: [repo],
    prState: "all",
  });
  await upsertPrs(repo, hist);
  await setRepoSync(repo, { all_backfilled: 1 });
}

/** One-time merged/closed history backfill for a repo (coalesced, idempotent). */
export function backfillHistory(repo: string): Promise<void> {
  const existing = backfillInFlight.get(repo);
  if (existing) return existing;
  const job = backfillHistoryInner(repo).finally(() => backfillInFlight.delete(repo));
  backfillInFlight.set(repo, job);
  return job;
}

/**
 * Ensure every repo's merged/closed history is loaded. The "all" list read
 * awaits this so selecting Merged/Closed shows a real load → the PRs, instead
 * of an empty flash while the (async) backfill is still in flight.
 */
export async function ensureBackfilled(repos: string[]): Promise<void> {
  await Promise.allSettled(repos.map((r) => backfillHistory(r)));
}

function maxUpdatedAt(prs: PullSummary[]): string | null {
  let m: string | null = null;
  for (const p of prs) if (!m || p.updated_at > m) m = p.updated_at;
  return m;
}

/** Full open-PR reconcile for a repo: re-list open, upsert, prune what left. */
async function reconcileOpen(repo: string): Promise<void> {
  const reconcileStartedAt = Date.now();
  const all = await invoke<PullSummary[]>("gh_list_repos_open_prs", {
    repos: [repo],
    prState: "open",
  });
  await upsertPrs(repo, all);
  await pruneOpen(
    repo,
    all.map((p) => p.id),
    reconcileStartedAt,
  );
  await setRepoSync(repo, {
    updated_high: maxUpdatedAt(all),
    open_synced_at: reconcileStartedAt,
    last_error: null,
  });
}

/** One repo → local DB. `full` forces an open reconcile+prune; else delta. */
async function syncRepoInner(repo: string, listState: ListState, full: boolean): Promise<void> {
  const sync = await getRepoSync(repo);

  if (full || !sync?.updated_high) {
    await reconcileOpen(repo);
  } else {
    // Incremental: PRs updated since the watermark. state=all so open→merged/
    // closed transitions are caught (they leave the open view via state column).
    const delta = await invoke<PullSummary[]>("gh_list_repo_pulls_delta", {
      repo,
      prState: "all",
      since: sync.updated_high,
    });
    await upsertPrs(repo, delta);
    await setRepoSync(repo, {
      updated_high: maxUpdatedAt(delta) ?? sync.updated_high,
      last_error: null,
    });
  }

  // First time the user asks for merged/closed, pull that history once
  // (coalesced with the on-demand "all" read in prs.tsx).
  if (listState === "all") {
    await backfillHistory(repo);
  }
}

function syncRepo(repo: string, listState: ListState, full: boolean): Promise<void> {
  const existing = inFlight.get(repo);
  if (existing) return existing;
  const job = syncRepoInner(repo, listState, full)
    .catch((e) => {
      console.warn(`[sync] ${repo} failed`, e);
      void setRepoSync(repo, { last_error: String(e) });
    })
    .finally(() => inFlight.delete(repo));
  inFlight.set(repo, job);
  return job;
}

/** Reconcile all watched repos, then invalidate the DB-backed list query once. */
export async function syncWatched(
  qc: QueryClient,
  repos: string[],
  listState: ListState,
  opts?: { full?: boolean },
): Promise<void> {
  if (repos.length === 0) return;
  await Promise.allSettled(repos.map((r) => syncRepo(r, listState, opts?.full ?? false)));
  qc.invalidateQueries({ queryKey: ["prs", "db"] });
}
