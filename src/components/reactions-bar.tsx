import { PopoverPanel } from "@/components/popover";
import { invoke } from "@/lib/tauri";
import { toastError } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type ReactionTarget = "issue_comment" | "review_comment" | "review" | "issue";

interface Reaction {
  id: number;
  content: string;
  user: { login: string };
}

interface Props {
  target: ReactionTarget;
  owner: string;
  repo: string;
  id: number;
  /** PR number — required for `review` targets (the endpoint includes /pulls/{n}). */
  pr?: number;
  /** Logged-in user login — used to detect own reactions for toggle behaviour. */
  viewerLogin?: string;
}

const REACTIONS = [
  { content: "+1", emoji: "👍" },
  { content: "-1", emoji: "👎" },
  { content: "laugh", emoji: "😄" },
  { content: "hooray", emoji: "🎉" },
  { content: "confused", emoji: "😕" },
  { content: "heart", emoji: "❤️" },
  { content: "rocket", emoji: "🚀" },
  { content: "eyes", emoji: "👀" },
] as const;

const EMOJI: Record<string, string> = Object.fromEntries(
  REACTIONS.map((r) => [r.content, r.emoji]),
);

export function ReactionsBar({ target, owner, repo, id, pr, viewerLogin }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const queryKey = ["reactions", target, owner, repo, id];

  const q = useQuery({
    queryKey,
    queryFn: () => invoke<Reaction[]>("gh_list_reactions", { target, owner, repo, id, pr }),
    staleTime: 30_000,
  });

  const react = useMutation({
    mutationFn: (content: string) =>
      invoke<Reaction>("gh_react", { target, owner, repo, id, pr, content }),
    // Optimistically add the chip so the click feels instant; roll back on error.
    onMutate: async (content: string) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Reaction[]>(queryKey);
      const optimistic: Reaction = {
        // Negative id keeps it distinct from any real reaction; replaced on refetch.
        id: -Date.now(),
        content,
        user: { login: viewerLogin ?? "" },
      };
      qc.setQueryData<Reaction[]>(queryKey, (old) => [...(old ?? []), optimistic]);
      return { previous };
    },
    onError: (e, _content, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toastError(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  const unreact = useMutation({
    mutationFn: (reactionId: number) =>
      invoke("gh_unreact", { target, owner, repo, id, pr, reactionId }),
    // Optimistically drop the reaction; roll back on error.
    onMutate: async (reactionId: number) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<Reaction[]>(queryKey);
      qc.setQueryData<Reaction[]>(queryKey, (old) =>
        (old ?? []).filter((r) => r.id !== reactionId),
      );
      return { previous };
    },
    onError: (e, _reactionId, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toastError(e);
    },
    onSettled: () => qc.invalidateQueries({ queryKey }),
  });

  // Group reactions by content so we render one chip per type with a count.
  const groups = new Map<string, Reaction[]>();
  for (const r of q.data ?? []) {
    const arr = groups.get(r.content) ?? [];
    arr.push(r);
    groups.set(r.content, arr);
  }

  function toggle(content: string) {
    const mine = (q.data ?? []).find((r) => r.content === content && r.user.login === viewerLogin);
    if (mine) unreact.mutate(mine.id);
    else react.mutate(content);
    setOpen(false);
  }

  // Keyboard support for the emoji picker: arrow keys roam, Enter/Space picks.
  const pickerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // Reset + focus the first emoji each time the picker opens.
  useEffect(() => {
    if (!open) return;
    setActive(0);
    const first = pickerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]")[0];
    first?.focus();
  }, [open]);

  function focusAt(idx: number) {
    const buttons = pickerRef.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]");
    if (!buttons || buttons.length === 0) return;
    const next = (idx + buttons.length) % buttons.length;
    setActive(next);
    buttons[next]?.focus();
  }

  function onPickerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAt(active + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusAt(active - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(REACTIONS.length - 1);
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-1">
      {[...groups.entries()].map(([content, list]) => {
        const mine = list.some((r) => r.user.login === viewerLogin);
        return (
          <button
            key={content}
            type="button"
            onClick={() => toggle(content)}
            aria-pressed={mine}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
              mine
                ? "border-primary/50 bg-primary/15 text-foreground"
                : "border-border/40 bg-background/30 text-muted-foreground hover:bg-foreground/[0.04]",
            )}
            aria-label={`${content}, ${list.length} reaction${list.length === 1 ? "" : "s"}${
              mine ? " including yours" : ""
            }`}
          >
            <span>{EMOJI[content] ?? content}</span>
            <span className="font-display tabular-nums">{list.length}</span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-foreground/[0.04] hover:text-foreground"
        aria-label="React"
      >
        <SmilePlus className="size-3" />
      </button>

      {open && (
        <PopoverPanel
          onClose={() => setOpen(false)}
          align="left"
          width="w-auto"
          className="inline-flex items-center gap-0.5"
        >
          <div
            ref={pickerRef}
            role="menu"
            aria-label="Add reaction"
            onKeyDown={onPickerKeyDown}
            className="inline-flex items-center gap-0.5"
          >
            {REACTIONS.map((r, i) => {
              const count = groups.get(r.content)?.length ?? 0;
              return (
                <button
                  key={r.content}
                  type="button"
                  role="menuitem"
                  data-emoji
                  tabIndex={i === active ? 0 : -1}
                  onClick={() => toggle(r.content)}
                  onFocus={() => setActive(i)}
                  className="rounded-md px-1 py-0.5 text-base leading-none hover:bg-foreground/[0.08] focus:bg-foreground/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={count > 0 ? `${r.content}, ${count}` : r.content}
                >
                  {r.emoji}
                </button>
              );
            })}
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}
