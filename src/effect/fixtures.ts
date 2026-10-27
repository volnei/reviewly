import { Effect, Layer, Queue, Schema, Stream } from "effect";
import { Tauri, type TauriShape } from "./Tauri";
import { DecodeError, TauriError } from "./errors";

/**
 * What the Rust side would answer, for `bun run dev` in a plain browser.
 * Enough of a world to build every screen against: a viewer, watched repos,
 * an Inbox with the six verdicts, and one pull request in full.
 */

const day = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const user = (login: string, id: number) => ({
  login,
  avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4`,
  html_url: `https://github.com/${login}`,
  id,
});
const av = (login: string) => user(login, login.length * 1001).avatar_url;

const viewer = {
  login: "volnei",
  avatar_url: av("volnei"),
  name: "Volnei Munhoz",
  html_url: "https://github.com/volnei",
};

const dash = (
  repo: string,
  number: number,
  title: string,
  author: string,
  extra: Partial<{
    isDraft: boolean;
    reviewDecision: string | null;
    ci: string;
    conflicting: boolean;
    age: number;
    unresolved: number;
    comments: number;
    codeOwners: string[];
  }> = {},
) => ({
  id: number * 7,
  number,
  title,
  url: `https://github.com/${repo}/pull/${number}`,
  repo,
  author,
  avatar: av(author),
  isDraft: extra.isDraft ?? false,
  reviewDecision: extra.reviewDecision ?? null,
  ci: extra.ci ?? "success",
  conflicting: extra.conflicting ?? false,
  createdAt: ago((extra.age ?? 1) * day),
  updatedAt: ago(((extra.age ?? 1) * day) / 3),
  issueCommentCount: extra.comments ?? 0,
  reviewThreadCount: extra.unresolved ?? 0,
  unresolvedThreadCount: extra.unresolved ?? 0,
  codeOwners: extra.codeOwners ?? ["@acme/payments"],
});

const incoming = [
  dash(
    "acme/ledger-api",
    2184,
    "Add idempotency keys to payment intents",
    "marina",
    {
      ci: "failure",
      age: 2,
      unresolved: 2,
      comments: 2,
    },
  ),
  dash("acme/web", 7761, "Virtualise the settlements table", "tiago", {
    age: 0.2,
  }),
  dash(
    "acme/ledger-api",
    2186,
    "Sync vendored protobuf definitions",
    "acme-bot[bot]",
    {
      age: 0.15,
    },
  ),
  dash("acme/web", 7758, "Small copy fix on the invoice screen", "joao", {
    age: 1,
  }),
  dash(
    "acme/infra",
    310,
    "Bump actions/checkout from 3 to 5",
    "dependabot[bot]",
    { age: 1 },
  ),
  dash("acme/ledger-api", 2103, "Rewrite the webhook retry worker", "pedro", {
    age: 2,
    unresolved: 3,
    conflicting: true,
  }),
];
const mine = [
  dash(
    "acme/ledger-api",
    2179,
    "Refactor fee calculation into a policy table",
    "volnei",
    {
      reviewDecision: "CHANGES_REQUESTED",
      age: 1,
      unresolved: 2,
    },
  ),
  dash(
    "volnei/reviewly",
    88,
    "Guided tour regenerates after a force-push",
    "volnei",
    {
      reviewDecision: "APPROVED",
      age: 3,
    },
  ),
  dash(
    "acme/ledger-api",
    2044,
    "Drop the legacy settlements endpoint",
    "volnei",
    { age: 3 },
  ),
  dash("acme/web", 7702, "Remove the legacy invoice PDF path", "volnei", {
    isDraft: true,
    age: 5,
  }),
];

const notifications = [
  {
    id: "n1",
    unread: true,
    reason: "mention",
    updated_at: ago(6 * 36e5),
    last_read_at: null,
    subject: {
      title: "Settlements: double-run on retry?",
      url: "https://api.github.com/repos/acme/web/pulls/7740",
      latest_comment_url: null,
      type: "PullRequest",
    },
    repository: {
      full_name: "acme/web",
      html_url: "https://github.com/acme/web",
    },
  },
  {
    id: "n2",
    unread: true,
    reason: "review_requested",
    updated_at: ago(5 * 36e5),
    last_read_at: null,
    subject: {
      title: "Virtualise the settlements table",
      url: "https://api.github.com/repos/acme/web/pulls/7761",
      latest_comment_url: null,
      type: "PullRequest",
    },
    repository: {
      full_name: "acme/web",
      html_url: "https://github.com/acme/web",
    },
  },
  {
    id: "n3",
    unread: true,
    reason: "comment",
    updated_at: ago(9 * 36e5),
    last_read_at: null,
    subject: {
      title: "Refactor fee calculation into a policy table",
      url: "https://api.github.com/repos/acme/ledger-api/pulls/2179",
      latest_comment_url: null,
      type: "PullRequest",
    },
    repository: {
      full_name: "acme/ledger-api",
      html_url: "https://github.com/acme/ledger-api",
    },
  },
  {
    id: "n4",
    unread: true,
    reason: "ci_activity",
    updated_at: ago(2 * day),
    last_read_at: null,
    subject: {
      title: "Guided tour regenerates after a force-push",
      url: "https://api.github.com/repos/volnei/reviewly/pulls/88",
      latest_comment_url: null,
      type: "PullRequest",
    },
    repository: {
      full_name: "volnei/reviewly",
      html_url: "https://github.com/volnei/reviewly",
    },
  },
];

const alerts: Record<string, unknown[]> = {
  "acme/ledger-api": [
    {
      number: 41,
      state: "open",
      html_url: "https://github.com/acme/ledger-api/security/dependabot/41",
      created_at: ago(4 * day),
      dependency: {
        package: { ecosystem: "npm", name: "fast-xml-parser" },
        manifest_path: "package.json",
      },
      security_advisory: {
        summary: "Prototype pollution in fast-xml-parser",
        severity: "high",
        ghsa_id: "GHSA-xxxx",
        cve_id: "CVE-2024-0001",
      },
      security_vulnerability: {
        severity: "high",
        vulnerable_version_range: "< 4.2.6",
        first_patched_version: { identifier: "4.2.6" },
      },
    },
  ],
};

const marina = user("marina", 1001);
const pedro = user("pedro", 1002);
const me = user("volnei", 1000);

const pull = {
  id: 2184 * 7,
  number: 2184,
  title: "Add idempotency keys to payment intents",
  state: "open",
  draft: false,
  user: marina,
  created_at: ago(2 * day),
  updated_at: ago(3 * 36e5),
  html_url: "https://github.com/acme/ledger-api/pull/2184",
  body: "## What & why\n\nClients retry the create call when the gateway times out, and we end up with two intents for one payment. This adds a client-supplied idempotency key, a unique index behind it, and a retry path that returns the first intent on a repeat.\n\n- migration with a partial unique index on `(account_id, idempotency_key)`\n- `Intents.create` looks up before inserting\n- middleware rejects writes without the `Idempotency-Key` header\n\nFixes [PAY-1234](https://linear.app/acme/issue/PAY-1234).\n\n## Out of scope\n\n1. Backfilling keys for intents created before this ships\n2. Settlements \u2014 they have their own retry story, see #2103\n\n> A void is terminal: a retry after a void is a new attempt, not a replay.\n\n## How to test\n\n![The settlements screen after the change](https://github.com/user-attachments/assets/0b1c2d3e-aaaa-bbbb-cccc-000000000001)\n\n- [x] `bun test packages/ledger` \u2014 the new cases cover replay, void, and a missing header\n- [x] Replay the same key twice against a local gateway and expect one row\n- [ ] Run the migration against a staging snapshot\n\n```sql\ncreate unique index concurrently intents_idem_key\n  on intents (account_id, idempotency_key)\n  where status <> 'void';\n```\n\n| Case | Before | After |\n| --- | --- | --- |\n| Retry after timeout | two intents | first intent returned |\n| Retry after void | two intents | new intent |\n| No header | accepted | 400 |",
  head: {
    ref: "marina/idempotency-keys",
    sha: "a81d330f2c1e4b5d9a7e6c3f1b2d4e5f6a7b8c9d",
    label: "acme:marina/idempotency-keys",
  },
  base: {
    ref: "main",
    sha: "0f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6",
    label: "acme:main",
  },
  mergeable: true,
  mergeable_state: "unstable",
  merged: false,
  additions: 312,
  deletions: 48,
  changed_files: 11,
  commits: 4,
  labels: [{ id: 1, name: "payments", color: "5319e7", description: null }],
  auto_merge: null,
};

const patchMig = `@@ -0,0 +1,5 @@
+alter table intents add column idempotency_key text;
+
+-- partial: a voided intent frees its key for reuse
+create unique index intents_idempotency_key_uniq
+  on intents (idempotency_key) where status <> 'void';`;
const patchIntents = `@@ -28,9 +28,24 @@ export const create = (input: CreateIntent) =>
   Effect.gen(function* () {
     const db = yield* Db
-    const row = yield* db.insert(intents, toRow(input))
-    return fromRow(row)
+    const existing = yield* db.findIdempotent(intents, input.idempotencyKey)
+    if (Option.isSome(existing)) return fromRow(existing.value)
+    const row = yield* db.insert(intents, toRow(input)).pipe(
+      Effect.catchTag("UniqueViolation", () =>
+        db.findIdempotent(intents, input.idempotencyKey).pipe(Effect.flatMap(Option.getOrThrow)),
+      ),
+    )
+    return fromRow(row)
   })
@@ -80,6 +95,12 @@ export const retry = (id: IntentId) =>
   Effect.gen(function* () {
     const db = yield* Db
+    const intent = yield* db.get(intents, id)
+    if (intent.status === "void") return yield* new IntentVoided({ id })
     yield* gateway.charge(id)
   })`;
const patchMw = `@@ -11,6 +11,10 @@ import { Headers, HttpMiddleware } from "@effect/platform"
 export const requireIdempotencyKey = HttpMiddleware.make((app) =>
   Effect.gen(function* () {
+    const key = yield* Headers.get("idempotency-key")
+    if (Option.isNone(key)) return yield* HttpError.badRequest("idempotency-key header is required")
+    return yield* app
   }))`;

const files = [
  {
    sha: "1",
    filename: "migrations/0042_idempotency_keys.sql",
    status: "added",
    additions: 5,
    deletions: 0,
    changes: 5,
    patch: patchMig,
    previous_filename: null,
  },
  {
    sha: "2",
    filename: "src/payments/Intents.ts",
    status: "modified",
    additions: 22,
    deletions: 3,
    changes: 25,
    patch: patchIntents,
    previous_filename: null,
  },
  {
    sha: "3",
    filename: "src/payments/Intents.schema.ts",
    status: "modified",
    additions: 18,
    deletions: 0,
    changes: 18,
    patch:
      "@@ -1,3 +1,21 @@\n+export const CreateIntent = Schema.Struct({\n+  amount: Schema.Number,\n+  idempotencyKey: Schema.String,\n+})",
    previous_filename: null,
  },
  {
    sha: "4",
    filename: "src/payments/Retry.ts",
    status: "modified",
    additions: 44,
    deletions: 9,
    changes: 53,
    patch:
      "@@ -84,6 +84,10 @@\n   return yield* attempt(id)\n+  // a repeat with the same key returns the first intent\n+  const prior = yield* db.findIdempotent(intents, key)\n+  if (Option.isSome(prior)) return prior.value\n+  return yield* attempt(id)",
    previous_filename: null,
  },
  {
    sha: "5",
    filename: "src/http/middleware.ts",
    status: "modified",
    additions: 8,
    deletions: 0,
    changes: 8,
    patch: patchMw,
    previous_filename: null,
  },
  {
    sha: "6",
    filename: "src/http/routes.ts",
    status: "modified",
    additions: 31,
    deletions: 4,
    changes: 35,
    patch:
      '@@ -40,4 +40,8 @@\n-app.post("/intents", create)\n+app.post("/intents", requireIdempotencyKey(create))\n+app.post("/settlements", create)',
    previous_filename: null,
  },
  {
    sha: "7",
    filename: "src/payments/Intents.test.ts",
    status: "added",
    additions: 38,
    deletions: 0,
    changes: 38,
    patch:
      '@@ -0,0 +1,12 @@\n+it("returns the first intent on a repeat", async () => {\n+  const a = await create({ amount: 10, idempotencyKey: "k" })\n+  const b = await create({ amount: 10, idempotencyKey: "k" })\n+  expect(b.id).toBe(a.id)\n+})',
    previous_filename: null,
  },
];

const reviewComments = [
  {
    id: 901,
    pull_request_review_id: 1,
    diff_hunk: patchMig,
    path: "migrations/0042_idempotency_keys.sql",
    commit_id: pull.head.sha,
    user: me,
    body: "Index is partial on `status <> 'void'` — is a voided intent allowed to reuse a key? If the client retries after a void, do we want a new intent or a 409?",
    created_at: ago(20 * 36e5),
    updated_at: ago(20 * 36e5),
    html_url: "#",
    line: 5,
    original_line: 5,
    side: "RIGHT",
    in_reply_to_id: null,
  },
  {
    id: 902,
    pull_request_review_id: 1,
    diff_hunk: patchMig,
    path: "migrations/0042_idempotency_keys.sql",
    commit_id: pull.head.sha,
    user: marina,
    body: "Yes, on purpose: a void is terminal, and a retry after it is a new attempt. I'll add that to the comment in the migration.",
    created_at: ago(3 * 36e5),
    updated_at: ago(3 * 36e5),
    html_url: "#",
    line: 5,
    original_line: 5,
    side: "RIGHT",
    in_reply_to_id: 901,
  },
  {
    id: 903,
    pull_request_review_id: 2,
    diff_hunk: patchMw,
    path: "src/http/middleware.ts",
    commit_id: pull.head.sha,
    user: pedro,
    body: "This rejects any request without the header, including the settlements routes. Intended?",
    created_at: ago(day),
    updated_at: ago(day),
    html_url: "#",
    line: 14,
    original_line: 14,
    side: "RIGHT",
    in_reply_to_id: null,
  },
  {
    id: 904,
    pull_request_review_id: 2,
    diff_hunk: patchMw,
    path: "src/http/middleware.ts",
    commit_id: pull.head.sha,
    user: marina,
    body: "Good catch, it should be payments only. Pushing a fix.",
    created_at: ago(22 * 36e5),
    updated_at: ago(22 * 36e5),
    html_url: "#",
    line: 14,
    original_line: 14,
    side: "RIGHT",
    in_reply_to_id: 903,
  },
];
const reviewThreads = [
  {
    id: "T1",
    is_resolved: false,
    path: "migrations/0042_idempotency_keys.sql",
    line: 5,
    original_line: 5,
    comment_ids: [901, 902],
  },
  {
    id: "T2",
    is_resolved: false,
    path: "src/http/middleware.ts",
    line: 14,
    original_line: 14,
    comment_ids: [903, 904],
  },
];
const reviews = [
  {
    id: 1,
    user: me,
    body: null,
    state: "COMMENTED",
    html_url: "#",
    submitted_at: ago(20 * 36e5),
    commit_id: pull.head.sha,
  },
  {
    id: 2,
    user: pedro,
    body: "Two questions inline, otherwise this reads well.",
    state: "COMMENTED",
    html_url: "#",
    submitted_at: ago(day),
    commit_id: pull.head.sha,
  },
];
const issueComments = [
  {
    id: 501,
    user: pedro,
    body: "Is the key per payment or per attempt? The settlements screen assumes one intent per payment.",
    created_at: ago(day),
    updated_at: ago(day),
    html_url: "#",
  },
  {
    id: 502,
    user: marina,
    body: "Per payment. The client generates it when the checkout starts, so every retry of that checkout carries the same key.",
    created_at: ago(22 * 36e5),
    updated_at: ago(22 * 36e5),
    html_url: "#",
  },
];
const commits = [
  {
    sha: "0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3",
    html_url: "#",
    commit: {
      message: "migration: idempotency_key with a partial unique index",
      author: { name: "marina", date: ago(2 * day) },
    },
    author: { login: "marina", avatar_url: av("marina") },
  },
  {
    sha: "1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4",
    html_url: "#",
    commit: {
      message: "intents: look up before insert, return the first on a repeat",
      author: { name: "marina", date: ago(1.8 * day) },
    },
    author: { login: "marina", avatar_url: av("marina") },
  },
  {
    sha: "2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5",
    html_url: "#",
    commit: {
      message: "http: require the header on writes",
      author: { name: "marina", date: ago(1.5 * day) },
    },
    author: { login: "marina", avatar_url: av("marina") },
  },
  {
    sha: "a81d330f2c1e4b5d9a7e6c3f1b2d4e5f6a7b8c9d",
    html_url: "#",
    commit: {
      message: "middleware: payments routes only",
      author: { name: "marina", date: ago(22 * 36e5) },
    },
    author: { login: "marina", avatar_url: av("marina") },
  },
];
const checks = {
  total_count: 4,
  check_runs: [
    {
      id: 1,
      name: "build / lint",
      status: "completed",
      conclusion: "success",
      started_at: ago(3 * 36e5),
      completed_at: ago(3 * 36e5 - 70_000),
      html_url: "#",
      app: { name: "GitHub Actions", slug: "github-actions" },
    },
    {
      id: 2,
      name: "test / unit",
      status: "completed",
      conclusion: "failure",
      started_at: ago(3 * 36e5),
      completed_at: ago(3 * 36e5 - 150_000),
      html_url: "#",
      app: { name: "GitHub Actions", slug: "github-actions" },
      output: {
        title: "1 failed",
        summary: "Intents.test.ts › returns the first intent on a repeat",
        text: null,
      },
    },
    {
      id: 3,
      name: "test / e2e",
      status: "completed",
      conclusion: "success",
      started_at: ago(3 * 36e5),
      completed_at: ago(3 * 36e5 - 110_000),
      html_url: "#",
      app: { name: "GitHub Actions", slug: "github-actions" },
    },
    {
      id: 4,
      name: "coverage / codecov",
      status: "completed",
      conclusion: "success",
      started_at: ago(3 * 36e5),
      completed_at: ago(3 * 36e5 - 20_000),
      html_url: "#",
      app: { name: "Codecov", slug: "codecov" },
    },
  ],
};

const activity = {
  commits: 412,
  mergedPrs: 96,
  days: Array.from({ length: 365 }, (_, i) => ({
    date: new Date(Date.now() - (364 - i) * day).toISOString().slice(0, 10),
    count: (i * 7919) % 11 === 0 ? 2 : (i * 31) % 5 === 0 ? 1 : 0,
  })),
};

/** A tiny event bus so the fixtures can stream like the Rust side does. */
const bus = new Map<string, Set<(payload: unknown) => void>>();
const emit = (name: string, payload: unknown) => {
  for (const h of bus.get(name) ?? []) h(payload);
};
const LAYERED_ANSWER = JSON.stringify({
  summary:
    "Adds a client-supplied idempotency key so a retried create returns the first intent.",
  strategy:
    "The index and the schema come first because everything else is written against them; the HTTP surface last, since it only forwards the header.",
  layers: [
    {
      title: "Key and index",
      intent:
        "The column, its partial unique index, and the schema type the rest of the change uses.",
      focus: [
        "The index excludes voided intents on purpose",
        "Existing rows have no key and stay valid",
      ],
      risk: "high",
      files: [
        "migrations/0042_idempotency_keys.sql",
        "src/payments/Intents.schema.ts",
      ],
    },
    {
      title: "Create and retry",
      intent:
        "The lookup before insert, and the retry path that hands back the first intent.",
      focus: [
        "A retry after a void makes a new intent, not a 409",
        "The lookup and the insert can’t race",
      ],
      risk: "high",
      files: ["src/payments/Intents.ts", "src/payments/Retry.ts"],
    },
    {
      title: "The header at the edge",
      intent:
        "Middleware that demands the header, and the route that forwards it.",
      focus: ["Only the payments routes are gated, not settlements"],
      risk: "medium",
      files: ["src/http/middleware.ts", "src/http/routes.ts"],
    },
    {
      title: "Tests",
      intent: "What the change claims: replay, void, and a missing header.",
      focus: ["There is a test for the retry-after-void case"],
      risk: "low",
      files: ["src/payments/Intents.test.ts"],
    },
  ],
});

const GUIDED_ANSWER =
  '{"summary":"Adds a client-supplied idempotency key to payment intents so a retried create returns the first intent instead of making a second one.","tour":"Start with the migration (the unique index is the contract), then Intents.create where the lookup-before-insert lives, then the middleware that enforces the header, and finish with the test.","verdict":"comment","verdictReason":"The core path is sound, but the middleware rejects every route without the header and the retry path\'s second lookup is unguarded.","steps":[{"path":"migrations/0042_idempotency_keys.sql","line":4,"kind":"orient","title":"The unique index is the whole guarantee","detail":"`create unique index intents_idempotency_key_uniq \u2026 where status <> \'void\'` \u2014 partial on purpose: a voided intent frees its key for a new attempt."},{"path":"src/payments/Intents.ts","line":30,"kind":"orient","title":"Look up before inserting","detail":"`const existing = yield* db.findIdempotent(intents, input.idempotencyKey)` \u2014 the happy path for a repeat returns the first intent before touching the gateway."},{"path":"src/payments/Intents.ts","line":33,"kind":"concern","title":"The race falls back to a second lookup that can miss","detail":"On `UniqueViolation` the code re-runs `findIdempotent` and `Option.getOrThrow`s it. If the first caller\'s row was voided between the two statements, this throws instead of creating a new attempt.","suggestion":"If the first intent is voided between the insert and this lookup, `getOrThrow` fails the retry. Should this loop back to the lookup-then-insert once, or return a 409?"},{"path":"src/http/middleware.ts","line":14,"kind":"question","title":"Every write now needs the header","detail":"`if (Option.isNone(key)) return yield* HttpError.badRequest(\u2026)` runs for any route the middleware wraps. routes.ts wraps `/intents` and `/settlements` \u2014 is settlements meant to require it too?","suggestion":"This rejects any request without the header, including `/settlements`. Intended, or payments only?"},{"path":"src/payments/Intents.test.ts","line":1,"kind":"praise","title":"The repeat case is tested","detail":"`returns the first intent on a repeat` covers the sequential case. The concurrent one (two creates in flight) is the one the index exists for \u2014 worth a second test later."}]}';
const CHAT_ANSWER =
  'Two things stand out.\n\n1. **The partial unique index** in `migrations/0042_idempotency_keys.sql` is the real guarantee \u2014 the lookup in `Intents.create` is an optimisation on top of it.\n2. **The middleware wraps every write** \u2014 `routes.ts` applies `requireIdempotencyKey` to `/settlements` too, which the description doesn\'t mention.\n\nI\'d ask about the second before approving.\n\n<action>{"type":"inline_comment","path":"src/http/middleware.ts","line":14,"body":"This rejects any request without the header, including `/settlements`. Intended, or payments only?"}</action>';
const REVIEW_ACTION =
  '\n\n<action>{"type":"review","event":"COMMENT","body":"The core path is sound. One question inline about the settlements route before I approve."}</action>';
const streamCanned = (key: string, text: string, provider = "claude") => {
  const parts = text.match(/[\s\S]{1,28}/g) ?? [];
  setTimeout(
    () =>
      emit("ai:progress", {
        key,
        provider,
        phase: "thinking",
        message: "Session ready; analyzing the current specs",
        model: provider === "codex" ? "gpt-5-codex" : "claude-sonnet-5",
        sessionId: "fixture-a83f92d1",
        inputTokens: 12480,
        cachedTokens: 8160,
      }),
    80,
  );
  setTimeout(
    () =>
      emit("ai:progress", {
        key,
        provider,
        phase: "writing",
        message: "Generating the structured spec draft",
        model: provider === "codex" ? "gpt-5-codex" : "claude-sonnet-5",
        sessionId: "fixture-a83f92d1",
        inputTokens: 12480,
        cachedTokens: 8160,
      }),
    180,
  );
  parts.forEach((delta, i) =>
    setTimeout(() => emit("ai:chunk", { key, delta }), 250 + i * 35),
  );
  setTimeout(
    () => {
      emit("ai:progress", {
        key,
        provider,
        phase: "complete",
        message: "Draft generated",
        model: provider === "codex" ? "gpt-5-codex" : "claude-sonnet-5",
        sessionId: "fixture-a83f92d1",
        inputTokens: 12480,
        outputTokens: 924,
        cachedTokens: 8160,
        costUsd: provider === "claude" ? 0.0832 : null,
        durationMs: 2180,
        turns: 1,
      });
      emit("ai:complete", { key, ok: true, output: text, costUsd: 0.0832 });
    },
    300 + parts.length * 35,
  );
};

type Handler = (args: Record<string, unknown>) => unknown;

/** One clone on this machine, for the Local pages: a branch ahead of main with work in progress. */
const localTree = {
  branch: "volnei/retry-metrics",
  upstream: true,
  ahead: 2,
  behind: 0,
  staged: [{ path: "src/metrics/retry.ts", status: "M" }] as Array<{
    path: string;
    status: string;
  }>,
  unstaged: [
    { path: "src/payments/Retry.ts", status: "M" },
    { path: "README.md", status: "M" },
    { path: "notes.txt", status: "?" },
  ] as Array<{ path: string; status: string }>,
};
let localBranches = ["main", localTree.branch, "marina/idempotency-keys"];
let fixturePrNumber = 2190;
let fixtureApplyNumber = 0;
let fixtureSpecCreated = false;
let fixtureWorktreePath: string | null = null;
const localLog = [
  {
    hash: "9c1f2e4a1b",
    short: "9c1f2e4",
    author: "volnei",
    date: "2026-10-05T18:10:00Z",
    subject: "metrics: count retries per intent",
  },
  {
    hash: "7b3a9d0c2e",
    short: "7b3a9d0",
    author: "volnei",
    date: "2026-10-05T16:42:00Z",
    subject: "retry: expose the attempt number",
  },
  {
    hash: "a81d330f55",
    short: "a81d330",
    author: "marina",
    date: "2026-10-04T11:03:00Z",
    subject: "Add idempotency keys to payment intents (#2184)",
  },
];
const localPatch = (file: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,6 +1,8 @@\n import { metrics } from "./metrics";\n \n-export const retry = (attempt: number) => attempt < 3;\n+export const retry = (attempt: number) => {\n+  metrics.count("retry", { attempt });\n+  return attempt < 3;\n+};\n \n export const backoff = (attempt: number) => 2 ** attempt * 100;\n`;

/** What the actions changed on the fixture PR, layered over it. */
let pullPatch: Record<string, unknown> = {};
const reactions = new Map<
  number,
  Array<{ id: number; content: string; user: { login: string } }>
>();
let nextReaction = 9000;
const num = (x: unknown) => Number(x);
const commands: Record<string, Handler> = {
  gh_compare: () => [
    {
      sha: "cmp1",
      filename: "src/payments/Retry.ts",
      status: "modified",
      additions: 6,
      deletions: 1,
      changes: 7,
      previous_filename: null,
      patch:
        '@@ -4,7 +4,12 @@ import { metrics } from "./metrics";\n export const retry = (attempt: number) => {\n-  return attempt < 3;\n+  metrics.count("retry", { attempt });\n+  // a voided intent gets a fresh attempt\n+  if (attempt === 0) return true;\n+  return attempt < 3;\n };\n \n export const backoff = (attempt: number) => 2 ** attempt * 100;',
    },
    {
      sha: "cmp2",
      filename: "src/payments/Intents.test.ts",
      status: "modified",
      additions: 9,
      deletions: 0,
      changes: 9,
      previous_filename: null,
      patch:
        '@@ -60,3 +60,12 @@ describe("replay", () => {\n   expect(second.id).toBe(first.id);\n });\n+\n+it("retries after a void start fresh", async () => {\n+  const first = await create(input);\n+  await voidIntent(first.id);\n+  const next = await create(input);\n+  expect(next.id).not.toBe(first.id);\n+});\n+\n+it.todo("rejects a reused key across accounts");',
    },
  ],
  git_grep: ({ query }) => [
    {
      file: "src/payments/Intents.ts",
      line: 12,
      text: `export const ${query} = (input: CreateIntent) =>`,
    },
    {
      file: "src/http/routes.ts",
      line: 48,
      text: `  const row = yield* ${query}(input);`,
    },
    {
      file: "src/payments/Intents.test.ts",
      line: 9,
      text: `import { ${query} } from "./Intents";`,
    },
  ],
  read_file: ({ path }) =>
    Array.from({ length: 80 }, (_, i) =>
      i === 11
        ? `export const create = (input: CreateIntent) => // ${String(path).split("/").pop()}`
        : `// line ${i + 1}`,
    ).join("\n"),
  git_blame_lines: ({ start, end }) =>
    Array.from({ length: num(end) - num(start) + 1 }, (_, i) => ({
      line: num(start) + i,
      hash:
        i % 2
          ? "7b3a9d0c2e7b3a9d0c2e7b3a9d0c2e7b3a9d0c2e"
          : "a81d330f55a81d330f55a81d330f55a81d330f55",
      short: i % 2 ? "7b3a9d0" : "a81d330",
      author: i % 2 ? "pedro" : "marina",
      time: Math.floor(Date.now() / 1000) - (i % 2 ? 21 : 3) * 86400,
      summary:
        i % 2
          ? "retry: expose the attempt number (#2103)"
          : "Add idempotency keys to payment intents (#2184)",
    })),
  gh_repo_stacks: ({ owner, repo }) =>
    `${owner}/${repo}` === "acme/ledger-api"
      ? [commands.gh_pr_stack({ number: 2184 })]
      : [],
  gh_pr_stack: ({ number }) =>
    num(number) === 2184
      ? {
          id: 77,
          number: 12,
          base: { ref: "main" },
          open: true,
          pull_requests: [
            {
              number: 2180,
              state: "closed",
              draft: false,
              merged_at: "2026-10-04T09:00:00Z",
              head: { ref: "marina/intent-schema", sha: "11aa" },
            },
            {
              number: 2184,
              state: "open",
              draft: false,
              merged_at: null,
              head: { ref: "marina/idempotency-keys", sha: "a81d330" },
            },
            {
              number: 2190,
              state: "open",
              draft: false,
              merged_at: null,
              head: { ref: "marina/retry-path", sha: "22bb" },
            },
            {
              number: 2195,
              state: "open",
              draft: true,
              merged_at: null,
              head: { ref: "marina/settlements-ui", sha: "33cc" },
            },
          ],
        }
      : null,
  gh_merge_async: () => ({ id: "3f1c0a9e-5b7d-4c2e-9a1f-8d6e2b4c7a10" }),
  gh_merge_async_status: () => ({ status: "merged", message: null }),
  gh_list_repo_pulls: ({ owner, repo }) => {
    const full = `${owner}/${repo}`;
    const mk = (
      n: number,
      title: string,
      who: ReturnType<typeof user>,
      days: number,
      extra: Partial<{
        state: string;
        draft: boolean;
        merged: string;
        labels: string[];
      }> = {},
    ) => ({
      id: 90000 + n,
      number: n,
      title,
      state: extra.state ?? "open",
      draft: extra.draft ?? false,
      user: who,
      created_at: new Date(Date.now() - days * 864e5).toISOString(),
      updated_at: new Date(Date.now() - days * 864e5 + 3600e3).toISOString(),
      html_url: `https://github.com/${full}/pull/${n}`,
      repository_url: `https://api.github.com/repos/${full}`,
      body: null,
      labels: (extra.labels ?? []).map((name, i) => ({
        id: i + 10,
        name,
        color: "5319e7",
        description: null,
      })),
      pull_request: { merged_at: extra.merged ?? null },
      head: null,
      base: null,
    });
    if (full !== "acme/ledger-api") return [];
    return [
      mk(2184, "Add idempotency keys to payment intents", marina, 2, {
        labels: ["payments"],
      }),
      mk(2190, "Retry path returns the first intent", marina, 1.5, {
        labels: ["payments"],
      }),
      mk(2195, "Settlements screen reads the idempotency key", marina, 1, {
        draft: true,
      }),
      mk(
        2186,
        "Sync vendored protobuf definitions",
        user("dependabot[bot]", 2000),
        0.3,
      ),
      mk(2179, "Refactor fee calculation into a policy table", me, 1),
      mk(2103, "Rewrite the webhook retry worker", pedro, 3, {
        labels: ["payments", "needs-qa"],
      }),
      mk(2170, "Settlement export as CSV", pedro, 4, { draft: true }),
      mk(2150, "Bump pino to 9", user("dependabot[bot]", 2000), 6, {
        state: "closed",
        merged: "2026-10-01T10:00:00Z",
      }),
      mk(2141, "Experiment: batch intents", marina, 9, { state: "closed" }),
    ];
  },
  monorepo_workspace: () => ({
    packages: [
      { name: "@acme/db", dir: "migrations" },
      { name: "@acme/payments", dir: "src/payments" },
      { name: "@acme/http", dir: "src/http" },
    ],
    edges: [
      ["@acme/http", "@acme/payments"],
      ["@acme/payments", "@acme/db"],
    ],
  }),
  git_ls_files: () => [
    "package.json",
    "turbo.json",
    "README.md",
    "migrations/0041_accounts.sql",
    "migrations/0042_idempotency_keys.sql",
    "src/payments/Intents.ts",
    "src/payments/Intents.schema.ts",
    "src/payments/Intents.test.ts",
    "src/payments/Retry.ts",
    "src/http/middleware.ts",
    "src/http/routes.ts",
    "src/http/server.ts",
    "src/metrics/retry.ts",
  ],
  list_dir: ({ path }) => {
    const p = String(path).replace(/\/$/, "");
    if (p.endsWith("/src"))
      return [
        { name: "http", is_dir: true },
        { name: "metrics", is_dir: true },
        { name: "payments", is_dir: true },
      ];
    if (p.endsWith("/src/payments"))
      return [
        { name: "Intents.schema.ts", is_dir: false },
        { name: "Intents.test.ts", is_dir: false },
        { name: "Intents.ts", is_dir: false },
        { name: "Retry.ts", is_dir: false },
      ];
    if (p.endsWith("/src/http"))
      return [
        { name: "middleware.ts", is_dir: false },
        { name: "routes.ts", is_dir: false },
        { name: "server.ts", is_dir: false },
      ];
    if (p.endsWith("/src/metrics"))
      return [{ name: "retry.ts", is_dir: false }];
    if (p.endsWith("/migrations"))
      return [
        { name: "0041_accounts.sql", is_dir: false },
        { name: "0042_idempotency_keys.sql", is_dir: false },
      ];
    return [
      { name: "migrations", is_dir: true },
      { name: "src", is_dir: true },
      { name: "README.md", is_dir: false },
      { name: "package.json", is_dir: false },
      { name: "turbo.json", is_dir: false },
    ];
  },
  read_file_data_url: () =>
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiM0NDQiLz48L3N2Zz4=",
  git_file_activity: () => [
    {
      path: "src/payments/Intents.ts",
      last_short: "a1b2c3d",
      last_author: "marina",
      last_time: Math.floor((Date.now() - 2 * day) / 1000),
      last_subject: "feat(payments): idempotency keys on intents",
      churn: 14,
    },
    {
      path: "src/http/middleware.ts",
      last_short: "b2c3d4e",
      last_author: "pedro",
      last_time: Math.floor((Date.now() - 9 * day) / 1000),
      last_subject: "fix(http): tighten header parsing",
      churn: 6,
    },
    {
      path: "src/metrics/retry.ts",
      last_short: "c3d4e5f",
      last_author: "volnei",
      last_time: Math.floor((Date.now() - 30 * day) / 1000),
      last_subject: "chore: retry metrics",
      churn: 2,
    },
  ],
  git_delete_branch: ({ name }) => {
    localBranches = localBranches.filter((b) => b !== String(name));
    return {};
  },
  git_clone: ({ url, parentDir }) =>
    `${parentDir}/${String(url)
      .replace(/\.git$/, "")
      .split("/")
      .pop()}`,
  gh_actions_job: ({ jobId }) => ({
    id: num(jobId),
    name: "test / unit",
    status: "completed",
    conclusion: "failure",
    html_url: "#",
    steps: [
      {
        name: "Set up job",
        status: "completed",
        conclusion: "success",
        number: 1,
        started_at: ago(9 * 60_000),
        completed_at: ago(9 * 60_000 - 4000),
      },
      {
        name: "Checkout",
        status: "completed",
        conclusion: "success",
        number: 2,
        started_at: ago(9 * 60_000 - 4000),
        completed_at: ago(9 * 60_000 - 9000),
      },
      {
        name: "bun install",
        status: "completed",
        conclusion: "success",
        number: 3,
        started_at: ago(9 * 60_000 - 9000),
        completed_at: ago(8 * 60_000),
      },
      {
        name: "bun test",
        status: "completed",
        conclusion: "failure",
        number: 4,
        started_at: ago(8 * 60_000),
        completed_at: ago(6 * 60_000),
      },
      {
        name: "Upload coverage",
        status: "completed",
        conclusion: "skipped",
        number: 5,
        started_at: null,
        completed_at: null,
      },
    ],
  }),
  monorepo_scan: () => ({
    packages: [
      { name: "@acme/web", dir: "apps/web" },
      { name: "@acme/ledger", dir: "packages/ledger" },
      { name: "@acme/ui", dir: "packages/ui" },
      { name: "@acme/config", dir: "packages/config" },
    ],
    edges: [
      ["@acme/web", "@acme/ledger"],
      ["@acme/web", "@acme/ui"],
      ["@acme/ledger", "@acme/config"],
      ["@acme/ui", "@acme/ledger"],
      ["@acme/ledger", "@acme/ui"],
    ],
    dep_edges: [
      { from: "@acme/web", to: "@acme/ledger", kind: "dependencies" },
      { from: "@acme/web", to: "@acme/ui", kind: "dependencies" },
      { from: "@acme/ledger", to: "@acme/config", kind: "devDependencies" },
      { from: "@acme/ui", to: "@acme/ledger", kind: "dependencies" },
      { from: "@acme/ledger", to: "@acme/ui", kind: "dependencies" },
    ],
    crossings: [
      {
        file: "apps/web/src/pay.ts",
        line: 12,
        spec: "../../../packages/ledger/src/intents",
        from_pkg: "@acme/web",
        target: "@acme/ledger",
      },
    ],
    member_uses: [
      {
        from_pkg: "@acme/web",
        target: "@acme/ledger",
        count: 14,
        example_file: "apps/web/src/pay.ts",
        example_line: 3,
      },
      {
        from_pkg: "@acme/web",
        target: "@acme/config",
        count: 2,
        example_file: "apps/web/src/env.ts",
        example_line: 1,
      },
      {
        from_pkg: "@acme/ui",
        target: "@acme/ledger",
        count: 1,
        example_file: "packages/ui/src/money.tsx",
        example_line: 2,
      },
    ],
    deps: [
      { package: "@acme/web", name: "zod", version: "^3.23.0" },
      { package: "@acme/ledger", name: "zod", version: "^3.22.4" },
      { package: "@acme/ui", name: "zod", version: "^3.23.0" },
      { package: "@acme/web", name: "react", version: "^18.3.1" },
      { package: "@acme/ui", name: "react", version: "^18.3.1" },
    ],
  }),
  openspec_scan: ({ path }) => ({
    root: `${String(path)}/openspec`,
    config_file: "openspec/config.yaml",
    source_specs: 7,
    source_spec_files: [
      "openspec/specs/authentication/spec.md",
      "openspec/specs/account-recovery/spec.md",
      "openspec/specs/admin-api/spec.md",
      "openspec/specs/audit-log/spec.md",
      "openspec/specs/billing/spec.md",
      "openspec/specs/organizations/spec.md",
      "openspec/specs/sessions/spec.md",
    ],
    changes: [
      ...(fixtureSpecCreated && String(path) === fixtureWorktreePath
        ? [
            {
              id: "add-session-device-trust",
              title: "Add session device trust",
              summary:
                "Let people recognize and revoke trusted devices without weakening current session rules.",
              stage: "apply",
              proposal_file:
                "openspec/changes/add-session-device-trust/proposal.md",
              design_file:
                "openspec/changes/add-session-device-trust/design.md",
              tasks_file: "openspec/changes/add-session-device-trust/tasks.md",
              tasks_total: 5,
              tasks_done: 0,
              tasks: [
                { label: "Persist device metadata", done: false },
                { label: "Add trusted device settings", done: false },
              ],
              requirements: [
                {
                  name: "Trusted device visibility",
                  kind: "added",
                  capability: "sessions",
                  file: "openspec/changes/add-session-device-trust/specs/sessions/spec.md",
                  scenarios: ["List active devices", "Revoke another device"],
                },
              ],
              issues: [],
              ready_to_archive: false,
            },
          ]
        : []),
      {
        id: "add-passkey-login",
        title: "Add passkey login",
        summary:
          "Let returning users authenticate with a passkey while preserving the current recovery flow.",
        stage: "apply",
        proposal_file: "openspec/changes/add-passkey-login/proposal.md",
        design_file: "openspec/changes/add-passkey-login/design.md",
        tasks_file: "openspec/changes/add-passkey-login/tasks.md",
        tasks_total: 6,
        tasks_done: 4,
        tasks: [
          { label: "Add WebAuthn challenge endpoints", done: true },
          { label: "Persist credential metadata", done: true },
          { label: "Add passkey sign-in flow", done: true },
          { label: "Cover invalid and expired challenges", done: true },
          { label: "Cover replay protection", done: false },
          { label: "Update recovery documentation", done: false },
        ],
        requirements: [
          {
            name: "Passkey authentication",
            kind: "added",
            capability: "authentication",
            file: "openspec/changes/add-passkey-login/specs/authentication/spec.md",
            scenarios: ["Known credential", "Unknown credential"],
          },
          {
            name: "Challenge replay protection",
            kind: "added",
            capability: "authentication",
            file: "openspec/changes/add-passkey-login/specs/authentication/spec.md",
            scenarios: [],
          },
          {
            name: "Account recovery fallback",
            kind: "modified",
            capability: "account-recovery",
            file: "openspec/changes/add-passkey-login/specs/account-recovery/spec.md",
            scenarios: ["Passkey unavailable"],
          },
        ],
        issues: [
          {
            severity: "warning",
            title: "Add a scenario for Challenge replay protection",
            detail:
              "A requirement without a WHEN/THEN scenario is hard to implement and verify consistently.",
            file: "openspec/changes/add-passkey-login/specs/authentication/spec.md",
          },
          {
            severity: "warning",
            title: "Complete 2 remaining tasks",
            detail:
              "The change should stay active until every implementation and verification task is checked.",
            file: "openspec/changes/add-passkey-login/tasks.md",
          },
        ],
        ready_to_archive: false,
      },
      {
        id: "rate-limit-admin-api",
        title: "Rate limit admin API",
        summary:
          "Protect organization-wide administrative mutations from accidental request bursts.",
        stage: "verify",
        proposal_file: "openspec/changes/rate-limit-admin-api/proposal.md",
        design_file: "openspec/changes/rate-limit-admin-api/design.md",
        tasks_file: "openspec/changes/rate-limit-admin-api/tasks.md",
        tasks_total: 4,
        tasks_done: 4,
        tasks: [
          { label: "Define per-organization budget", done: true },
          { label: "Add rate-limit headers", done: true },
          { label: "Cover burst behavior", done: true },
          { label: "Document client retry behavior", done: true },
        ],
        requirements: [
          {
            name: "Administrative mutation budget",
            kind: "added",
            capability: "admin-api",
            file: "openspec/changes/rate-limit-admin-api/specs/admin-api/spec.md",
            scenarios: ["Within budget", "Budget exceeded"],
          },
        ],
        issues: [],
        ready_to_archive: true,
      },
    ],
  }),
  openspec_create_change: () => {
    fixtureSpecCreated = true;
    localTree.unstaged.push({
      path: "openspec/changes/add-session-device-trust/proposal.md",
      status: "?",
    });
    return {};
  },
  path_is_dir: () => true,
  git_repo_info: () => ({
    remote_url: "git@github.com:acme/ledger-api.git",
    current_branch: localTree.branch,
    dirty: localTree.staged.length + localTree.unstaged.length > 0,
  }),
  git_status: () => ({
    ...localTree,
    staged: [...localTree.staged],
    unstaged: [...localTree.unstaged],
  }),
  git_stage: ({ file }) => {
    const pick =
      file == null
        ? localTree.unstaged
        : localTree.unstaged.filter((f) => f.path === file);
    localTree.staged.push(
      ...pick.map((f) => ({ ...f, status: f.status === "?" ? "A" : f.status })),
    );
    localTree.unstaged = localTree.unstaged.filter((f) => !pick.includes(f));
    return {};
  },
  git_unstage: ({ file }) => {
    const pick =
      file == null
        ? localTree.staged
        : localTree.staged.filter((f) => f.path === file);
    localTree.unstaged.push(
      ...pick.map((f) => ({ ...f, status: f.status === "A" ? "?" : f.status })),
    );
    localTree.staged = localTree.staged.filter((f) => !pick.includes(f));
    return {};
  },
  git_diff_file: ({ file }) => localPatch(String(file)),
  git_staged_diff: () =>
    localTree.staged.map((f) => localPatch(f.path)).join("\n"),
  git_commit: ({ message }) => {
    localLog.unshift({
      hash: Math.random().toString(16).slice(2, 12),
      short: "new1234",
      author: "volnei",
      date: new Date().toISOString(),
      subject: String(message).split("\n")[0],
    });
    localTree.staged = [];
    localTree.ahead += 1;
    return {};
  },
  git_discard: ({ file }) => {
    localTree.unstaged = localTree.unstaged.filter((f) => f.path !== file);
    return {};
  },
  git_push: () => {
    localTree.ahead = 0;
    localTree.upstream = true;
    return {};
  },
  git_pull: () => {
    localTree.behind = 0;
    return {};
  },
  git_fetch: () => ({}),
  git_log: () => localLog,
  git_show: () =>
    `${localPatch("src/metrics/retry.ts")}\n${localPatch("src/payments/Retry.ts")}`,
  git_branches: () => ({ current: localTree.branch, all: localBranches }),
  git_checkout: ({ branch }) => {
    localTree.branch = String(branch);
    return {};
  },
  git_create_branch: ({ name }) => {
    localTree.branch = String(name);
    localTree.upstream = false;
    localTree.ahead = 0;
    return {};
  },
  git_worktrees: ({ path }) => [
    { path: String(path), branch: "main" },
    ...(fixtureWorktreePath
      ? [{ path: fixtureWorktreePath, branch: localTree.branch }]
      : []),
  ],
  git_create_worktree: ({ branch }) => {
    localTree.branch = String(branch);
    localTree.staged = [];
    localTree.unstaged = [];
    fixtureWorktreePath = `/tmp/reviewly-worktrees/ledger-api/${String(branch).replaceAll("/", "-")}`;
    return fixtureWorktreePath;
  },
  git_merge_lab: ({ prs }) => ({
    clean: false,
    base: "7e3fa2197dc9a0b5a4c135889d06c8fe83df1210",
    applied: (prs as number[]).slice(0, 1),
    conflicts: ["src/payments/Intents.ts", "src/payments/Retry.ts"],
    changedFiles: [
      "src/payments/Intents.ts",
      "migrations/0042_idempotency_keys.sql",
    ],
    durationMs: 1840,
  }),
  git_branch_changes: () => ({
    base: "main",
    files: [
      { path: "src/metrics/retry.ts", additions: 18, deletions: 2 },
      { path: "src/payments/Retry.ts", additions: 6, deletions: 1 },
    ],
  }),
  gh_pr_create: () =>
    `https://github.com/acme/ledger-api/pull/${++fixturePrNumber}`,
  gh_list_branches: () => ({
    default: "main",
    branches: ["main", "marina/idempotency-keys"],
  }),
  gh_mark_all_notifications_read: () => ({}),
  dependabot_inflight: () => [],
  gh_dependabot_ai_fix_bg: ({ key }) => {
    setTimeout(
      () =>
        emit("dependabot:done", {
          key: String(key),
          ok: true,
          url: "https://github.com/acme/ledger-api/pull/2190",
        }),
      2500,
    );
    return null;
  },
  gh_get_file_content: ({ path }) =>
    Array.from(
      { length: 160 },
      (_, i) => `// ${String(path).split("/").pop()} line ${i + 1}`,
    ).join("\n"),
  gh_repo_labels: () => [
    { id: 1, name: "payments", color: "5319e7", description: null },
    {
      id: 2,
      name: "migration",
      color: "d93f0b",
      description: "touches the schema",
    },
    { id: 3, name: "needs-qa", color: "fbca04", description: null },
    { id: 4, name: "docs", color: "0e8a16", description: null },
  ],
  gh_repo_collaborators: () => [marina, pedro, me, user("joao", 1003)],
  gh_get_requested_reviewers: () => ({ users: [me], teams: [] }),
  gh_request_reviewers: () => ({}),
  gh_remove_reviewers: () => ({}),
  gh_update_pr: ({ title, body }) => {
    if (typeof title === "string") pullPatch = { ...pullPatch, title };
    if (typeof body === "string") pullPatch = { ...pullPatch, body };
    return {};
  },
  gh_set_pr_state: ({ open }) => {
    pullPatch = { ...pullPatch, state: open ? "open" : "closed" };
    return {};
  },
  gh_pr_node_id: () => "PR_fixture_2184",
  gh_set_draft: ({ draft }) => {
    pullPatch = { ...pullPatch, draft: !!draft };
    return {};
  },
  gh_merge_pr: () => {
    pullPatch = { ...pullPatch, merged: true, state: "closed" };
    return {};
  },
  gh_enable_auto_merge: ({ method }) => {
    pullPatch = {
      ...pullPatch,
      auto_merge: { merge_method: String(method), enabled_by: me },
    };
    return {};
  },
  gh_disable_auto_merge: () => {
    pullPatch = { ...pullPatch, auto_merge: null };
    return {};
  },
  gh_update_branch: () => ({}),
  gh_list_reactions: ({ id }) => reactions.get(num(id)) ?? [],
  gh_react: ({ id, content }) => {
    const r = {
      id: nextReaction++,
      content: String(content),
      user: { login: "volnei" },
    };
    reactions.set(num(id), [...(reactions.get(num(id)) ?? []), r]);
    return r;
  },
  gh_unreact: ({ id, reactionId }) => {
    reactions.set(
      num(id),
      (reactions.get(num(id)) ?? []).filter((r) => r.id !== num(reactionId)),
    );
    return {};
  },
  gh_edit_issue_comment: () => ({}),
  gh_delete_issue_comment: () => ({}),
  gh_edit_review_comment: () => ({}),
  gh_delete_review_comment: () => ({}),
  gh_required_contexts: () => ["build / lint", "test / unit"],
  gh_check_annotations: () => [
    {
      path: "src/payments/Intents.test.ts",
      start_line: 48,
      end_line: 48,
      annotation_level: "failure",
      message: "Expected 1 intent, received 2",
      title: "replay returns the first intent",
    },
  ],
  gh_rerun_job: () => ({}),
  gh_rerun_failed_jobs: () => ({}),
  gh_rerun_check: () => ({}),
  gh_pr_checkout: () => ({}),
  local_editor_targets: () => [
    {
      id: "vscode",
      label: "Visual Studio Code",
      isDefault: true,
      iconDataUrl: null,
    },
    { id: "zed", label: "Zed", isDefault: false, iconDataUrl: null },
  ],
  open_local_editor: () => ({}),
  gh_resolve_conflicts_ai: () => "resolved",
  gh_fetch_attachment: ({ url }) => {
    // A graphite card with the file name on it — enough to see the media path work.
    const name = String(url).split("/").pop() ?? "attachment";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" rx="8" fill="#242424"/><rect x="24" y="24" width="592" height="200" rx="6" fill="#1e1e1e" stroke="#3a3a3a"/><rect x="48" y="56" width="220" height="14" rx="3" fill="#8a8a8a"/><rect x="48" y="86" width="340" height="10" rx="3" fill="#555"/><rect x="48" y="108" width="300" height="10" rx="3" fill="#555"/><rect x="48" y="160" width="120" height="32" rx="6" fill="#f1f1f1"/><text x="48" y="268" font-family="monospace" font-size="14" fill="#ababab">${name}</text></svg>`;
    return {
      content_type: "image/svg+xml",
      data_b64: btoa(svg),
      size: svg.length,
    };
  },
  auth_status: () => ({ signed_in: true, viewer }),
  auth_gh_available: () => true,
  auth_device_start: () => ({
    user_code: "ABCD-1234",
    verification_uri: "https://github.com/login/device",
    expires_in: 900,
    interval: 5,
    device_code: "dev",
  }),
  auth_device_poll: () => viewer,
  auth_use_gh_cli: () => viewer,
  auth_sign_out: () => null,
  gh_dashboard: () => ({
    reviewRequested: incoming.length,
    mentions: 1,
    opened: mine.length,
    approved: 1,
    changesRequested: 1,
    awaitingReview: 2,
    draft: 1,
    ciPass: 7,
    ciFail: 1,
    ciPending: 0,
    stale: 1,
    incoming,
    mine,
  }),
  gh_list_repos: () => [
    "acme/ledger-api",
    "acme/web",
    "acme/infra",
    "volnei/reviewly",
  ],
  gh_get_pull: () => ({ ...pull, ...pullPatch }),
  gh_list_pull_files: () => files,
  gh_list_review_comments: () => reviewComments,
  gh_list_review_threads: () => reviewThreads,
  gh_list_reviews: () => reviews,
  gh_list_issue_comments: () => issueComments,
  gh_list_commits: () => commits,
  gh_list_checks: () => checks,
  gh_submit_review: () => ({ ok: true }),
  gh_create_issue_comment: () => ({ ok: true }),
  gh_create_review_comment: ({ path, line, side, body }) => {
    const id = 950 + reviewComments.length;
    reviewComments.push({
      id,
      pull_request_review_id: 1,
      diff_hunk: "",
      path: String(path),
      commit_id: pull.head.sha,
      user: me,
      body: String(body),
      created_at: ago(0),
      updated_at: ago(0),
      html_url: "#",
      line: num(line),
      original_line: num(line),
      side: String(side),
      in_reply_to_id: null,
    });
    return { id };
  },
  gh_reply_review_comment: () => ({ ok: true }),
  gh_resolve_thread: () => null,
  gh_list_notifications: () => notifications,
  gh_mark_notification_read: () => null,
  gh_dependabot_alerts: (a) => alerts[`${a.owner}/${a.repo}`] ?? [],
  gh_user: (a) => ({
    login: String(a.login),
    name: null,
    avatar_url: av(String(a.login)),
    html_url: "#",
    bio: null,
    company: null,
    location: null,
    followers: 12,
    following: 7,
    public_repos: 30,
  }),
  gh_activity: () => activity,
  gh_search: () => [],
  gh_list_repos_open_prs: () => [],
  tray_set_title: () => null,
  set_watched_repos: () => null,
  set_poll_interval: () => null,
  set_notifications_enabled: () => null,
  set_notification_reasons: () => null,
  set_launch_at_login: () => null,
  get_launch_at_login: () => false,
  set_start_in_tray: () => null,
  set_app_icon: () => null,
  ai_available: (a) => a.provider === "claude",
  ai_stream: (a) => {
    const key = String(a.key),
      prompt = String(a.prompt);
    if (/simulate timeout/i.test(prompt)) {
      setTimeout(
        () =>
          emit("ai:progress", {
            key,
            provider: String(a.provider ?? "claude"),
            phase: "thinking",
            message: "Analyzing the current specs",
            model: "claude-sonnet-5",
            sessionId: "fixture-timeout",
            inputTokens: 12480,
            cachedTokens: 8160,
          }),
        100,
      );
      setTimeout(
        () =>
          emit("ai:complete", {
            key,
            ok: false,
            error:
              "Claude produced no activity for 900s and was stopped. Try again, or increase the AI inactivity limit in Settings.",
          }),
        650,
      );
      return null;
    }
    const text = prompt.startsWith("SPEC LENS DRAFT")
      ? '{"id":"add-session-device-trust","title":"Add session device trust","summary":"Let people recognize and revoke trusted devices without weakening current session rules.","proposal":"# Add session device trust\\n\\nLet people recognize and revoke trusted devices while preserving the current session lifetime and recovery rules.\\n\\n## Why\\nUsers cannot currently distinguish their active sessions by device or revoke one device safely.","design":"# Design\\n\\nStore a stable device label and last-seen metadata beside each session. Revocation remains server-authoritative and invalidates only the selected session.","tasks":"# Tasks\\n\\n- [ ] Persist device metadata for new sessions\\n- [ ] List trusted devices in account settings\\n- [ ] Revoke one device without ending the current session\\n- [ ] Add unit and integration coverage\\n- [ ] Document recovery interaction","specs":[{"capability":"sessions","content":"## ADDED Requirements\\n\\n### Requirement: Trusted device visibility\\nUsers SHALL see the devices associated with their active sessions.\\n\\n#### Scenario: List active devices\\n- **WHEN** an authenticated user opens session settings\\n- **THEN** every active session shows its device label and last-seen time\\n\\n### Requirement: Per-device revocation\\nUsers SHALL revoke one trusted device without ending unrelated sessions.\\n\\n#### Scenario: Revoke another device\\n- **WHEN** a user revokes an active device\\n- **THEN** only that device session becomes invalid"}],"delivery":{"mode":"stack","rationale":"The session model and API can land before the settings experience consumes them.","pullRequests":[{"id":"session-foundation","title":"Persist trusted session metadata","goal":"Add the storage model and server-side session revocation contract.","validation":"Run session model and API integration tests."},{"id":"device-settings","title":"Add trusted device settings","goal":"Expose device visibility and per-device revocation in account settings.","validation":"Run settings UI tests and the session revocation end-to-end flow."}]}}'
      : prompt.startsWith("SPEC LENS SEARCH")
        ? '{"answer":"Authentication is governed by three current capability specs: credentials establish identity, account recovery is the fallback when a credential is unavailable, and sessions define the resulting authenticated lifetime. Active change proposals are not treated as current rules.","sources":[{"path":"openspec/specs/authentication/spec.md","reason":"Defines the accepted authentication paths and credential behavior."},{"path":"openspec/specs/account-recovery/spec.md","reason":"Defines the fallback when primary authentication is unavailable."},{"path":"openspec/specs/sessions/spec.md","reason":"Defines the session created after successful authentication."}]}'
        : prompt.startsWith("Write a single git commit message")
          ? "feat(metrics): count retries per intent\n\nEmit one counter per retry path so the dashboard can tell a replay from a new attempt."
          : prompt.includes("verifying ONE code-review concern")
            ? '{"verdict":"valid","finding":"`requireIdempotencyKey` is applied to the whole router in `src/http/routes.ts`, so `/settlements` rejects writes without the header too. Scope it to `/intents`, or say so in the description."}'
            : prompt.includes("decide what to open first")
              ? "Adds a client-supplied idempotency key so a retried create returns the first intent instead of making a second one. Worth a look: the partial unique index excludes voided intents, so a retry after a void makes a new intent on purpose."
              : prompt.includes("CUT IT INTO LAYERS")
                ? LAYERED_ANSWER
                : prompt.includes("GUIDED TOUR")
                  ? GUIDED_ANSWER
                  : /review it for me/i.test(prompt)
                    ? CHAT_ANSWER + REVIEW_ACTION
                    : CHAT_ANSWER;
    streamCanned(key, text, String(a.provider ?? "claude"));
    return null;
  },
  ai_cancel: (a) => {
    emit("ai:done", { key: String(a.key), canceled: true });
    return true;
  },
  ai_apply: () => {
    fixtureApplyNumber += 1;
    localTree.unstaged.push({
      path: `src/session/device-trust-${fixtureApplyNumber}.ts`,
      status: "M",
    });
    return '<reviewly-result>{"ok":true,"summary":"Implemented device trust and covered revocation behavior.","tests":"18 tests passed"}</reviewly-result>';
  },
};

export const TauriFixtures = Layer.succeed(Tauri, {
  native: false,
  invoke: <A>(
    cmd: string,
    args: Record<string, unknown>,
    schema: Schema.Codec<A, unknown>,
  ) => {
    const h = commands[cmd];
    if (!h)
      return Effect.fail(
        new TauriError({ cmd, message: `no fixture for ${cmd}` }),
      );
    return Effect.sleep("120 millis").pipe(
      Effect.flatMap(() =>
        Schema.decodeUnknownEffect(schema)(h(args)).pipe(
          Effect.mapError(
            (issue) => new DecodeError({ cmd, message: String(issue) }),
          ),
        ),
      ),
      Effect.tap((result) =>
        Effect.promise(() =>
          import("@/features/history/commands").then(
            ({ recordCompletedCommand }) =>
              recordCompletedCommand(cmd, args, result),
          ),
        ),
      ),
    );
  },
  listen: <A>(
    name: string,
    schema: Schema.Codec<A, unknown>,
    handler: (a: A) => void,
  ) =>
    Effect.sync(() => {
      const decode = Schema.decodeUnknownSync(schema);
      const h = (payload: unknown) => {
        try {
          handler(decode(payload));
        } catch {
          /* not for us */
        }
      };
      const set = bus.get(name) ?? new Set();
      set.add(h);
      bus.set(name, set);
      return () => void set.delete(h);
    }),
  events: <A>(name: string, schema: Schema.Codec<A, unknown>) =>
    Stream.callback<A>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const decode = Schema.decodeUnknownSync(schema);
          const h = (payload: unknown) => {
            try {
              Queue.offerUnsafe(queue, decode(payload));
            } catch {
              /* not for us */
            }
          };
          const set = bus.get(name) ?? new Set();
          set.add(h);
          bus.set(name, set);
          return () => void set.delete(h);
        }),
        (off) => Effect.sync(() => off()),
      ).pipe(Effect.asVoid),
    ),
} satisfies TauriShape);
