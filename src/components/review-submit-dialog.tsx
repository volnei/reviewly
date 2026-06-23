import { Composer } from "@/components/composer";
import { PopoverPanel } from "@/components/popover";
import type { DraftComment } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { type ReviewEvent, useReviewVerdict } from "@/stores/review-verdict";
import { Check, MessageSquare, X } from "lucide-react";
import { type ReactElement, cloneElement, useEffect, useState } from "react";

type Event = ReviewEvent;

interface Props {
  /** The button that anchors and toggles the popover. */
  trigger: ReactElement<{ onClick?: () => void }>;
  draftBody: string;
  draftComments: DraftComment[];
  onBodyChange: (body: string) => void;
  onRemoveComment: (idx: number) => void;
  submitting: boolean;
  onSubmit: (event: Event) => void;
  side?: "top" | "bottom";
  /**
   * The viewer's existing review verdict on this PR, if any. When present it
   * seeds the selection (over the remembered last-used verdict) so reopening on
   * a PR you've already reviewed defaults to that state.
   */
  defaultEvent?: Event | null;
  /**
   * Jump to the file+line of a pending inline comment. When provided, the
   * inline-comment rows become clickable (and the popover closes on jump).
   */
  onJumpToComment?: (comment: DraftComment, idx: number) => void;
}

/** Map the GitHub review state word to our Event verdict. */
export function reviewStateToEvent(state: string | null | undefined): Event | null {
  if (state === "APPROVED") return "APPROVE";
  if (state === "CHANGES_REQUESTED") return "REQUEST_CHANGES";
  if (state === "COMMENTED") return "COMMENT";
  return null;
}

/** Submit-review popover — pick Comment/Approve/Request-changes, anchored to its trigger. */
export function ReviewSubmitPopover({
  trigger,
  draftBody,
  draftComments,
  onBodyChange,
  onRemoveComment,
  submitting,
  onSubmit,
  side = "bottom",
  defaultEvent,
  onJumpToComment,
}: Props) {
  const lastVerdict = useReviewVerdict((s) => s.last);
  const setLastVerdict = useReviewVerdict((s) => s.setLast);
  const [open, setOpen] = useState(false);
  // Default to the viewer's existing review state if known, else the remembered
  // last-used verdict.
  const [event, setEvent] = useState<Event>(defaultEvent ?? lastVerdict);

  // Re-seed the selection each time the popover opens so it reflects the latest
  // existing-state / remembered verdict (without clobbering an in-progress pick).
  useEffect(() => {
    if (open) setEvent(defaultEvent ?? lastVerdict);
  }, [open, defaultEvent, lastVerdict]);

  function submit(e: Event) {
    setLastVerdict(e);
    onSubmit(e);
    setOpen(false);
  }

  const triggerEl = cloneElement(trigger, { onClick: () => setOpen((v) => !v) });

  return (
    <div className="relative inline-flex">
      {triggerEl}
      {open && (
        <PopoverPanel
          onClose={() => setOpen(false)}
          side={side}
          width="w-96"
          className="space-y-3 p-4"
        >
          <div
            onKeyDown={(e) => {
              // ⌘↵ (or Ctrl+↵) submits the selected verdict from anywhere in
              // the popover. The Composer textarea handles its own ⌘↵ (and
              // preventDefaults it), so skip when already handled to avoid a
              // double submit.
              if (e.defaultPrevented) return;
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                if (!submitting) submit(event);
              }
            }}
            className="space-y-3"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Submit review</p>
              <p className="text-xs text-muted-foreground">
                {draftComments.length > 0
                  ? `${draftComments.length} inline comment${draftComments.length === 1 ? "" : "s"} will be posted.`
                  : "Approve, request changes, or just leave a comment."}
              </p>
            </div>

            {/* Enter on a verdict button selects + submits that verdict;
                Enter elsewhere in the grid submits the current selection. */}
            <div
              role="radiogroup"
              aria-label="Review verdict"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || submitting) return;
                e.preventDefault();
                const focused = (e.target as HTMLElement).closest<HTMLElement>("[data-event]");
                const verdict = (focused?.dataset.event as Event | undefined) ?? event;
                setEvent(verdict);
                submit(verdict);
              }}
              className="grid grid-cols-3 gap-2"
            >
              <EventChoice
                value="COMMENT"
                active={event === "COMMENT"}
                onClick={() => setEvent("COMMENT")}
                icon={MessageSquare}
                label="Comment"
              />
              <EventChoice
                value="APPROVE"
                active={event === "APPROVE"}
                onClick={() => setEvent("APPROVE")}
                icon={Check}
                label="Approve"
                tone="success"
              />
              <EventChoice
                value="REQUEST_CHANGES"
                active={event === "REQUEST_CHANGES"}
                onClick={() => setEvent("REQUEST_CHANGES")}
                icon={X}
                label="Request changes"
                tone="destructive"
              />
            </div>

            {draftComments.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Inline comments</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-foreground/[0.04] p-2">
                  {draftComments.map((c, i) => {
                    const jumpable = !!onJumpToComment;
                    return (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded p-1.5 text-xs hover:bg-foreground/[0.04]"
                      >
                        {jumpable ? (
                          <button
                            type="button"
                            onClick={() => {
                              onJumpToComment?.(c, i);
                              setOpen(false);
                            }}
                            className="min-w-0 flex-1 cursor-pointer text-left"
                            aria-label={`Jump to ${c.path}${c.line != null ? `:${c.line}` : ""}`}
                          >
                            <p className="font-mono text-xs text-muted-foreground hover:text-primary">
                              {c.path}:{c.line}
                            </p>
                            <p className="mt-0.5 truncate text-foreground/90">{c.body}</p>
                          </button>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <p className="font-mono text-xs text-muted-foreground">
                              {c.path}:{c.line}
                            </p>
                            <p className="mt-0.5 truncate text-foreground/90">{c.body}</p>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveComment(i)}
                          className="text-muted-foreground/60 hover:text-destructive"
                          aria-label="Remove inline comment"
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Same Composer card as every other comment surface. */}
            <Composer
              initialValue={draftBody}
              onChange={onBodyChange}
              allowEmpty
              rows={4}
              placeholder="Leave an overall comment (optional)…"
              submitLabel="Submit review"
              submitting={submitting}
              onCancel={() => setOpen(false)}
              onSubmit={() => submit(event)}
            />
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}

type Tone = "neutral" | "success" | "destructive";

const TONE: Record<Tone, { idle: string; activeBg: string; activeText: string }> = {
  neutral: { idle: "text-muted-foreground", activeBg: "bg-primary/15", activeText: "text-primary" },
  success: { idle: "text-success", activeBg: "bg-success/15", activeText: "text-success" },
  destructive: {
    idle: "text-destructive",
    activeBg: "bg-destructive/15",
    activeText: "text-destructive",
  },
};

function EventChoice({
  value,
  active,
  onClick,
  icon: Icon,
  label,
  tone = "neutral",
}: {
  value: Event;
  active: boolean;
  onClick: () => void;
  icon: typeof Check;
  label: string;
  tone?: Tone;
}) {
  const t = TONE[tone];
  return (
    <button
      type="button"
      data-event={value}
      role="radio"
      aria-checked={active}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-center text-xs leading-tight ring-inset transition-colors",
        active
          ? cn(t.activeBg, t.activeText, "font-medium ring-2 ring-ring")
          : "bg-foreground/[0.03] text-muted-foreground ring-1 ring-border/40 hover:bg-foreground/[0.06]",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? t.activeText : t.idle)} strokeWidth={2} />
      <span>{label}</span>
    </button>
  );
}
