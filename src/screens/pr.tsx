import { useRegisterCommands } from "@/app/commands";
import { useKeyScope } from "@/app/keys";
import { settingsCategoryStore } from "@/app/settings-navigation";
import { useTitleSlot } from "@/app/title-slot";
import { toast } from "@/app/toast";
import { usePullRequestInbox, workspaceStore } from "@/app/workspace";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import { run, useEffectQuery } from "@/effect/runtime";
import { useAuth } from "@/effect/services/Auth";
import { Git } from "@/effect/services/Git";
import { GitHub, type PrRef, type ReviewEvent } from "@/effect/services/GitHub";
import { prId } from "@/effect/services/Inbox";
import { prefsStore, tomorrowMorning, usePrefs } from "@/effect/services/Prefs";
import { copyNamedLink } from "@/lib/clipboard";
import { rememberSelection } from "@/features/list/list";
import { age } from "@/features/list/row";
import { MoreMenu } from "@/features/pr/actions";
import { prContext } from "@/features/pr/ai";
import { AskDrawer } from "@/features/pr/ask";
import { useLocalClone } from "@/features/pr/clone";
import { SubmitDialog, SubmitReviewButton } from "@/features/pr/decide";
import { lineId } from "@/features/pr/diff";
import { EditableTitle } from "@/features/pr/editable";
import { FilesColumn, type FilesOrder } from "@/features/pr/files-column";
import { type StepActions, liftOf, useGuided } from "@/features/pr/guided";
import { LayerHeading, orderByLayers, useLayers } from "@/features/pr/layers";
import {
  type Thread,
  isReviewablePull,
  pullKey,
  usePullRequest,
} from "@/features/pr/model";
import { Labels, Reviewers } from "@/features/pr/pickers";
import {
  type Composing,
  type PrView,
  ReadPane,
  fileAnchor,
} from "@/features/pr/read-pane";
import {
  getReview,
  reviewStore,
  updateReview,
  useLastEvent,
  useReview,
} from "@/features/pr/review-state";
import { StackLine, useStack } from "@/features/pr/stack";
import type { CommentOps, Draft } from "@/features/pr/thread";
import { UserCard } from "@/features/pr/user-card";
import { useWorkspace } from "@/features/pr/workspace";
import type { AiAction } from "@/lib/ai-actions";
import { readingMinutes } from "@/lib/estimate";
import type { GuidedPlan, GuidedStep } from "@/lib/guided";
import { boundaryCrossings, dependentsOf, ownerOf } from "@/lib/monorepo";
import { previewLinks } from "@/lib/pr-links";
import type { PullFile } from "@/lib/tauri";
import { safeOpenUrl } from "@/lib/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Effect } from "effect";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Columns2,
  ExternalLink,
  Moon,
  PanelLeftClose,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Entering a PR is entering a page. The title bar carries the way back, the
 * position in the list, and the decision; the page opens with title → meta →
 * one verdict line, then the files column and one continuous read. The model
 * sits behind two doors: Guided order, and the Ask panel.
 */
export function PrScreen() {
  const params = useParams({ strict: false }) as {
    owner: string;
    repo: string;
    number: string;
  };
  const ref = useMemo<PrRef>(
    () => ({
      owner: params.owner,
      repo: params.repo,
      number: Number(params.number),
    }),
    [params.owner, params.repo, params.number],
  );
  const navigate = useNavigate();
  const qc = useQueryClient();
  const auth = useAuth();
  const pr = usePullRequest(ref);
  const inbox = usePullRequestInbox();
  const prefs = usePrefs();

  // where this PR sits in the list, for "k of N" and ↑↓
  const list = useMemo(
    () => (inbox.data ? [...inbox.data.turn, ...inbox.data.unsorted] : []),
    [inbox.data],
  );
  const id = prId(`${ref.owner}/${ref.repo}`, ref.number);
  const prKey = `${ref.owner}/${ref.repo}#${ref.number}`;
  const position = list.findIndex((i) => i.id === id);
  const ranked = position >= 0 ? list[position] : null;
  const goTo = useCallback(
    (d: number) => {
      const next = list[position + d];
      if (next?.owner && next.repoName && next.number)
        void navigate({
          to: "/pr/$owner/$repo/$number",
          params: {
            owner: next.owner,
            repo: next.repoName,
            number: String(next.number),
          },
        });
    },
    [list, position, navigate],
  );
  const back = useCallback(() => {
    rememberSelection(`Inbox:${workspaceStore.get() ?? "all"}`, id);
    return navigate({ to: "/inbox" });
  }, [navigate, id]);

  // the reviewer's own state on this page
  const [view, setView] = useState<PrView>("overview");
  const [split, setSplit] = useState(prefs.splitDiff);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new PR starts on its overview
  useEffect(() => {
    setView("overview");
  }, [prKey]);
  const [filesHidden, setFilesHidden] = useState(false);
  const [find, setFind] = useState(false);
  // Column widths: live while dragging, kept in Settings when let go.
  const [filesW, setFilesW] = useState(prefs.filesWidth);
  const [askW, setAskW] = useState(prefs.askWidth);
  const onFilesWidth = useCallback((w: number, done: boolean) => {
    setFilesW(w);
    if (done) prefsStore.update((p) => ({ ...p, filesWidth: w }));
  }, []);
  const onAskWidth = useCallback((w: number, done: boolean) => {
    setAskW(w);
    if (done) prefsStore.update((p) => ({ ...p, askWidth: w }));
  }, []);
  const [ask, setAsk] = useState(false);
  const [order, setOrder] = useState<FilesOrder>(prefs.filesOrder);
  useEffect(() => {
    if (order === "guided") setView("guided");
  }, [order]);
  const review = useReview(prKey);
  const lastEvent = useLastEvent();
  const viewed = useMemo(() => new Set(review.viewed), [review.viewed]);
  const drafts = review.drafts;
  const [composing, setComposing] = useState<Composing | null>(null);
  const [submit, setSubmit] = useState<{ open: boolean; event: ReviewEvent }>({
    open: false,
    event: review.event ?? lastEvent ?? "COMMENT",
  });
  const [busy, setBusy] = useState(false);
  const [approvedPr, setApprovedPr] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const pull = pr.pull.data;
  const files = pr.files.data ?? [];
  const clone = useLocalClone(ref.owner, ref.repo);
  const stack = useStack(ref);
  const reviewable = isReviewablePull(pull);
  const canEdit = reviewable && auth.viewer?.login === pull?.user.login;

  // The head you read last time: a push resets the read marks, and the read
  // opens with what changed. Shown for one visit, then forgotten.
  const handledHead = useRef<string | null>(null);
  useEffect(() => {
    const sha = pull?.head.sha;
    if (!sha || handledHead.current === sha) return;
    handledHead.current = sha;
    const r = getReview(prKey);
    if (r.headSha === sha) {
      if (r.previousHead)
        updateReview(prKey, (x) => ({ ...x, previousHead: null }));
      return;
    }
    updateReview(prKey, (x) => ({
      ...x,
      headSha: sha,
      previousHead: x.headSha,
      viewed: [],
    }));
  }, [pull?.head.sha, prKey]);
  useEffect(
    () => () =>
      updateReview(prKey, (x) => ({ ...x, seenAt: new Date().toISOString() })),
    [prKey],
  );
  const commits = pr.commits.data ?? [];
  // What moved since the review you sent: the files between that head and this one.
  const reviewedSha =
    review.reviewedSha && pull && review.reviewedSha !== pull.head.sha
      ? review.reviewedSha
      : null;
  const [onlyChanged, setOnlyChanged] = useState(true);
  const compare = useEffectQuery(
    ["compare", ref.owner, ref.repo, reviewedSha ?? "", pull?.head.sha ?? ""],
    Effect.flatMap(GitHub, (g) =>
      g.compare(ref.owner, ref.repo, reviewedSha ?? "", pull?.head.sha ?? ""),
    ),
    { enabled: !!reviewedSha && !!pull, staleTime: 5 * 60_000 },
  );
  const sinceReview = useMemo(() => {
    if (!reviewedSha) return null;
    const i = commits.findIndex((c) => c.sha === reviewedSha);
    return {
      sha: reviewedSha,
      commits: i >= 0 ? commits.slice(i + 1).length : commits.length,
      files: compare.data ?? null,
    };
  }, [reviewedSha, commits, compare.data]);
  const since = useMemo(() => {
    if (!review.previousHead || !pull || review.previousHead === pull.head.sha)
      return null;
    const i = commits.findIndex((c) => c.sha === review.previousHead);
    return {
      commits: i >= 0 ? commits.slice(i + 1) : commits,
      forced: i < 0,
      seenAt: review.seenAt,
    };
  }, [review.previousHead, review.seenAt, pull, commits]);
  const threadsByPath = useMemo(
    () => countBy(pr.threads.filter((t) => !t.resolved).map((t) => t.path)),
    [pr.threads],
  );
  const draftsByPath = useMemo(
    () => countBy(drafts.map((d) => d.path)),
    [drafts],
  );

  // the model: the same diff you see, built once per PR
  const context = useMemo(
    () => (pull ? prContext(pull, files, ref) : ""),
    [pull, files, ref],
  );
  const promptOpts = { instructions: prefs.ai.instructions, hasClone: !!clone };
  const guided = useGuided(prKey, context, {
    headSha: pull?.head.sha ?? "",
    cwd: clone,
    provider: prefs.ai.provider,
    ...promptOpts,
  });
  const layers = useLayers(prKey, files, context, {
    headSha: pull?.head.sha ?? "",
    cwd: clone,
    ...promptOpts,
  });
  // In layer order the read and j/k follow the plan; the column shows the slices.
  const orderedFiles = useMemo(
    () =>
      order === "layer" && layers.plan
        ? orderByLayers(layers.plan, files)
        : files,
    [order, layers.plan, files],
  );
  const shownFiles = useMemo(
    () =>
      onlyChanged && sinceReview?.files ? sinceReview.files : orderedFiles,
    [onlyChanged, sinceReview, orderedFiles],
  );
  const headingFor = useCallback(
    (path: string) => {
      const plan = order === "layer" ? layers.plan : null;
      if (!plan) return null;
      const i = plan.layers.findIndex((l) => l.files[0] === path);
      if (i < 0) return null;
      const layer = plan.layers[i];
      const inPr = layer.files.filter((f) =>
        files.some((x) => x.filename === f),
      );
      return (
        <LayerHeading
          layer={layer}
          index={i}
          total={plan.layers.length}
          read={{
            viewed: inPr.filter((f) => viewed.has(f)).length,
            files: inPr.length,
          }}
          onDone={() => {
            updateReview(prKey, (r) => ({
              ...r,
              viewed: [...new Set([...r.viewed, ...inPr])],
            }));
            const next = plan.layers[i + 1]?.files[0];
            if (next) {
              setCurrent(next);
              document
                .getElementById(fileAnchor(next))
                ?.scrollIntoView({ block: "start" });
              toast.say(
                `${layer.title} read`,
                `Next: ${plan.layers[i + 1].title}`,
              );
            } else {
              setSubmit((s) => ({ ...s, open: true }));
              toast.say("Every layer read");
            }
          }}
        />
      );
    },
    [order, layers.plan, files, viewed, prKey],
  );
  const guidedStart = guided.start;
  // Settings: the tour starts on its own when a PR opens, once per PR, if the CLI is there.
  const autoToured = useRef<string | null>(null);
  useEffect(() => {
    if (!prefs.ai.autoTour || !context || guided.plan || guided.running) return;
    if (guided.available !== true || autoToured.current === prKey) return;
    autoToured.current = prKey;
    setOrder("guided");
    guidedStart();
  }, [
    prefs.ai.autoTour,
    context,
    guided.plan,
    guided.running,
    guided.available,
    prKey,
    guidedStart,
  ]);

  // Where you were in each PR, for ] and [ and for coming back — kept on the machine too.
  useEffect(() => {
    const el = scrollRef.current;
    if (view !== "files" && view !== "guided") return;
    return () => {
      if (!el) return;
      prScroll.set(prKey, el.scrollTop);
      const top = Math.round(el.scrollTop);
      updateReview(prKey, (r) =>
        r.scrollTop === top ? r : { ...r, scrollTop: top },
      );
    };
  }, [prKey, view]);
  const loaded = !!pull && files.length > 0;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !loaded || (view !== "files" && view !== "guided")) return;
    el.scrollTop = prScroll.get(prKey) ?? getReview(prKey).scrollTop ?? 0;
  }, [prKey, loaded, view]);
  // The Turborepo in your clone: what this PR touches, and what leans on it.
  const workspace = useWorkspace(clone);
  const reach = useMemo(() => {
    if (!workspace || !files.length) return null;
    const touched = new Set<string>();
    for (const f of files) {
      const o = ownerOf(f.filename, workspace);
      if (o) touched.add(o);
    }
    const dependents = dependentsOf(touched, workspace);
    const crossings = boundaryCrossings(
      [...files] as unknown as PullFile[],
      workspace,
    );
    return { touched, dependents, crossings, total: workspace.packages.length };
  }, [workspace, files]);
  const previews = useMemo(() => previewLinks(pull?.body), [pull?.body]);
  // What you said last time, from the reviews GitHub keeps.
  const myReview = useMemo(() => {
    const mine = (pr.reviews.data ?? []).filter(
      (r) =>
        r.user.login === auth.viewer?.login &&
        (r.state === "APPROVED" ||
          r.state === "CHANGES_REQUESTED" ||
          r.state === "COMMENTED"),
    );
    return (
      mine.sort((a, b) =>
        (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""),
      )[0] ?? null
    );
  }, [pr.reviews.data, auth.viewer?.login]);

  const jumpTo = useCallback((path: string) => {
    setView("files");
    setCurrent(path);
    requestAnimationFrame(() =>
      document
        .getElementById(fileAnchor(path))
        ?.scrollIntoView({ block: "start" }),
    );
  }, []);
  const jumpToStep = useCallback(
    (i: number) => {
      const steps = guided.plan?.steps ?? [];
      if (i < 0 || i >= steps.length) return;
      setView("guided");
      guided.setStep(i);
      const s = steps[i];
      const el =
        document.getElementById(lineId(fileAnchor(s.path), "R", s.line)) ??
        document.getElementById(fileAnchor(s.path));
      if (!el) {
        toast.fail(
          `${s.path} isn’t a file in this diff`,
          "The model may have pointed outside it.",
        );
        return;
      }
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: "center" });
        markStop(s);
      });
    },
    [guided.plan, guided.setStep],
  );
  const openAiReview = useCallback(() => {
    const needsRun = !guided.plan || guided.stale || !!guided.error;
    if (needsRun && !guided.running && guided.available === false) {
      settingsCategoryStore.set("assistant");
      void navigate({ to: "/settings" });
      return;
    }
    setView("guided");
    setFilesHidden(false);
    setOrder("guided");
    if (guided.running) return;
    if (needsRun) {
      guided.start();
      return;
    }
    const firstVisible =
      guided.plan?.steps.findIndex((_, i) => guided.visible(i)) ?? -1;
    const target = guided.visible(guided.step) ? guided.step : firstVisible;
    if (target >= 0) jumpToStep(target);
  }, [
    guided.plan,
    guided.stale,
    guided.error,
    guided.running,
    guided.available,
    guided.start,
    guided.step,
    guided.visible,
    jumpToStep,
    navigate,
  ]);

  // A plan that just arrived, or a tour re-entered: land on its stop without a click.
  const jumpedFor = useRef<GuidedPlan | null>(null);
  useEffect(() => {
    if (order !== "guided" || view !== "guided") {
      jumpedFor.current = null;
      markStop(null);
      return;
    }
    if (!guided.plan || jumpedFor.current === guided.plan) return;
    jumpedFor.current = guided.plan;
    const t = setTimeout(() => jumpToStep(guided.step), 60);
    return () => clearTimeout(t);
  }, [order, guided.plan, guided.step, jumpToStep, view]);
  const leaveTour = useCallback(() => {
    setView("files");
    setOrder("path");
    markStop(null);
  }, []);
  // The session: everything that needs a look, in reading order — threads
  // whose last word isn't yours, the tour's stops, the changed blocks of files
  // you haven't read. `space` goes to the next one; past the last, you decide.
  const me = auth.viewer?.login ?? null;
  const needsYou = useMemo(
    () =>
      pr.threads.filter((t) => {
        if (t.resolved || t.line == null) return false;
        const last = t.comments[t.comments.length - 1];
        return !!last && last.user.login !== me;
      }),
    [pr.threads, me],
  );
  const replies = useMemo(
    () =>
      needsYou.filter(
        (t) => me != null && t.comments.some((c) => c.user.login === me),
      ),
    [needsYou, me],
  );
  const collectTargets = useCallback((): Target[] => {
    const root = scrollRef.current;
    if (!root) return [];
    const rr = root.getBoundingClientRect();
    const topOf = (el: Element) =>
      el.getBoundingClientRect().top - rr.top + root.scrollTop;
    const out: Target[] = [];
    for (const t of needsYou) {
      const side: "L" | "R" = t.side?.[0] === "L" ? "L" : "R";
      const el = document.getElementById(
        lineId(fileAnchor(t.path), side, t.line as number),
      );
      if (el)
        out.push({
          kind: "thread",
          top: topOf(el),
          path: t.path,
          side,
          line: t.line as number,
        });
    }
    (guided.plan?.steps ?? []).forEach((st, i) => {
      if (!guided.visible(i)) return;
      const el = document.getElementById(
        lineId(fileAnchor(st.path), "R", st.line),
      );
      if (el)
        out.push({
          kind: "stop",
          top: topOf(el),
          path: st.path,
          side: "R",
          line: st.line,
          endLine: st.endLine,
          index: i,
        });
    });
    for (const sec of root.querySelectorAll<HTMLElement>("[data-file]")) {
      const path = sec.dataset.file ?? "";
      if (viewed.has(path)) continue;
      for (const h of sec.querySelectorAll<HTMLElement>("[data-hunk]"))
        out.push({ kind: "hunk", top: topOf(h), path, side: "R", line: 0 });
    }
    out.sort((a, b) => a.top - b.top);
    return out.filter(
      (t, i) => i === 0 || Math.abs(t.top - out[i - 1].top) > 1,
    );
  }, [needsYou, guided.plan, guided.visible, viewed]);
  if (import.meta.env.DEV)
    (window as unknown as { __flowTargets?: () => Target[] }).__flowTargets =
      collectTargets;
  const flow = useCallback(
    (d: 1 | -1) => {
      if (view !== "files" && view !== "guided") {
        setView("files");
        return;
      }
      const root = scrollRef.current;
      if (!root) return;
      const targets = collectTargets();
      // A target lands LAND px below the top of the viewport, so the next
      // search starts from exactly there and never finds the same one twice.
      const pos = root.scrollTop + LAND;
      const next =
        d > 0
          ? targets.find((t) => t.top > pos + 2)
          : [...targets].reverse().find((t) => t.top < pos - 2);
      if (!next) {
        if (d > 0) {
          markStop(null);
          setSubmit((s) => ({ ...s, open: true }));
          toast.say(
            targets.length
              ? "That was the last thing to look at"
              : "Nothing here needs a look",
          );
        }
        return;
      }
      root.scrollTo({ top: Math.max(0, next.top - LAND) });
      if (next.kind === "stop" && next.index != null)
        guided.setStep(next.index);
      if (next.kind === "hunk") markStop(null);
      else
        markLines(next.path, next.side, next.line, next.endLine ?? next.line);
    },
    [collectTargets, guided.setStep, view],
  );
  // How many are still ahead of where you are, for the title bar.
  const [ahead, setAhead] = useState<number | null>(null);
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !pull || (view !== "files" && view !== "guided")) return;
    let raf = 0;
    const count = () => {
      raf = 0;
      const pos = root.scrollTop + LAND;
      setAhead(collectTargets().filter((t) => t.top > pos + 2).length);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(count);
    };
    const t = setTimeout(count, 300);
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(t);
      root.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [collectTargets, pull, view]);

  // n / p walk the changed blocks across files; u goes to the next file you haven't read.
  const stepHunk = useCallback((d: number) => {
    setView("files");
    const root = scrollRef.current;
    if (!root) return;
    const rr = root.getBoundingClientRect();
    const hunks = [...root.querySelectorAll<HTMLElement>("[data-hunk]")];
    const tops = hunks.map((h) => h.getBoundingClientRect().top - rr.top - 44);
    let i = -1;
    if (d > 0) i = tops.findIndex((t) => t > 4);
    else
      for (let j = tops.length - 1; j >= 0; j--)
        if (tops[j] < -4) {
          i = j;
          break;
        }
    const el = hunks[i];
    if (!el) return;
    root.scrollTo({ top: root.scrollTop + tops[i] });
  }, []);
  const nextUnread = useCallback(() => {
    const i = shownFiles.findIndex((f) => f.filename === current);
    const next =
      shownFiles.find((f, j) => j > i && !viewed.has(f.filename)) ??
      shownFiles.find((f) => !viewed.has(f.filename));
    if (next) jumpTo(next.filename);
  }, [shownFiles, current, viewed, jumpTo]);
  const stepFile = useCallback(
    (d: number) => {
      if (order === "guided" && guided.plan?.steps.length) {
        const i = guided.nextIndex(guided.step, d > 0 ? 1 : -1);
        if (i != null) jumpToStep(i);
        return;
      }
      if (!shownFiles.length) return;
      const i = Math.max(
        0,
        shownFiles.findIndex((f) => f.filename === current),
      );
      const next =
        shownFiles[Math.min(shownFiles.length - 1, Math.max(0, i + d))];
      if (next) jumpTo(next.filename);
    },
    [
      shownFiles,
      current,
      jumpTo,
      order,
      guided.plan,
      guided.step,
      guided.nextIndex,
      jumpToStep,
    ],
  );

  // the file in view, for the column's highlight
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-observe when the file set changes, not on every scroll state
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (top) setCurrent((top.target as HTMLElement).dataset.file ?? null);
      },
      { root, rootMargin: "-40px 0px -70% 0px" },
    );
    for (const el of root.querySelectorAll("[data-file]")) io.observe(el);
    return () => io.disconnect();
  }, [files.length, view]);

  const markRead = useCallback(
    (path: string) =>
      updateReview(prKey, (r) => ({
        ...r,
        viewed: r.viewed.includes(path)
          ? r.viewed.filter((x) => x !== path)
          : [...r.viewed, path],
      })),
    [prKey],
  );
  const markReadOnce = useCallback(
    (path: string) =>
      updateReview(prKey, (r) =>
        r.viewed.includes(path) ? r : { ...r, viewed: [...r.viewed, path] },
      ),
    [prKey],
  );
  const addDraft = useCallback(
    (d: Omit<Draft, "key">) =>
      updateReview(prKey, (r) => ({
        ...r,
        drafts: [
          ...r.drafts,
          { ...d, key: `${d.path}:${d.side}${d.line}:${Date.now()}` },
        ],
      })),
    [prKey],
  );
  const changeDraft = useCallback(
    (key: string, body: string) =>
      updateReview(prKey, (r) => ({
        ...r,
        drafts: r.drafts.map((d) => (d.key === key ? { ...d, body } : d)),
      })),
    [prKey],
  );
  const discardDraft = useCallback(
    (key: string) =>
      updateReview(prKey, (r) => ({
        ...r,
        drafts: r.drafts.filter((d) => d.key !== key),
      })),
    [prKey],
  );
  /** What a stop's comment can do: a draft in your review, or a comment on GitHub right now. */
  const stepActions = useMemo<StepActions>(
    () => ({
      onUse: (step, body) => {
        const range = step.endLine != null && step.endLine > step.line;
        addDraft({
          path: step.path,
          side: "R",
          line: range ? (step.endLine as number) : step.line,
          startLine: range ? step.line : undefined,
          body,
        });
        toast.say("Added to your review as a draft");
      },
      onPost: async (step, body) => {
        if (!pull) throw new Error("no head");
        try {
          await run(
            Effect.flatMap(GitHub, (g) =>
              g.createReviewComment(ref, {
                commitId: pull.head.sha,
                path: step.path,
                line: step.endLine ?? step.line,
                side: "RIGHT",
                body,
              }),
            ),
          );
          await pr.refresh();
          toast.say("Posted to GitHub");
        } catch (e) {
          toast.fail("The comment didn’t go up", e);
          throw e;
        }
      },
    }),
    [addDraft, pull, ref, pr.refresh],
  );
  /** Every stop's comment into the review at once, and the verdict the tour suggests. */
  const draftTour = useCallback(() => {
    const steps = guided.plan?.steps ?? [];
    let n = 0;
    steps.forEach((step, i) => {
      if (guided.isDismissed(i)) return;
      const body =
        guided.checks[`${step.path}:${step.line}`]?.finding ?? liftOf(step);
      if (!body) return;
      const range = step.endLine != null && step.endLine > step.line;
      addDraft({
        path: step.path,
        side: "R",
        line: range ? (step.endLine as number) : step.line,
        startLine: range ? step.line : undefined,
        body,
      });
      n++;
    });
    const verdict = guided.plan?.verdict;
    const event: ReviewEvent =
      verdict === "approve"
        ? "APPROVE"
        : verdict === "request_changes"
          ? "REQUEST_CHANGES"
          : "COMMENT";
    updateReview(prKey, (r) => ({ ...r, event }));
    setSubmit({ open: true, event });
    toast.say(
      n
        ? `${n} comment${n === 1 ? "" : "s"} added to your review`
        : "Nothing to lift",
    );
  }, [guided.plan, guided.isDismissed, guided.checks, addDraft, prKey]);

  const reply = useCallback(
    async (t: Thread, body: string) => {
      const last = t.comments[t.comments.length - 1];
      try {
        await run(Effect.flatMap(GitHub, (g) => g.reply(ref, last.id, body)));
        await pr.refresh();
      } catch (e) {
        toast.fail("Reply didn’t go up", e);
        throw e;
      }
    },
    [ref, pr.refresh],
  );
  const resolve = useCallback(
    async (t: Thread, r: boolean) => {
      if (!t.nodeId) return;
      try {
        await run(
          Effect.flatMap(GitHub, (g) => g.resolveThread(t.nodeId as string, r)),
        );
        await pr.refresh();
      } catch (e) {
        toast.fail(r ? "Couldn’t resolve it" : "Couldn’t reopen it", e);
      }
    },
    [pr.refresh],
  );
  const comment = useCallback(
    async (body: string) => {
      try {
        await run(Effect.flatMap(GitHub, (g) => g.comment(ref, body)));
        await pr.refresh();
        toast.say("Comment posted");
      } catch (e) {
        toast.fail("Comment didn’t go up", e);
        throw e;
      }
    },
    [ref, pr.refresh],
  );
  const saveTitle = useCallback(
    async (title: string) => {
      try {
        await run(Effect.flatMap(GitHub, (g) => g.updatePull(ref, { title })));
        await pr.refresh();
      } catch (e) {
        toast.fail("The title didn’t change", e);
        throw e;
      }
    },
    [ref, pr.refresh],
  );
  const saveBody = useCallback(
    async (body: string) => {
      try {
        await run(Effect.flatMap(GitHub, (g) => g.updatePull(ref, { body })));
        await pr.refresh();
      } catch (e) {
        toast.fail("The description didn’t change", e);
        throw e;
      }
    },
    [ref, pr.refresh],
  );
  const ops = useMemo<CommentOps>(
    () => ({
      me: auth.viewer?.login ?? null,
      ref,
      onEdit: async (kind, id, body) => {
        try {
          await run(
            Effect.flatMap(GitHub, (g) =>
              g.editComment(kind, ref.owner, ref.repo, id, body),
            ),
          );
          await pr.refresh();
        } catch (e) {
          toast.fail("The edit didn’t go up", e);
          throw e;
        }
      },
      onDelete: async (kind, id) => {
        try {
          await run(
            Effect.flatMap(GitHub, (g) =>
              g.deleteComment(kind, ref.owner, ref.repo, id),
            ),
          );
          await pr.refresh();
          toast.say("Comment deleted");
        } catch (e) {
          toast.fail("Couldn’t delete it", e);
          throw e;
        }
      },
    }),
    [auth.viewer?.login, ref, pr.refresh],
  );
  const sendReview = useCallback(
    async (body: string) => {
      if (!reviewable) {
        setSubmit((current) => ({ ...current, open: false }));
        toast.say(
          pull?.merged
            ? "This pull request is already merged"
            : "This pull request is closed",
        );
        return;
      }
      setBusy(true);
      try {
        await run(
          Effect.flatMap(GitHub, (g) =>
            g.submitReview(ref, {
              body,
              event: submit.event,
              comments: drafts.map((d) => ({
                path: d.path,
                body: d.body,
                line: d.line,
                side: d.side === "L" ? "LEFT" : "RIGHT",
                start_line: d.startLine ?? null,
                start_side:
                  d.startLine != null
                    ? d.side === "L"
                      ? "LEFT"
                      : "RIGHT"
                    : null,
              })),
              commitId: pr.pull.data?.head.sha,
            }),
          ),
        );
        updateReview(prKey, (r) => ({
          ...r,
          drafts: [],
          body: "",
          event: null,
          previousHead: null,
          reviewedSha: pr.pull.data?.head.sha ?? r.reviewedSha,
        }));
        reviewStore.update((s) => ({ ...s, lastEvent: submit.event }));
        setSubmit({ open: false, event: submit.event });
        prefsStore.update((p) => ({
          ...p,
          done: [...p.done, id],
          reviewed: [...p.reviewed, id],
        }));
        void qc.invalidateQueries({ queryKey: ["inbox"] });
        // Settings: a review on a draft takes it out of draft, with a way back.
        if (pr.pull.data?.draft && prefs.autoReadyOnReview) {
          try {
            const nodeId = await run(
              Effect.flatMap(GitHub, (g) => g.nodeId(ref)),
            );
            await run(Effect.flatMap(GitHub, (g) => g.setDraft(nodeId, false)));
            toast.act("Marked ready for review", "Keep it a draft", () => {
              run(Effect.flatMap(GitHub, (g) => g.setDraft(nodeId, true)))
                .then(() => pr.refresh())
                .catch((e) => toast.fail("Couldn’t put it back in draft", e));
            });
          } catch (e) {
            toast.fail("The review went up, but it stayed a draft", e);
          }
        }
        await pr.refresh();
        const approved = submit.event === "APPROVE";
        if (approved) setApprovedPr(prKey);
        const next = list[position + 1];
        toast.done(
          "Review sent",
          (approved
            ? "Approved — you can merge it here when ready."
            : submit.event === "REQUEST_CHANGES"
              ? "Changes requested — back when they push."
              : "Comments posted.") + (!approved && next ? ` Next: ${next.title}` : ""),
        );
        if (approved) return;
        if (next?.owner && next.repoName && next.number) goTo(1);
        else void back();
      } catch (e) {
        toast.fail("The review didn’t go up", e);
      } finally {
        setBusy(false);
      }
    },
    [
      ref,
      submit.event,
      drafts,
      pr.pull.data?.head.sha,
      pr.pull.data?.draft,
      prefs.autoReadyOnReview,
      pr.refresh,
      id,
      qc,
      back,
      prKey,
      list,
      position,
      goTo,
      reviewable,
      pull?.merged,
    ],
  );
  const snooze = useCallback(() => {
    prefsStore.update((p) => ({
      ...p,
      snoozed: { ...p.snoozed, [id]: tomorrowMorning() },
    }));
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    toast.say("Snoozed until tomorrow morning");
    void back();
  }, [id, qc, back]);

  /** What the model proposes in the Ask panel, once you click: drafts stay drafts, the rest posts. */
  const runAction = useCallback(
    async (a: AiAction) => {
      switch (a.type) {
        case "inline_comment": {
          const inDiff = files.some((f) => f.filename === a.path);
          if (!inDiff) {
            toast.fail(`${a.path} isn’t in this diff`);
            throw new Error("not in diff");
          }
          addDraft({
            path: a.path,
            side: a.side === "LEFT" ? "L" : "R",
            line: a.line,
            body: a.body,
          });
          toast.say("Added to your review as a draft");
          return;
        }
        case "review":
          updateReview(prKey, (r) => ({ ...r, body: a.body, event: a.event }));
          setSubmit({ open: true, event: a.event });
          return;
        case "comment":
          await comment(a.body);
          return;
        case "label": {
          const names = new Set((pull?.labels ?? []).map((l) => l.name));
          for (const n of a.add) names.add(n);
          for (const n of a.remove) names.delete(n);
          try {
            await run(
              Effect.flatMap(GitHub, (g) => g.setLabels(ref, [...names])),
            );
            await pr.refresh();
            toast.say("Labels updated");
          } catch (e) {
            toast.fail("Labels didn’t change", e);
            throw e;
          }
        }
      }
    },
    [files, addDraft, comment, pull?.labels, ref, pr.refresh, prKey],
  );

  useKeyScope(
    "pr",
    useCallback(
      (e: KeyboardEvent) => {
        if (submit.open) return false;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
          setView("files");
          setSplit((s) => !s);
          return true;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
          setFind(true);
          return true;
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
          setView("files");
          setFilesHidden(false);
          if (order !== "path") setOrder("path");
          setTimeout(() => document.getElementById("files-filter")?.focus(), 0);
          return true;
        }
        if (e.metaKey || e.ctrlKey || e.altKey) return false;
        switch (e.key) {
          case "Escape":
            if (find) setFind(false);
            else if (composing) setComposing(null);
            else if (ask) setAsk(false);
            else if (order === "guided" && guided.plan) leaveTour();
            else void back();
            return true;
          case " ":
            flow(e.shiftKey ? -1 : 1);
            return true;
          case "n":
            stepHunk(1);
            return true;
          case "p":
            stepHunk(-1);
            return true;
          case "u":
            nextUnread();
            return true;
          case "j":
            stepFile(1);
            return true;
          case "k":
            stepFile(-1);
            return true;
          case "f":
            setView("files");
            setFilesHidden((h) => !h);
            return true;
          case "a":
            setAsk((o) => !o);
            return true;
          case "v":
            if (current) markRead(current);
            return true;
          case "x":
            if (order === "guided" && guided.plan) {
              const next =
                guided.nextIndex(guided.step, 1) ??
                guided.nextIndex(guided.step, -1);
              guided.dismiss(guided.step);
              if (next != null) jumpToStep(next);
              else markStop(null);
              return true;
            }
            return false;
          case "r":
            if (!reviewable) return false;
            setSubmit((s) => ({ ...s, open: true }));
            return true;
          case "s":
            snooze();
            return true;
          case "]":
            goTo(1);
            return true;
          case "[":
            goTo(-1);
            return true;
          case "}":
            stack.step(1);
            return true;
          case "{":
            stack.step(-1);
            return true;
        }
        return false;
      },
      [
        submit.open,
        composing,
        ask,
        find,
        back,
        stepFile,
        stepHunk,
        nextUnread,
        current,
        markRead,
        snooze,
        goTo,
        stack.step,
        order,
        guided.plan,
        guided.step,
        guided.nextIndex,
        guided.dismiss,
        jumpToStep,
        leaveTour,
        flow,
        reviewable,
      ],
    ),
  );

  useRegisterCommands(
    useMemo(
      () => [
        ...(reviewable
          ? [
              {
                id: "review",
                label: "Write the review",
                key: "r",
                run: () => setSubmit((s) => ({ ...s, open: true })),
              },
            ]
          : []),
        {
          id: "ask",
          label: ask ? "Close the Ask panel" : "Ask about this PR",
          key: "a",
          run: () => setAsk((o) => !o),
        },
        {
          id: "tour",
          label: "Review with AI",
          run: openAiReview,
        },
        {
          id: "layers",
          label: "Plan the layers with the model",
          run: () => {
            setView("files");
            setOrder("layer");
            layers.planWithModel();
          },
        },
        {
          id: "split",
          label: split ? "Unified diff" : "Split diff",
          key: "⌘B",
          run: () => {
            setView("files");
            setSplit((v) => !v);
          },
        },
        {
          id: "files",
          label: filesHidden
            ? "Show the files column"
            : "Hide the files column",
          key: "f",
          run: () => {
            setView("files");
            setFilesHidden((h) => !h);
          },
        },
        {
          id: "read",
          label: "Mark this file read",
          key: "v",
          run: () => {
            if (current) markRead(current);
          },
        },
        { id: "snooze", label: "Snooze until tomorrow", key: "s", run: snooze },
        {
          id: "copy",
          label: "Copy the link",
          run: () => {
            if (pull)
              void copyNamedLink(pull.title, pull.html_url)
                .then(() => toast.say("Link copied"))
                .catch(() => toast.fail("Couldn’t copy the link"));
          },
        },
        {
          id: "github",
          label: "Open on GitHub",
          run: () => {
            if (pull) safeOpenUrl(pull.html_url);
          },
        },
      ],
      [
        ask,
        split,
        filesHidden,
        current,
        markRead,
        snooze,
        pull,
        openAiReview,
        layers.planWithModel,
        reviewable,
      ],
    ),
  );

  useTitleSlot(
    <>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={back}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-ink-2 hover:bg-raise hover:text-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={2} /> Inbox
      </Button>
      {position >= 0 ? (
        <span className="tnum flex items-center gap-1 text-[12.5px] text-ink-3">
          {position + 1} of {list.length}
          <IconButton
            label="Previous (shift [)"
            onClick={() => goTo(-1)}
            disabled={position <= 0}
          >
            <ChevronUp className="size-4" strokeWidth={2} />
          </IconButton>
          <IconButton
            label="Next (shift ])"
            onClick={() => goTo(1)}
            disabled={position >= list.length - 1}
          >
            <ChevronDown className="size-4" strokeWidth={2} />
          </IconButton>
        </span>
      ) : null}
      {(view === "files" || view === "guided") && ahead ? (
        <span
          className="tnum text-[12.5px] text-ink-3"
          title="space goes to the next thing that needs a look"
        >
          {ahead} to look at
        </span>
      ) : null}
      <span className="flex-1" />
      <IconButton label="Snooze until tomorrow (s)" onClick={snooze}>
        <Moon className="size-4" strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label="Ask about this PR (a)"
        onClick={() => setAsk((o) => !o)}
        pressed={ask}
      >
        <Sparkles className="ai-spark size-4" strokeWidth={1.75} />
      </IconButton>
      {view === "files" || view === "guided" ? (
        <>
          <IconButton
            label={split ? "Unified diff (⌘B)" : "Split diff (⌘B)"}
            onClick={() => setSplit((s) => !s)}
            pressed={split}
          >
            <Columns2 className="size-4" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label={filesHidden ? "Show files (f)" : "Hide files (f)"}
            onClick={() => setFilesHidden((h) => !h)}
            pressed={filesHidden}
          >
            <PanelLeftClose className="size-4" strokeWidth={1.75} />
          </IconButton>
        </>
      ) : null}
      {pull ? (
        <IconButton
          label="Open on GitHub"
          onClick={() => safeOpenUrl(pull.html_url)}
        >
          <ExternalLink className="size-4" strokeWidth={1.75} />
        </IconButton>
      ) : null}
      {pull ? (
        <MoreMenu
          prRef={ref}
          pull={pull}
          clone={clone}
          stack={stack.stack}
          primaryMerge={approvedPr === prKey || myReview?.state === "APPROVED"}
          onRefresh={pr.refresh}
          onMerged={() => {
            // GitHub can briefly return the pre-merge representation. Keep this page on the
            // PR and move its controls to the final state immediately instead of advancing.
            qc.setQueryData(pullKey(ref, "detail"), (current: typeof pull) =>
              current
                ? {
                    ...current,
                    merged: true,
                    state: "closed",
                    auto_merge: null,
                  }
                : current,
            );
            prefsStore.update((p) =>
              p.done.includes(id) ? p : { ...p, done: [...p.done, id] },
            );
            void qc.invalidateQueries({ queryKey: ["inbox"] });
          }}
        />
      ) : null}
    </>,
    "page",
    [
      position,
      list.length,
      split,
      filesHidden,
      ask,
      drafts.length,
      pull,
      clone,
      id,
      stack.stack,
      approvedPr,
      prKey,
      myReview?.state,
      ahead,
      view,
    ],
  );

  if (pr.error) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <div className="max-w-md text-center">
          <p className="text-[13px] text-ink">
            GitHub didn’t answer for #{ref.number}.
          </p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            {String((pr.error as Error).message)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => pr.refresh()}
            className="mt-3 h-7 rounded-md border border-edge bg-raise px-3 text-[12.5px] text-ink"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  // What the list already knew shows at once; the rest fills in underneath.
  const title = pull?.title ?? ranked?.title ?? `#${ref.number}`;
  const author = pull?.user.login ?? ranked?.author;
  const avatar = pull?.user.avatar_url ?? ranked?.avatar;
  const createdAt = pull?.created_at ?? ranked?.createdAt;
  const updatedAt = pull?.updated_at ?? ranked?.updatedAt;

  return (
    <Tabs
      value={view}
      onValueChange={(value) => {
        const next = value as PrView;
        if (next === "guided") {
          openAiReview();
          return;
        }
        if (next === "files" && order === "guided") setOrder("path");
        setView(next);
      }}
      className="pr-v2 screen-enter flex h-full flex-col gap-0 bg-page"
    >
      <header className="shrink-0 border-b border-hair px-8 pt-5 pb-3">
        {pull ? (
          <EditableTitle
            title={pull.title}
            canEdit={canEdit}
            onSave={saveTitle}
          />
        ) : (
          <h1 className="selectable text-[20px] font-semibold tracking-[-0.02em] text-ink">
            {title}
          </h1>
        )}
        <div className="pr-summary-line">
          <span className="pr-state">
            {pull?.merged
              ? "Merged"
              : pull?.state === "closed"
                ? "Closed"
                : pull?.draft
                  ? "Draft"
                  : "Open"}
          </span>
          <span>#{ref.number}</span>
          {author ? (
            <UserCard login={author}>
              <span className="flex items-center gap-1.5">
                {avatar ? (
                  <img src={avatar} alt="" className="size-4 rounded-full" />
                ) : null}
                {author}
              </span>
            </UserCard>
          ) : null}
          <span className="pr-review-progress">
            {files.filter((f) => viewed.has(f.filename)).length}/{files.length}{" "}
            files reviewed
          </span>
          {pull?.mergeable === false ? (
            <span className="text-del">Merge conflicts</span>
          ) : null}
          {pr.checks.data ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setView("checks")}
              className="hover:text-ink"
            >
              {
                pr.checks.data.check_runs.filter(
                  (c) => c.conclusion === "success",
                ).length
              }
              /{pr.checks.data.check_runs.length} checks passed
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="pr-ai-review"
            data-running={guided.running ? "" : undefined}
            disabled={
              !pull ||
              !context ||
              (guided.available === null && !guided.plan && !guided.running)
            }
            onClick={openAiReview}
            title={
              guided.running
                ? "The review is running. Open its progress."
                : guided.plan && !guided.stale
                  ? "Continue your guided review without generating it again"
                  : "Walk through this pull request with your AI provider"
            }
          >
            <span className="pr-ai-review-icon" aria-hidden>
              <Sparkles className="size-4 shrink-0" />
            </span>
            <span className="pr-ai-review-label">
              {guided.running
                ? "Reviewing with AI…"
                : (!guided.plan || guided.stale || guided.error) &&
                    guided.available === false
                  ? "Set up AI review"
                  : guided.error
                    ? "Retry AI review"
                    : guided.stale
                      ? "Update AI review"
                      : guided.plan?.steps.length
                        ? `Continue review · ${Math.min(guided.step + 1, guided.plan.steps.length)} of ${guided.plan.steps.length}`
                        : guided.plan
                          ? "View AI review"
                          : "Review with AI"}
            </span>
            {guided.running ? (
              <span
                className="pr-ai-review-dot size-1.5 rounded-full"
                aria-hidden
              />
            ) : null}
          </Button>
          {reviewable ? (
            <SubmitReviewButton
              drafts={drafts.length}
              onOpen={() =>
                setSubmit((current) => ({ ...current, open: true }))
              }
            />
          ) : null}
        </div>
        <Collapsible className="pr-metadata">
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="pr-metadata-trigger"
              />
            }
          >
            <ChevronDown className="pr-metadata-chevron size-3.5" aria-hidden />
            Details
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pr-metadata-body">
              <dl className="pr-metadata-grid">
                <div className="pr-meta-field">
                  <dt>Pull request</dt>
                  <dd className="mono">
                    {ref.owner}/{ref.repo} #{ref.number}
                  </dd>
                </div>
                {author ? (
                  <div className="pr-meta-field">
                    <dt>Author</dt>
                    <dd>
                      <UserCard login={author}>
                        <span className="flex items-center gap-1.5">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt=""
                              className="size-4 rounded-full bg-raise"
                            />
                          ) : null}
                          <span>{author}</span>
                        </span>
                      </UserCard>
                    </dd>
                  </div>
                ) : null}
                {createdAt ? (
                  <div className="pr-meta-field">
                    <dt>Activity</dt>
                    <dd>
                      Opened {age(createdAt)} ago
                      {updatedAt ? (
                        <span className="pr-meta-secondary">
                          Updated {age(updatedAt)} ago
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                {pull ? (
                  <div className="pr-meta-field">
                    <dt>Change</dt>
                    <dd className="tnum">
                      {pull.changed_files ?? files.length} files
                      <span className="text-add">+{pull.additions ?? 0}</span>
                      <span className="text-del">−{pull.deletions ?? 0}</span>
                      <span
                        className="pr-meta-secondary"
                        title="A careful read, from size alone"
                      >
                        ~
                        {readingMinutes(
                          pull.additions ?? 0,
                          pull.deletions ?? 0,
                          pull.changed_files ?? files.length,
                        )}{" "}
                        min read
                      </span>
                    </dd>
                  </div>
                ) : null}
                {pull ? (
                  <div className="pr-meta-field pr-meta-branches">
                    <dt>Branches</dt>
                    <dd className="mono">
                      <span title={pull.head.ref}>{pull.head.ref}</span>
                      <span className="pr-meta-arrow" aria-label="into">
                        →
                      </span>
                      <span title={pull.base.ref}>{pull.base.ref}</span>
                    </dd>
                  </div>
                ) : null}
              </dl>
              {pull ? (
                <div className="pr-metadata-controls">
                  <div className="pr-meta-control">
                    <span className="pr-meta-label">Labels</span>
                    <Labels
                      prRef={ref}
                      current={pull.labels}
                      onChanged={pr.refresh}
                    />
                  </div>
                  <div className="pr-meta-control">
                    <span className="pr-meta-label">Reviewers</span>
                    <Reviewers prRef={ref} />
                  </div>
                  {pull.auto_merge ? (
                    <div className="pr-meta-control">
                      <span className="pr-meta-label">Merge</span>
                      <span className="text-ink-2">
                        auto-merge on
                        {pull.auto_merge.merge_method
                          ? ` (${pull.auto_merge.merge_method.toLowerCase()})`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                  {pull.state !== "open" ? (
                    <div className="pr-meta-control">
                      <span className="pr-meta-label">State</span>
                      <span className="text-ink-2">
                        {pull.merged ? "merged" : "closed"}
                      </span>
                    </div>
                  ) : null}
                  {myReview ? (
                    <div className="pr-meta-control">
                      <span className="pr-meta-label">Your review</span>
                      <span className="text-ink-2">
                        {myReview.state === "APPROVED"
                          ? "Approved"
                          : myReview.state === "CHANGES_REQUESTED"
                            ? "Changes requested"
                            : "Commented"}
                        {myReview.submitted_at
                          ? ` ${age(myReview.submitted_at)} ago`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                  {previews.length ? (
                    <div className="pr-meta-control">
                      <span className="pr-meta-label">Previews</span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {previews.map((l) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            key={l.url}
                            type="button"
                            onClick={() => safeOpenUrl(l.url)}
                            title={l.url}
                            className="flex h-5 items-center gap-1 rounded-[4px] bg-raise px-1.5 text-[11.5px] text-ink-2 hover:text-ink"
                          >
                            <ExternalLink
                              className="size-3"
                              strokeWidth={2}
                              aria-hidden
                            />
                            {l.host}
                          </Button>
                        ))}
                      </span>
                    </div>
                  ) : null}
                  <StackLine s={stack} />
                </div>
              ) : null}
              {reach ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-3">
                  <span>
                    workspace: touches{" "}
                    <span className="tnum text-ink-2">
                      {reach.touched.size} of {reach.total}
                    </span>{" "}
                    packages
                    {reach.dependents.size
                      ? `, ${reach.dependents.size} more depend on them`
                      : ", nothing else depends on them"}
                    {reach.crossings.length
                      ? ` · ${reach.crossings.length} import${reach.crossings.length === 1 ? "" : "s"} reaching into another package`
                      : ""}
                  </span>
                  {reach.touched.size > 1 && order !== "layer" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => {
                        setView("files");
                        layers.splitByPackage();
                        setOrder("layer");
                      }}
                      className="h-6 rounded-md px-2 text-ink-2 hover:bg-raise hover:text-ink"
                    >
                      Read by package
                    </Button>
                  ) : null}
                  {reach.crossings.slice(0, 3).map((c) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      key={`${c.file}:${c.line}`}
                      type="button"
                      onClick={() => {
                        setView("files");
                        setCurrent(c.file);
                        requestAnimationFrame(() =>
                          document
                            .getElementById(
                              lineId(fileAnchor(c.file), "R", c.line),
                            )
                            ?.scrollIntoView({ block: "center" }),
                        );
                      }}
                      className="mono h-6 rounded-md px-1.5 text-[11.5px] text-ink-2 hover:bg-raise hover:text-ink"
                      title={`imports ${c.spec} from ${c.target}`}
                    >
                      {c.file.split("/").pop()}:{c.line}
                    </Button>
                  ))}
                </p>
              ) : null}
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </header>
      <TabsList
        variant="underline"
        className="pr-tabs w-full shrink-0 justify-start"
        aria-label="Pull request sections"
      >
        <TabsTab value="overview" id="pr-tab-overview">
          Overview
        </TabsTab>
        <TabsTab value="files" id="pr-tab-files">
          Files <span className="pr-tab-count tnum">{files.length}</span>
        </TabsTab>
        <TabsTab value="guided" id="pr-tab-guided">
          <Sparkles className="pr-tab-icon size-3.5" aria-hidden />
          Guided review
          {guided.plan ? (
            <span className="pr-tab-count tnum">
              {guided.plan.steps.length}
            </span>
          ) : null}
        </TabsTab>
        <TabsTab value="discussion" id="pr-tab-discussion">
          Discussion
          <span className="pr-tab-count tnum">
            {(pr.issueComments.data?.length ?? 0) +
              (pr.reviews.data?.length ?? 0)}
          </span>
        </TabsTab>
        <TabsTab value="commits" id="pr-tab-commits">
          Commits
          <span className="pr-tab-count tnum">
            {pr.commits.data?.length ?? 0}
          </span>
        </TabsTab>
        <TabsTab value="checks" id="pr-tab-checks">
          Checks
          <span className="pr-tab-count tnum">
            {pr.checks.data?.check_runs.length ?? 0}
          </span>
        </TabsTab>
      </TabsList>
      {!pull ? (
        <Loading />
      ) : (
        <div className="flex min-h-0 flex-1">
          {(view === "files" || view === "guided") && !filesHidden ? (
            <FilesColumn
              files={shownFiles}
              threadsByPath={threadsByPath}
              draftsByPath={draftsByPath}
              viewed={viewed}
              current={current}
              onSelect={jumpTo}
              order={order}
              onOrder={setOrder}
              guidedView={view === "guided"}
              guided={guided}
              stepIndex={guided.step}
              onStep={jumpToStep}
              foldNoise={prefs.hideNoise}
              layers={layers}
              provider={prefs.ai.provider}
              busyHint={
                guided.running
                  ? guided.found
                    ? `${guided.found} stop${guided.found === 1 ? "" : "s"} so far…`
                    : "Reading the diff…"
                  : undefined
              }
              width={filesW}
              onWidth={onFilesWidth}
            />
          ) : null}
          <ReadPane
            view={view}
            onShowFiles={() => setView("files")}
            pull={pull}
            files={shownFiles}
            sinceReview={
              sinceReview
                ? {
                    sha: sinceReview.sha,
                    commits: sinceReview.commits,
                    files: sinceReview.files?.length ?? null,
                    onlyChanged,
                    setOnlyChanged,
                  }
                : null
            }
            replies={replies}
            clone={clone}
            onOpenFile={(file) => {
              if (!clone) return;
              run(
                Effect.flatMap(Git, (g) =>
                  Effect.flatMap(g.editorTargets, (ts) =>
                    ts[0]
                      ? g.openEditor(`${clone}/${file}`, ts[0].id)
                      : Effect.void,
                  ),
                ),
              ).catch((e) => toast.fail("Couldn’t open the editor", e));
            }}
            onCommitPr={(n) =>
              void navigate({
                to: "/pr/$owner/$repo/$number",
                params: { owner: ref.owner, repo: ref.repo, number: String(n) },
              })
            }
            briefingReach={
              reach
                ? {
                    touched: [...reach.touched],
                    dependents: [...reach.dependents],
                    crossings: reach.crossings.length,
                    total: reach.total,
                  }
                : null
            }
            onOpenBriefing={openAiReview}
            onJumpFile={jumpTo}
            onFinishReview={
              reviewable
                ? () =>
                    setSubmit({ open: true, event: review.event ?? "COMMENT" })
                : undefined
            }
            headingFor={headingFor}
            issueComments={pr.issueComments.data ?? []}
            reviews={pr.reviews.data ?? []}
            commits={pr.commits.data ?? []}
            checks={pr.checks.data}
            checksError={pr.checks.error}
            checksRefreshing={pr.checks.isFetching}
            onRetryChecks={() => void pr.checks.refetch()}
            threads={pr.threads}
            drafts={drafts}
            split={split}
            viewer={auth.viewer}
            composing={composing}
            setComposing={setComposing}
            onDraft={addDraft}
            onDraftChange={changeDraft}
            onDraftDiscard={discardDraft}
            since={since}
            onFileEnd={prefs.autoMarkRead ? markReadOnce : undefined}
            onReply={reply}
            onResolve={resolve}
            onComment={comment}
            prRef={ref}
            ops={ops}
            canEdit={canEdit}
            onEditBody={saveBody}
            wrap={prefs.wrapLines}
            hideWhitespace={prefs.hideWhitespace}
            hideNoise={prefs.hideNoise}
            findOpen={find}
            onFindClose={() => setFind(false)}
            tourOn={view === "guided" && !!guided.plan}
            onLeaveTour={leaveTour}
            onMarkRead={markRead}
            viewed={viewed}
            scrollRef={scrollRef}
            guided={guided}
            showGuided={view === "guided"}
            provider={prefs.ai.provider}
            onStepJump={jumpToStep}
            stepActions={stepActions}
            onDraftTour={draftTour}
          />
        </div>
      )}
      <AskDrawer
        open={ask}
        onOpenChange={setAsk}
        prKey={prKey}
        prRef={ref}
        context={context}
        cwd={clone}
        instructions={prefs.ai.instructions}
        onAction={runAction}
        width={askW}
        onWidth={onAskWidth}
      />
      {reviewable ? (
        <SubmitDialog
          open={submit.open}
          event={submit.event}
          body={review.body}
          onBodyChange={(body) => updateReview(prKey, (r) => ({ ...r, body }))}
          drafts={drafts}
          busy={busy}
          onOpenChange={(open) => setSubmit((s) => ({ ...s, open }))}
          onEvent={(event) => {
            updateReview(prKey, (r) => ({ ...r, event }));
            setSubmit((s) => ({ ...s, event }));
          }}
          onSubmit={(body) => {
            if (submit.event === "REQUEST_CHANGES" && !body.trim())
              toast.say(
                "Requesting changes without a word",
                "Reviewers usually expect one.",
              );
            void sendReview(body);
          }}
          onDiscardDraft={discardDraft}
          onJumpDraft={(d) => {
            setView("files");
            setSubmit((s) => ({ ...s, open: false }));
            setCurrent(d.path);
            setTimeout(() => {
              document
                .getElementById(lineId(fileAnchor(d.path), d.side, d.line))
                ?.scrollIntoView({ block: "center" });
              markLines(d.path, d.side, d.startLine ?? d.line, d.line);
            }, 50);
          }}
          confirm={prefs.confirmBeforeSubmit}
        />
      ) : null}
    </Tabs>
  );
}

/** The lines you were brought to, lit: cleared first, then every row of the range. */
function markLines(
  path: string | null,
  side: "L" | "R",
  start: number,
  end: number,
) {
  for (const el of document.querySelectorAll("[data-stop]"))
    el.removeAttribute("data-stop");
  if (!path) return;
  const prefix = fileAnchor(path);
  for (let n = start; n <= end; n++)
    document
      .getElementById(lineId(prefix, side, n))
      ?.closest("tr")
      ?.setAttribute("data-stop", "");
}
const markStop = (s: GuidedStep | null) =>
  s
    ? markLines(s.path, "R", s.line, s.endLine ?? s.line)
    : markLines(null, "R", 0, 0);

/** One thing on the page that needs a look, in reading order. */
interface Target {
  readonly kind: "thread" | "stop" | "hunk";
  readonly top: number;
  readonly path: string;
  readonly side: "L" | "R";
  readonly line: number;
  readonly endLine?: number;
  readonly index?: number;
}

const prScroll = new Map<string, number>();
/** Where a target lands: this far below the top of the read, under the sticky file header. */
const LAND = 120;

/** The shape of the page while GitHub answers: a column of files, a read, nothing to click yet. */
function Loading() {
  return (
    <div
      className="flex min-h-0 flex-1"
      aria-busy="true"
      aria-label="Loading the pull request"
    >
      <aside className="w-64 shrink-0 border-r border-hair bg-desk px-4 pt-4">
        {[180, 120, 150, 90, 160, 130].map((w, i) => (
          <Skeleton
            key={w + i}
            className="mb-3 h-3 rounded-sm bg-raise"
            style={{ width: w }}
          />
        ))}
      </aside>
      <div className="flex-1 px-8 pt-6">
        <div className="mx-auto max-w-[760px]">
          <Skeleton className="h-3.5 w-[70%] rounded-sm bg-raise" />
          <Skeleton className="mt-3 h-3.5 w-[92%] rounded-sm bg-raise" />
          <Skeleton className="mt-3 h-3.5 w-[84%] rounded-sm bg-raise" />
          <Skeleton className="mt-8 h-3 w-[40%] rounded-sm bg-raise" />
          <Skeleton className="mt-3 h-3 w-[55%] rounded-sm bg-raise" />
        </div>
      </div>
    </div>
  );
}

function countBy(xs: ReadonlyArray<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
