import type { Label, PullSummary } from "@/lib/tauri";
import Database from "@tauri-apps/plugin-sql";

/**
 * Local-first PR store. The `prs` table is the source of truth for the
 * watched-repos list: the UI reads from here (instant, offline) while the sync
 * engine (`src/lib/sync.ts`) reconciles GitHub → here. Schema: migration 5 in
 * `src-tauri/src/lib.rs`.
 */

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:reviewly.db");
  return dbPromise;
}

export type ListState = "open" | "all";

interface PrRow {
  id: number;
  repo: string;
  number: number;
  title: string;
  state: string;
  draft: number;
  merged_at: string | null;
  author_login: string;
  author_avatar: string;
  author_url: string;
  author_id: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  repository_url: string | null;
  body: string | null;
  labels: string;
  head_ref: string | null;
  base_ref: string | null;
}

function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** DB row → the search-shaped PullSummary the UI/`prState` expects. */
function rowToPullSummary(r: PrRow): PullSummary {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    state: r.state,
    draft: !!r.draft,
    user: {
      login: r.author_login,
      avatar_url: r.author_avatar,
      html_url: r.author_url,
      id: r.author_id,
    },
    created_at: r.created_at,
    updated_at: r.updated_at,
    html_url: r.html_url,
    repository_url: r.repository_url,
    body: r.body,
    labels: safeParse<Label[]>(r.labels, []),
    // prState() reads pull_request.merged_at to tell merged from closed.
    pull_request: r.merged_at ? { merged_at: r.merged_at } : null,
    head: safeParse(r.head_ref, null) ?? undefined,
    base: safeParse(r.base_ref, null) ?? undefined,
  };
}

/**
 * The list source. `open` (default) returns only currently-open PRs; `all`
 * also returns merged/closed (loaded on demand when the State filter asks).
 * Sorting/filtering still happens client-side in prs.tsx.
 */
export async function readPrs(repos: string[], listState: ListState): Promise<PullSummary[]> {
  if (repos.length === 0) return [];
  try {
    const db = await getDb();
    const placeholders = repos.map((_, i) => `$${i + 1}`).join(",");
    const stateClause = listState === "all" ? "" : " AND state = 'open' AND merged_at IS NULL";
    const rows = await db.select<PrRow[]>(
      `SELECT * FROM prs WHERE repo IN (${placeholders})${stateClause} ORDER BY updated_at DESC`,
      repos,
    );
    return rows.map(rowToPullSummary);
  } catch (e) {
    console.warn("[prs-db] readPrs failed", e);
    return [];
  }
}

/**
 * Upsert a batch of PRs (all belonging to `repo`) into the local store.
 * No explicit transaction: tauri-plugin-sql pools connections, so a manual
 * BEGIN/COMMIT would land on different connections and corrupt the batch.
 * Each row auto-commits; the upsert is idempotent by id.
 */
export async function upsertPrs(repo: string, prs: PullSummary[]): Promise<void> {
  if (prs.length === 0) return;
  const db = await getDb();
  const sql = `INSERT INTO prs (id, repo, number, title, state, draft, merged_at,
       author_login, author_avatar, author_url, author_id,
       created_at, updated_at, html_url, repository_url, body, labels,
       head_ref, base_ref, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, strftime('%s','now') * 1000)
     ON CONFLICT(id) DO UPDATE SET
       repo=excluded.repo, number=excluded.number, title=excluded.title,
       state=excluded.state, draft=excluded.draft, merged_at=excluded.merged_at,
       author_login=excluded.author_login, author_avatar=excluded.author_avatar,
       author_url=excluded.author_url, author_id=excluded.author_id,
       created_at=excluded.created_at, updated_at=excluded.updated_at,
       html_url=excluded.html_url, repository_url=excluded.repository_url,
       body=COALESCE(excluded.body, prs.body),
       labels=excluded.labels, head_ref=excluded.head_ref, base_ref=excluded.base_ref,
       synced_at=excluded.synced_at`;
  for (const p of prs) {
    try {
      await db.execute(sql, [
        p.id,
        repo,
        p.number,
        p.title,
        p.state,
        p.draft ? 1 : 0,
        p.pull_request?.merged_at ?? null,
        p.user.login,
        p.user.avatar_url,
        p.user.html_url,
        p.user.id,
        p.created_at,
        p.updated_at,
        p.html_url,
        p.repository_url ?? null,
        p.body ?? null,
        JSON.stringify(p.labels ?? []),
        p.head ? JSON.stringify(p.head) : null,
        p.base ? JSON.stringify(p.base) : null,
      ]);
    } catch (e) {
      console.warn(`[prs-db] upsertPrs row ${p.id} failed`, e);
    }
  }
}

/**
 * After a full open-PR reconcile, drop open rows no longer present. Scoped to
 * open-non-merged only (never touches merged/closed history), and only rows
 * written before this reconcile began (so a concurrent delta isn't clobbered).
 */
export async function pruneOpen(
  repo: string,
  keepIds: number[],
  reconcileStartedAt: number,
): Promise<void> {
  try {
    const db = await getDb();
    const keepClause =
      keepIds.length > 0 ? ` AND id NOT IN (${keepIds.map((_, i) => `$${i + 2}`).join(",")})` : "";
    await db.execute(
      `DELETE FROM prs
       WHERE repo = $1 AND state = 'open' AND merged_at IS NULL
         AND synced_at < ${Number(reconcileStartedAt)}${keepClause}`,
      [repo, ...keepIds],
    );
  } catch (e) {
    console.warn("[prs-db] pruneOpen failed", e);
  }
}

export interface RepoSync {
  repo: string;
  open_synced_at: number | null;
  updated_high: string | null;
  all_backfilled: number;
  last_error: string | null;
}

export async function getRepoSync(repo: string): Promise<RepoSync | null> {
  try {
    const db = await getDb();
    const rows = await db.select<RepoSync[]>("SELECT * FROM repo_sync WHERE repo = $1", [repo]);
    return rows[0] ?? null;
  } catch (e) {
    console.warn("[prs-db] getRepoSync failed", e);
    return null;
  }
}

export async function setRepoSync(
  repo: string,
  patch: Partial<Omit<RepoSync, "repo">>,
): Promise<void> {
  try {
    const db = await getDb();
    const cur = await getRepoSync(repo);
    const next: RepoSync = {
      repo,
      open_synced_at: patch.open_synced_at ?? cur?.open_synced_at ?? null,
      updated_high: patch.updated_high ?? cur?.updated_high ?? null,
      all_backfilled: patch.all_backfilled ?? cur?.all_backfilled ?? 0,
      last_error: patch.last_error !== undefined ? patch.last_error : (cur?.last_error ?? null),
    };
    await db.execute(
      `INSERT INTO repo_sync (repo, open_synced_at, updated_high, all_backfilled, last_error)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT(repo) DO UPDATE SET
         open_synced_at=excluded.open_synced_at, updated_high=excluded.updated_high,
         all_backfilled=excluded.all_backfilled, last_error=excluded.last_error`,
      [next.repo, next.open_synced_at, next.updated_high, next.all_backfilled, next.last_error],
    );
  } catch (e) {
    console.warn("[prs-db] setRepoSync failed", e);
  }
}

/** Remove a repo's PRs + sync state (on un-watch). */
export async function deleteRepoData(repo: string): Promise<void> {
  try {
    const db = await getDb();
    await db.execute("DELETE FROM prs WHERE repo = $1", [repo]);
    await db.execute("DELETE FROM repo_sync WHERE repo = $1", [repo]);
  } catch (e) {
    console.warn("[prs-db] deleteRepoData failed", e);
  }
}

export async function getPrById(id: number): Promise<PullSummary | null> {
  try {
    const db = await getDb();
    const rows = await db.select<PrRow[]>("SELECT * FROM prs WHERE id = $1", [id]);
    return rows[0] ? rowToPullSummary(rows[0]) : null;
  } catch (e) {
    console.warn("[prs-db] getPrById failed", e);
    return null;
  }
}
