import { toast } from "@/app/toast";
import { IconButton } from "@/components/icon-button";
import { ResizeHandle } from "@/components/resize-handle";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { isNative } from "@/effect/Tauri";
import { providerName } from "@/effect/services/Ai";
import type { PrRef } from "@/effect/services/GitHub";
import { usePrefs } from "@/effect/services/Prefs";
import { type AiAction, actionTitle, parseActions } from "@/lib/ai-actions";
import { recoveryHint } from "@/lib/reliability";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy,
  PictureInPicture2,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ChatMessage, chatPrompt, useAiRun } from "./ai";
import {
  clearChat,
  setChatDraft,
  setChatMessages,
  useChat,
} from "./chat-store";
import { Markdown } from "./markdown";

const STARTERS = [
  "What changed, and why?",
  "Where should I start reading?",
  "Review it for me.",
  "Any behaviour change without a test?",
];

/** The Ask conversation in its own window, beside the app. The same transcript, kept on the machine. */
async function openChatWindow(ref: PrRef): Promise<void> {
  if (!isNative()) {
    toast.say("A separate window needs the desktop app");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `chat-${ref.owner}-${ref.repo}-${ref.number}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: `/chat/${ref.owner}/${ref.repo}/${ref.number}`,
    title: `Ask · ${ref.owner}/${ref.repo} #${ref.number}`,
    width: 460,
    height: 720,
    minWidth: 360,
    minHeight: 440,
    resizable: true,
    backgroundColor: "#191919",
  });
  win.once("tauri://error", (e) =>
    toast.fail(
      "Couldn’t open the window",
      (e as { payload?: unknown }).payload,
    ),
  );
}

/**
 * Ask about this PR: a panel you open, not a band that stays. The model gets
 * the same diff you see; what it proposes to post waits for your click. The
 * conversation is kept per PR, and the same one shows in a detached window.
 */
export function AskPanel({
  prKey,
  prRef,
  context,
  cwd,
  instructions,
  onClose,
  onAction,
  width,
  onWidth,
  mode = "panel",
}: {
  prKey: string;
  prRef: PrRef;
  context: string;
  /** The local clone the model works in, when there is one. */
  cwd: string | null;
  instructions: string;
  onClose?: () => void;
  onAction: (a: AiAction) => Promise<void>;
  width?: number;
  onWidth?: (w: number, done: boolean) => void;
  /** A panel beside the read, a floating drawer, or the whole of its own window. */
  mode?: "panel" | "drawer" | "window";
}) {
  const startW = useRef(width ?? 400);
  const drag = useCallback(
    (dx: number) =>
      onWidth?.(Math.min(640, Math.max(320, startW.current - dx)), false),
    [onWidth],
  );
  const endDrag = useCallback(() => {
    startW.current = width ?? 400;
    onWidth?.(width ?? 400, true);
  }, [onWidth, width]);
  const provider = usePrefs((p) => p.ai.provider);
  const chat = useChat(prKey);
  const messages = chat.messages;
  const [q, setQ] = useState(chat.draft);
  const ai = useAiRun();
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  // The unsent question survives a close and a restart.
  useEffect(() => {
    const t = setTimeout(() => setChatDraft(prKey, q), 300);
    return () => clearTimeout(t);
  }, [prKey, q]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message lands or the stream grows
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, ai.text]);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const ask = (
    question: string,
    history: ReadonlyArray<ChatMessage> = messages,
  ) => {
    const text = question.trim();
    if (!text || ai.running) return;
    setChatMessages(prKey, [...history, { role: "user", content: text }]);
    setLastQuestion(text);
    setQ("");
    ai.start(
      `chat:${prKey}`,
      chatPrompt(context, history, text, { instructions, hasClone: !!cwd }),
      (answer) =>
        setChatMessages(prKey, [
          ...history,
          { role: "user", content: text },
          { role: "assistant", content: answer },
        ]),
      "Answering",
      cwd,
    );
  };
  /** Drop the last answer and ask its question again. */
  const regenerate = () => {
    const i = messages.length - 1;
    if (
      i < 1 ||
      messages[i].role !== "assistant" ||
      messages[i - 1].role !== "user"
    )
      return;
    ask(messages[i - 1].content, messages.slice(0, i - 1));
  };
  const clear = () => {
    const was = clearChat(prKey);
    toast.act("Conversation cleared", "Undo", () =>
      setChatMessages(prKey, was),
    );
  };
  const canRegenerate =
    !ai.running &&
    messages.length >= 2 &&
    messages[messages.length - 1].role === "assistant";

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col bg-desk",
        mode === "panel" ? "shrink-0 border-l border-hair" : "w-full",
      )}
      style={
        mode === "window"
          ? undefined
          : { width: `min(${width ?? 400}px, calc(100vw - 24px))` }
      }
      onMouseDownCapture={() => {
        startW.current = width ?? 400;
      }}
    >
      {mode !== "window" && onWidth ? (
        <ResizeHandle
          edge="left"
          onDrag={drag}
          onEnd={endDrag}
          label="Ask panel width"
        />
      ) : null}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-hair px-3 text-[12.5px] text-ink-2">
        <Sparkles className="ai-spark size-3.5" strokeWidth={2} />
        <span className="flex-1 truncate">
          {mode === "window" ? `Ask · ${prKey}` : "Ask about this PR"}
        </span>
        <span
          className="truncate text-ink-3"
          title={
            cwd ??
            "Add the clone in Local and it reads the code, not just the diff"
          }
        >
          {providerName(provider)}
          {cwd ? " · in your clone" : " · diff only"}
        </span>
        {messages.length && !ai.running ? (
          <IconButton size={6} label="Clear the conversation" onClick={clear}>
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {mode !== "window" && isNative() ? (
          <IconButton
            size={6}
            label="Open in its own window"
            onClick={() => {
              void openChatWindow(prRef);
              onClose?.();
            }}
          >
            <PictureInPicture2 className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
        {onClose ? (
          <IconButton size={6} label="Close (esc)" onClick={onClose}>
            <X className="size-3.5" strokeWidth={2} />
          </IconButton>
        ) : null}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3 scrollbar-thin">
        {messages.length === 0 && !ai.running ? (
          <div className="grid gap-1.5">
            <p className="mb-1 text-[12.5px] text-ink-3">
              It reads the same diff you do. Nothing is posted until you say so.
            </p>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                className="h-7 rounded-md bg-raise/60 px-2.5 text-left text-[12.5px] text-ink-2 hover:bg-raise hover:text-ink"
              >
                {s}
              </button>
            ))}
          </div>
        ) : null}
        <div className="grid min-w-0 gap-3">
          {messages.map((m, i) => (
            <Message
              key={`${i}-${m.role}`}
              m={m}
              onAction={onAction}
              onRegenerate={
                canRegenerate && i === messages.length - 1
                  ? regenerate
                  : undefined
              }
            />
          ))}
          {ai.running ? (
            <div className="ai-soft grid min-w-0 gap-1 px-3 py-2.5">
              {ai.text ? (
                <Markdown className="text-[13px]">
                  {parseActions(ai.text).text}
                </Markdown>
              ) : null}
              <p className="flex items-center gap-2 text-[12px] text-ink-3">
                <span
                  className="ai-dot size-1.5 animate-pulse rounded-full"
                  aria-hidden
                />
                <span className="ai-ink font-medium">Thinking</span> with{" "}
                {providerName(provider)}…
              </p>
            </div>
          ) : null}
          {ai.error ? (
            <div className="grid gap-2 text-[12.5px]">
              {ai.text ? (
                <div className="border-l-2 border-edge pl-3">
                  <p className="mb-1 text-[11px] text-ink-3">
                    Partial answer kept
                  </p>
                  <Markdown className="text-ink-2">
                    {parseActions(ai.text).text}
                  </Markdown>
                </div>
              ) : null}
              <p className="text-del">{ai.error}</p>
              <p className="text-ink-3">{recoveryHint(ai.error)}</p>
              {lastQuestion ? (
                <button
                  type="button"
                  onClick={() => {
                    const last = messages[messages.length - 1];
                    const history =
                      last?.role === "user" && last.content === lastQuestion
                        ? messages.slice(0, -1)
                        : messages;
                    ask(lastQuestion, history);
                  }}
                  className="w-fit text-ink-2 underline decoration-ink-3 underline-offset-2 hover:text-ink"
                >
                  Start a clean retry
                </button>
              ) : null}
            </div>
          ) : null}
          <div ref={end} />
        </div>
      </div>
      <div className="shrink-0 border-t border-hair p-3">
        <textarea
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          rows={2}
          placeholder="Ask anything about this change…"
          className="selectable w-full resize-none rounded-md border border-input bg-sink px-2.5 py-1.5 font-sans text-[13px] leading-[1.5] text-ink outline-none placeholder:text-ink-3 focus:border-edge"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(q);
            }
            // An empty field and ↑: the last question comes back to be edited.
            if (e.key === "ArrowUp" && !q) {
              const last = [...messages]
                .reverse()
                .find((m) => m.role === "user");
              if (last) {
                e.preventDefault();
                setQ(last.content);
              }
            }
            if (e.key === "Escape" && onClose) {
              e.preventDefault();
              onClose();
            }
            e.stopPropagation();
          }}
        />
        <div className="ask-composer-footer">
          <div className="ask-shortcuts" aria-label="Composer shortcuts">
            <span className="ask-shortcut ask-shortcut-primary">
              <kbd>↵</kbd>
              <span>Send</span>
            </span>
            <span className="ask-shortcut">
              <kbd>⇧ ↵</kbd>
              <span>New line</span>
            </span>
            <span className="ask-shortcut ask-shortcut-secondary">
              <kbd>↑</kbd>
              <span>Previous</span>
            </span>
            {onClose ? (
              <span className="ask-shortcut ask-shortcut-secondary">
                <kbd>Esc</kbd>
                <span>Close</span>
              </span>
            ) : null}
          </div>
          {ai.running ? (
            <button type="button" onClick={ai.cancel} className="ask-stop">
              Stop
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

export function AskDrawer({
  open,
  onOpenChange,
  ...panel
}: Omit<React.ComponentProps<typeof AskPanel>, "mode" | "onClose"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/28 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Popup className="fixed top-3 right-3 bottom-3 z-50 overflow-hidden rounded-xl border border-edge bg-desk shadow-[0_20px_64px_rgba(0,0,0,0.38)] outline-none transition-transform duration-200 data-ending-style:translate-x-[calc(100%+1rem)] data-starting-style:translate-x-[calc(100%+1rem)] motion-reduce:transition-none">
          <DialogPrimitive.Title className="sr-only">
            Ask about this pull request
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Ask the configured model questions about the current pull request.
          </DialogPrimitive.Description>
          <AskPanel
            {...panel}
            mode="drawer"
            onClose={() => onOpenChange(false)}
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Message({
  m,
  onAction,
  onRegenerate,
}: {
  m: ChatMessage;
  onAction: (a: AiAction) => Promise<void>;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (m.role === "user") {
    return (
      <p className="selectable ml-8 min-w-0 break-words rounded-lg bg-raise px-3 py-2 text-[13px] text-ink">
        {m.content}
      </p>
    );
  }
  const { text, actions } = parseActions(m.content);
  const copy = () =>
    navigator.clipboard
      .writeText(m.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.fail("Couldn’t copy it"));
  return (
    <div className="group ai-soft grid min-w-0 gap-2 px-3 py-2.5">
      <Markdown className="min-w-0 text-[13px]">{text}</Markdown>
      {actions.map((a, i) => (
        <ActionCard key={`${i}-${a.type}`} action={a} onAction={onAction} />
      ))}
      <div className="flex items-center gap-0.5 opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          size={6}
          label={copied ? "Copied" : "Copy the answer"}
          onClick={copy}
        >
          {copied ? (
            <Check className="size-3.5" strokeWidth={2} />
          ) : (
            <Copy className="size-3.5" strokeWidth={1.75} />
          )}
        </IconButton>
        {onRegenerate ? (
          <IconButton size={6} label="Ask again" onClick={onRegenerate}>
            <RotateCcw className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function ActionCard({
  action,
  onAction,
}: {
  action: AiAction;
  onAction: (a: AiAction) => Promise<void>;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed">(
    "idle",
  );
  const body = "body" in action ? action.body : "";
  return (
    <div className="ai-card p-3">
      <p className="text-[12.5px] font-medium text-ink">
        {actionTitle(action)}
      </p>
      {body ? (
        <Markdown className="mt-1 text-[12.5px] text-ink-2">{body}</Markdown>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={state !== "idle"}
          onClick={async () => {
            setState("busy");
            try {
              await onAction(action);
              setState("done");
            } catch {
              setState("failed");
            }
          }}
          className={cn(
            "h-6 shrink-0 whitespace-nowrap rounded-md px-2.5 text-[12px]",
            state === "done"
              ? "border border-transparent text-ink-3"
              : "ai-button font-medium disabled:opacity-50",
          )}
        >
          {state === "done"
            ? "Done"
            : state === "busy"
              ? "Working…"
              : state === "failed"
                ? "Try again"
                : action.type === "inline_comment"
                  ? "Add to my review"
                  : "Do it"}
        </button>
        <span className="text-[11.5px] text-ink-3">
          {action.type === "inline_comment"
            ? "becomes a draft; it goes up with your review"
            : action.type === "review"
              ? "opens your review with this text"
              : "posts to GitHub as you"}
        </span>
      </div>
    </div>
  );
}
