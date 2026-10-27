import { Popover, PopoverPopup, PopoverTrigger } from "@/components/ui/popover";
import { useEffectQuery } from "@/effect/runtime";
import { GitHub } from "@/effect/services/GitHub";
import { safeOpenUrl } from "@/lib/ui";
import { Effect } from "effect";
import { type ReactElement, useRef, useState } from "react";

const compact = (n: number) =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/**
 * Rest on a name or an avatar and the person shows: who they are, where, how
 * many follow them. Fetched once the card opens, kept for the session.
 */
export function UserCard({ login, children }: { login: string; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const profile = useEffectQuery(
    ["user", login],
    Effect.flatMap(GitHub, (g) => g.user(login)),
    { enabled: open, staleTime: 6 * 3600_000 },
  );
  const later = (o: boolean, ms: number) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(o), ms);
  };
  const p = profile.data;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={children}
        onMouseEnter={() => later(true, 450)}
        onMouseLeave={() => later(false, 200)}
        onFocus={() => later(true, 300)}
        onBlur={() => later(false, 100)}
      />
      <PopoverPopup
        align="start"
        className="w-[280px] rounded-lg border-edge bg-popover p-3 text-[12.5px]"
        onMouseEnter={() => later(true, 0)}
        onMouseLeave={() => later(false, 200)}
      >
        <div className="flex items-center gap-3">
          <img
            src={p?.avatar_url ?? `https://github.com/${login}.png?size=96`}
            alt=""
            className="size-10 rounded-full bg-raise"
            draggable={false}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{p?.name ?? login}</p>
            <p className="truncate text-ink-3">@{login}</p>
          </div>
        </div>
        {p?.bio ? <p className="mt-2 text-ink-2">{p.bio}</p> : null}
        {p ? (
          <p className="tnum mt-2 text-ink-3">
            <span className="text-ink-2">{compact(p.followers)}</span> followers ·{" "}
            <span className="text-ink-2">{compact(p.public_repos)}</span> repos
            {p.company ? ` · ${p.company}` : ""}
            {p.location ? ` · ${p.location}` : ""}
          </p>
        ) : profile.isError ? (
          <p className="mt-2 text-ink-3">GitHub didn’t say more.</p>
        ) : (
          <p className="mt-2 text-ink-3">Looking them up…</p>
        )}
        <button
          type="button"
          onClick={() => safeOpenUrl(p?.html_url ?? `https://github.com/${login}`)}
          className="mt-2 h-6 rounded-md px-1.5 text-ink-2 hover:bg-raise hover:text-ink"
        >
          Open on GitHub
        </button>
      </PopoverPopup>
    </Popover>
  );
}
