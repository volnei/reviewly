import { KbdCmd, KbdEnter } from "@/components/kbd";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Cap autosize growth so a long body scrolls inside the card instead of off-screen. */
const MAX_TEXTAREA_HEIGHT = 320;

/** Turn a pasted GitHub URL into a markdown link with a readable short label. */
function githubLinkLabel(url: string): string {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/i);
  if (m) return `${m[1]}/${m[2]}#${m[4]}`;
  const c = url.match(/github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})/i);
  if (c) return `${c[1]}/${c[2]}@${c[3].slice(0, 7)}`;
  const r = url.match(/github\.com\/([^/]+)\/([^/]+)\/?$/i);
  if (r) return `${r[1]}/${r[2]}`;
  return url;
}

function isGithubUrl(text: string): boolean {
  return /^https?:\/\/github\.com\/\S+$/i.test(text.trim()) && !/\s/.test(text.trim());
}

interface Props {
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  cancelLabel?: string;
  /** Optional content shown inside the card above the field (e.g. a line chip). */
  header?: ReactNode;
  /** Icon rendered before the submit label (e.g. a Send glyph). */
  submitIcon?: ReactNode;
  /** A second ghost action before the primary button (e.g. "Add to review"). */
  secondaryLabel?: string;
  onSecondary?: (body: string) => void;
  /** Footer-left content; replaces the "⌘↵ to …" hint (e.g. a success status). */
  footerStatus?: ReactNode;
  /** Allow submitting an empty body (e.g. an optional review summary). */
  allowEmpty?: boolean;
  /** Live value callback, fired on every keystroke (e.g. to persist a draft). */
  onChange?: (value: string) => void;
  /** Show a "Suggest change" button that wraps the highlighted text in ```suggestion. */
  withSuggestion?: boolean;
  submitting?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  className?: string;
  rows?: number;
  autoFocus?: boolean;
}

/**
 * The one comment composer — a single cohesive card (optional header, a
 * borderless field, and a footer action bar). Used for top-level Conversation
 * comments, thread replies, edits, and (via `header`) inline diff comments, so
 * every "write a comment" surface looks and behaves identically. ⌘↵ submits.
 */
export function Composer({
  placeholder = "Leave a comment…",
  initialValue = "",
  submitLabel = "Comment",
  cancelLabel = "Cancel",
  header,
  submitIcon,
  secondaryLabel,
  onSecondary,
  footerStatus,
  allowEmpty,
  onChange,
  withSuggestion,
  submitting,
  onSubmit,
  onCancel,
  className,
  rows = 3,
  autoFocus,
}: Props) {
  const [body, setBody] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = allowEmpty || body.trim().length > 0;
  // "Dirty" = the body diverges from what it was initialized/reset to. Used to
  // guard an accidental Escape/Cancel that would throw away unsent edits.
  const dirty = body !== initialValue;
  const submit = () => {
    if (canSubmit) onSubmit(body.trim());
  };

  // 27/76: when the `initialValue` prop changes (e.g. an edit composer is
  // pointed at a different comment, or a guided step's suggestion changes),
  // resync the field — but never clobber unsent edits the reviewer is typing.
  useEffect(() => {
    setBody((cur) => (cur === initialValue ? cur : initialValue));
  }, [initialValue]);

  // 74: autosize the field to its content, capped so it scrolls past the cap.
  // `body` is the trigger — we re-measure whenever the text changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on body change
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
  }, [body]);

  // 28/76: an Escape/Cancel that would discard a dirty body asks first.
  function requestCancel() {
    if (!onCancel) return;
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    onCancel();
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      requestCancel();
    }
  }

  // 75: pasting a bare GitHub URL offers to insert it as a markdown link; a
  // selection becomes the link text. Other pastes fall through unchanged.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!isGithubUrl(text)) return; // image paste etc. — best-effort skip, let default run
    const el = e.currentTarget;
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const selected = body.slice(start, end);
    const url = text.trim();
    const label = selected || githubLinkLabel(url);
    const md = `[${label}](${url})`;
    e.preventDefault();
    const next = body.slice(0, start) + md + body.slice(end);
    setBody(next);
    onChange?.(next);
    const caret = start + md.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function wrapSuggestion() {
    setBody((cur) => {
      const trimmed = cur.trim();
      if (trimmed.includes("```suggestion")) return cur;
      return `\`\`\`suggestion\n${trimmed}\n\`\`\``;
    });
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-input bg-card shadow-sm transition-colors focus-within:border-ring",
        className,
      )}
    >
      {header && <div className="flex items-center gap-2 px-3 pt-2.5 text-xs">{header}</div>}
      <Textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          onChange?.(e.target.value);
        }}
        onKeyDown={handleKey}
        onPaste={handlePaste}
        placeholder={placeholder}
        rows={rows}
        className="min-h-0 resize-none border-0 bg-transparent px-3 py-2.5 font-sans text-sm shadow-none focus-visible:ring-0"
      />
      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-2.5 py-2">
        {footerStatus ?? (
          <span className="flex items-center gap-1 pl-0.5 text-[11px] text-muted-foreground/45">
            <span className="inline-flex items-center gap-px">
              <KbdCmd />
              <KbdEnter />
            </span>
            to {submitLabel.toLowerCase()}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          {withSuggestion && (
            <Button size="xs" variant="ghost" onClick={wrapSuggestion} type="button">
              Suggest change
            </Button>
          )}
          {onCancel && (
            <Button size="xs" variant="ghost" onClick={requestCancel} type="button">
              {cancelLabel}
            </Button>
          )}
          {onSecondary && secondaryLabel && (
            <Button
              size="xs"
              variant="ghost"
              type="button"
              disabled={!body.trim()}
              onClick={() => body.trim() && onSecondary(body.trim())}
            >
              {secondaryLabel}
            </Button>
          )}
          <Button size="xs" loading={submitting} disabled={!canSubmit} onClick={submit}>
            {submitIcon}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
