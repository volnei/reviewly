import { EmptyState } from "@/components/empty-state";
import { IconButton } from "@/components/icon-button";
import { PageHeader } from "@/components/page-header";
import { Segmented } from "@/components/segmented";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import type { Notification } from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { type NotifMode, useNotifPrefs } from "@/stores/notif-prefs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Check, CheckCheck, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/** Parse a notification subject API url into an in-app PR target, if it's a PR. */
function prTarget(url?: string | null): { owner: string; repo: string; number: string } | null {
  if (!url) return null;
  const m = url.match(/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: m[3] } : null;
}

const MODES: { value: NotifMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reviews", label: "Reviews & comments" },
  { value: "mentions", label: "Mentions" },
];

// "Reviews & comments" must NOT include mentions — those have their own tab.
const REVIEW_REASONS = new Set(["review_requested", "comment"]);
const MENTION_REASONS = new Set(["mention", "team_mention"]);

// Human labels for GitHub notification reason tokens (shown in the meta line).
const REASON_LABELS: Record<string, string> = {
  review_requested: "Review requested",
  mention: "Mention",
  team_mention: "Team mention",
  comment: "Comment",
  assign: "Assigned",
  author: "Author",
  ci_activity: "CI activity",
  manual: "Subscribed",
  state_change: "State change",
  subscribed: "Subscribed",
};

const reasonLabel = (reason: string) =>
  REASON_LABELS[reason] ?? reason.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Persisted so the active filter survives navigation + restart.
  const mode = useNotifPrefs((s) => s.mode);
  const setMode = useNotifPrefs((s) => s.setMode);
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => invoke<Notification[]>("gh_list_notifications", { all: false }),
  });

  const list = useMemo(() => {
    const data = q.data ?? [];
    if (mode === "reviews") return data.filter((n) => REVIEW_REASONS.has(n.reason));
    if (mode === "mentions") return data.filter((n) => MENTION_REASONS.has(n.reason));
    return data;
  }, [q.data, mode]);

  // Keyboard cursor into the visible list (j/k move, Enter open, e mark-read).
  const [cursor, setCursor] = useState(0);
  const activeRowRef = useRef<HTMLLIElement>(null);
  // Keep the cursor in range as the list shrinks (mark-read, filter switch).
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, list.length - 1)));
  }, [list.length]);
  // Keep the cursor row visible as j/k moves it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-scroll when the cursor moves
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // "updated Xm ago" off the query's last successful fetch; 30s tick refreshes
  // the relative label without re-fetching.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Re-insert a marked-read row at its original position (used by undo + the
  // error path — GitHub has no "un-read" endpoint, so this is a local restore).
  function restoreNotification(n: Notification, index: number) {
    qc.setQueryData<Notification[]>(["notifications"], (prev) => {
      const cur = prev ?? [];
      if (cur.some((x) => x.id === n.id)) return cur;
      const next = cur.slice();
      next.splice(Math.min(index, next.length), 0, n);
      return next;
    });
  }

  // Optimistically drop the row so the list doesn't flicker before refetch.
  // On failure, restore it and surface the error; on success, offer Undo.
  async function markRead(id: string) {
    const prev = qc.getQueryData<Notification[]>(["notifications"]) ?? [];
    const index = prev.findIndex((n) => n.id === id);
    const removed = index >= 0 ? prev[index] : null;
    qc.setQueryData<Notification[]>(["notifications"], (p) => p?.filter((n) => n.id !== id));
    try {
      await invoke("gh_mark_notification_read", { id });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      if (removed) {
        toast.success("Marked read", {
          action: { label: "Undo", onClick: () => restoreNotification(removed, index) },
        });
      }
    } catch (e) {
      if (removed) restoreNotification(removed, index);
      toast.error(`Couldn't mark read — ${String(e)}`);
    }
  }

  const markAll = useMutation({
    mutationFn: () => invoke("gh_mark_all_notifications_read"),
    onSuccess: () => {
      qc.setQueryData<Notification[]>(["notifications"], []);
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  function open(n: Notification) {
    const target = prTarget(n.subject.url);
    if (target) {
      navigate({ to: "/prs/$owner/$repo/$number", params: target });
      return;
    }
    const url = n.subject.url?.replace("api.github.com/repos/", "github.com/");
    if (url) safeOpenUrl(url);
  }

  // Keyboard nav: 1/2/3 switch tabs, j/k move the cursor, Enter opens, e marks
  // read. Latest state is read through a ref so one stable listener stays valid.
  const navRef = useRef({ list, cursor, open, markRead, setMode, setCursor });
  navRef.current = { list, cursor, open, markRead, setMode, setCursor };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = navRef.current;
      const tab = ["1", "2", "3"].indexOf(e.key);
      if (tab >= 0 && MODES[tab]) {
        e.preventDefault();
        s.setMode(MODES[tab].value);
        return;
      }
      if (s.list.length === 0) return;
      if (e.key === "j") {
        e.preventDefault();
        s.setCursor((c) => Math.min(c + 1, s.list.length - 1));
      } else if (e.key === "k") {
        e.preventDefault();
        s.setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        const n = s.list[s.cursor];
        if (n) {
          e.preventDefault();
          s.open(n);
        }
      } else if (e.key === "e") {
        const n = s.list[s.cursor];
        if (n) {
          e.preventDefault();
          void s.markRead(n.id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Notifications"
        subtitle={q.isLoading ? "Loading…" : `${list.length} unread`}
      />
      <div className="flex items-center gap-3 px-6 py-2">
        <Segmented options={MODES} value={mode} onChange={setMode} />
        <div className="ml-auto flex items-center gap-2">
          {q.dataUpdatedAt > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              updated {relativeTime(q.dataUpdatedAt)}
            </span>
          )}
          <IconButton
            label="Refresh"
            icon={RefreshCw}
            loading={q.isFetching}
            onClick={() => q.refetch()}
          />
          {(q.data?.length ?? 0) > 0 && (
            <IconButton
              label="Mark all read"
              icon={CheckCheck}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            />
          )}
        </div>
      </div>
      <ScrollArea className="flex-1">
        {q.isLoading ? (
          <div className="space-y-2 p-4">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No new notifications"
            description="When teammates mention you or request a review, they'll show up here."
          />
        ) : (
          <ul className="px-3 py-0.5">
            {list.map((n, i) => (
              <li
                key={n.id}
                ref={i === cursor ? activeRowRef : undefined}
                aria-current={i === cursor ? "true" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2.5",
                  i === cursor
                    ? "bg-foreground/[0.06] ring-1 ring-inset ring-primary/30"
                    : "hover:bg-foreground/[0.04]",
                )}
              >
                <span
                  className="mt-1.5 size-2 shrink-0 self-start rounded-full bg-primary"
                  aria-label="Unread"
                />
                <button type="button" onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm text-foreground">{n.subject.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {n.repository?.full_name ?? "—"} · {reasonLabel(n.reason)} ·{" "}
                    {relativeTime(n.updated_at)}
                  </p>
                </button>
                {/* actions stay quiet until hover/focus */}
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  {n.subject.url && (
                    <IconButton
                      label="Open on GitHub"
                      icon={ExternalLink}
                      size="icon-xs"
                      onClick={() => {
                        const url = n.subject.url?.replace("api.github.com/repos/", "github.com/");
                        if (url) safeOpenUrl(url);
                      }}
                    />
                  )}
                  <IconButton
                    label="Mark read"
                    icon={Check}
                    size="icon-xs"
                    onClick={() => markRead(n.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
