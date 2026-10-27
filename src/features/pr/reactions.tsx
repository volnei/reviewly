import { toast } from "@/app/toast";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { run, useEffectQuery } from "@/effect/runtime";
import { GitHub, type ReactionTarget } from "@/effect/services/GitHub";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { SmilePlus } from "lucide-react";
import { useState } from "react";

const REACTIONS = [
  ["+1", "👍"],
  ["-1", "👎"],
  ["laugh", "😄"],
  ["hooray", "🎉"],
  ["confused", "😕"],
  ["heart", "❤️"],
  ["rocket", "🚀"],
  ["eyes", "👀"],
] as const;
const EMOJI: Record<string, string> = Object.fromEntries(REACTIONS);

/** The reactions on one comment: chips with counts, yours pressed, and a quiet "+" for more. */
export function Reactions({
  target,
  owner,
  repo,
  id,
  pr,
  me,
}: {
  target: ReactionTarget;
  owner: string;
  repo: string;
  id: number;
  pr?: number;
  me: string | null;
}) {
  const qc = useQueryClient();
  const key = ["reactions", target, owner, repo, id];
  const q = useEffectQuery(
    key,
    Effect.flatMap(GitHub, (g) => g.reactions(target, owner, repo, id, pr)),
    { staleTime: 5 * 60_000 },
  );
  const [open, setOpen] = useState(false);
  const all = q.data ?? [];
  const groups = new Map<string, number>();
  for (const r of all) groups.set(r.content, (groups.get(r.content) ?? 0) + 1);

  const toggle = async (content: string) => {
    setOpen(false);
    const mine = all.find((r) => r.content === content && r.user.login === me);
    try {
      await run(
        Effect.flatMap(GitHub, (g) =>
          mine
            ? g.unreact(target, owner, repo, id, mine.id, pr)
            : g.react(target, owner, repo, id, content, pr),
        ),
      );
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.fail("The reaction didn’t stick", e);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {[...groups].map(([content, n]) => {
        const mine = all.some((r) => r.content === content && r.user.login === me);
        return (
          <button
            key={content}
            type="button"
            aria-pressed={mine}
            onClick={() => toggle(content)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-md px-1.5 text-[12px]",
              mine ? "bg-raise text-ink" : "text-ink-3 hover:bg-raise/60 hover:text-ink-2",
            )}
          >
            <span>{EMOJI[content] ?? content}</span>
            <span className="tnum">{n}</span>
          </button>
        );
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                aria-label="React"
                className={cn(
                  "grid size-6 place-items-center rounded-md text-ink-3 hover:bg-raise hover:text-ink data-[popup-open]:bg-raise data-[popup-open]:text-ink",
                  // Nothing here yet: the "+" waits for the pointer, like every quiet action.
                  groups.size === 0 &&
                    "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[popup-open]:opacity-100",
                )}
              />
            }
          >
            <SmilePlus className="size-3.5" strokeWidth={1.75} />
          </TooltipTrigger>
          <TooltipPopup>React</TooltipPopup>
        </Tooltip>
        <PopoverPopup align="start" className="rounded-lg border-edge bg-popover p-1">
          <div className="flex gap-0.5">
            {REACTIONS.map(([content, emoji]) => (
              <button
                key={content}
                type="button"
                aria-label={content}
                onClick={() => toggle(content)}
                className="grid size-7 place-items-center rounded-md text-[15px] hover:bg-raise"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
