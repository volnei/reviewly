import type * as S from "@/effect/schema";
import Database from "@tauri-apps/plugin-sql";

/** Persistent, local-first mirror of the pull requests in watched repositories. */

let database: Promise<Database> | undefined;
let writeTail: Promise<void> = Promise.resolve();

function db(): Promise<Database> {
  database ??= Database.load("sqlite:reviewly.db");
  return database;
}

/** SQLite has one writer; serialize commits while network reads stay parallel. */
function writeSerial<T>(task: () => Promise<T>): Promise<T> {
  const run = writeTail.then(task, task);
  writeTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

interface PrRow {
  id: number;
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
  requested_reviewers: string;
  requested_teams: string;
  inbox_incoming: number;
  inbox_mine: number;
  ci: string;
  conflicting: number;
  review_decision: string | null;
  issue_comment_count: number;
  review_thread_count: number;
  unresolved_thread_count: number;
  code_owners: string;
  stack_number: number | null;
  stack_position: number | null;
  stack_size: number | null;
  stack_base: string | null;
}

const json = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

function fromRow(row: PrRow): S.PullSummary {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    state: row.state,
    draft: !!row.draft,
    user: {
      login: row.author_login,
      avatar_url: row.author_avatar,
      html_url: row.author_url,
      id: row.author_id,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    html_url: row.html_url,
    repository_url: row.repository_url,
    body: row.body,
    labels: json(row.labels, []),
    requested_reviewers: json(row.requested_reviewers, []),
    requested_teams: json(row.requested_teams, []),
    pull_request: row.merged_at ? { merged_at: row.merged_at } : null,
    head: json(row.head_ref, null),
    base: json(row.base_ref, null),
    inboxIncoming: !!row.inbox_incoming,
    inboxMine: !!row.inbox_mine,
    ci: row.ci,
    conflicting: !!row.conflicting,
    reviewDecision: row.review_decision,
    issueCommentCount: row.issue_comment_count,
    reviewThreadCount: row.review_thread_count,
    unresolvedThreadCount: row.unresolved_thread_count,
    codeOwners: json(row.code_owners, []),
    stack:
      row.stack_number != null &&
      row.stack_position != null &&
      row.stack_size != null &&
      row.stack_base != null
        ? {
            number: row.stack_number,
            position: row.stack_position,
            size: row.stack_size,
            base: row.stack_base,
          }
        : null,
  };
}

/** Read a repository from the local mirror; callers opt into its persisted history. */
export async function readRepoPrs(
  repo: string,
  state: "open" | "all" = "open",
): Promise<ReadonlyArray<S.PullSummary>> {
  const stateClause = state === "open" ? " AND state = 'open' AND merged_at IS NULL" : "";
  const rows = await (await db()).select<PrRow[]>(
    `SELECT * FROM prs
      WHERE repo = $1${stateClause}
      ORDER BY updated_at DESC`,
    [repo],
  );
  return rows.map(fromRow);
}

/** Count the complete open queue directly from the local mirror. */
export async function countOpenPrs(repos: ReadonlyArray<string>): Promise<number> {
  if (!repos.length) return 0;
  const placeholders = repos.map((_, index) => `$${index + 1}`).join(",");
  const rows = await (await db()).select<Array<{ count: number }>>(
    `SELECT COUNT(*) AS count FROM prs
      WHERE repo IN (${placeholders}) AND state = 'open' AND merged_at IS NULL`,
    [...repos],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function upsertPrs(repo: string, pulls: ReadonlyArray<S.PullSummary>): Promise<void> {
  if (!pulls.length) return;
  await writeSerial(async () => {
    const database = await db();
    const columns = `INSERT INTO prs (
      id, repo, number, title, state, draft, merged_at,
      author_login, author_avatar, author_url, author_id,
      created_at, updated_at, html_url, repository_url, body, labels,
      head_ref, base_ref, requested_reviewers, requested_teams, synced_at
    ) VALUES `;
    const conflict = ` ON CONFLICT(id) DO UPDATE SET
      repo=excluded.repo, number=excluded.number, title=excluded.title,
      state=excluded.state, draft=excluded.draft, merged_at=excluded.merged_at,
      author_login=excluded.author_login, author_avatar=excluded.author_avatar,
      author_url=excluded.author_url, author_id=excluded.author_id,
      created_at=excluded.created_at, updated_at=excluded.updated_at,
      html_url=excluded.html_url, repository_url=excluded.repository_url,
      body=COALESCE(excluded.body, prs.body), labels=excluded.labels,
      head_ref=excluded.head_ref, base_ref=excluded.base_ref,
      requested_reviewers=excluded.requested_reviewers,
      requested_teams=excluded.requested_teams, synced_at=excluded.synced_at`;

    const syncedAt = Date.now();
    // One IPC + SQLite commit per batch instead of one per PR. A year of a busy
    // monorepo is thousands of rows; row-at-a-time made first sync take minutes.
    for (let offset = 0; offset < pulls.length; offset += 100) {
      const batch = pulls.slice(offset, offset + 100);
      const params: unknown[] = [];
      const values = batch.map((pull) => {
        const row = [
          pull.id,
          repo,
          pull.number,
          pull.title,
          pull.state,
          pull.draft ? 1 : 0,
          pull.pull_request?.merged_at ?? null,
          pull.user.login,
          pull.user.avatar_url,
          pull.user.html_url,
          pull.user.id,
          pull.created_at,
          pull.updated_at,
          pull.html_url,
          pull.repository_url ?? null,
          pull.body ?? null,
          JSON.stringify(pull.labels),
          pull.head ? JSON.stringify(pull.head) : null,
          pull.base ? JSON.stringify(pull.base) : null,
          JSON.stringify(pull.requested_reviewers ?? []),
          JSON.stringify(pull.requested_teams ?? []),
          syncedAt,
        ];
        const start = params.length + 1;
        params.push(...row);
        return `(${row.map((_, index) => `$${start + index}`).join(",")})`;
      });
      await database.execute(`${columns}${values.join(",")}${conflict}`, params);
    }
  });
}

/**
 * Persist the richer GraphQL signals used to rank the Inbox. The REST mirror
 * remains responsible for the complete PR set; this pass only enriches rows
 * and records which of them currently involve the signed-in reviewer.
 */
export async function applyDashboardPrs(
  repos: ReadonlyArray<string>,
  dashboard: S.Dashboard,
): Promise<void> {
  if (!repos.length) return;
  await writeSerial(async () => {
    const database = await db();
    const placeholders = repos.map((_, index) => `$${index + 1}`).join(",");
    await database.execute(
      `UPDATE prs
      SET inbox_incoming = 0, inbox_mine = 0
      WHERE repo IN (${placeholders})`,
      [...repos],
    );

    const rows = new Map<number, { pull: S.DashboardPr; incoming: boolean; mine: boolean }>();
    for (const pull of dashboard.incoming) rows.set(pull.id, { pull, incoming: true, mine: false });
    for (const pull of dashboard.mine) {
      const current = rows.get(pull.id);
      rows.set(pull.id, {
        pull,
        incoming: current?.incoming ?? false,
        mine: true,
      });
    }

    const columns = `INSERT INTO prs (
      id, repo, number, title, state, draft, merged_at,
      author_login, author_avatar, author_url, author_id,
      created_at, updated_at, html_url, repository_url, body, labels,
      head_ref, base_ref, requested_reviewers, requested_teams, synced_at,
      inbox_incoming, inbox_mine, ci, conflicting, review_decision,
      issue_comment_count, review_thread_count, unresolved_thread_count,
      code_owners, dashboard_synced_at
    ) VALUES `;
    const conflict = ` ON CONFLICT(id) DO UPDATE SET
      repo=excluded.repo, number=excluded.number, title=excluded.title,
      draft=excluded.draft, author_login=excluded.author_login,
      author_avatar=excluded.author_avatar, updated_at=excluded.updated_at,
      html_url=excluded.html_url, inbox_incoming=excluded.inbox_incoming,
      inbox_mine=excluded.inbox_mine, ci=excluded.ci,
      conflicting=excluded.conflicting, review_decision=excluded.review_decision,
      issue_comment_count=excluded.issue_comment_count,
      review_thread_count=excluded.review_thread_count,
      unresolved_thread_count=excluded.unresolved_thread_count,
      code_owners=excluded.code_owners,
      dashboard_synced_at=excluded.dashboard_synced_at`;
    const syncedAt = Date.now();
    const enriched = [...rows.values()];
    for (let offset = 0; offset < enriched.length; offset += 50) {
      const params: unknown[] = [];
      const values = enriched.slice(offset, offset + 50).map(({ pull, incoming, mine }) => {
        const row = [
          pull.id,
          pull.repo,
          pull.number,
          pull.title,
          pull.isDraft ? 1 : 0,
          pull.author,
          pull.avatar,
          pull.author ? `https://github.com/${pull.author}` : "",
          pull.createdAt ?? "",
          pull.updatedAt ?? "",
          pull.url,
          `https://api.github.com/repos/${pull.repo}`,
          syncedAt,
          incoming ? 1 : 0,
          mine ? 1 : 0,
          pull.ci,
          pull.conflicting ? 1 : 0,
          pull.reviewDecision,
          pull.issueCommentCount,
          pull.reviewThreadCount,
          pull.unresolvedThreadCount,
          JSON.stringify(pull.codeOwners),
        ];
        const start = params.length + 1;
        params.push(...row);
        const at = (index: number) => `$${start + index}`;
        return `(${at(0)},${at(1)},${at(2)},${at(3)},'open',${at(4)},NULL,${at(5)},${at(6)},${at(7)},0,${at(8)},${at(9)},${at(10)},${at(11)},NULL,'[]',NULL,NULL,'[]','[]',${at(12)},${at(13)},${at(14)},${at(15)},${at(16)},${at(17)},${at(18)},${at(19)},${at(20)},${at(21)},${at(12)})`;
      });
      await database.execute(`${columns}${values.join(",")}${conflict}`, params);
    }
  });
}

/** Store GitHub's native stack graph on its PR rows; never infer it from branch names. */
export async function applyRepoStacks(
  repo: string,
  stacks: ReadonlyArray<S.PullStack>,
): Promise<void> {
  await writeSerial(async () => {
    const database = await db();
    await database.execute(
      `UPDATE prs
      SET stack_number = NULL, stack_position = NULL, stack_size = NULL, stack_base = NULL
      WHERE repo = $1 AND state = 'open' AND merged_at IS NULL AND stack_number IS NOT NULL`,
      [repo],
    );
    const rows = stacks.flatMap((stack) =>
      stack.pull_requests.map((pull, index) => ({
        number: pull.number,
        stackNumber: stack.number,
        position: index + 1,
        size: stack.pull_requests.length,
        base: stack.base.ref,
      })),
    );
    if (!rows.length) return;
    const params: unknown[] = [repo];
    const values = rows.map((row) => {
      const start = params.length + 1;
      params.push(row.number, row.stackNumber, row.position, row.size, row.base);
      return `($${start},$${start + 1},$${start + 2},$${start + 3},$${start + 4})`;
    });
    await database.execute(
      `WITH stack_rows(number, stack_number, stack_position, stack_size, stack_base) AS
        (VALUES ${values.join(",")})
      UPDATE prs SET
        stack_number = (SELECT stack_number FROM stack_rows WHERE number = prs.number),
        stack_position = (SELECT stack_position FROM stack_rows WHERE number = prs.number),
        stack_size = (SELECT stack_size FROM stack_rows WHERE number = prs.number),
        stack_base = (SELECT stack_base FROM stack_rows WHERE number = prs.number)
      WHERE repo = $1 AND number IN (SELECT number FROM stack_rows)`,
      params,
    );
  });
}

/** Remove open rows that disappeared during a complete reconciliation. */
export async function pruneOpen(
  repo: string,
  keepIds: ReadonlyArray<number>,
  startedAt: number,
): Promise<void> {
  const placeholders = keepIds.map((_, index) => `$${index + 3}`).join(",");
  const except = placeholders ? ` AND id NOT IN (${placeholders})` : "";
  await writeSerial(async () =>
    (await db()).execute(
      `DELETE FROM prs
        WHERE repo = $1 AND state = 'open' AND merged_at IS NULL
          AND synced_at < $2${except}`,
      [repo, startedAt, ...keepIds],
    ),
  );
}

export interface RepoSync {
  repo: string;
  open_synced_at: number | null;
  updated_high: string | null;
  all_backfilled: number;
  last_error: string | null;
}

export async function getRepoSync(repo: string): Promise<RepoSync | null> {
  const rows = await (await db()).select<RepoSync[]>("SELECT * FROM repo_sync WHERE repo = $1", [
    repo,
  ]);
  return rows[0] ?? null;
}

export async function setRepoSync(
  repo: string,
  patch: Partial<Omit<RepoSync, "repo">>,
): Promise<void> {
  const current = await getRepoSync(repo);
  const next: RepoSync = {
    repo,
    open_synced_at: patch.open_synced_at ?? current?.open_synced_at ?? null,
    updated_high: patch.updated_high ?? current?.updated_high ?? null,
    all_backfilled: patch.all_backfilled ?? current?.all_backfilled ?? 0,
    last_error: patch.last_error === undefined ? (current?.last_error ?? null) : patch.last_error,
  };
  await writeSerial(async () =>
    (await db()).execute(
      `INSERT INTO repo_sync (repo, open_synced_at, updated_high, all_backfilled, last_error)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT(repo) DO UPDATE SET
          open_synced_at=excluded.open_synced_at,
          updated_high=excluded.updated_high,
          all_backfilled=excluded.all_backfilled,
          last_error=excluded.last_error`,
      [next.repo, next.open_synced_at, next.updated_high, next.all_backfilled, next.last_error],
    ),
  );
}
