import { toast } from "@/app/toast";
import { run, useEffectQuery } from "@/effect/runtime";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { usePrefs } from "@/effect/services/Prefs";
import { prContext } from "@/features/pr/ai";
import { AskPanel } from "@/features/pr/ask";
import { useLocalClone } from "@/features/pr/clone";
import { updateReview } from "@/features/pr/review-state";
import type { AiAction } from "@/lib/ai-actions";
import { useParams } from "@tanstack/react-router";
import { Effect } from "effect";
import { useCallback, useMemo } from "react";

/**
 * The Ask conversation in a window of its own, beside the app: the same
 * transcript (both windows read one store), the same diff, the same actions.
 * A draft it adds lands in your review in the main window; a review it
 * proposes waits there for you to send.
 */
export function ChatWindowScreen() {
  const params = useParams({ strict: false }) as { owner: string; repo: string; number: string };
  const ref = useMemo<PrRef>(
    () => ({ owner: params.owner, repo: params.repo, number: Number(params.number) }),
    [params.owner, params.repo, params.number],
  );
  const prKey = `${ref.owner}/${ref.repo}#${ref.number}`;
  const prefs = usePrefs();
  const clone = useLocalClone(ref.owner, ref.repo);
  const pull = useEffectQuery(
    ["pull", ref.owner, ref.repo, ref.number, "detail"],
    Effect.flatMap(GitHub, (g) => g.pull(ref)),
    { staleTime: 60_000 },
  );
  const files = useEffectQuery(
    ["pull", ref.owner, ref.repo, ref.number, "files"],
    Effect.flatMap(GitHub, (g) => g.files(ref)),
    { staleTime: 60_000 },
  );
  const context = useMemo(
    () => (pull.data ? prContext(pull.data, files.data ?? [], ref) : ""),
    [pull.data, files.data, ref],
  );

  const runAction = useCallback(
    async (a: AiAction) => {
      switch (a.type) {
        case "inline_comment": {
          if (!(files.data ?? []).some((f) => f.filename === a.path)) {
            toast.fail(`${a.path} isn’t in this diff`);
            throw new Error("not in diff");
          }
          updateReview(prKey, (r) => ({
            ...r,
            drafts: [
              ...r.drafts,
              {
                key: `${a.path}:${a.side === "LEFT" ? "L" : "R"}${a.line}:${Date.now()}`,
                path: a.path,
                side: a.side === "LEFT" ? "L" : "R",
                line: a.line,
                body: a.body,
              },
            ],
          }));
          toast.say("Added to your review as a draft", "It shows in the main window.");
          return;
        }
        case "review":
          updateReview(prKey, (r) => ({ ...r, body: a.body, event: a.event }));
          toast.say("Saved to your review", "Send it from the main window.");
          return;
        case "comment":
          await run(Effect.flatMap(GitHub, (g) => g.comment(ref, a.body)));
          toast.say("Comment posted");
          return;
        case "label": {
          const names = new Set((pull.data?.labels ?? []).map((l) => l.name));
          for (const n of a.add) names.add(n);
          for (const n of a.remove) names.delete(n);
          await run(Effect.flatMap(GitHub, (g) => g.setLabels(ref, [...names])));
          toast.say("Labels updated");
        }
      }
    },
    [files.data, prKey, pull.data?.labels, ref],
  );

  return (
    <div className="flex h-full flex-col bg-desk">
      <header
        data-tauri-drag-region
        className="flex h-[42px] shrink-0 items-center border-b border-hair pl-[84px] pr-3 text-[12.5px] text-ink-2"
      >
        <span className="pointer-events-none truncate">
          {pull.data
            ? pull.data.title
            : pull.isError
              ? "Couldn’t load the pull request"
              : "Loading…"}
        </span>
      </header>
      <div className="min-h-0 flex-1">
        {pull.data ? (
          <AskPanel
            mode="window"
            prKey={prKey}
            prRef={ref}
            context={context}
            cwd={clone}
            instructions={prefs.ai.instructions}
            onAction={runAction}
          />
        ) : null}
      </div>
    </div>
  );
}
