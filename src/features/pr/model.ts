import { run } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { type QueryClient, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useCallback, useMemo } from "react";

/** A review thread as the page shows it: the comments in order, resolved or not, and the node id to resolve it. */
export interface Thread {
  readonly key: string;
  readonly nodeId: string | null;
  readonly path: string;
  readonly line: number | null;
  readonly side: string | null;
  readonly resolved: boolean;
  readonly comments: ReadonlyArray<S.ReviewComment>;
}

function buildThreads(
  comments: ReadonlyArray<S.ReviewComment>,
  gql: ReadonlyArray<S.ReviewThreadGraphQL>,
): Thread[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c: S.ReviewComment): S.ReviewComment => {
    let cur = c;
    for (let i = 0; i < 50 && cur.in_reply_to_id != null; i++) {
      const parent = byId.get(cur.in_reply_to_id);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  };
  const groups = new Map<number, S.ReviewComment[]>();
  for (const c of comments) {
    const root = rootOf(c);
    const g = groups.get(root.id) ?? [];
    g.push(c);
    groups.set(root.id, g);
  }
  const gqlByComment = new Map<number, S.ReviewThreadGraphQL>();
  for (const t of gql) for (const id of t.comment_ids) gqlByComment.set(id, t);
  return [...groups.entries()].map(([rootId, cs]) => {
    cs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const root = cs[0];
    const t = gqlByComment.get(rootId) ?? null;
    return {
      key: `t${rootId}`,
      nodeId: t?.id ?? null,
      path: root.path,
      line: root.line ?? root.original_line,
      side: root.side,
      resolved: t?.is_resolved ?? false,
      comments: cs,
    };
  });
}

export const pullKey = (ref: PrRef, name: string) =>
  ["pull", ref.owner, ref.repo, ref.number, name] as const;

/** A review is a decision on an active change, never on its immutable final state. */
export const isReviewablePull = (pull: Pick<S.PullDetail, "state" | "merged"> | null | undefined) =>
  Boolean(pull && pull.state === "open" && pull.merged !== true);

/** The PR's detail and files into the cache ahead of time, under the keys the page reads. */
export function prefetchPull(qc: QueryClient, ref: PrRef) {
  return Promise.all([
    qc.prefetchQuery({
      queryKey: pullKey(ref, "detail"),
      queryFn: () => run(Effect.flatMap(GitHub, (g) => g.pull(ref))),
      staleTime: 60_000,
    }),
    qc.prefetchQuery({
      queryKey: pullKey(ref, "files"),
      queryFn: () => run(Effect.flatMap(GitHub, (g) => g.files(ref))),
      staleTime: 60_000,
    }),
  ]);
}

/** Everything the PR page reads, as parallel queries. The page draws what has arrived. */
export function usePullRequest(ref: PrRef) {
  const key = (name: string) => ["pull", ref.owner, ref.repo, ref.number, name] as const;
  const gh =
    <A>(f: (g: typeof GitHub.Service) => Effect.Effect<A, unknown, GitHub>) =>
    () =>
      run(Effect.flatMap(GitHub, f));
  const [pull, files, reviewComments, reviewThreads, reviews, issueComments, commits] = useQueries({
    queries: [
      { queryKey: key("detail"), queryFn: gh((g) => g.pull(ref)), staleTime: 60_000 },
      { queryKey: key("files"), queryFn: gh((g) => g.files(ref)), staleTime: 60_000 },
      {
        queryKey: key("review-comments"),
        queryFn: gh((g) => g.reviewComments(ref)),
        staleTime: 30_000,
      },
      {
        queryKey: key("review-threads"),
        queryFn: gh((g) => g.reviewThreads(ref)),
        staleTime: 30_000,
      },
      { queryKey: key("reviews"), queryFn: gh((g) => g.reviews(ref)), staleTime: 30_000 },
      {
        queryKey: key("issue-comments"),
        queryFn: gh((g) => g.issueComments(ref)),
        staleTime: 30_000,
      },
      { queryKey: key("commits"), queryFn: gh((g) => g.commits(ref)), staleTime: 120_000 },
    ],
  });
  const sha = pull.data?.head.sha;
  const checks = useQuery<S.CheckRuns>({
    queryKey: key(`checks:${sha ?? ""}`),
    queryFn: gh((g) => g.checks(ref.owner, ref.repo, sha ?? "")),
    enabled: !!sha,
    staleTime: 10_000,
    // While something runs, ask again every few seconds; once all are done, stop.
    refetchInterval: (q) => {
      if (q.state.error) return 30_000;
      return q.state.data?.check_runs.some((r) => r.status !== "completed") ? 15_000 : false;
    },
  });
  const threads = useMemo(
    () => buildThreads(reviewComments.data ?? [], reviewThreads.data ?? []),
    [reviewComments.data, reviewThreads.data],
  );
  const qc = useQueryClient();
  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: ["pull", ref.owner, ref.repo, ref.number] }),
    [qc, ref.owner, ref.repo, ref.number],
  );
  return {
    pull,
    files,
    reviews,
    issueComments,
    commits,
    checks,
    threads,
    loading: pull.isLoading || files.isLoading,
    error: pull.error ?? files.error,
    refresh,
  };
}
