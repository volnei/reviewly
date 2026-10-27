import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReviewEvent } from "@/effect/services/GitHub";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { Draft } from "./thread";

const EVENTS: ReadonlyArray<{ value: ReviewEvent; label: string; verb: string }> = [
  { value: "COMMENT", label: "Comment", verb: "Comment" },
  { value: "REQUEST_CHANGES", label: "Request changes", verb: "Request changes" },
  { value: "APPROVE", label: "Approve", verb: "Approve" },
];

/** Opens the review composer; the verdict belongs inside that dialog, beside its consequences. */
export function SubmitReviewButton({ onOpen, drafts }: { onOpen: () => void; drafts: number }) {
  return (
    <Button variant="ghost" size="sm" type="button" onClick={onOpen} className="pr-submit-review">
      Submit review
      {drafts ? (
        <span className="pr-submit-review-count tnum" aria-label={`${drafts} draft comments`}>
          {drafts}
        </span>
      ) : null}
    </Button>
  );
}

/**
 * The review goes up as one thing: the decision, a summary, and every draft.
 * Nothing leaves until the one button at the bottom.
 */
export function SubmitDialog({
  open,
  event,
  drafts,
  busy,
  onOpenChange,
  onEvent,
  onSubmit,
  onDiscardDraft,
  onJumpDraft,
  confirm,
  body,
  onBodyChange,
}: {
  open: boolean;
  /** The summary, kept per PR so a closed dialog loses nothing. */
  body: string;
  onBodyChange: (body: string) => void;
  event: ReviewEvent;
  drafts: ReadonlyArray<Draft>;
  busy: boolean;
  onOpenChange: (o: boolean) => void;
  onEvent: (e: ReviewEvent) => void;
  onSubmit: (body: string) => void;
  onDiscardDraft: (key: string) => void;
  /** A draft in the list, clicked: the read scrolls to its line. */
  onJumpDraft?: (d: Draft) => void;
  /** Settings: one more step before anything goes up. */
  confirm?: boolean;
}) {
  const verb = EVENTS.find((e) => e.value === event)?.verb ?? "Send";
  const canSend = event !== "COMMENT" || body.trim().length > 0 || drafts.length > 0;
  const [asking, setAsking] = useState(false);
  const send = () => {
    if (!canSend || busy) return;
    if (confirm) setAsking(true);
    else onSubmit(body.trim());
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[560px] rounded-xl border-edge bg-popover">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium text-ink">Your review</DialogTitle>
          <DialogDescription className="text-[12.5px] text-ink-3">
            {drafts.length
              ? `${drafts.length} draft comment${drafts.length > 1 ? "s" : ""} go up with it.`
              : "No inline comments yet — a summary is enough."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-3 px-6">
          <div role="radiogroup" aria-label="Decision" className="flex gap-1.5">
            {EVENTS.map((e) => (
              <Button
                variant="ghost"
                size="sm"
                key={e.value}
                type="button"
                role="radio"
                aria-checked={event === e.value}
                onClick={() => onEvent(e.value)}
                className={cn(
                  "h-7 rounded-md border px-2.5 text-[12.5px]",
                  event === e.value
                    ? "border-edge bg-raise text-ink"
                    : "border-transparent text-ink-2 hover:bg-raise/60",
                )}
              >
                {e.label}
              </Button>
            ))}
          </div>
          <textarea
            value={body}
            onChange={(e) => onBodyChange(e.target.value)}
            autoFocus
            rows={5}
            placeholder={
              event === "APPROVE"
                ? "Optional — what you checked, in a line."
                : event === "REQUEST_CHANGES"
                  ? "What has to change before it merges."
                  : "What you saw."
            }
            className="selectable w-full resize-y rounded-md border border-input bg-sink px-2.5 py-1.5 font-sans text-[13px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSend && !busy) {
                e.preventDefault();
                send();
              }
              e.stopPropagation();
            }}
          />
          {drafts.length ? (
            <ul className="grid max-h-48 gap-1.5 overflow-y-auto scrollbar-thin">
              {drafts.map((d) => (
                <li
                  key={d.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md bg-sink px-2.5 py-1.5 text-[12.5px]"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onJumpDraft?.(d)}
                    className="min-w-0 text-left"
                    title="Go to the line"
                  >
                    <p className="mono truncate text-[11.5px] text-ink-3">
                      {d.path}:{d.startLine != null ? `${d.startLine}–${d.line}` : d.line}
                    </p>
                    <p className="truncate text-ink-2 hover:text-ink">{d.body}</p>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => onDiscardDraft(d.key)}
                    className="text-[12px] text-ink-3 hover:text-ink"
                  >
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </DialogPanel>
        <DialogFooter className="px-6 pb-5">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-8 rounded-md px-3 text-[12.5px] text-ink-2 hover:bg-raise"
          >
            Not yet
          </Button>
          <Button
            variant="default"
            size="sm"
            type="button"
            disabled={!canSend || busy}
            onClick={send}
            aria-keyshortcuts="Meta+Enter Control+Enter"
            title={`${verb} review (Command or Control + Enter)`}
            className="h-8 rounded-md px-3.5 text-[12.5px]"
          >
            {busy ? "Sending…" : verb}
          </Button>
        </DialogFooter>
      </DialogPopup>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogPopup className="max-w-[420px] rounded-xl border-edge bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-medium text-ink">
              {verb}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px] text-ink-3">
              {drafts.length
                ? `${drafts.length} inline comment${drafts.length === 1 ? "" : "s"} and your summary go up as one review.`
                : "Your summary goes up as a review."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogClose className="h-8 rounded-md px-3 text-[12.5px] text-ink-2 hover:bg-raise">
              Not yet
            </AlertDialogClose>
            <Button
              variant="default"
              size="sm"
              type="button"
              onClick={() => {
                setAsking(false);
                onSubmit(body.trim());
              }}
              className="h-8 rounded-md px-3.5 text-[12.5px]"
            >
              {verb}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Dialog>
  );
}
