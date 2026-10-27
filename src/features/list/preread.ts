import { run } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { AppSettings } from "@/effect/services/AppSettings";
import { prefsStore, usePrefs } from "@/effect/services/Prefs";
import type { Ranked } from "@/effect/services/Triage";
import { prContext, startBackground, summaryPrompt } from "@/features/pr/ai";
import { prefetchPull, pullKey } from "@/features/pr/model";
import { getSummary, saveSummary } from "@/features/pr/plans-store";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useEffect } from "react";

/**
 * The app reads ahead of you: the first pull requests of the queue get their
 * detail and files into the cache, and the model writes one paragraph about
 * each, one at a time, so a peek or an open finds it already there.
 */
let available: boolean | null = null;
const queue: string[] = [];
const queued = new Set<string>();
let busy = false;
let active: string | null = null;
const MAX_QUEUE = 20;

function enqueue(id: string, first = false) {
  if (queued.has(id) || active === id) return;
  queued.add(id);
  if (first) queue.unshift(id);
  else queue.push(id);
  while (queue.length > MAX_QUEUE) {
    const dropped = queue.pop();
    if (dropped) queued.delete(dropped);
  }
}

async function next(qc: QueryClient) {
  if (busy) return;
  const id = queue.shift();
  if (!id) return;
  queued.delete(id);
  active = id;
  busy = true;
  try {
    const m = id.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!m) return;
    const ref = { owner: m[1], repo: m[2], number: Number(m[3]) };
    await prefetchPull(qc, ref);
    const pull = qc.getQueryData<S.PullDetail>(pullKey(ref, "detail"));
    const files = qc.getQueryData<ReadonlyArray<S.PullFile>>(pullKey(ref, "files"));
    const prefs = prefsStore.get();
    if (!pull || !files || !prefs.ai.preread) return;
    const key = `${ref.owner}/${ref.repo}#${ref.number}`;
    if (getSummary(key)?.headSha === pull.head.sha) return;
    if (available == null) {
      available = await run(
        Effect.flatMap(AppSettings, (a) => a.aiAvailable(prefs.ai.provider)),
      ).catch(() => false);
    }
    if (!available) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };
      // A run that fails or is cancelled never calls back: give it a bound.
      const timeout = setTimeout(finish, 4 * 60_000);
      startBackground(
        `summary:${key}`,
        summaryPrompt(prContext(pull, files, ref), {
          instructions: prefs.ai.instructions,
          hasClone: false,
        }),
        null,
        "Reading ahead",
        (text) => {
          if (text.trim()) saveSummary(key, text.trim(), pull.head.sha);
          finish();
        },
      );
    });
  } finally {
    active = null;
    busy = false;
    void next(qc);
  }
}

/** Queue the first few pull requests of a list. Harmless to call again: nothing is read twice. */
export function usePreread(items: ReadonlyArray<Ranked>, count = 3) {
  const qc = useQueryClient();
  const on = usePrefs((p) => p.ai.preread);
  const ids = items
    .filter((i) => i.kind === "pr" && i.owner && i.repoName && i.number)
    .slice(0, count)
    .map((i) => `${i.owner}/${i.repoName}#${i.number}`)
    .join(",");
  useEffect(() => {
    if (!on || !ids) return;
    for (const id of ids.split(",")) enqueue(id);
    void next(qc);
  }, [ids, on, qc]);
}

/** Read one pull request now, ahead of the queue. */
export function prereadNow(qc: QueryClient, id: string) {
  enqueue(id, true);
  void next(qc);
}
