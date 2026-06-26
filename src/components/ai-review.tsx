import { KbdEnter, KbdShift } from "@/components/kbd";
import { MarkdownBody } from "@/components/markdown-body";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type AiAction, actionTitle, parseActions } from "@/lib/ai-actions";
import { CHAT_SYSTEM } from "@/lib/ai/prompts";
import { invoke } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { PROVIDER_LABEL, aiInvokeArgs, useAiProvider } from "@/stores/ai";
import { type ChatMessage, useAiChat } from "@/stores/ai-chat";
import { useLocalRepos } from "@/stores/local-repos";
import { useReviewPrefs } from "@/stores/review-prefs";
import { listen } from "@tauri-apps/api/event";
import { Check, Copy, MessageSquare, RotateCcw, SendHorizonal, Tag, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface Props {
  /** Conversation key, e.g. `owner/repo#123`. */
  prKey: string;
  /** Self-contained PR context (metadata + diff) sent with every turn. */
  context: string;
  /** Posts an AI-proposed action via the app's authenticated GitHub commands. */
  executeAction: (a: AiAction) => Promise<void>;
}

const EMPTY: ChatMessage[] = [];

export function AiReview({ prKey, context, executeAction }: Props) {
  const provider = useAiProvider((s) => s.provider);
  const messages = useAiChat((s) => s.byPr[prKey]) ?? EMPTY;
  const draft = useAiChat((s) => s.drafts[prKey]) ?? "";
  const append = useAiChat((s) => s.append);
  const reset = useAiChat((s) => s.reset);
  const setMessages = useAiChat((s) => s.setMessages);
  const setDraft = useAiChat((s) => s.setDraft);
  const aiInstructions = useReviewPrefs((s) => s.aiInstructions);
  const localRepos = useLocalRepos((s) => s.repos);
  const [input, setInput] = useState(draft);

  // 73: rehydrate the unsent draft when switching PRs (the store is the source
  // of truth across navigation/refresh; mirror it into local state on key change).
  useEffect(() => {
    setInput(useAiChat.getState().drafts[prKey] ?? "");
  }, [prKey]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Live streaming state — the in-flight assistant text accumulates here (not in
  // the persisted store, to avoid a sqlite write per token); on completion the
  // backend's authoritative full text is committed as one message.
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const streamingRef = useRef(false);

  // If the PR's repo is cloned in the local workspace, run the agent INSIDE that
  // clone so it can grep/read real files — not just reason over the diff.
  const cwd = useMemo(() => {
    const [owner, repo] = prKey.split("#")[0].split("/");
    return localRepos.find((r) => r.owner === owner && r.repo === repo)?.path ?? null;
  }, [prKey, localRepos]);

  // Stream tokens (ai:chunk) + completion (ai:complete) for THIS PR. Chunks
  // accumulate live; on complete we commit the full text to the store.
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let alive = true;
    const track = (p: Promise<() => void>) => {
      p.then((u) => (alive ? unlistens.push(u) : u()));
    };
    track(
      listen<{ key: string; delta: string }>("ai:chunk", (e) => {
        if (e.payload.key !== prKey || !streamingRef.current) return;
        setStreamText((t) => t + e.payload.delta);
      }),
    );
    track(
      listen<{ key: string; ok: boolean; output?: string; error?: string }>("ai:complete", (e) => {
        if (e.payload.key !== prKey || !streamingRef.current) return;
        const p = e.payload;
        append(prKey, {
          role: "assistant",
          content: p.ok ? (p.output ?? "") : `⚠️ ${p.error ?? "AI failed"}`,
        });
        streamingRef.current = false;
        setStreaming(false);
        setStreamText("");
      }),
    );
    return () => {
      alive = false;
      for (const u of unlistens) u();
    };
  }, [prKey, append]);

  // 67: keep the latest message (and the live stream) in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on transcript/stream change
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, streamText]);

  function runTurn(history: ChatMessage[]) {
    const transcript = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const custom = aiInstructions.trim()
      ? `\n\n# Reviewer's instructions (follow these)\n${aiInstructions.trim()}`
      : "";
    setStreamText("");
    setStreaming(true);
    streamingRef.current = true;
    invoke("ai_stream", {
      key: prKey,
      ...aiInvokeArgs(),
      cwd,
      prompt: `${CHAT_SYSTEM}${custom}\n\n# Pull request\n${context}\n\n# Conversation\n${transcript}\n\nAssistant:`,
    }).catch((e) => {
      if (!streamingRef.current) return;
      streamingRef.current = false;
      setStreaming(false);
      setStreamText("");
      append(prKey, { role: "assistant", content: `⚠️ ${String(e)}` });
    });
  }

  function send(text: string) {
    const body = text.trim();
    if (!body || streaming) return;
    const history = [...messages, { role: "user" as const, content: body }];
    append(prKey, { role: "user", content: body });
    setInput("");
    setDraft(prKey, "");
    runTurn(history);
  }

  // 66: stop the in-flight turn — abort the backend task (kills the child) and
  // keep whatever streamed so far so the partial answer isn't lost.
  function stop() {
    streamingRef.current = false;
    invoke("ai_cancel", { key: prKey }).catch(() => {});
    const partial = streamText.trim();
    if (partial) append(prKey, { role: "assistant", content: partial });
    setStreaming(false);
    setStreamText("");
  }

  // 69: re-run the last assistant turn by rewinding to just before it and
  // re-sending the prior user message.
  function regenerate() {
    if (streaming) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Drop a trailing assistant turn (the one being regenerated) if present.
    const trimmed =
      messages.length && messages[messages.length - 1].role === "assistant"
        ? messages.slice(0, -1)
        : messages.slice();
    setMessages(prKey, trimmed);
    runTurn(trimmed);
  }

  // 70: clearing wipes a real conversation — confirm via an undoable toast that
  // restores the transcript if the reviewer changes their mind.
  function clearConversation() {
    if (messages.length === 0) return;
    const snapshot = messages;
    reset(prKey);
    toast("Conversation cleared", {
      action: { label: "Undo", onClick: () => setMessages(prKey, snapshot) },
    });
  }

  function onChangeInput(value: string) {
    setInput(value);
    setDraft(prKey, value); // 73: persist the in-progress draft
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* conversation (scrolls; composer stays pinned below) */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
        {messages.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Ask anything about this PR. It can also comment, approve, or request changes — you
            confirm before anything posts.
          </p>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="ml-1 min-w-0 max-w-[88%] break-words rounded-2xl rounded-br-sm bg-primary/15 px-3 py-2 text-xs text-foreground">
                  <MarkdownBody>{m.content}</MarkdownBody>
                </div>
              </div>
            ) : (
              <AssistantMessage
                key={i}
                content={m.content}
                executeAction={executeAction}
                onRegenerate={i === lastAssistantIdx && !streaming ? regenerate : undefined}
              />
            ),
          )
        )}
        {streaming &&
          (streamText ? (
            <div className="space-y-1">
              <div className="break-words rounded-2xl rounded-bl-sm border border-border/40 bg-card/65 px-3 py-2 text-xs">
                <MarkdownBody>{streamText}</MarkdownBody>
                <span className="ml-0.5 inline-block h-3.5 w-[3px] translate-y-0.5 animate-pulse rounded-full bg-primary/70 align-middle" />
              </div>
              <button
                type="button"
                onClick={stop}
                className="pl-1 text-[11px] font-medium text-muted-foreground/55 transition-colors hover:text-destructive"
              >
                Stop generating
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-sm border border-border/40 bg-card/65 px-3 py-2.5">
              <TypingDots />
              <span className="text-xs text-muted-foreground">
                {PROVIDER_LABEL[provider]} is thinking…
              </span>
              <button
                type="button"
                onClick={stop}
                className="ml-auto text-[11px] font-medium text-muted-foreground/55 transition-colors hover:text-destructive"
              >
                Stop
              </button>
            </div>
          ))}
      </div>

      {/* composer */}
      <div className="mt-2 shrink-0 space-y-2">
        {messages.length > 0 && (
          <div className="flex items-center">
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={clearConversation}
              disabled={streaming}
            >
              <Trash2 className="size-3" />
              Clear
            </Button>
          </div>
        )}
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={(e) => {
              // 71: Enter or ⌘/Ctrl↵ sends; ⇧↵ inserts a newline.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send(input);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
                return;
              }
              // 72: ↑ on an empty field recalls the previous user message to edit.
              if (e.key === "ArrowUp" && input.length === 0) {
                const lastUser = [...messages].reverse().find((m) => m.role === "user");
                if (lastUser) {
                  e.preventDefault();
                  onChangeInput(lastUser.content);
                }
              }
            }}
            placeholder="Talk about this PR…"
            rows={2}
            className="min-h-0 flex-1 resize-none font-sans text-xs"
          />
          <Button type="submit" size="icon-sm" disabled={streaming || !input.trim()}>
            <SendHorizonal className="size-4" />
          </Button>
        </form>
        {/* 71: keyboard hint */}
        <p className="flex items-center gap-1.5 pl-0.5 text-[11px] text-muted-foreground/45">
          <span className="inline-flex items-center gap-1">
            <KbdEnter /> send
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-flex items-center gap-px">
              <KbdShift />
              <KbdEnter />
            </span>
            newline
          </span>
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  executeAction,
  onRegenerate,
}: {
  content: string;
  executeAction: (a: AiAction) => Promise<void>;
  /** Present only on the last assistant turn — re-runs the prior user message. */
  onRegenerate?: () => void;
}) {
  const { text, actions } = parseActions(content);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error("Couldn't copy to clipboard"));
  }

  return (
    <div className="group/msg min-w-0 space-y-2">
      {text && (
        <div className="relative break-words rounded-2xl rounded-bl-sm border border-border/40 bg-card/65 px-3 py-2 text-xs">
          <MarkdownBody>{text}</MarkdownBody>
          {/* 68: hover Copy on the assistant bubble. */}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Copy message"
            onClick={copy}
            className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/msg:opacity-100"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </Button>
        </div>
      )}
      {actions.map((a, i) => (
        <ActionCard key={i} action={a} executeAction={executeAction} />
      ))}
      {/* 69: regenerate the last assistant turn. */}
      {onRegenerate && (
        <div className="flex items-center">
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto opacity-0 transition-opacity group-hover/msg:opacity-100"
            onClick={onRegenerate}
          >
            <RotateCcw className="size-3" />
            Regenerate
          </Button>
        </div>
      )}
    </div>
  );
}

/** Three-dot typing indicator (staggered bounce), like a chat app. */
function TypingDots() {
  return (
    <span className="flex shrink-0 items-end gap-1" aria-hidden>
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
    </span>
  );
}

interface ActionTone {
  icon: typeof Check;
  text: string;
  bg: string;
  /** Left accent border in the tone color. */
  border: string;
  destructive: boolean;
}

function actionTone(a: AiAction): ActionTone {
  if (a.type === "review" && a.event === "APPROVE") {
    return {
      icon: Check,
      text: "text-success",
      bg: "bg-success/[0.07]",
      border: "border-l-success",
      destructive: false,
    };
  }
  if (a.type === "review" && a.event === "REQUEST_CHANGES") {
    return {
      icon: X,
      text: "text-destructive",
      bg: "bg-destructive/[0.07]",
      border: "border-l-destructive",
      destructive: true,
    };
  }
  if (a.type === "label") {
    return {
      icon: Tag,
      text: "text-primary",
      bg: "bg-foreground/[0.04]",
      border: "border-l-primary",
      destructive: false,
    };
  }
  return {
    icon: MessageSquare,
    text: "text-primary",
    bg: "bg-foreground/[0.04]",
    border: "border-l-primary",
    destructive: false,
  };
}

function actionBody(a: AiAction): string | null {
  if (a.type === "comment" || a.type === "review" || a.type === "inline_comment") return a.body;
  return null;
}

function ActionCard({
  action,
  executeAction,
}: {
  action: AiAction;
  executeAction: (a: AiAction) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const tone = actionTone(action);
  const Icon = tone.icon;
  const body = actionBody(action);
  const done = status === "done";

  async function run() {
    setStatus("running");
    setError(null);
    try {
      await executeAction(action);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setError(String(e));
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-l-2 border-border/40 p-3 transition-opacity",
        tone.bg,
        tone.border,
        done && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone.text)} strokeWidth={2} />
        <span className="min-w-0 break-words text-xs font-medium text-foreground">
          {actionTitle(action)}
        </span>
      </div>
      {body && (
        <div className="mt-1.5 max-w-none text-xs text-foreground/85">
          <MarkdownBody>{body}</MarkdownBody>
        </div>
      )}
      {status === "error" && error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      {/* The action lives below the comment so a long file path can't push it
          off the card. */}
      <div className="mt-2.5 flex justify-end">
        {done ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" strokeWidth={2.5} />
            Posted
          </span>
        ) : (
          <Button
            size="xs"
            variant={tone.destructive ? "destructive" : "default"}
            loading={status === "running"}
            onClick={run}
          >
            Confirm & post
          </Button>
        )}
      </div>
    </div>
  );
}
