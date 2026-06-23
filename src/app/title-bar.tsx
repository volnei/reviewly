import { ReviewlyGlyph } from "@/components/reviewly-glyph";
import { relativeTime } from "@/lib/format";
import { parsePullUrl } from "@/lib/tauri";
import { useUi } from "@/stores/ui";
import { useIsFetching } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CloudOff, Search } from "lucide-react";
import { useEffect, useState } from "react";

/** Quiet offline / last-synced status, parked at the right of the title bar. */
function SyncStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const fetching = useIsFetching();
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (fetching === 0) setLastSynced(Date.now());
  }, [fetching]);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!online) {
    return (
      <output
        className="flex items-center gap-1.5 text-xs text-destructive"
        aria-label="Offline — changes will sync when the connection returns"
      >
        <CloudOff className="size-3.5" />
        Offline
      </output>
    );
  }
  if (lastSynced == null) return null;
  return (
    <output className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
      <span className="size-1.5 rounded-full bg-success/70" aria-hidden />
      Synced · {relativeTime(lastSynced)}
    </output>
  );
}

export function TitleBar() {
  const togglePalette = useUi((s) => s.togglePalette);
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const isMac =
    typeof document !== "undefined" && document.documentElement.classList.contains("has-vibrancy");

  const handleMouseDown = async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, [data-no-drag]")) return;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      /* not in Tauri */
    }
  };

  const handleDoubleClick = async (e: React.MouseEvent) => {
    // Don't zoom the window when double-clicking the search / buttons — let the
    // native control handle it (e.g. double-click selects a word in the input).
    if ((e.target as HTMLElement).closest("button, a, input, [data-no-drag]")) return;
    try {
      const w = getCurrentWindow();
      if (await w.isMaximized()) await w.unmaximize();
      else await w.maximize();
    } catch {
      /* ignore */
    }
  };

  const submit = () => {
    const t = query.trim();
    if (!t) return;
    const url = parsePullUrl(t);
    if (url) {
      navigate({
        to: "/prs/$owner/$repo/$number",
        params: { owner: url.owner, repo: url.repo, number: String(url.number) },
      });
      return;
    }
    // owner/repo#number shorthand
    const m = t.match(/^([^/]+)\/([^/]+)#(\d+)$/);
    if (m) {
      navigate({
        to: "/prs/$owner/$repo/$number",
        params: { owner: m[1], repo: m[2], number: m[3] },
      });
      return;
    }
  };

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className="relative flex h-10 shrink-0 items-center gap-3 border-b border-hairline bg-transparent pr-5 select-none"
      style={{ paddingLeft: isMac ? 84 : 16 }}
    >
      {!isMac && (
        <div className="flex items-center gap-1.5 text-xs tracking-tight text-foreground/90 pointer-events-none">
          <ReviewlyGlyph />
          <span className="font-display text-sm">Reviewly</span>
        </div>
      )}

      <div data-no-drag className="ml-auto flex items-center gap-2.5">
        <SyncStatus />
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/40 bg-card/40 px-2 transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30">
          <Search className="size-3.5 text-muted-foreground/70" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                setQuery("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="owner/repo#123 or url…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="h-6 w-56 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
          />
        </div>

        <button
          onClick={togglePalette}
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <kbd className="rounded border border-border/40 bg-card/40 px-1 py-px font-mono text-xs">
            ⌘K
          </kbd>
        </button>
      </div>
    </div>
  );
}
