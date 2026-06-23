import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { UserHoverCard } from "@/components/user-hover-card";
import { invoke } from "@/lib/tauri";
import type { UserRef } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

interface RequestedReviewersResp {
  users: UserRef[];
  teams: Array<{ name: string; slug: string }>;
}

interface Props {
  owner: string;
  repo: string;
  number: number;
  /** Controlled — opened from the PR actions overflow menu. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Request reviewers" dialog. Lives behind the PR-actions "⋯" menu rather than
 * in the header. Lists current reviewers (click to remove) and the repo
 * collaborators (click to request).
 */
export function ReviewerPicker({ owner, repo, number, open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");

  const requested = useQuery({
    queryKey: ["pr-reviewers", owner, repo, number],
    queryFn: () =>
      invoke<RequestedReviewersResp>("gh_get_requested_reviewers", { owner, repo, number }),
    enabled: open,
    staleTime: 60_000,
  });

  const collaborators = useQuery({
    queryKey: ["repo-collaborators", owner, repo],
    queryFn: () => invoke<UserRef[]>("gh_repo_collaborators", { owner, repo }),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const requestMut = useMutation({
    mutationFn: (logins: string[]) =>
      invoke("gh_request_reviewers", { owner, repo, number, reviewers: logins }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-reviewers", owner, repo, number] }),
    onError: (e) => toast.error(`Request failed: ${e}`),
  });

  const removeMut = useMutation({
    mutationFn: (logins: string[]) =>
      invoke("gh_remove_reviewers", { owner, repo, number, reviewers: logins }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-reviewers", owner, repo, number] }),
    onError: (e) => toast.error(`Remove failed: ${e}`),
  });

  const current = requested.data?.users ?? [];
  const requestedLogins = new Set(current.map((u) => u.login));
  const list = useMemo(() => {
    const data = collaborators.data ?? [];
    const f = filter.trim().toLowerCase();
    return f ? data.filter((u) => u.login.toLowerCase().includes(f)) : data;
  }, [collaborators.data, filter]);

  function toggle(login: string) {
    if (requestedLogins.has(login)) removeMut.mutate([login]);
    else requestMut.mutate([login]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request reviewers</DialogTitle>
          <DialogDescription>
            {current.length > 0
              ? `${current.length} reviewer${current.length === 1 ? "" : "s"} requested.`
              : "No reviewers requested yet."}
          </DialogDescription>
        </DialogHeader>

        {current.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {current.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => removeMut.mutate([u.login])}
                aria-label={`Remove @${u.login}`}
                className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] py-px pl-1 pr-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <UserAvatar user={u} className="size-3.5" />
                {u.login}
                <X className="size-2.5" />
              </button>
            ))}
          </div>
        )}

        <Input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter collaborators…"
          size="sm"
          className="w-full"
        />

        <ul className="max-h-72 space-y-0.5 overflow-y-auto">
          {collaborators.isLoading ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Loading…</li>
          ) : list.length === 0 ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">No collaborators.</li>
          ) : (
            list.map((u) => {
              const selected = requestedLogins.has(u.login);
              return (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => toggle(u.login)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-foreground/[0.04]"
                  >
                    <Check
                      className={cn("size-3 shrink-0", selected ? "text-primary" : "opacity-0")}
                    />
                    <UserHoverCard user={u}>
                      <img
                        src={u.avatar_url}
                        alt={u.login}
                        className="size-4 shrink-0 rounded-full"
                      />
                    </UserHoverCard>
                    <span className="truncate">{u.login}</span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
