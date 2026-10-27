import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { type Verdict, usePrefs } from "@/effect/services/Prefs";
import type { Ranked } from "@/effect/services/Triage";
import { useReview } from "@/features/pr/review-state";
import { safeOpenUrl } from "@/lib/ui";
import { cn } from "@/lib/utils";
import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitPullRequest,
  Layers,
  MessageSquare,
  Moon,
  MoreHorizontal,
} from "lucide-react";
import { SNOOZE_LABEL, type SnoozeWhen } from "./snooze";

/** "2d", "5h", "just now" — the age the list shows, two characters when it can. */
export function age(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  const m = Math.round(ms / 60_000);
  if (m < 2) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

/** The verdict word: six words, lowercase, mono. Amber means one thing. */
export function VerdictWord({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <span
      className={cn(
        "mono text-[12px] leading-none",
        verdict === "risky" ? "text-amber" : "text-ink-2",
        className,
      )}
    >
      {verdict}
    </span>
  );
}

function Ci({ ci }: { ci?: string }) {
  if (!ci || ci === "none") return null;
  const Icon = ci === "success" ? CircleCheck : ci === "failure" ? CircleX : CircleDashed;
  const label =
    ci === "success" ? "checks green" : ci === "failure" ? "CI failing" : "checks running";
  return (
    <Icon
      aria-label={label}
      className={cn(
        "size-3.5 shrink-0",
        ci === "success" ? "text-add" : ci === "failure" ? "text-del" : "text-ink-3",
      )}
      strokeWidth={2}
    />
  );
}

/** Where it is and who it is from, in one quiet line. */
function Where({ item, inStack = false }: { item: Ranked; inStack?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-ink-3">
      {item.avatar ? (
        <img
          src={item.avatar}
          alt=""
          className="size-4 shrink-0 rounded-full bg-raise"
          draggable={false}
        />
      ) : (
        <span className="grid size-4 shrink-0 place-items-center rounded-full bg-raise text-[9px] text-ink-2">
          {item.kind === "finding" ? "!" : item.kind === "local" ? "~" : "·"}
        </span>
      )}
      <span className="truncate">
        {inStack ? `#${item.number ?? ""}` : item.repo}
        {!inStack && item.number ? ` #${item.number}` : ""}
      </span>
      {item.kind === "mention" ? (
        <MessageSquare aria-label="a mention" className="size-3.5 shrink-0" strokeWidth={2} />
      ) : null}
      <Ci ci={item.ci} />
      {item.draft ? <span className="shrink-0">draft</span> : null}
      {item.stack && !inStack ? (
        <span
          className="tnum flex shrink-0 items-center gap-0.5"
          title={`layer ${item.stack.position} of ${item.stack.size} in a stack onto ${item.stack.base}`}
        >
          <Layers className="size-3.5" strokeWidth={1.75} aria-hidden />
          {item.stack.position}/{item.stack.size}
        </span>
      ) : null}
      <span className="tnum shrink-0">{age(item.createdAt ?? item.updatedAt)}</span>
    </span>
  );
}

export function Row({
  item,
  selected,
  hideVerdict,
  inStack = false,
  stackGapBefore = false,
  onSelect,
  onOpen,
  onDone,
  onSnooze,
  onSnoozeFor,
  onUnsnooze,
}: {
  item: Ranked;
  selected: boolean;
  hideVerdict?: boolean;
  inStack?: boolean;
  /** This visible layer is not consecutive with the previous visible layer. */
  stackGapBefore?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onDone?: () => void;
  onSnooze?: () => void;
  onSnoozeFor?: (when: SnoozeWhen) => void;
  onUnsnooze?: () => void;
}) {
  const review = useReview(item.number ? `${item.repo}#${item.number}` : "");
  const pending = review.drafts.length;
  const snoozedUntil = usePrefs((p) => p.snoozed[item.id]);
  const isSnoozed = !!snoozedUntil && Date.parse(snoozedUntil) > Date.now();
  if (item.kind === "pr") {
    const status = item.conflicting
      ? "Conflicts"
      : item.ci === "failure"
        ? "CI failing"
        : item.reviewDecision === "CHANGES_REQUESTED"
          ? "Changes requested"
          : item.verdict === "mergeable"
            ? "Ready to merge"
            : item.draft
              ? "Draft"
              : null;
    return (
      <div
        role="option"
        aria-selected={selected}
        id={item.id}
        data-id={item.id}
        data-in-stack={inStack || undefined}
        data-stack-gap-before={stackGapBefore || undefined}
        tabIndex={-1}
        onClick={onOpen}
        onFocus={onSelect}
        className="pr-list-row"
      >
        <span
          className="pr-list-gutter"
          aria-label={inStack ? `Layer ${item.stack?.position} of ${item.stack?.size}` : undefined}
        >
          {inStack ? (
            <span>
              {item.stack?.position}/{item.stack?.size}
            </span>
          ) : (
            <GitPullRequest className="size-3.5" aria-hidden />
          )}
        </span>
        <div className="pr-list-main">
          <span className="pr-list-title" title={item.title}>
            {item.title}
          </span>
          <span className="pr-list-meta">
            {item.avatar ? <img src={item.avatar} alt="" draggable={false} /> : null}
            <span>{item.repo}</span>
            <span>#{item.number}</span>
            {item.author ? <span>{item.author}</span> : null}
            <span>{age(item.createdAt ?? item.updatedAt)}</span>
            {pending ? (
              <span>
                {pending} draft comment{pending === 1 ? "" : "s"}
              </span>
            ) : null}
          </span>
        </div>
        <span className="pr-list-status-slot">
          {status ? (
            <Badge
              variant={item.conflicting || item.ci === "failure" ? "error" : "secondary"}
              size="sm"
              className="pr-list-status"
            >
              {status}
            </Badge>
          ) : null}
          {!status ? <Ci ci={item.ci} /> : null}
        </span>
        <Menu>
          <MenuTrigger
            aria-label={`Actions for pull request ${item.number}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="shrink-0"
            render={<Button variant="ghost" size="icon-xs" />}
          >
            <MoreHorizontal className="size-3.5" />
          </MenuTrigger>
          <MenuPopup
            align="end"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {onDone ? (
              <MenuItem onClick={onDone}>
                <Check className="size-3.5" />
                Mark done
              </MenuItem>
            ) : null}
            {onSnoozeFor ? (
              (["later", "tomorrow", "week"] as const).map((when) => (
                <MenuItem key={when} onClick={() => onSnoozeFor(when)}>
                  <Moon className="size-3.5" />
                  {SNOOZE_LABEL[when]}
                </MenuItem>
              ))
            ) : onSnooze ? (
              <MenuItem onClick={onSnooze}>Snooze until tomorrow</MenuItem>
            ) : null}
            {isSnoozed && onUnsnooze ? (
              <MenuItem onClick={onUnsnooze}>Move back to Inbox</MenuItem>
            ) : null}
            {item.url ? (
              <>
                <MenuSeparator />
                <MenuItem onClick={() => item.url && safeOpenUrl(item.url)}>
                  <ExternalLink className="size-3.5" />
                  Open on GitHub
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
    );
  }
  return (
    <div
      role="option"
      aria-selected={selected}
      id={item.id}
      data-id={item.id}
      data-hide-verdict={hideVerdict || undefined}
      tabIndex={-1}
      onClick={onOpen}
      onFocus={onSelect}
      className={cn(
        "review-row group relative grid h-10 w-full cursor-default items-center gap-5 border-b border-hair px-5 text-left transition-colors",
        hideVerdict
          ? "grid-cols-[minmax(220px,1.1fr)_minmax(200px,300px)_minmax(0,1.3fr)]"
          : "grid-cols-[minmax(220px,1.1fr)_minmax(200px,300px)_84px_minmax(0,1.3fr)]",
        selected ? "bg-raise" : "hover:bg-raise/50",
      )}
    >
      <span className={cn("truncate text-[13px]", selected ? "font-medium text-ink" : "text-ink")}>
        {item.title}
      </span>
      <Where item={item} inStack={inStack} />
      {hideVerdict ? null : <VerdictWord verdict={item.verdict} />}
      <span className="truncate text-[12.5px] text-ink-2">
        {pending ? (
          <span className="tnum mr-2 rounded-[3px] bg-raise px-1 text-[11px] text-ink-2">
            {pending} draft{pending > 1 ? "s" : ""}
          </span>
        ) : null}
        {item.why}
      </span>
      {onDone || onSnooze || item.url ? (
        <span className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-raise px-0.5 opacity-0 shadow-[0_1px_2px_rgba(0,0,0,.3)] focus-within:opacity-100 group-hover:opacity-100">
          {onDone ? (
            <IconButton size={6} label="Done (e)" onClick={onDone}>
              <Check className="size-3.5" strokeWidth={2} />
            </IconButton>
          ) : null}
          {onSnooze && onSnoozeFor ? (
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      aria-label="Snooze (s: until tomorrow)"
                      onClick={(e) => e.stopPropagation()}
                      className="grid size-6 place-items-center rounded-md text-ink-2 hover:bg-raise hover:text-ink data-[popup-open]:bg-raise data-[popup-open]:text-ink"
                    />
                  }
                >
                  <Moon className="size-3.5" strokeWidth={1.75} />
                </TooltipTrigger>
                <TooltipPopup>Snooze (s: until tomorrow)</TooltipPopup>
              </Tooltip>
              <MenuPopup
                align="end"
                className="min-w-44 border-edge bg-popover text-[13px]"
                onClick={(e) => e.stopPropagation()}
              >
                {(["later", "tomorrow", "week"] as const).map((w) => (
                  <MenuItem key={w} onClick={() => onSnoozeFor(w)}>
                    {SNOOZE_LABEL[w]}
                    {w === "tomorrow" ? (
                      <kbd className="ml-auto text-[11px] text-ink-3">s</kbd>
                    ) : null}
                  </MenuItem>
                ))}
                {isSnoozed && onUnsnooze ? (
                  <>
                    <MenuSeparator />
                    <MenuItem onClick={onUnsnooze}>Back in the Inbox now</MenuItem>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : onSnooze ? (
            <IconButton size={6} label="Snooze until tomorrow (s)" onClick={onSnooze}>
              <Moon className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
          {item.url ? (
            <IconButton
              size={6}
              label="Open on GitHub"
              onClick={() => item.url && safeOpenUrl(item.url)}
            >
              <ExternalLink className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
