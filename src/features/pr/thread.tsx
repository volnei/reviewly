import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type * as S from "@/effect/schema";
import type { PrRef } from "@/effect/services/GitHub";
import { age } from "@/features/list/row";
import { githubLinkMarkdown } from "@/lib/pr-links";
import { cn } from "@/lib/utils";
import { Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";
import type { Thread } from "./model";
import { Reactions } from "./reactions";
import { UserCard } from "./user-card";

/** A textarea and two words. ⌘↵ sends, Esc cancels. */
export function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  initial = "",
  autoFocus = true,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel?: () => void;
  initial?: string;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const send = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setBody("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="selectable w-full resize-y rounded-md border border-input bg-sink px-2.5 py-1.5 font-sans text-[13px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void send();
          }
          if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
          e.stopPropagation();
        }}
        onPaste={(e) => {
          // A GitHub link pasted bare becomes a link with a name: owner/repo#123.
          const text = e.clipboardData.getData("text/plain").trim();
          const md = /^https?:\/\/github\.com\//.test(text) ? githubLinkMarkdown(text) : null;
          const el = ref.current;
          if (!md || !el) return;
          e.preventDefault();
          const a = el.selectionStart;
          const b = el.selectionEnd;
          const selected = body.slice(a, b);
          const insert = selected ? `[${selected}](${text})` : md;
          setBody(body.slice(0, a) + insert + body.slice(b));
          requestAnimationFrame(() => {
            el.selectionStart = el.selectionEnd = a + insert.length;
          });
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!body.trim() || busy}
          onClick={send}
          className="h-7 rounded-md border border-ink bg-ink px-2.5 text-[12.5px] font-medium text-[#141414] disabled:opacity-50"
        >
          {submitLabel} <kbd className="ml-1 font-sans text-[11px] opacity-70">⌘↵</kbd>
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-raise"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Byline({
  user,
  when,
  children,
}: { user: S.UserRef; when: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <UserCard login={user.login}>
        <img
          src={user.avatar_url}
          alt=""
          className="size-5 rounded-full bg-raise"
          draggable={false}
        />
      </UserCard>
      <UserCard login={user.login}>
        <b className="font-medium text-ink">{user.login}</b>
      </UserCard>
      <span className="tnum text-ink-3">{age(when)}</span>
      {children}
    </div>
  );
}

/** One thread under its line: comments in order, then reply and resolve. */
export function ThreadView({
  thread,
  ops,
  onReply,
  onResolve,
}: {
  thread: Thread;
  ops: CommentOps;
  onReply: (body: string) => Promise<void>;
  onResolve?: (resolve: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(!thread.resolved);
  const [replying, setReplying] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-7 w-full items-center gap-2 rounded-md bg-card px-3 text-left text-[12.5px] text-ink-3 hover:text-ink-2"
      >
        <span className="rounded-[3px] bg-raise px-1.5 py-px text-[11px] text-ink-2">resolved</span>
        {thread.comments[0]?.user.login}:{" "}
        <span className="truncate">{thread.comments[0]?.body.slice(0, 90)}</span>
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-edge bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,.3)]">
      <div className="grid gap-3">
        {thread.comments.map((c) => (
          <CommentView key={c.id} kind="review" comment={c} ops={ops} />
        ))}
      </div>
      <div className="mt-3 pl-7">
        {replying ? (
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            onSubmit={async (b) => {
              await onReply(b);
              setReplying(false);
            }}
            onCancel={() => setReplying(false)}
          />
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setReplying(true)}
              className="h-6 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
            >
              Reply
            </button>
            {onResolve && thread.nodeId ? (
              <button
                type="button"
                onClick={() => onResolve(!thread.resolved).then(() => setOpen(thread.resolved))}
                className="h-6 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
              >
                {thread.resolved ? "Unresolve" : "Resolve"}
              </button>
            ) : null}
            {thread.resolved ? (
              <span className="ml-1 rounded-[3px] bg-raise px-1.5 py-px text-[11px] text-ink-2">
                resolved
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export interface Draft {
  readonly key: string;
  readonly path: string;
  readonly side: "L" | "R";
  /** The last line; with `startLine`, a range. */
  readonly line: number;
  readonly startLine?: number;
  readonly body: string;
}

/** A draft looks like a thread with a tag; it goes up with the review. */
export function DraftView({
  draft,
  me,
  onChange,
  onDiscard,
}: { draft: Draft; me: S.Viewer | null; onChange: (body: string) => void; onDiscard: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={cn("rounded-lg border border-edge bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,.3)]")}
    >
      <div className="flex items-center gap-2 text-[12.5px]">
        {me ? (
          <img
            src={me.avatar_url}
            alt=""
            className="size-5 rounded-full bg-raise"
            draggable={false}
          />
        ) : (
          <span className="size-5 rounded-full bg-raise" />
        )}
        <b className="font-medium text-ink">you</b>
        <span className="rounded-[3px] bg-raise px-1.5 py-px text-[11px] text-ink-2">draft</span>
        {draft.startLine != null ? (
          <span className="tnum text-[11.5px] text-ink-3">
            lines {draft.startLine}–{draft.line}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 pl-7">
        {editing ? (
          <Composer
            initial={draft.body}
            placeholder="Say it plainly."
            submitLabel="Keep"
            onSubmit={(b) => {
              onChange(b);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <Markdown>{draft.body}</Markdown>
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="h-6 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="h-6 rounded-md px-2 text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
              >
                Discard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { Byline };

export type CommentKind = "issue" | "review";

/** What a comment needs to act on itself: who is reading, where it lives, and the two verbs. */
export interface CommentOps {
  readonly me: string | null;
  readonly ref: PrRef;
  readonly onEdit: (kind: CommentKind, id: number, body: string) => Promise<void>;
  readonly onDelete: (kind: CommentKind, id: number) => Promise<void>;
}

/** One comment: who, when, the text, the reactions; edit and delete when it is yours. */
export function CommentView({
  kind,
  comment,
  ops,
}: {
  kind: CommentKind;
  comment: { id: number; user: S.UserRef; body: string; created_at: string };
  ops: CommentOps;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const mine = ops.me != null && ops.me === comment.user.login;
  return (
    <div className="group grid gap-1.5">
      <Byline user={comment.user} when={comment.created_at}>
        {mine && !editing ? (
          <span className="ml-auto flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              aria-label="Edit comment"
              onClick={() => setEditing(true)}
              className="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-raise hover:text-ink"
            >
              <Pencil className="size-3.5" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-label="Delete comment"
              onClick={() => setConfirm(true)}
              className="grid size-6 place-items-center rounded-md text-ink-3 hover:bg-raise hover:text-ink"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          </span>
        ) : null}
      </Byline>
      <div className="pl-7">
        {editing ? (
          <Composer
            placeholder=""
            submitLabel="Save"
            initial={comment.body}
            onSubmit={async (b) => {
              await ops.onEdit(kind, comment.id, b);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Markdown>{comment.body}</Markdown>
        )}
        <div className="mt-1.5">
          <Reactions
            target={kind === "issue" ? "issue_comment" : "review_comment"}
            owner={ops.ref.owner}
            repo={ops.ref.repo}
            id={comment.id}
            me={ops.me}
          />
        </div>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogPopup className="max-w-[420px] rounded-xl border-edge bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[15px] font-medium text-ink">
              Delete this comment?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[12.5px] text-ink-3">
              It goes away on GitHub too. Nothing brings it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="px-6 pb-5">
            <AlertDialogClose className="h-7 rounded-md px-2.5 text-[12.5px] text-ink-2 hover:bg-raise">
              Keep it
            </AlertDialogClose>
            <button
              type="button"
              onClick={async () => {
                await ops.onDelete(kind, comment.id);
                setConfirm(false);
              }}
              className="h-7 rounded-md border border-ink bg-ink px-3 text-[12.5px] font-medium text-[#141414]"
            >
              Delete
            </button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
