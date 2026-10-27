import { runtime } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { Ai, type AiError, type AiProgress } from "@/effect/services/Ai";
import type { PrRef } from "@/effect/services/GitHub";
import { buildLayerContext, buildReviewContext } from "@/lib/ai/context";
import {
  CHAT_SYSTEM,
  CLONE_ABSENT_CLAUSE,
  GUIDED_SYSTEM,
  LAYERED_SYSTEM,
} from "@/lib/ai/prompts";
import { failureText } from "@/lib/reliability";
import type { PullDetail, PullFile } from "@/lib/tauri";
import { Cause, Effect, Fiber, Stream } from "effect";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/** The PR as the model sees it: metadata, description, the diff within budget. */
export function prContext(
  pull: S.PullDetail,
  files: ReadonlyArray<S.PullFile>,
  ref: PrRef,
): string {
  return buildReviewContext(
    pull as unknown as PullDetail,
    [...files] as unknown as PullFile[],
    `${ref.owner}/${ref.repo}`,
    ref.number,
  );
}

/** What every prompt carries about this reviewer and this machine. */
export interface PromptOpts {
  /** Settings → Review assistant → Instructions: the team's standards, once. */
  readonly instructions: string;
  /** A local clone is passed as the working directory, so the model reads real files, not just the diff. */
  readonly hasClone: boolean;
}

const instructionsClause = (s: string) =>
  s.trim()
    ? `\n\n## Additional instructions from the reviewer\n${s.trim()}`
    : "";

export const guidedPrompt = (ctx: string, o: PromptOpts): string =>
  `${GUIDED_SYSTEM}${instructionsClause(o.instructions)}${o.hasClone ? "" : CLONE_ABSENT_CLAUSE}\n\n# Pull request\n${ctx}`;

export const layeredPrompt = (
  ctx: string,
  files: ReadonlyArray<S.PullFile>,
  o: PromptOpts,
): string =>
  `${LAYERED_SYSTEM}${instructionsClause(o.instructions)}\n\n# Pull request\n${buildLayerContext(ctx, [...files] as unknown as PullFile[])}`;

/** The one paragraph a reviewer needs before opening: plain text, no verdict. */
const SUMMARY_SYSTEM = `You are helping a code reviewer decide what to open first. In at most 60 words of plain text, no markdown, no bullet points, say what this pull request does and the one thing most worth a reviewer's attention. Do not judge it, do not list files, do not repeat the title.`;

export const summaryPrompt = (ctx: string, o: PromptOpts): string =>
  `${SUMMARY_SYSTEM}${instructionsClause(o.instructions)}\n\n# Pull request\n${ctx}`;

export interface ChatMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export const chatPrompt = (
  ctx: string,
  history: ReadonlyArray<ChatMessage>,
  question: string,
  o: PromptOpts,
): string =>
  [
    CHAT_SYSTEM +
      instructionsClause(o.instructions) +
      (o.hasClone ? "" : CLONE_ABSENT_CLAUSE),
    "",
    "# Pull request",
    ctx,
    "",
    "# Conversation so far",
    ...history.map(
      (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
    ),
    "",
    `User: ${question}`,
    "Assistant:",
  ].join("\n");

export interface AiRun {
  readonly text: string;
  readonly running: boolean;
  readonly error: string | null;
  readonly progress: AiProgress | null;
}

/** What the model is doing right now, for an indicator that outlives any one panel. */
export interface AiActivityEntry {
  readonly key: string;
  readonly label: string;
  readonly cancel: () => void;
  readonly returnTo?: "/spec-lens";
}
const activityListeners = new Set<() => void>();
let activity: ReadonlyArray<AiActivityEntry> = [];
const activityStore = {
  get: () => activity,
  set: (next: ReadonlyArray<AiActivityEntry>) => {
    activity = next;
    for (const l of activityListeners) l();
  },
  subscribe: (l: () => void) => {
    activityListeners.add(l);
    return () => void activityListeners.delete(l);
  },
};
const addActivity = (e: AiActivityEntry) =>
  activityStore.set([...activity.filter((x) => x.key !== e.key), e]);
const removeActivity = (key: string) =>
  activityStore.set(activity.filter((x) => x.key !== key));

export const useAiActivity = (): ReadonlyArray<AiActivityEntry> =>
  useSyncExternalStore(
    activityStore.subscribe,
    activityStore.get,
    activityStore.get,
  );

/* ───────────── runs that outlive the page: the tour, the layers ───────────── */

const runs = new Map<string, AiRun>();
const fibers = new Map<string, Fiber.Fiber<void, AiError>>();
const runListeners = new Set<() => void>();
const setRun = (key: string, r: AiRun) => {
  runs.set(key, r);
  for (const l of runListeners) l();
};

/** Start a keyed run nobody has to stay on the page for. The result goes to `onDone`; the text and state to `useBackgroundRun`. */
export function startBackground(
  key: string,
  prompt: string,
  cwd: string | null,
  label: string,
  onDone?: (text: string) => void,
  returnTo?: AiActivityEntry["returnTo"],
): void {
  cancelBackground(key);
  let acc = "";
  setRun(key, { text: "", running: true, error: null, progress: null });
  addActivity({ key, label, cancel: () => cancelBackground(key), returnTo });
  const program = Stream.runForEach(
    Stream.unwrap(
      Effect.map(Ai, (ai) =>
        ai.stream(key, prompt, cwd ?? undefined, (progress) => {
          const current = runs.get(key);
          if (current?.running)
            setRun(key, {
              ...current,
              progress: current.progress
                ? { ...current.progress, ...progress }
                : progress,
            });
        }),
      ),
    ),
    (delta) =>
      Effect.sync(() => {
        acc += delta;
        setRun(key, {
          text: acc,
          running: true,
          error: null,
          progress: runs.get(key)?.progress ?? null,
        });
      }),
  );
  const f = runtime.runFork(program);
  fibers.set(key, f);
  void runtime.runPromiseExit(Fiber.join(f)).then((exit) => {
    if (fibers.get(key) !== f) return; // cancelled or superseded
    fibers.delete(key);
    removeActivity(key);
    if (exit._tag === "Success") {
      setRun(key, {
        text: acc,
        running: false,
        error: null,
        progress: runs.get(key)?.progress ?? null,
      });
      onDone?.(acc);
    } else
      setRun(key, {
        text: acc,
        running: false,
        error: failureText(Cause.squash(exit.cause)),
        progress: runs.get(key)?.progress ?? null,
      });
  });
}

export function cancelBackground(key: string): void {
  const f = fibers.get(key);
  if (!f) return;
  fibers.delete(key);
  runtime.runFork(Fiber.interrupt(f));
  removeActivity(key);
  void runtime.runPromise(Effect.flatMap(Ai, (ai) => ai.cancel(key)));
  const r = runs.get(key);
  if (r?.running) setRun(key, { ...r, running: false });
}

export const useBackgroundRun = (key: string): AiRun | undefined =>
  useSyncExternalStore(
    (l) => {
      runListeners.add(l);
      return () => void runListeners.delete(l);
    },
    () => runs.get(key),
    () => runs.get(key),
  );

/** One streaming run at a time: start it, watch the text grow, stop it, and it stops with the screen. */
export function useAiRun() {
  const [run, setState] = useState<AiRun>({
    text: "",
    running: false,
    error: null,
    progress: null,
  });
  const fiber = useRef<Fiber.Fiber<void, AiError> | null>(null);
  const key = useRef<string | null>(null);

  const cancel = useCallback(() => {
    const f = fiber.current,
      k = key.current;
    fiber.current = null;
    key.current = null;
    if (f) runtime.runFork(Fiber.interrupt(f));
    if (k) {
      removeActivity(k);
      void runtime.runPromise(Effect.flatMap(Ai, (ai) => ai.cancel(k)));
    }
    setState((r) => (r.running ? { ...r, running: false } : r));
  }, []);

  const start = useCallback(
    (
      runKey: string,
      prompt: string,
      onDone?: (text: string) => void,
      label = "Thinking",
      cwd?: string | null,
    ) => {
      cancel();
      let acc = "";
      setState({ text: "", running: true, error: null, progress: null });
      key.current = runKey;
      addActivity({ key: runKey, label, cancel });
      const program = Stream.runForEach(
        Stream.unwrap(
          Effect.map(Ai, (ai) =>
            ai.stream(runKey, prompt, cwd ?? undefined, (progress) => {
              setState((current) =>
                current.running
                  ? {
                      ...current,
                      progress: current.progress
                        ? { ...current.progress, ...progress }
                        : progress,
                    }
                  : current,
              );
            }),
          ),
        ),
        (delta) =>
          Effect.sync(() => {
            acc += delta;
            setState((current) => ({
              text: acc,
              running: true,
              error: null,
              progress: current.progress,
            }));
          }),
      );
      const f = runtime.runFork(program);
      fiber.current = f;
      void runtime.runPromiseExit(Fiber.join(f)).then((exit) => {
        if (fiber.current !== f) return; // cancelled or superseded
        fiber.current = null;
        key.current = null;
        removeActivity(runKey);
        if (exit._tag === "Success") {
          setState((current) => ({
            ...current,
            text: acc,
            running: false,
            error: null,
          }));
          onDone?.(acc);
        } else {
          setState((current) => ({
            ...current,
            text: acc,
            running: false,
            error: failureText(Cause.squash(exit.cause)),
          }));
        }
      });
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);
  return { ...run, start, cancel };
}
