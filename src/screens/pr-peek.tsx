import type * as S from "@/effect/schema";
import { providerName } from "@/effect/services/Ai";
import { usePrefs } from "@/effect/services/Prefs";
import type { Ranked } from "@/effect/services/Triage";
import { prereadNow } from "@/features/list/preread";
import { useBackgroundRun } from "@/features/pr/ai";
import { pullKey } from "@/features/pr/model";
import { useSummary } from "@/features/pr/plans-store";
import { readingMinutes } from "@/lib/estimate";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useItemActions, useOpenItem } from "./inbox";

/**
 * `space` on a pull request: the paragraph the model read ahead, the size and
 * the time it takes, what is waiting in it, and the two things to do.
 */
export function PrPeek({ item }: { item: Ranked }) {
  const qc = useQueryClient();
  const provider = usePrefs((p) => p.ai.provider);
  const open = useOpenItem();
  const { snooze } = useItemActions();
  const key =
    item.owner && item.repoName && item.number
      ? `${item.owner}/${item.repoName}#${item.number}`
      : "";
  const ref = { owner: item.owner ?? "", repo: item.repoName ?? "", number: item.number ?? 0 };
  const summary = useSummary(key);
  const run = useBackgroundRun(`summary:${key}`);
  const pull = useQuery<S.PullDetail>({ queryKey: pullKey(ref, "detail"), enabled: false });
  const files = useQuery<ReadonlyArray<S.PullFile>>({
    queryKey: pullKey(ref, "files"),
    enabled: false,
  });
  const p = pull.data;
  const adds = p?.additions ?? files.data?.reduce((n, f) => n + f.additions, 0);
  const dels = p?.deletions ?? files.data?.reduce((n, f) => n + f.deletions, 0);
  const nFiles = p?.changed_files ?? files.data?.length;
  return (
    <div className="grid max-w-[760px] gap-2 text-[13px]">
      {summary ? (
        <p className="ai-soft selectable flex items-start gap-2 px-3 py-2 text-ink">
          <Sparkles className="ai-spark mt-[3px] size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span>{summary.text}</span>
        </p>
      ) : run?.running ? (
        <p className="flex items-center gap-2 text-ink-3">
          <span className="ai-dot size-1.5 animate-pulse rounded-full" aria-hidden />
          <span className="ai-ink font-medium">Reading</span> with {providerName(provider)}…
        </p>
      ) : (
        <p className="flex items-center gap-2 text-ink-3">
          Not read yet.
          <button
            type="button"
            onClick={() => prereadNow(qc, key)}
            className="ai-button h-6 px-2.5 text-[12px] font-medium"
          >
            Read it now
          </button>
        </p>
      )}
      <p className="tnum text-[12.5px] text-ink-3">
        {nFiles != null ? `${nFiles} file${nFiles === 1 ? "" : "s"}` : "size unknown yet"}
        {adds != null && dels != null ? (
          <>
            {" "}
            <span className="text-add">+{adds}</span> <span className="text-del">−{dels}</span>
            {" · "}~{readingMinutes(adds, dels, nFiles ?? 1)} min
          </>
        ) : null}
        {item.unresolved
          ? ` · ${item.unresolved} thread${item.unresolved === 1 ? "" : "s"} open`
          : ""}
        {item.ci === "failure" ? " · CI failing" : item.ci === "success" ? " · checks green" : ""}
        {item.draft ? " · draft" : ""}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => open(item)}
          className="h-7 rounded-md border border-ink bg-ink px-2.5 text-[12.5px] font-medium text-[#141414]"
        >
          Open
        </button>
        <button
          type="button"
          onClick={() => snooze(item)}
          className="h-7 rounded-md border border-edge px-2.5 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
        >
          Snooze until tomorrow
        </button>
      </div>
    </div>
  );
}
