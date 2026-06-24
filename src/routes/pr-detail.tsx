import { AiReview } from "@/components/ai-review";
import { checkRowIcon, summarizeChecks } from "@/components/check-badge";
import { CommentByline } from "@/components/comment-byline";
import { Composer } from "@/components/composer";
import { DiffViewer } from "@/components/diff-viewer";
import { EmptyState } from "@/components/empty-state";
import { FileTree } from "@/components/file-tree";
import { GuidedReview } from "@/components/guided-review";
import { LabelPicker } from "@/components/label-picker";
import { MarkdownBody } from "@/components/markdown-body";
import { PrActions } from "@/components/pr-actions";
import { ReactionsBar } from "@/components/reactions-bar";
import { ReviewSubmitPopover, reviewStateToEvent } from "@/components/review-submit-dialog";
import { ReviewThreadGroup } from "@/components/review-thread";
import { Segmented } from "@/components/segmented";
import { StackRail } from "@/components/stack-rail";
import { TooltipFor } from "@/components/tooltip-for";
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import { UserHoverCard } from "@/components/user-hover-card";
import type { AiAction } from "@/lib/ai-actions";
import { buildReviewContext } from "@/lib/ai/context";
import { celebrate } from "@/lib/confetti";
import { relativeTime } from "@/lib/format";
import type {
  ActionsJob,
  ActionsStep,
  CheckAnnotation,
  CheckRun,
  CheckRunsResponse,
  IssueComment,
  Label,
  PullDetail,
  PullFile,
  PullSummary,
  Review,
  ReviewThread,
  ReviewThreadGraphQL,
} from "@/lib/tauri";
import { invoke } from "@/lib/tauri";
import { safeOpenUrl, toastError, toastRetry } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useAuth } from "@/stores/auth";
import { useLocalRepos } from "@/stores/local-repos";
import { usePinboard } from "@/stores/pinboard";
import { usePrView } from "@/stores/pr-view";
import { useReviewDraft } from "@/stores/review-draft";
import { useReviewPrefs } from "@/stores/review-prefs";
import { useUi } from "@/stores/ui";
import { useViewedFiles, viewedKey } from "@/stores/viewed-files";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate, useParams } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  Columns2,
  Download,
  ExternalLink,
  Files,
  Focus,
  FolderGit2,
  GitCommit,
  GitPullRequest,
  MessageSquare,
  OctagonX,
  Pencil,
  Pin,
  PinOff,
  Rocket,
  RotateCw,
  Rows3,
  Sparkles,
  X,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

type DetailTab = "files" | "conversation" | "commits" | "checks";

/**
 * Reflect a just-submitted review, then CONFIRM it against GitHub — never just
 * trust a local flip. The POST returns the created review, so we show it
 * immediately; meanwhile we poll the real `GET /reviews` until it lists the
 * review (GitHub's list is eventually consistent). Each poll commits GitHub's
 * actual list as the source of truth — re-merging the created review only while
 * the list hasn't caught up yet, so the state is GitHub-backed and never flips
 * back on replication lag. If GitHub never shows it, the next natural refetch
 * reconciles, so a failed/inconsistent submit can't keep showing a stale state.
 */
function mergeReview(
  qc: ReturnType<typeof useQueryClient>,
  owner: string,
  repo: string,
  number: number,
  created: Review | undefined,
): void {
  const key = ["pull-reviews", owner, repo, number];
  if (!created?.id) {
    qc.invalidateQueries({ queryKey: key });
    return;
  }
  const createdId = created.id;
  // Optimistic: GitHub's own POST response, so it's real (not fabricated).
  qc.setQueryData<Review[]>(key, (old) => [
    ...(old ?? []).filter((r) => r.id !== createdId),
    created,
  ]);

  let tries = 0;
  const confirm = async () => {
    tries += 1;
    try {
      const fresh = await invoke<Review[]>("gh_list_reviews", { owner, repo, number });
      const present = fresh.some((r) => r.id === createdId);
      // Commit GitHub's real list. While it lags, keep the created review merged
      // so the UI doesn't flip back; once present, the list alone is the truth.
      qc.setQueryData<Review[]>(key, present ? fresh : [...fresh, created]);
      if (present) return;
    } catch {
      /* transient — try again */
    }
    if (tries < 5) window.setTimeout(confirm, 1500);
  };
  window.setTimeout(confirm, 1200);
}

export function PRDetailPage() {
  const { owner, repo, number: numberStr } = useParams({ from: "/prs/$owner/$repo/$number" });
  const number = Number(numberStr);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const view = useUi((s) => s.diffView);
  const setView = useUi((s) => s.setDiffView);
  const focusMode = useUi((s) => s.focusMode);
  const toggleFocus = useUi((s) => s.toggleFocusMode);
  // The string key the per-PR view store (and review-draft store) is keyed by.
  const prViewKey = `${owner}/${repo}#${number}`;
  // Persist + restore the active tab per PR (item 16). Lazy init reads the
  // store once so returning to a PR resumes the tab instead of resetting.
  const setPersistedTab = usePrView((s) => s.setTab);
  const setPersistedFile = usePrView((s) => s.setFile);
  const [tab, setTabState] = useState<DetailTab>(
    () => usePrView.getState().tabs[prViewKey] ?? "files",
  );
  const setTab = (next: DetailTab) => {
    setTabState(next);
    setPersistedTab(prViewKey, next);
  };
  const [chatOpen, setChatOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  // Toggle button for the floating AI panel, so closing it (Escape) can return
  // focus there (item 89).
  const chatToggleRef = useRef<HTMLButtonElement>(null);
  // Verdict announced to assistive tech after a review submit (item 97).
  const [verdict, setVerdict] = useState("");
  // Confirm before discarding the pending review, via an on-theme dialog
  // instead of window.confirm (item 86).
  const [discardOpen, setDiscardOpen] = useState(false);
  // Guided-tour "jump to line": which new-file line to scroll to + flash, with
  // a nonce so clicking the same step twice re-triggers the scroll.
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Jump from a pending review comment (in the submit dialog) to its file+line.
  const jumpToDraftComment = (c: { path: string; line?: number | null }) => {
    setTab("files");
    setActiveFile(c.path);
    if (c.line != null) {
      setFocusLine(c.line);
      setFocusNonce((n) => n + 1);
    }
    setView("unified");
  };
  const [titleDraft, setTitleDraft] = useState("");

  const prKey = { owner, repo, number };
  const draft = useReviewDraft((s) => s.drafts[`${owner}/${repo}#${number}`]);
  const setBody = useReviewDraft((s) => s.setBody);
  const addComment = useReviewDraft((s) => s.addComment);
  const removeComment = useReviewDraft((s) => s.removeComment);
  const clearDraft = useReviewDraft((s) => s.clear);

  // Unsaved-draft exit guard (item 18): once the review draft has comments,
  // intercept in-app navigation with a confirm dialog and arm a `beforeunload`
  // prompt for window/tab close. `withResolver` exposes the blocked state so we
  // can render an on-theme AlertDialog instead of the browser's native confirm.
  const hasUnsavedDraft = (draft?.comments?.length ?? 0) > 0;
  const blocker = useBlocker({
    shouldBlockFn: () => hasUnsavedDraft,
    enableBeforeUnload: () => hasUnsavedDraft,
    withResolver: true,
  });

  const pin = usePinboard((s) => s.pin);
  const unpin = usePinboard((s) => s.unpin);
  const isPinned = usePinboard((s) => s.isPinned);

  const viewerLogin = useAuth((s) => s.viewer?.login);
  const localRepo = useLocalRepos((s) => s.repos.find((r) => r.owner === owner && r.repo === repo));
  const checkoutLocal = useMutation({
    mutationFn: () => invoke("gh_pr_checkout", { path: localRepo?.path ?? "", number }),
    // Actionable success toast (item 21): one click reveals the clone in the
    // in-app repo view, matching the header's "Open local clone" affordance.
    onSuccess: () =>
      toast.success(`Checked out #${number} in ${owner}/${repo}`, {
        description: localRepo?.path,
        action: {
          label: "Open clone",
          onClick: () => navigate({ to: "/repos/$owner/$repo", params: { owner, repo } }),
        },
      }),
    // Recoverable failure (item 93): offer Retry instead of a dead-end error.
    onError: (e) => toastRetry(`Checkout failed — ${String(e)}`, () => checkoutLocal.mutate()),
  });

  // ~30s staleTime keeps switching between tabs (Files / Conversation / Checks)
  // from refetching everything each time; realtime events still invalidate.
  const detail = useQuery({
    queryKey: ["pull", owner, repo, number],
    queryFn: () => invoke<PullDetail>("gh_get_pull", { owner, repo, number }),
    staleTime: 30_000,
  });

  const files = useQuery({
    queryKey: ["pull-files", owner, repo, number],
    queryFn: () => invoke<PullFile[]>("gh_list_pull_files", { owner, repo, number }),
    staleTime: 60_000,
  });

  const threads = useQuery({
    queryKey: ["pull-review-comments", owner, repo, number],
    queryFn: () => invoke<ReviewThread[]>("gh_list_review_comments", { owner, repo, number }),
    staleTime: 30_000,
  });

  // GraphQL thread data (resolve state + node ids) powers reply/resolve in both
  // the diff (DiffViewer) and the Conversation tab.
  const reviewThreadsGql = useQuery({
    queryKey: ["pull-review-threads-gql", owner, repo, number],
    queryFn: () => invoke<ReviewThreadGraphQL[]>("gh_list_review_threads", { owner, repo, number }),
    staleTime: 30_000,
  });

  const reviews = useQuery({
    queryKey: ["pull-reviews", owner, repo, number],
    queryFn: () => invoke<Review[]>("gh_list_reviews", { owner, repo, number }),
    staleTime: 30_000,
  });

  // The viewer's own latest review verdict, so the header button reflects that
  // they've already reviewed (instead of always reading "Review" / undone).
  const myReviewState = useMemo(() => {
    const meaningful = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]);
    const mine = (reviews.data ?? [])
      .filter((r) => r.user.login === viewerLogin && meaningful.has(r.state))
      .sort((a, b) => +new Date(b.submitted_at ?? 0) - +new Date(a.submitted_at ?? 0));
    return mine[0]?.state ?? null;
  }, [reviews.data, viewerLogin]);

  // GraphQL node id is needed for draft↔ready and thread-resolve mutations.
  const nodeId = useQuery({
    queryKey: ["pr-node-id", owner, repo, number],
    queryFn: () => invoke<string>("gh_pr_node_id", { owner, repo, number }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  // Labels are a real field on the PR detail (GitHub's full PR object includes
  // them). The cached list value is only an instant first-paint fallback while
  // the detail query resolves — matched by repo *and* number so PR numbers
  // don't collide across the multi-repo list cache. Edits write straight into
  // the detail cache so the change sticks and survives a refetch.
  const cachedLists = qc.getQueriesData<PullSummary[]>({ queryKey: ["prs"] });
  const labelsFromList: Label[] | null = (() => {
    for (const [, data] of cachedLists) {
      // ["prs", …] is a broad prefix: some entries aren't PullSummary[] (the
      // state-totals object, the CI array). Only scan real PR-list arrays.
      if (!Array.isArray(data)) continue;
      const found = data.find(
        (p) =>
          p?.number === number &&
          typeof p?.html_url === "string" &&
          p.html_url.includes(`/${owner}/${repo}/`),
      );
      if (found) return found.labels;
    }
    return null;
  })();
  const labels = detail.data?.labels ?? labelsFromList ?? [];
  const applyLabels = (next: Label[]) => {
    qc.setQueryData<PullDetail>(["pull", owner, repo, number], (old) =>
      old ? { ...old, labels: next } : old,
    );
    qc.invalidateQueries({ queryKey: ["prs"] });
  };

  // Preview / deploy links parsed out of the PR description.
  const previewLinks = useMemo(() => {
    const urls = (detail.data?.body ?? "").match(/https?:\/\/[^\s)<>\]]+/g) ?? [];
    const out: { url: string; host: string }[] = [];
    const seen = new Set<string>();
    for (const raw of urls) {
      const url = raw.replace(/[.,;)\]]+$/, "");
      if (
        !/preview|deploy|staging|vercel\.app|netlify|ngrok|onrender|render\.com|fly\.dev|pages\.dev|herokuapp|surge\.sh|deno\.dev|railway/i.test(
          url,
        )
      )
        continue;
      try {
        const host = new URL(url).host;
        if (seen.has(host)) continue;
        seen.add(host);
        out.push({ url, host });
      } catch {
        // ignore non-URL matches
      }
      if (out.length >= 4) break;
    }
    return out;
  }, [detail.data?.body]);

  const headSha = detail.data?.head.sha;
  const checks = useQuery({
    queryKey: ["pull-checks", owner, repo, headSha],
    queryFn: () =>
      invoke<CheckRunsResponse>("gh_list_checks", {
        owner,
        repo,
        sha: headSha as string,
      }),
    enabled: !!headSha,
    staleTime: 15_000,
    // Live-refresh while CI is still running: poll every 8s as long as any check
    // is in progress, then stop on its own. Never polls a PR with no CI.
    refetchInterval: (query) => {
      const runs = query.state.data?.check_runs;
      if (!runs || runs.length === 0) return false;
      return runs.some((r) => r.status !== "completed") ? 8_000 : false;
    },
  });

  // Warm the adjacent tabs once the PR shell is open. These are small,
  // PR-scoped reads; prefetching them keeps tab switches feeling local instead
  // of replacing the page with fresh loading chrome.
  useEffect(() => {
    if (!headSha) return;
    void qc.prefetchQuery({
      queryKey: ["pull-commits", owner, repo, number],
      queryFn: () => invoke<CommitItem[]>("gh_list_commits", { owner, repo, number }),
      staleTime: 60_000,
    });
    void qc.prefetchQuery({
      queryKey: ["pull-issue-comments", owner, repo, number],
      queryFn: () => invoke<IssueComment[]>("gh_list_issue_comments", { owner, repo, number }),
      staleTime: 30_000,
    });
  }, [headSha, owner, repo, number, qc]);

  // Which checks are *required* by branch protection — so an optional failure
  // doesn't read as a broken PR, and a required-but-missing check reads pending.
  const requiredChecks = useQuery({
    queryKey: ["required-checks", owner, repo, number],
    queryFn: () => invoke<string[]>("gh_required_contexts", { owner, repo, number }),
    staleTime: 5 * 60_000,
  });
  const requiredSet = useMemo(() => new Set(requiredChecks.data ?? []), [requiredChecks.data]);

  // Check status drives the colour of the Checks tab (instead of a separate
  // badge in the header metadata row). Required-aware: optional failures don't
  // turn it red.
  const checkSummary = summarizeChecks(checks.data?.check_runs, requiredSet);
  const checkTone =
    checkSummary.summary === "failure"
      ? "text-destructive"
      : checkSummary.summary === "pending"
        ? "text-warning"
        : checkSummary.summary === "success"
          ? "text-success"
          : "text-muted-foreground";
  const fileList = files.data ?? [];
  const current = activeFile ?? fileList[0]?.filename ?? null;
  const currentFile = fileList.find((f) => f.filename === current) ?? null;
  const filteredThreads = threads.data ?? [];

  // Viewed-files state, also used to drive "mark viewed & next".
  const vk = headSha ? viewedKey(owner, repo, number, headSha) : null;
  const viewedMap = useViewedFiles((s) => (vk ? s.viewed[vk] : undefined));
  const setViewedFile = useViewedFiles((s) => s.setViewed);
  const autoMarkViewed = useReviewPrefs((s) => s.autoMarkViewed);
  const autoReadyOnReview = useReviewPrefs((s) => s.autoReadyOnReview);
  const diffDensity = useReviewPrefs((s) => s.diffDensity);

  // Unresolved review threads per file, for the file-tree comment badges.
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of reviewThreadsGql.data ?? []) {
      if (t.is_resolved) continue;
      counts[t.path] = (counts[t.path] ?? 0) + 1;
    }
    return counts;
  }, [reviewThreadsGql.data]);

  // Resume the last file read for this PR head (item 17). Only restores once,
  // when files first load and nothing is selected yet, and only if the saved
  // path still exists at this head — a force-push (new sha) keys to a fresh
  // entry, so stale paths never get restored.
  useEffect(() => {
    if (activeFile || !headSha || fileList.length === 0) return;
    const saved = usePrView.getState().files[`${prViewKey}@${headSha}`];
    if (saved && fileList.some((f) => f.filename === saved)) setActiveFile(saved);
  }, [activeFile, headSha, fileList, prViewKey]);

  // Persist the active file per PR head so re-entering resumes it (item 17).
  useEffect(() => {
    if (headSha && current) setPersistedFile(prViewKey, headSha, current);
  }, [headSha, current, prViewKey, setPersistedFile]);

  // Manually re-pull this PR from GitHub (diff, comments, reviews, checks, …).
  // Invalidates every query scoped to this owner/repo/PR — keyed by number or
  // by head sha (checks, file content) — and awaits the refetch so the button
  // can spin until fresh data lands.
  async function refreshPr() {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey;
          return (
            Array.isArray(k) &&
            k[1] === owner &&
            k[2] === repo &&
            (k[3] === number || (headSha != null && k[3] === headSha))
          );
        },
      });
    } finally {
      setRefreshing(false);
    }
  }

  function markViewedAndNext() {
    if (!vk || !current) return;
    setViewedFile(vk, current, true);
    const order = fileList.map((f) => f.filename);
    const start = order.indexOf(current);
    for (let step = 1; step <= order.length; step++) {
      const cand = order[(start + step) % order.length];
      if (cand !== current && !viewedMap?.[cand]) {
        setActiveFile(cand);
        return;
      }
    }
  }

  // Review-loop keyboard nav on the Files tab: ] / [ next/prev file, n marks the
  // current file viewed and jumps to the next unviewed one. Ignored while typing.
  useEffect(() => {
    if (tab !== "files") return;
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const order = fileList.map((f) => f.filename);
      if (order.length === 0) return;
      const cur = current ?? order[0];
      const idx = order.indexOf(cur);
      if (e.key === "]") {
        e.preventDefault();
        setActiveFile(order[(idx + 1) % order.length]);
      } else if (e.key === "[") {
        e.preventDefault();
        setActiveFile(order[(idx - 1 + order.length) % order.length]);
      } else if (e.key === "n") {
        e.preventDefault();
        if (vk && cur) {
          setViewedFile(vk, cur, true);
          for (let s = 1; s <= order.length; s++) {
            const cand = order[(idx + s) % order.length];
            if (cand !== cur && !viewedMap?.[cand]) {
              setActiveFile(cand);
              break;
            }
          }
        }
      } else if (e.key === "c") {
        // Jump to the next file with open inline-comment threads (item 20),
        // wrapping around. Uses the same unresolved-thread counts as the
        // file-tree badges.
        e.preventDefault();
        for (let s = 1; s <= order.length; s++) {
          const cand = order[(idx + s) % order.length];
          if (cand !== cur && (commentCounts[cand] ?? 0) > 0) {
            setActiveFile(cand);
            break;
          }
        }
      } else if (e.key === "v") {
        // Toggle "viewed" for the current file (item 37).
        e.preventDefault();
        if (vk && cur) setViewedFile(vk, cur, !viewedMap?.[cur]);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, fileList, current, viewedMap, vk, setViewedFile, commentCounts]);

  // Tab-switch shortcuts (item 19): 1–4 jump to Files / Conversation / Commits /
  // Checks. Ignored while typing or with modifiers, so they don't fight text
  // entry or browser/app chords.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only stable store setters are used
  useEffect(() => {
    const order: DetailTab[] = ["files", "conversation", "commits", "checks"];
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = Number(e.key) - 1;
      const next = order[idx];
      if (next) {
        e.preventDefault();
        setTab(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Execute an AI-proposed action with the app's authenticated commands.
  async function executeAiAction(a: AiAction): Promise<void> {
    switch (a.type) {
      case "comment":
        await invoke("gh_create_issue_comment", { owner, repo, number, body: a.body });
        qc.invalidateQueries({ queryKey: ["pull-issue-comments", owner, repo, number] });
        break;
      case "review": {
        const created = await invoke<Review>("gh_submit_review", {
          owner,
          repo,
          number,
          body: a.body,
          event: a.event,
          comments: [],
          commitId: headSha,
        });
        mergeReview(qc, owner, repo, number, created);
        if (a.event === "APPROVE") celebrate();
        break;
      }
      case "inline_comment":
        if (!headSha) throw new Error("PR head commit unavailable — reload and try again.");
        await invoke("gh_create_review_comment", {
          owner,
          repo,
          number,
          commitId: headSha,
          path: a.path,
          line: a.line,
          side: a.side,
          body: a.body,
        });
        qc.invalidateQueries({ queryKey: ["pull-review-comments", owner, repo, number] });
        qc.invalidateQueries({ queryKey: ["pull-review-threads-gql", owner, repo, number] });
        break;
      case "label": {
        const names = new Set(labels.map((l) => l.name));
        for (const n of a.add) names.add(n);
        for (const n of a.remove) names.delete(n);
        const result = await invoke<Label[]>("gh_set_pr_labels", {
          owner,
          repo,
          number,
          labels: [...names],
        });
        applyLabels(result);
        break;
      }
    }
    toast.success("Posted to GitHub");
  }

  // Fetch the currently-viewed file's HEAD content so the diff viewer can
  // expand context lines between hunks ("expand more lines").
  const fileContent = useQuery({
    queryKey: ["file-content", owner, repo, headSha, current],
    queryFn: () =>
      invoke<string>("gh_get_file_content", {
        owner,
        repo,
        path: current as string,
        ref: headSha as string,
      }),
    enabled: !!headSha && !!current,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });

  const submit = useMutation({
    mutationFn: async (event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") => {
      const body = draft?.body ?? "";
      const comments = draft?.comments ?? [];
      // Non-blocking nudge (item 22): requesting changes with no summary is
      // usually a mistake, but we still let it through — just warn.
      if (event === "REQUEST_CHANGES" && !body.trim()) {
        toast.warning("Requesting changes without a summary", {
          description: "Reviewers usually expect a note on what to change.",
        });
      }
      return invoke<Review>("gh_submit_review", {
        owner,
        repo,
        number,
        body,
        event,
        comments,
        commitId: detail.data?.head.sha,
      });
    },
    onSuccess: (created, event) => {
      clearDraft(prKey);
      mergeReview(qc, owner, repo, number, created);
      qc.invalidateQueries({ queryKey: ["pull-review-comments", owner, repo, number] });
      toast.success("Review submitted");
      // Announce the verdict to assistive tech (item 97).
      setVerdict(
        event === "APPROVE"
          ? "Review submitted: approved"
          : event === "REQUEST_CHANGES"
            ? "Review submitted: changes requested"
            : "Review submitted: commented",
      );
      if (event === "APPROVE") celebrate();
      // Optionally flip a draft PR to ready-for-review on review submit.
      if (autoReadyOnReview && detail.data?.draft && nodeId.data) {
        const prNodeId = nodeId.data;
        invoke("gh_set_draft", { prNodeId, draft: false })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["pull", owner, repo, number] });
            // Surface the side effect clearly (item 23): explain that the PR was
            // published, with an Undo back to draft (the mutation is at hand).
            toast.success("Published — PR is now ready for review", {
              description: "Submitting your review took this PR out of draft.",
              action: {
                label: "Undo",
                onClick: () => {
                  invoke("gh_set_draft", { prNodeId, draft: true })
                    .then(() => {
                      qc.invalidateQueries({ queryKey: ["pull", owner, repo, number] });
                      toast.success("Back to draft");
                    })
                    .catch(toastError);
                },
              },
            });
          })
          .catch(() => {});
      }
    },
    // The draft isn't cleared on failure, so Retry re-submits the same review.
    onError: (e, event) =>
      toastRetry(`Couldn't submit review — ${String(e)}`, () => submit.mutate(event)),
  });

  const updatePr = useMutation({
    mutationFn: (patch: { title?: string; body?: string }) =>
      invoke("gh_update_pr", { owner, repo, number, ...patch }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pull", owner, repo, number] });
      qc.invalidateQueries({ queryKey: ["prs"] });
      toast.success("Pull request updated");
    },
    onError: toastError,
  });

  // Self-contained review context: PR metadata + description + the full diff
  // (capped) so the AI can review without filesystem access.
  const reviewContext = useMemo(
    () =>
      detail.data
        ? buildReviewContext(detail.data, files.data ?? [], `${owner}/${repo}`, number)
        : "",
    [detail.data, files.data, owner, repo, number],
  );

  if (detail.isLoading) {
    return <PRDetailLoading />;
  }
  if (detail.error || !detail.data) {
    return (
      <EmptyState
        icon={GitPullRequest}
        title="Couldn't load this PR"
        description={String(detail.error)}
        action={
          <Button variant="outline" onClick={() => navigate({ to: "/prs" })}>
            Back to list
          </Button>
        }
      />
    );
  }

  const d = detail.data;
  const pinned = isPinned("pr", `${owner}/${repo}#${number}`);

  return (
    <div className="relative flex h-full flex-col">
      {/* Header */}
      <header className="flex flex-col gap-y-3 border-b border-hairline px-6 py-4">
        <div className="flex items-start gap-3">
          <GitPullRequest
            className={cn(
              "mt-1 size-5 shrink-0",
              d.merged
                ? "text-purple-400"
                : d.state === "closed"
                  ? "text-destructive"
                  : d.draft
                    ? "text-muted-foreground"
                    : "text-success",
            )}
            strokeWidth={1.5}
          />
          <div className="min-w-0 flex-1">
            <div className="group/title flex items-center gap-2">
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && titleDraft.trim()) {
                      e.preventDefault();
                      updatePr.mutate({ title: titleDraft.trim() });
                      setEditingTitle(false);
                    }
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  onBlur={() => setEditingTitle(false)}
                  className="min-w-0 flex-1 rounded-md border border-border/40 bg-background/40 px-2 py-0.5 text-base font-medium text-foreground outline-none focus:border-primary/50"
                />
              ) : (
                <>
                  <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                    {d.title}
                  </h1>
                  <span className="ml-1 shrink-0 text-xs text-muted-foreground">
                    {owner}/{repo}
                    <span className="font-display tabular-nums">#{number}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Edit title"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setTitleDraft(d.title);
                      setEditingTitle(true);
                    }}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/title:opacity-100"
                  >
                    <Pencil className="size-3" />
                  </button>
                </>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <UserHoverCard user={d.user}>
                  <UserAvatar user={d.user} className="size-5 ring-1 ring-border/50" />
                </UserHoverCard>
                <span className="text-foreground/80">{d.user.login}</span>
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                {d.head.ref}
                <ArrowRight className="size-3.5 text-muted-foreground/50" />
                {d.base.ref}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span>updated {relativeTime(d.updated_at)}</span>
              {localRepo && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <TooltipFor label={`Open local clone · ${localRepo.path}`}>
                    <button
                      type="button"
                      aria-label="Open local clone"
                      onClick={() =>
                        navigate({ to: "/repos/$owner/$repo", params: { owner, repo } })
                      }
                      className="text-primary transition-colors hover:text-primary/80"
                    >
                      <FolderGit2 className="size-3.5" />
                    </button>
                  </TooltipFor>
                  <TooltipFor label="Check out this PR in the local clone">
                    <button
                      type="button"
                      aria-label="Check out this PR locally"
                      onClick={() => checkoutLocal.mutate()}
                      disabled={checkoutLocal.isPending}
                      className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      <Download
                        className={cn("size-3.5", checkoutLocal.isPending && "animate-pulse")}
                      />
                    </button>
                  </TooltipFor>
                </>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <LabelPicker
                owner={owner}
                repo={repo}
                number={number}
                current={labels}
                onChange={applyLabels}
              />
              {previewLinks.map((l) => (
                <button
                  key={l.host}
                  type="button"
                  onClick={() => safeOpenUrl(l.url)}
                  aria-label={l.url}
                  className="inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-xs text-info transition-colors hover:bg-info/25"
                >
                  <Rocket className="size-3" strokeWidth={2} />
                  {l.host}
                </button>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <TooltipFor label="Refresh PR">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Refresh PR"
                onClick={refreshPr}
                disabled={refreshing}
              >
                <RotateCw className={cn("size-3.5", refreshing && "animate-spin")} />
              </Button>
            </TooltipFor>
            <TooltipFor label="Open on GitHub">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Open on GitHub"
                onClick={() => safeOpenUrl(d.html_url)}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipFor>
            <TooltipFor label={pinned ? "Unpin" : "Pin PR"}>
              <Button
                size="icon-sm"
                variant={pinned ? "secondary" : "ghost"}
                onClick={() => {
                  const item = {
                    kind: "pr" as const,
                    id: `${owner}/${repo}#${number}`,
                    label: `${owner}/${repo}#${number}`,
                    hint: d.title,
                    path: `/prs/${owner}/${repo}/${number}`,
                  };
                  pinned ? unpin("pr", item.id) : pin(item);
                }}
              >
                {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              </Button>
            </TooltipFor>
            {d.state === "open" && d.user.login !== viewerLogin && (
              <ReviewSubmitPopover
                trigger={
                  <Button
                    size="sm"
                    variant={myReviewState ? "secondary" : "default"}
                    className="shadow-none"
                  >
                    {myReviewState === "APPROVED" ? (
                      <CheckCircle2 className="size-3.5 text-success" />
                    ) : myReviewState === "CHANGES_REQUESTED" ? (
                      <X className="size-3.5 text-destructive" />
                    ) : myReviewState === "COMMENTED" ? (
                      <MessageSquare className="size-3.5" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    {myReviewState === "APPROVED"
                      ? "Approved"
                      : myReviewState === "CHANGES_REQUESTED"
                        ? "Changes requested"
                        : myReviewState === "COMMENTED"
                          ? "Reviewed"
                          : "Review"}
                  </Button>
                }
                draftBody={draft?.body ?? ""}
                draftComments={draft?.comments ?? []}
                defaultEvent={reviewStateToEvent(myReviewState)}
                onJumpToComment={jumpToDraftComment}
                onBodyChange={(b) => setBody(prKey, b)}
                onRemoveComment={(i) => removeComment(prKey, i)}
                submitting={submit.isPending}
                onSubmit={(event) => submit.mutate(event)}
              />
            )}
            <PrActions owner={owner} repo={repo} number={number} pr={d} nodeId={nodeId.data} />
          </div>
        </div>

        <div className="flex items-center gap-2 pb-1">
          <Segmented<DetailTab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "files", label: "Files", icon: Files },
              { value: "conversation", label: "Conversation", icon: MessageSquare },
              {
                value: "commits",
                label: "Commits",
                icon: GitCommit,
                count: d.commits ?? undefined,
              },
              {
                value: "checks",
                label: "Checks",
                // A failing rollup swaps the glyph to a "stop" octagon so the tab
                // warns by shape, not just color.
                icon: checkSummary.summary === "failure" ? OctagonX : CheckCircle2,
                count: checks.data?.total_count,
                tone: checks.data ? checkTone : undefined,
              },
            ]}
          />

          {tab === "files" && (
            <div className="ml-auto flex items-center gap-2">
              {(d.additions ?? d.deletions) != null && (
                <span
                  className="mr-0.5 flex items-center gap-1.5 font-display text-xs tabular-nums"
                  aria-label={`${d.additions ?? 0} additions, ${d.deletions ?? 0} deletions`}
                >
                  <span className="text-success">+{d.additions ?? 0}</span>
                  <span className="text-destructive">−{d.deletions ?? 0}</span>
                </span>
              )}
              {view !== "guided" && vk && current && (
                <TooltipFor label="Mark viewed & jump to next file (n) · [ ] to move between files">
                  <button
                    type="button"
                    onClick={markViewedAndNext}
                    aria-label="Mark viewed & jump to next file"
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
                  >
                    <CheckCheck className="size-3.5" />
                  </button>
                </TooltipFor>
              )}
              {view !== "guided" && (
                <TooltipFor label="Focus mode hides lockfiles, generated, snapshots, renames, and format-only changes">
                  <button
                    type="button"
                    onClick={toggleFocus}
                    aria-label="Focus mode"
                    aria-pressed={focusMode}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md transition-colors",
                      focusMode
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
                    )}
                  >
                    <Focus className="size-3.5" />
                  </button>
                </TooltipFor>
              )}
              <div className="inline-flex h-7 items-center rounded-md border border-border p-0.5">
                <TooltipFor label="Unified diff" shortcut="⌘B">
                  <button
                    type="button"
                    onClick={() => setView("unified")}
                    aria-label="Unified diff"
                    aria-pressed={view === "unified"}
                    className={cn(
                      "flex size-6 items-center justify-center rounded transition-colors",
                      view === "unified"
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Rows3 className="size-3.5" />
                  </button>
                </TooltipFor>
                <TooltipFor label="Split diff" shortcut="⌘B">
                  <button
                    type="button"
                    onClick={() => setView("split")}
                    aria-label="Split diff"
                    aria-pressed={view === "split"}
                    className={cn(
                      "flex size-6 items-center justify-center rounded transition-colors",
                      view === "split"
                        ? "bg-foreground/[0.08] text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Columns2 className="size-3.5" />
                  </button>
                </TooltipFor>
                <TooltipFor label="Guided review — AI walks you through it">
                  <button
                    type="button"
                    onClick={() => setView("guided")}
                    aria-label="Guided review"
                    aria-pressed={view === "guided"}
                    className={cn(
                      "flex size-6 items-center justify-center rounded transition-colors",
                      view === "guided"
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Sparkles className="size-3.5" />
                  </button>
                </TooltipFor>
              </div>
            </div>
          )}
        </div>
      </header>

      <StackRail owner={owner} repo={repo} current={d} />

      {/* Body */}
      <div className="flex flex-1 min-h-0 flex-col">
        {tab === "files" && view === "guided" && (
          <GuidedReview
            prKey={`${owner}/${repo}#${number}`}
            context={reviewContext}
            files={fileList}
            headSha={headSha}
            onAddComment={(c) => addComment(prKey, c)}
            onPostComment={(c) =>
              executeAiAction({
                type: "inline_comment",
                path: c.path,
                line: c.line,
                body: c.body,
                side: "RIGHT",
              })
            }
            onOpenFile={(path, line) => {
              setActiveFile(path);
              if (line != null) {
                setFocusLine(line);
                setFocusNonce((n) => n + 1);
              }
              setView("unified");
            }}
          />
        )}

        {tab === "files" && view !== "guided" && (
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
            <ResizablePanel defaultSize={22} minSize={15}>
              <FileTree
                files={fileList}
                active={current}
                onSelect={setActiveFile}
                loading={files.isLoading && fileList.length === 0}
                viewedKey={vk}
                commentCounts={commentCounts}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel>
              <ScrollArea className="h-full">
                {currentFile ? (
                  <DiffViewer
                    path={currentFile.filename}
                    patch={currentFile.patch}
                    view={view === "split" ? "split" : "unified"}
                    threads={filteredThreads.filter((t) => t.path === currentFile.filename)}
                    onAddComment={(c) => addComment(prKey, c)}
                    owner={owner}
                    repo={repo}
                    number={number}
                    reviewThreads={reviewThreadsGql.data ?? []}
                    viewerLogin={viewerLogin}
                    fileLines={
                      fileContent.data && fileContent.dataUpdatedAt > 0
                        ? fileContent.data.split("\n")
                        : undefined
                    }
                    autoMarkViewed={autoMarkViewed}
                    onReachedEnd={() => {
                      if (vk && current) setViewedFile(vk, current, true);
                    }}
                    density={diffDensity}
                    focusLine={focusLine}
                    focusNonce={focusNonce}
                    headSha={headSha}
                    viewedKey={vk}
                    fileLinesLoading={fileContent.isLoading && fileContent.dataUpdatedAt === 0}
                  />
                ) : (
                  <EmptyState
                    icon={Files}
                    title="No file selected"
                    description="Pick a file from the tree."
                  />
                )}
              </ScrollArea>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        {tab === "conversation" && (
          <ScrollArea className="flex-1">
            <Conversation
              owner={owner}
              repo={repo}
              number={number}
              viewerLogin={viewerLogin}
              description={d.body}
              author={d.user}
              createdAt={d.created_at}
              reviews={reviews.data ?? []}
              threads={filteredThreads}
              onSaveDescription={(body) => updatePr.mutate({ body })}
              savingDescription={updatePr.isPending}
            />
          </ScrollArea>
        )}

        {tab === "commits" && <CommitsTab owner={owner} repo={repo} number={number} />}

        {tab === "checks" && (
          <ScrollArea className="flex-1">
            <ChecksTab
              runs={checks.data?.check_runs ?? []}
              loading={checks.isLoading}
              owner={owner}
              repo={repo}
              requiredNames={requiredSet}
            />
          </ScrollArea>
        )}
      </div>

      {/* Pending review footer */}
      {(draft?.comments?.length ?? 0) > 0 && (
        <div className="flex items-center gap-3 border-t border-hairline bg-card/50 px-6 py-2 backdrop-blur-md">
          <MessageSquare className="size-3.5 text-primary" />
          <span className="text-xs text-foreground">
            Pending review · {draft.comments.length} comment{draft.comments.length === 1 ? "" : "s"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setDiscardOpen(true)}>
              Discard
            </Button>
            <ReviewSubmitPopover
              side="top"
              trigger={<Button size="sm">Submit review</Button>}
              draftBody={draft?.body ?? ""}
              draftComments={draft?.comments ?? []}
              defaultEvent={reviewStateToEvent(myReviewState)}
              onJumpToComment={jumpToDraftComment}
              onBodyChange={(b) => setBody(prKey, b)}
              onRemoveComment={(i) => removeComment(prKey, i)}
              submitting={submit.isPending}
              onSubmit={(event) => submit.mutate(event)}
            />
          </div>
        </div>
      )}

      {/* Discard-review confirmation — on-theme, focus-trapped (item 86). */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard pending review?</AlertDialogTitle>
            <AlertDialogDescription>
              {`Your ${draft?.comments?.length ?? 0} pending comment${
                (draft?.comments?.length ?? 0) === 1 ? "" : "s"
              } will be permanently discarded. This can't be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm">
                  Keep editing
                </Button>
              }
            />
            <AlertDialogClose
              render={
                <Button variant="destructive" size="sm" onClick={() => clearDraft(prKey)}>
                  Discard
                </Button>
              }
            />
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Unsaved-draft exit guard (item 18) — on-theme confirm when leaving with
          pending review comments. `beforeunload` is handled by useBlocker. */}
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          // Closing without choosing Leave = stay on the page.
          if (!open && blocker.status === "blocked") blocker.reset();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with an unsaved review?</AlertDialogTitle>
            <AlertDialogDescription>
              {`You have ${draft?.comments?.length ?? 0} pending comment${
                (draft?.comments?.length ?? 0) === 1 ? "" : "s"
              } that haven't been submitted. Leaving keeps the draft, but you'll navigate away from this PR.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => blocker.status === "blocked" && blocker.reset()}
            >
              Stay
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => blocker.status === "blocked" && blocker.proceed()}
            >
              Leave
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>

      {/* Assertive live region announcing the review verdict (item 97). */}
      <output aria-live="assertive" className="sr-only">
        {verdict}
      </output>

      {/* Floating AI chat — ask about this PR from any tab. */}
      <div
        className={cn(
          "absolute right-4 z-40 flex flex-col items-end",
          (draft?.comments?.length ?? 0) > 0 ? "bottom-16" : "bottom-4",
        )}
      >
        {chatOpen && (
          // Escape closes the panel and returns focus to the toggle (item 89).
          <div
            role="dialog"
            aria-label="Ask about this PR"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setChatOpen(false);
                chatToggleRef.current?.focus();
              }
            }}
            className="mb-2 flex h-[30rem] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-hairline bg-popover/95 shadow-2xl backdrop-blur-md"
          >
            <div className="flex items-center gap-1.5 border-b border-hairline px-3 py-2.5 text-[13px] font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              Ask about this PR
              <button
                type="button"
                onClick={() => {
                  setChatOpen(false);
                  chatToggleRef.current?.focus();
                }}
                aria-label="Close chat"
                className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 px-3 py-3">
              <AiReview
                prKey={`${owner}/${repo}#${number}`}
                context={reviewContext}
                executeAction={executeAiAction}
              />
            </div>
          </div>
        )}
        <button
          ref={chatToggleRef}
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          aria-label={chatOpen ? "Close AI chat" : "Ask AI about this PR"}
          aria-expanded={chatOpen}
          className="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          {chatOpen ? <X className="size-5" /> : <Sparkles className="size-5" />}
        </button>
      </div>
    </div>
  );
}

function PRDetailLoading() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-y-3 border-b border-hairline px-6 py-4">
        <div className="flex items-start gap-3">
          <PlaceholderBox className="mt-1 size-5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <PlaceholderBox className="h-5 w-[min(32rem,62%)]" />
              <PlaceholderBox className="h-3.5 w-28" />
            </div>
            <div className="flex items-center gap-2">
              <PlaceholderBox className="size-5 rounded-full" />
              <PlaceholderBox className="h-3 w-20" />
              <PlaceholderBox className="h-3 w-32" />
              <PlaceholderBox className="h-3 w-24" />
            </div>
            <div className="flex items-center gap-2">
              {[56, 72, 64].map((width) => (
                <PlaceholderBox key={width} className="h-5 rounded-full" style={{ width }} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <PlaceholderBox className="h-7 w-16 rounded-lg" />
            <PlaceholderBox className="h-7 w-14 rounded-lg" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {[64, 96, 72, 68].map((width) => (
            <PlaceholderBox key={width} className="h-7 rounded-md" style={{ width }} />
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="w-[22%] min-w-52 space-y-1 border-r border-hairline p-2">
          {[0.86, 0.68, 0.78, 0.54, 0.72, 0.62, 0.48].map((width, i) => (
            <div key={i} className="flex h-6 items-center gap-2 rounded px-1.5">
              <PlaceholderBox className="size-3 shrink-0 rounded-sm" />
              <PlaceholderBox className="h-3 min-w-0" style={{ width: `${width * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-2 p-4">
          <PlaceholderBox className="h-5 w-64" />
          {[0.94, 0.88, 0.96, 0.7, 0.84, 0.92, 0.62].map((width, i) => (
            <PlaceholderBox key={i} className="h-4" style={{ width: `${width * 100}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlaceholderBox({ className, ...props }: ComponentProps<"div">): ReactElement {
  return <div className={cn("rounded-md bg-foreground/[0.055]", className)} {...props} />;
}

function CommitsPlaceholder() {
  const rows = [
    { width: "56%", meta: "22%" },
    { width: "72%", meta: "18%" },
    { width: "48%", meta: "24%" },
    { width: "64%", meta: "20%" },
  ];

  return (
    <div className="px-3 py-2">
      {rows.map((row, i) => (
        <div key={i} className="flex h-8 items-center gap-3 rounded-lg px-3">
          <GitCommit className="size-3.5 shrink-0 text-muted-foreground/45" />
          <PlaceholderBox className="h-3.5 min-w-0" style={{ width: row.width }} />
          <PlaceholderBox className="ml-auto h-3.5 shrink-0" style={{ width: row.meta }} />
          <code className="h-3.5 w-12 shrink-0 rounded bg-foreground/[0.045]" />
        </div>
      ))}
    </div>
  );
}

function ChecksPlaceholder() {
  const rows = ["58%", "66%", "44%", "72%", "52%", "62%"];

  return (
    <div className="px-2 py-1.5">
      <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/50">
        Required
      </div>
      {rows.map((width, i) => (
        <div key={i} className="flex h-8 items-center gap-2 rounded-lg px-2">
          <span className="size-3.5 shrink-0 rounded-full border border-border/50 bg-foreground/[0.035]" />
          <PlaceholderBox className="h-3.5 min-w-0" style={{ width }} />
          <PlaceholderBox className="ml-auto h-3.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function Conversation({
  owner,
  repo,
  number,
  viewerLogin,
  description,
  author,
  createdAt,
  reviews,
  threads,
  onSaveDescription,
  savingDescription,
}: {
  owner: string;
  repo: string;
  number: number;
  viewerLogin?: string;
  description: string | null;
  author: { login: string; avatar_url: string };
  createdAt: string;
  reviews: Review[];
  threads: ReviewThread[];
  onSaveDescription: (body: string) => void;
  savingDescription: boolean;
}) {
  const qc = useQueryClient();
  const [editingDescription, setEditingDescription] = useState(false);

  const issueComments = useQuery({
    queryKey: ["pull-issue-comments", owner, repo, number],
    queryFn: () => invoke<IssueComment[]>("gh_list_issue_comments", { owner, repo, number }),
    staleTime: 30_000,
  });
  const comments = issueComments.data ?? [];

  // GraphQL thread data carries the resolve state + node id needed to
  // resolve/reopen a conversation; we match its comment ids back to the REST
  // review comments for the bodies.
  const reviewThreads = useQuery({
    queryKey: ["pull-review-threads-gql", owner, repo, number],
    queryFn: () => invoke<ReviewThreadGraphQL[]>("gh_list_review_threads", { owner, repo, number }),
    staleTime: 30_000,
  });
  const gqlThreads = reviewThreads.data ?? [];
  const commentById = new Map(threads.map((t) => [t.id, t]));

  const hasContent =
    !!description || reviews.length > 0 || threads.length > 0 || comments.length > 0;

  const comment = useMutation({
    mutationFn: (body: string) => invoke("gh_create_issue_comment", { owner, repo, number, body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pull-issue-comments", owner, repo, number] });
      toast.success("Comment posted");
    },
    onError: toastError,
  });

  return (
    <div className="space-y-5 px-6 pt-6 pb-20">
      {(description || editingDescription) && (
        <article className="group/desc rounded-xl border border-hairline bg-card/50 p-4">
          <CommentByline
            className="mb-2"
            user={author}
            action="opened"
            timestamp={createdAt}
            trailing={
              !editingDescription && (
                <button
                  type="button"
                  aria-label="Edit description"
                  onClick={() => setEditingDescription(true)}
                  className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/desc:opacity-100"
                >
                  <Pencil className="size-3" />
                </button>
              )
            }
          />
          {editingDescription ? (
            <Composer
              initialValue={description ?? ""}
              placeholder="Describe this pull request…"
              submitLabel="Save"
              submitting={savingDescription}
              rows={8}
              autoFocus
              onSubmit={(body) => {
                onSaveDescription(body);
                setEditingDescription(false);
              }}
              onCancel={() => setEditingDescription(false)}
            />
          ) : (
            <>
              <MarkdownBody className="text-xs">{description ?? ""}</MarkdownBody>
              <div className="mt-2.5">
                <ReactionsBar
                  target="issue"
                  owner={owner}
                  repo={repo}
                  id={number}
                  viewerLogin={viewerLogin}
                />
              </div>
            </>
          )}
        </article>
      )}
      {!hasContent ? (
        <EmptyState
          icon={MessageSquare}
          title="No discussion yet"
          description="Reviews and comments on this PR will appear here."
          className="py-10"
        />
      ) : (
        <>
          {reviews.map((r) => (
            <article
              key={r.id}
              className={cn(
                "rounded-xl border border-hairline border-l-2 bg-card/50 p-4 pl-3.5",
                r.state === "APPROVED"
                  ? "border-l-success/60"
                  : r.state === "CHANGES_REQUESTED"
                    ? "border-l-destructive/60"
                    : "border-l-border/40",
              )}
            >
              <CommentByline
                className="mb-2"
                user={r.user}
                timestamp={r.submitted_at}
                badge={
                  <span
                    className={cn(
                      "font-medium",
                      r.state === "APPROVED"
                        ? "text-success"
                        : r.state === "CHANGES_REQUESTED"
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {r.state.replace(/_/g, " ").toLowerCase()}
                  </span>
                }
              />
              {r.body && <MarkdownBody className="text-xs">{r.body}</MarkdownBody>}
              <div className="mt-2.5">
                <ReactionsBar
                  target="review"
                  owner={owner}
                  repo={repo}
                  id={r.id}
                  pr={number}
                  viewerLogin={viewerLogin}
                />
              </div>
            </article>
          ))}

          {comments.map((c) => (
            <article key={c.id} className="rounded-xl border border-hairline bg-card/50 p-4">
              <CommentByline className="mb-2" user={c.user} timestamp={c.created_at} />
              <MarkdownBody className="text-xs">{c.body}</MarkdownBody>
              <div className="mt-2.5">
                <ReactionsBar
                  target="issue_comment"
                  owner={owner}
                  repo={repo}
                  id={c.id}
                  viewerLogin={viewerLogin}
                />
              </div>
            </article>
          ))}

          {gqlThreads.length > 0 && (
            <section>
              <h2 className="mb-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Inline comments
              </h2>
              <div className="space-y-2.5">
                {gqlThreads.map((gt) => {
                  const cmts = gt.comment_ids
                    .map((id) => commentById.get(id))
                    .filter((c): c is ReviewThread => c != null);
                  if (cmts.length === 0) return null;
                  return (
                    <ReviewThreadGroup
                      key={gt.id}
                      owner={owner}
                      repo={repo}
                      number={number}
                      thread={gt}
                      comments={cmts}
                      viewerLogin={viewerLogin}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <div className="border-t border-hairline pt-4">
        <Composer
          placeholder="Add a comment to the conversation…"
          submitLabel="Comment"
          submitting={comment.isPending}
          onSubmit={(body) => comment.mutate(body)}
        />
      </div>
    </div>
  );
}

interface CommitItem {
  sha: string;
  commit: { message: string; author: { name: string; date: string } };
}

function CommitsTab({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const q = useQuery({
    queryKey: ["pull-commits", owner, repo, number],
    queryFn: () => invoke<CommitItem[]>("gh_list_commits", { owner, repo, number }),
    staleTime: 60_000,
  });

  if (q.isLoading) {
    return <CommitsPlaceholder />;
  }
  if (!q.data || q.data.length === 0) {
    return <p className="p-6 text-xs text-muted-foreground">No commits.</p>;
  }
  return (
    <ScrollArea className="flex-1">
      <ul className="px-3 py-2">
        {q.data.map((c) => (
          <li
            key={c.sha}
            className="group flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-foreground/[0.04]"
          >
            <GitCommit className="size-3.5 shrink-0 text-muted-foreground" />
            <p className="min-w-0 flex-1 truncate text-xs text-foreground">
              {c.commit.message.split("\n")[0]}
            </p>
            <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {c.commit.author?.name} · {relativeTime(c.commit.author?.date)}
            </span>
            <code className="shrink-0 font-mono text-xs text-muted-foreground">
              {c.sha.slice(0, 7)}
            </code>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

function ChecksTab({
  runs,
  loading,
  owner,
  repo,
  requiredNames,
}: {
  runs: CheckRun[];
  loading: boolean;
  owner: string;
  repo: string;
  requiredNames: Set<string>;
}) {
  // Split required (merge-gating) from the rest, each sorted by name. Grouping
  // makes the long list scannable and makes "required or not" obvious.
  const { required, optional } = useMemo(() => {
    const byName = (a: CheckRun, b: CheckRun) => a.name.localeCompare(b.name);
    return {
      required: runs.filter((r) => requiredNames.has(r.name)).sort(byName),
      optional: runs.filter((r) => !requiredNames.has(r.name)).sort(byName),
    };
  }, [runs, requiredNames]);

  if (loading) {
    return <ChecksPlaceholder />;
  }
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No CI checks"
        description="This PR head doesn't have any check runs yet."
      />
    );
  }
  const row = (run: CheckRun) => <CheckRow key={run.id} run={run} owner={owner} repo={repo} />;
  return (
    <div className="px-2 py-1.5">
      {required.length > 0 && (
        <CheckGroup title="Required" hint="must pass to merge">
          {required.map(row)}
        </CheckGroup>
      )}
      {optional.length > 0 && (
        <CheckGroup title={required.length > 0 ? "Other checks" : "Checks"}>
          {optional.map(row)}
        </CheckGroup>
      )}
    </div>
  );
}

function CheckGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-1">
      <div className="flex items-baseline gap-2 px-2 pt-2 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {hint && <span className="text-[11px] text-muted-foreground/50">{hint}</span>}
      </div>
      <ul>{children}</ul>
    </section>
  );
}

function CheckRow({ run, owner, repo }: { run: CheckRun; owner: string; repo: string }) {
  const qc = useQueryClient();
  const { Icon, tone, spin } = checkRowIcon(run);
  const jobId = actionsJobId(run);
  const runId = actionsRunId(run);
  const duration =
    run.started_at && run.completed_at
      ? formatDuration(new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())
      : null;

  const rerun = useMutation({
    // Re-run as narrowly as the check allows, never the whole suite:
    // 1) a parseable Actions job → just that job (+ its dependents);
    // 2) else an Actions run → only that run's FAILED jobs;
    // 3) else a GitHub App check → rerequest that single check.
    mutationFn: () =>
      jobId != null
        ? invoke<void>("gh_rerun_job", { owner, repo, jobId })
        : runId != null
          ? invoke<void>("gh_rerun_failed_jobs", { owner, repo, runId })
          : invoke<void>("gh_rerun_check", { owner, repo, checkRunId: run.id }),
    onSuccess: () => {
      toast.success(`Queued re-run of ${run.name}`);
      qc.invalidateQueries({ queryKey: ["pull-checks"] });
    },
    onError: (e) => toast.error(`Couldn't re-run ${run.name}`, { description: String(e) }),
  });

  const canRerun = run.status === "completed";
  const [expanded, setExpanded] = useState(false);

  // Status text + tone — only real failures are red; skipped/cancelled/neutral
  // are muted (not errors), and queued/in-progress are amber.
  const status: { text: string; tone: string } | null =
    run.status !== "completed"
      ? { text: run.status.replace(/_/g, " "), tone: "text-warning" }
      : run.conclusion === "failure" ||
          run.conclusion === "timed_out" ||
          run.conclusion === "action_required"
        ? { text: run.conclusion.replace(/_/g, " "), tone: "text-destructive" }
        : run.conclusion && run.conclusion !== "success"
          ? { text: run.conclusion.replace(/_/g, " "), tone: "text-muted-foreground" }
          : null;

  const hasDetail =
    Boolean(
      run.output?.summary?.trim() ||
        run.output?.text?.trim() ||
        (run.output?.annotations_count ?? 0) > 0,
    ) || jobId != null;

  return (
    <li className="rounded-md">
      <div className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-foreground/[0.04]">
        <button
          type="button"
          disabled={!hasDetail}
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground/60 transition-transform",
              expanded && "rotate-90",
              !hasDetail && "opacity-0",
            )}
            strokeWidth={2}
          />
          <Icon className={cn("size-4 shrink-0", tone, spin && "animate-spin")} strokeWidth={2} />
          <span className="truncate text-xs text-foreground">{run.name}</span>
          {status && <span className={cn("shrink-0 text-xs", status.tone)}>{status.text}</span>}
        </button>
        <span className="hidden shrink-0 text-[11px] text-muted-foreground/55 opacity-0 transition-opacity group-hover:opacity-100 sm:inline">
          {run.app?.name ?? "Unknown"}
          {duration && ` · ${duration}`}
        </span>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          {canRerun && (
            <Button
              size="xs"
              variant="ghost"
              loading={rerun.isPending}
              onClick={() => rerun.mutate()}
            >
              <RotateCw className="size-3" />
              Re-run
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => safeOpenUrl(run.html_url || run.details_url || "")}
          >
            <ExternalLink className="size-3" />
            Open
          </Button>
        </div>
      </div>
      {expanded && hasDetail && <CheckDetail run={run} owner={owner} repo={repo} />}
    </li>
  );
}

/** Parse the GitHub Actions job id from a check run's details/html URL
 * (`…/actions/runs/<run>/job/<job>`). Null for non-Actions checks. */
function actionsJobId(run: CheckRun): number | null {
  const url = run.details_url ?? run.html_url ?? "";
  const m = url.match(/\/actions\/runs\/\d+\/job\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Parse the GitHub Actions run id from a check run's URL
 * (`…/actions/runs/<run>`). Null for non-Actions checks. Lets us re-run only a
 * run's failed jobs when the job id isn't in the URL. */
function actionsRunId(run: CheckRun): number | null {
  const url = run.details_url ?? run.html_url ?? "";
  const m = url.match(/\/actions\/runs\/(\d+)/);
  return m ? Number(m[1]) : null;
}

function CheckDetail({ run, owner, repo }: { run: CheckRun; owner: string; repo: string }) {
  const hasAnnotations = (run.output?.annotations_count ?? 0) > 0;
  const annotations = useQuery({
    queryKey: ["check-annotations", owner, repo, run.id],
    queryFn: () =>
      invoke<CheckAnnotation[]>("gh_check_annotations", { owner, repo, checkRunId: run.id }),
    enabled: hasAnnotations,
    staleTime: 5 * 60_000,
  });

  // The per-step breakdown — "what actually ran" — from the Actions job.
  const jobId = actionsJobId(run);
  const job = useQuery({
    queryKey: ["actions-job", owner, repo, jobId],
    queryFn: () => invoke<ActionsJob>("gh_actions_job", { owner, repo, jobId }),
    enabled: jobId != null,
    staleTime: 60_000,
  });
  const steps = job.data?.steps ?? [];

  const summary = run.output?.summary?.trim();
  const text = run.output?.text?.trim();

  return (
    <div className="space-y-3 border-t border-hairline py-3 pl-9 pr-3">
      {run.output?.title && (
        <p className="text-xs font-medium text-foreground">{run.output.title}</p>
      )}
      {summary && <MarkdownBody className="text-xs">{summary}</MarkdownBody>}
      {text && text !== summary && <MarkdownBody className="text-xs">{text}</MarkdownBody>}

      {jobId != null &&
        (job.isLoading ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : steps.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">
              Steps · {steps.length}
            </p>
            <ul className="space-y-0.5">
              {steps.map((s) => (
                <StepRow key={s.number} s={s} />
              ))}
            </ul>
          </div>
        ) : null)}

      {hasAnnotations &&
        (annotations.isLoading ? (
          <Skeleton className="h-14 w-full rounded-md" />
        ) : (
          <div className="space-y-1.5">
            {(annotations.data ?? []).map((a, i) => (
              <AnnotationRow key={i} a={a} />
            ))}
          </div>
        ))}
    </div>
  );
}

function StepRow({ s }: { s: ActionsStep }) {
  // ActionsStep carries the same status/conclusion fields a CheckRun does, so
  // the row icon mapping is reused.
  const { Icon, tone, spin } = checkRowIcon(s as unknown as CheckRun);
  const dur =
    s.started_at && s.completed_at
      ? formatDuration(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime())
      : null;
  return (
    <li className="flex items-center gap-2 text-xs">
      <Icon className={cn("size-3.5 shrink-0", tone, spin && "animate-spin")} strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate text-foreground/85">{s.name}</span>
      {dur && <span className="shrink-0 tabular-nums text-muted-foreground/70">{dur}</span>}
    </li>
  );
}

function AnnotationRow({ a }: { a: CheckAnnotation }) {
  const tone =
    a.annotation_level === "failure"
      ? "text-destructive"
      : a.annotation_level === "warning"
        ? "text-warning"
        : "text-muted-foreground";
  const loc = a.path ? `${a.path}${a.start_line ? `:${a.start_line}` : ""}` : null;
  return (
    <div className="rounded-md bg-foreground/[0.03] p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={cn("font-medium capitalize", tone)}>{a.annotation_level ?? "note"}</span>
        {loc && <code className="font-mono text-xs text-muted-foreground">{loc}</code>}
      </div>
      {a.title && <p className="mt-1 font-medium text-foreground">{a.title}</p>}
      {a.message && (
        <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-foreground/85">
          {a.message}
        </pre>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}
