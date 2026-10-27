import { toast } from "@/app/toast";
import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { run, useEffectQuery } from "@/effect/runtime";
import type * as S from "@/effect/schema";
import { GitHub, type PrRef } from "@/effect/services/GitHub";
import { cn } from "@/lib/utils";
import { Effect } from "effect";
import { Check, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

/** A label is a word with the repo's own colour as a dot; no outline, read by fill. */
function LabelChip({ label }: { label: S.Label }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1.5 rounded-[4px] bg-raise px-1.5 text-[12px] text-ink-2"
      title={label.description ?? undefined}
    >
      <span className="size-1.5 rounded-full" style={{ background: `#${label.color}` }} />
      {label.name}
    </span>
  );
}

/** A small "+" that opens a filterable list; ↵ toggles the first match. */
function Picker<T>({
  label,
  items,
  loading,
  selected,
  keyOf,
  render,
  onToggle,
  children,
  popupClassName,
  itemClassName,
}: {
  label: string;
  items: ReadonlyArray<T>;
  loading: boolean;
  selected: (t: T) => boolean;
  keyOf: (t: T) => string;
  render: (t: T) => ReactNode;
  onToggle: (t: T) => void;
  children?: ReactNode;
  popupClassName?: string;
  itemClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    return f ? items.filter((t) => keyOf(t).toLowerCase().includes(f)) : items;
  }, [items, q, keyOf]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={label}
              className="grid size-5 place-items-center rounded-[4px] text-ink-3 hover:bg-raise hover:text-ink data-[popup-open]:bg-raise data-[popup-open]:text-ink"
            />
          }
        >
          <Plus className="size-3.5" strokeWidth={2} />
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align="start"
        className={cn("w-64 rounded-lg border-edge bg-popover p-1", popupClassName)}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Filter ${label.toLowerCase()}`}
          className="h-7 w-full rounded-md bg-sink px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3"
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && list[0]) onToggle(list[0]);
            if (e.key === "Escape") setOpen(false);
          }}
        />
        <ul className="mt-1 max-h-64 overflow-y-auto scrollbar-thin" aria-label={label}>
          {loading ? <li className="px-2 py-1.5 text-[12px] text-ink-3">Loading…</li> : null}
          {!loading && list.length === 0 ? (
            <li className="px-2 py-1.5 text-[12px] text-ink-3">Nothing matches.</li>
          ) : null}
          {list.map((t) => {
            const on = selected(t);
            return (
              <li key={keyOf(t)}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(t)}
                  className={cn(
                    "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] hover:bg-raise",
                    on ? "text-ink" : "text-ink-2",
                    itemClassName,
                  )}
                >
                  <Check
                    className={cn("size-3.5 shrink-0", on ? "text-ink" : "opacity-0")}
                    strokeWidth={2}
                  />
                  {render(t)}
                </button>
              </li>
            );
          })}
        </ul>
        {children}
      </PopoverPopup>
    </Popover>
  );
}

/** The PR's labels, and the repo's to pick from. */
export function Labels({
  prRef,
  current,
  onChanged,
}: { prRef: PrRef; current: ReadonlyArray<S.Label>; onChanged: () => Promise<unknown> }) {
  const all = useEffectQuery(
    ["repo-labels", prRef.owner, prRef.repo],
    Effect.flatMap(GitHub, (g) => g.repoLabels(prRef.owner, prRef.repo)),
    { staleTime: 5 * 60_000 },
  );
  const names = new Set(current.map((l) => l.name));
  const toggle = async (l: S.Label) => {
    const next = new Set(names);
    if (next.has(l.name)) next.delete(l.name);
    else next.add(l.name);
    try {
      await run(Effect.flatMap(GitHub, (g) => g.setLabels(prRef, [...next])));
      await onChanged();
    } catch (e) {
      toast.fail("Labels didn’t change", e);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {current.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      <Picker
        label="Labels"
        items={all.data ?? []}
        loading={all.isPending}
        selected={(l) => names.has(l.name)}
        keyOf={(l) => l.name}
        onToggle={toggle}
        popupClassName="w-[22rem] max-w-[calc(100vw-2rem)]"
        itemClassName="h-auto min-h-11 items-start py-2"
        render={(l) => (
          <>
            <span
              className="mt-1.5 size-1.5 shrink-0 rounded-full"
              style={{ background: `#${l.color}` }}
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words leading-4 text-ink">{l.name}</span>
              {l.description ? (
                <span className="mt-0.5 block whitespace-normal break-words text-[11.5px] leading-4 text-ink-3">
                  {l.description}
                </span>
              ) : null}
            </span>
          </>
        )}
      />
    </span>
  );
}

/** Who was asked, and the collaborators to ask. */
export function Reviewers({ prRef }: { prRef: PrRef }) {
  const requested = useEffectQuery(
    ["requested-reviewers", prRef.owner, prRef.repo, prRef.number],
    Effect.flatMap(GitHub, (g) => g.requestedReviewers(prRef)),
    { staleTime: 60_000 },
  );
  const people = useEffectQuery(
    ["collaborators", prRef.owner, prRef.repo],
    Effect.flatMap(GitHub, (g) => g.collaborators(prRef.owner, prRef.repo)),
    { staleTime: 10 * 60_000 },
  );
  const users = requested.data?.users ?? [];
  const asked = new Set(users.map((u) => u.login));
  const toggle = async (u: S.UserRef) => {
    try {
      await run(
        Effect.flatMap(GitHub, (g) =>
          asked.has(u.login)
            ? g.removeReviewers(prRef, [u.login])
            : g.requestReviewers(prRef, [u.login]),
        ),
      );
      await requested.refetch();
    } catch (e) {
      toast.fail(asked.has(u.login) ? "Couldn’t withdraw the request" : "Couldn’t ask them", e);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {!users.length && !requested.data?.teams.length ? <span>None</span> : null}
      {users.map((u) => (
        <span key={u.id} className="inline-flex items-center gap-1 text-ink-2">
          <img
            src={u.avatar_url}
            alt=""
            className="size-4 rounded-full bg-raise"
            draggable={false}
          />
          {u.login}
        </span>
      ))}
      {requested.data?.teams.map((t) => (
        <span key={t.slug} className="text-ink-2">
          {t.name}
        </span>
      ))}
      <Picker
        label="Reviewers"
        items={people.data ?? []}
        loading={people.isPending}
        selected={(u) => asked.has(u.login)}
        keyOf={(u) => u.login}
        onToggle={toggle}
        render={(u) => (
          <>
            <img
              src={u.avatar_url}
              alt=""
              className="size-4 rounded-full bg-raise"
              draggable={false}
            />
            <span className="truncate">{u.login}</span>
          </>
        )}
      />
    </span>
  );
}
