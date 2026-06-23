import { CommentByline } from "@/components/comment-byline";
import { Composer } from "@/components/composer";
import { MarkdownBody } from "@/components/markdown-body";
import { ReactionsBar } from "@/components/reactions-bar";
import { Button } from "@/components/ui/button";
import { invoke } from "@/lib/tauri";
import type { ReviewThread, ReviewThreadGraphQL } from "@/lib/tauri";
import { toastError } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

interface Props {
  owner: string;
  repo: string;
  number: number;
  thread: ReviewThreadGraphQL;
  comments: ReviewThread[];
  /** Logged-in user login — enables react/un-react toggle on each comment. */
  viewerLogin?: string;
  /** Hide the file:line header (e.g. when shown inline under the diff line). */
  hideLocation?: boolean;
  className?: string;
}

/**
 * One inline review conversation: its comments plus reply + resolve/reopen.
 * Shared between the Conversation tab and the inline diff (`ThreadsBlock`).
 */
export function ReviewThreadGroup({
  owner,
  repo,
  number,
  thread,
  comments,
  viewerLogin,
  hideLocation,
  className,
}: Props) {
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pull-review-comments", owner, repo, number] });
    qc.invalidateQueries({ queryKey: ["pull-review-threads-gql", owner, repo, number] });
  };

  const resolve = useMutation({
    mutationFn: () =>
      invoke("gh_resolve_thread", { threadNodeId: thread.id, resolve: !thread.is_resolved }),
    onSuccess: () => {
      invalidate();
      toast.success(thread.is_resolved ? "Conversation reopened" : "Conversation resolved");
    },
    onError: toastError,
  });

  const reply = useMutation({
    mutationFn: (body: string) =>
      invoke("gh_reply_review_comment", { owner, repo, number, commentId: comments[0].id, body }),
    onSuccess: () => {
      invalidate();
      setReplying(false);
      toast.success("Reply posted");
    },
    onError: toastError,
  });

  const first = comments[0];
  const loc = `${first.path.split("/").pop()}:${first.line ?? first.original_line ?? "?"}`;

  return (
    <div className={cn("rounded-lg bg-card/40 p-3", thread.is_resolved && "opacity-65", className)}>
      {!hideLocation && (
        <header className="mb-2 flex items-center gap-2 text-xs">
          <span className="font-mono text-muted-foreground" aria-label={first.path}>
            {loc}
          </span>
          {thread.is_resolved && (
            <span className="rounded bg-success/15 px-1.5 py-px text-xs text-success">
              Resolved
            </span>
          )}
        </header>
      )}
      {hideLocation && thread.is_resolved && (
        <div className="mb-2">
          <span className="rounded bg-success/15 px-1.5 py-px text-xs text-success">Resolved</span>
        </div>
      )}
      <div className="space-y-2.5">
        {comments.map((c) => (
          <div key={c.id}>
            <CommentByline
              className="mb-0.5"
              user={c.user}
              timestamp={c.created_at}
              avatarClassName="size-4"
            />
            <MarkdownBody className="text-xs">{c.body}</MarkdownBody>
            <div className="mt-1.5">
              <ReactionsBar
                target="review_comment"
                owner={owner}
                repo={repo}
                id={c.id}
                pr={number}
                viewerLogin={viewerLogin}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1">
        <Button size="xs" variant="ghost" onClick={() => setReplying((v) => !v)}>
          Reply
        </Button>
        <Button
          size="xs"
          variant="ghost"
          loading={resolve.isPending}
          onClick={() => resolve.mutate()}
        >
          {thread.is_resolved ? "Reopen" : "Resolve"}
        </Button>
      </div>
      {replying && (
        <div className="mt-2">
          <Composer
            placeholder="Reply…"
            submitLabel="Reply"
            submitting={reply.isPending}
            onSubmit={(b) => reply.mutate(b)}
            onCancel={() => setReplying(false)}
            autoFocus
          />
        </div>
      )}
    </div>
  );
}
