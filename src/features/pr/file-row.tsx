import { Button } from "@/components/ui/button";
import type * as S from "@/effect/schema";
import { HIDE_LABEL, type HideReason } from "@/lib/focus";
import { cn } from "@/lib/utils";
import { Check, Circle } from "lucide-react";

/** One letter for what happened to the file, before its name. */
const STATUS: Record<string, [string, string]> = {
  added: ["A", "added"],
  removed: ["D", "deleted"],
  renamed: ["R", "renamed"],
  copied: ["C", "copied"],
  modified: ["M", "modified"],
};

/** One file in the column: read mark, status, name, threads, drafts, churn. */
export function FileRow({
  f,
  read,
  threads,
  drafts,
  current,
  quiet,
  reason,
  onSelect,
}: {
  f: S.PullFile;
  read: boolean;
  threads: number;
  drafts: number;
  current: boolean;
  quiet?: boolean;
  /** Why the file is folded: a lockfile, generated, only formatting… */
  reason?: HideReason | null;
  onSelect: () => void;
}) {
  const [letter, word] = STATUS[f.status] ?? ["M", f.status];
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      onClick={onSelect}
      aria-current={current ? "true" : undefined}
      title={f.filename}
      className={cn(
        "pr-file-row mx-2 grid h-8 w-[calc(100%-1rem)] grid-cols-[13px_9px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md px-2.5 text-left text-[12px] font-normal",
        current
          ? "bg-raise/80 text-ink"
          : quiet
            ? "text-ink-3 hover:bg-raise/40 hover:text-ink-2"
            : "text-ink-2 hover:bg-raise/40 hover:text-ink",
      )}
    >
      <span
        className={cn(
          "flex size-3.5 items-center justify-center",
          read ? "text-ok" : "text-ink-3/70",
        )}
        aria-label={read ? "read" : "unread"}
      >
        {read ? (
          <Check className="size-3.5" strokeWidth={2} />
        ) : (
          <Circle className="size-3" strokeWidth={1.5} />
        )}
      </span>
      <span
        className={cn(
          "mono text-[10.5px]",
          f.status === "added" ? "text-add" : f.status === "removed" ? "text-del" : "text-ink-3",
        )}
        aria-label={word}
        title={word}
      >
        {letter}
      </span>
      <span className="mono truncate text-[11.5px]">{f.filename.split("/").pop()}</span>
      <span className="file-churn tnum flex items-center gap-1 text-[10.5px]">
        {reason ? <span className="font-sans text-ink-3">{HIDE_LABEL[reason]}</span> : null}
        {threads ? <span className="rounded-[3px] bg-raise px-1 text-ink-2">{threads}</span> : null}
        {drafts ? (
          <span className="rounded-[3px] border border-edge px-1 text-ink-2">{drafts}</span>
        ) : null}
        {f.additions ? <span className="text-add">+{f.additions}</span> : null}
        {f.deletions ? <span className="text-del">−{f.deletions}</span> : null}
      </span>
    </Button>
  );
}
