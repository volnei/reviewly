import { useMemo } from "react";
import { Effect } from "effect";

import { useFastLanePolicies } from "@/app/fast-lane";
import { usePullRequestInbox } from "@/app/workspace";
import { useEffectQuery } from "@/effect/runtime";
import { GitHub } from "@/effect/services/GitHub";
import type { Ranked } from "@/effect/services/Triage";
import {
  isFastLane,
  isFastLaneCandidate,
  requiresFastLaneFiles,
  type FastLaneFileFacts,
} from "@/features/fast-lane";

export function useFastLaneItems() {
  const inbox = usePullRequestInbox();
  const policies = useFastLanePolicies();
  const active = useMemo(
    () => (inbox.data ? [...inbox.data.turn, ...inbox.data.unsorted] : []),
    [inbox.data],
  );
  const enabled = useMemo(
    () =>
      new Map(
        (policies.data ?? [])
          .filter(({ policy }) => policy.enabled)
          .map(({ organization, policy }) => [organization.login.toLowerCase(), policy] as const),
      ),
    [policies.data],
  );
  const candidates = useMemo(
    () =>
      active.filter((item) => {
        const policy = enabled.get(item.repo.split("/")[0]?.toLowerCase() ?? "");
        return (
          policy &&
          requiresFastLaneFiles(policy) &&
          item.owner &&
          item.repoName &&
          item.number &&
          isFastLaneCandidate(item, policy)
        );
      }),
    [active, enabled],
  );
  const signature = candidates.map((item) => item.id).sort().join(",");
  const facts = useEffectQuery(
    ["teams", "fast-lane", "changed-paths", signature],
    Effect.forEach(
      candidates,
      (item) =>
        Effect.flatMap(GitHub, (github) =>
          github.files({
            owner: item.owner ?? "",
            repo: item.repoName ?? "",
            number: item.number ?? 0,
          }),
        ).pipe(
          Effect.map(
            (files) =>
              [
                item.id,
                {
                  paths: files.map((file) => file.filename),
                  changedFiles: files.length,
                  changedLines: files.reduce((sum, file) => sum + file.changes, 0),
                } satisfies FastLaneFileFacts,
              ] as const,
          ),
          Effect.orElseSucceed(() => [item.id, null] as const),
        ),
      { concurrency: 3 },
    ).pipe(
      Effect.map(
        (entries) =>
          new Map<string, FastLaneFileFacts | null>(
            entries as ReadonlyArray<readonly [string, FastLaneFileFacts | null]>,
          ),
      ),
    ),
    { enabled: candidates.length > 0, staleTime: 30_000 },
  );
  const items = useMemo(
    () =>
      active.filter((item: Ranked) => {
        const policy = enabled.get(item.repo.split("/")[0]?.toLowerCase() ?? "");
        return policy ? isFastLane(item, policy, facts.data?.get(item.id)) : false;
      }),
    [active, enabled, facts.data],
  );

  return {
    items,
    isPending: inbox.isPending || policies.isPending || (candidates.length > 0 && facts.isPending),
    isError: inbox.isError || policies.isError,
  };
}
