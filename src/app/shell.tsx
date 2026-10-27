import { useAppearance, zoomBy, zoomReset } from "@/app/appearance";
import { useClipboardSniff } from "@/app/clipboard-sniff";
import { chord, dispatchScopes, isTyping } from "@/app/keys";
import { KeysDialog } from "@/app/keys-dialog";
import { onboarding } from "@/app/onboarding";
import { overlays, useOverlays } from "@/app/overlays";
import { Palette } from "@/app/palette";
import { usePrSync } from "@/app/pr-sync";
import { Rail } from "@/app/rail";
import { VIEW_PATHS, isChatWindow } from "@/app/router";
import { TitleBar } from "@/app/title-bar";
import { toast } from "@/app/toast";
import { useUpdater } from "@/app/updater";
import { WhatsNewDialog, useWhatsNew } from "@/app/whats-new";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Tauri } from "@/effect/Tauri";
import { run, runtime } from "@/effect/runtime";
import { DependabotDone, Viewer } from "@/effect/schema";
import { AppSettings } from "@/effect/services/AppSettings";
import { Auth, authStore, useAuth } from "@/effect/services/Auth";
import { usePrefs } from "@/effect/services/Prefs";
import { clearHomeCache } from "@/features/home/cache";
import { clearInboxCache } from "@/features/inbox/cache";
import { recordFix } from "@/features/list/fixes";
import { toLocalId } from "@/lib/local-id";
import { syncPrs } from "@/lib/pr-sync";
import { safeOpenUrl } from "@/lib/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Effect, Fiber, Schema, Stream } from "effect";
import { useEffect } from "react";
import { refreshInboxFromWatcher } from "./workspace";

/**
 * The window: one title bar across the top, the rail below it on the left,
 * the screen to its right. Nothing else is permanent.
 */
export function Shell() {
  if (isChatWindow) return <ChatShell />;
  return <MainShell />;
}

/** The detached Ask window: the screen alone, with toasts and tooltips. */
function ChatShell() {
  useAppearance();
  return (
    <TooltipProvider delay={300}>
      <ToastProvider position="bottom-right" limit={2}>
        <div className="h-full bg-desk text-ink">
          <Outlet />
        </div>
      </ToastProvider>
    </TooltipProvider>
  );
}

function MainShell() {
  useAuthBootstrap();
  useBackendSettingsSync();
  usePrSync();
  useBackendEvents();
  useClipboardSniff();
  useNativeChrome();
  useAppearance();
  useUpdater();
  useWhatsNew();
  useGlobalKeys();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useDocumentTitle(pathname);
  const firstRun = pathname === "/first-run";
  const over = useOverlays();
  return (
    <TooltipProvider delay={300}>
      <ToastProvider position="bottom-right" limit={3}>
        <div className="flex h-full flex-col bg-void text-ink">
          <a className="skip-link" href="#stage">
            Skip to content
          </a>
          <TitleBar />
          <div className="app-workspace flex min-h-0 flex-1">
            {firstRun ? null : <Rail />}
            <main
              id="stage"
              className="app-stage relative min-w-0 flex-1 overflow-hidden"
              tabIndex={-1}
            >
              <Outlet />
            </main>
          </div>
        </div>
        <Palette open={over.palette} onOpenChange={(palette) => overlays.set({ palette })} />
        <KeysDialog open={over.keys} onOpenChange={(keys) => overlays.set({ keys })} />
        <WhatsNewDialog />
      </ToastProvider>
    </TooltipProvider>
  );
}

const SCREEN_TITLES: Record<string, string> = {
  "/": "Home",
  "/inbox": "Inbox",
  "/prs": "Pull requests",
  "/mentions": "Mentions",
  "/health": "Health",
  "/turbo": "Living architecture",
  "/spec-lens": "Spec Lens",
  "/merge-lab": "Merge Lab",
  "/history": "History",
  "/local": "Local repositories",
  "/settings": "Settings",
};

function useDocumentTitle(pathname: string) {
  useEffect(() => {
    const exact = SCREEN_TITLES[pathname];
    const section = pathname.startsWith("/pr/")
      ? "Pull request"
      : pathname.startsWith("/local/")
        ? "Repository"
        : undefined;
    document.title = `${exact ?? section ?? "Reviewly"} · Reviewly`;
  }, [pathname]);
}

/** Keep the native watcher configured after every launch, not only after visiting Settings. */
function useBackendSettingsSync() {
  const watched = usePrefs((p) => p.watchedRepos);
  const pollMinutes = usePrefs((p) => p.pollMinutes);
  const notificationsEnabled = usePrefs((p) => p.notifications.enabled);
  const notificationReasons = usePrefs((p) => p.notifications.reasons);

  useEffect(() => {
    void run(Effect.flatMap(AppSettings, (a) => a.setWatchedRepos(watched))).catch(() => {});
  }, [watched]);
  useEffect(() => {
    void run(Effect.flatMap(AppSettings, (a) => a.setPollInterval(pollMinutes))).catch(() => {});
  }, [pollMinutes]);
  useEffect(() => {
    void run(
      Effect.flatMap(AppSettings, (a) => a.setNotificationsEnabled(notificationsEnabled)),
    ).catch(() => {});
  }, [notificationsEnabled]);
  useEffect(() => {
    void run(
      Effect.flatMap(AppSettings, (a) => a.setNotificationReasons(notificationReasons)),
    ).catch(() => {});
  }, [notificationReasons]);
}

/** Ask the backend who is signed in; the first run takes over until someone is. */
function useAuthBootstrap() {
  const auth = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    void run(Effect.flatMap(Auth, (a) => a.bootstrap));
  }, []);
  useEffect(() => {
    if (auth.loading) return;
    if (!auth.signedIn && pathname !== "/first-run") void navigate({ to: "/first-run" });
    if (auth.signedIn && pathname === "/first-run" && !onboarding.get())
      void navigate({ to: "/inbox" });
  }, [auth.loading, auth.signedIn, pathname, navigate]);
}

/** The Rust workers talk; the cache listens. One subscription per event, for the window's life. */
/** Where the tray's quick menu points, in this app's own map. */
const TRAY_ROUTES: Record<string, string> = {
  "/": "/",
  "/inbox": "/inbox",
  "/prs": "/prs",
  "/mentions": "/mentions",
  "/health": "/health",
  // Accept events from older native builds while the app is being upgraded.
  "/notifications": "/mentions",
  "/dependabot": "/health",
  "/repos": "/local",
  "/history": "/history",
  "/settings": "/settings",
};

function useBackendEvents() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const watched = usePrefs((prefs) => prefs.watchedRepos);
  useEffect(() => {
    const program = Effect.gen(function* () {
      const t = yield* Tauri;
      const refresh = (keys: ReadonlyArray<ReadonlyArray<string>>) =>
        Effect.sync(() => {
          for (const k of keys) void qc.invalidateQueries({ queryKey: k });
        });
      const syncPullMirror = Effect.promise(() => syncPrs(qc, watched));
      yield* Effect.all(
        [
          Stream.runForEach(t.events("pr:changed", Schema.Unknown), () =>
            Effect.all([refresh([["pull"], ["stacks"], ["stack"]]), syncPullMirror]),
          ),
          Stream.runForEach(t.events("pr:new", Schema.Array(Schema.String)), (ids) =>
            Effect.all([
              syncPullMirror,
              Effect.sync(() => {
                void qc.invalidateQueries({ queryKey: ["notifications"] });
                // "owner/repo#123": a new request while you work gets one toast each, three at most.
                for (const id of ids.slice(0, 3)) {
                  const m = id.match(/^([^/]+)\/([^#]+)#(\d+)$/);
                  if (!m) continue;
                  const [, owner, repo, number] = m;
                  toast.act(`${repo} #${number} asks for your review`, "Open", () =>
                    navigate({
                      to: "/pr/$owner/$repo/$number",
                      params: { owner, repo, number },
                    }),
                  );
                }
              }),
            ]),
          ),
          Stream.runForEach(t.events("repos:changed", Schema.Array(Schema.String)), (repos) =>
            Effect.promise(() => syncPrs(qc, repos)),
          ),
          Stream.runForEach(t.events("auth:ready", Viewer), (viewer) =>
            Effect.sync(() => {
              authStore.set({ loading: false, signedIn: true, viewer });
              void qc.invalidateQueries();
            }),
          ),
          Stream.runForEach(t.events("auth:signed_out", Schema.Unknown), () =>
            Effect.sync(() => {
              authStore.set({ loading: false, signedIn: false, viewer: null });
              qc.clear();
              clearHomeCache();
              clearInboxCache();
            }),
          ),
          // The poller counts what waits for you; the tray shows the number.
          Stream.runForEach(t.events("pr:tick", Schema.Number), (n) =>
            Effect.flatMap(AppSettings, (a) => a.setTrayTitle(n > 0 ? String(n) : "")).pipe(
              Effect.orElseSucceed(() => undefined),
            ),
          ),
          Stream.runForEach(t.events("tray:navigate", Schema.String), (route) =>
            Effect.sync(() => void navigate({ to: TRAY_ROUTES[route] ?? "/inbox" })),
          ),
          // The app menu's "About Reviewly": the version and the updater live in Settings.
          Stream.runForEach(t.events("menu:about", Schema.Unknown), () =>
            Effect.sync(() => void navigate({ to: "/settings" })),
          ),
          Stream.runForEach(t.events("dependabot:done", DependabotDone), (d) =>
            Effect.sync(() => {
              void refreshInboxFromWatcher(qc);
              recordFix(d.key, { ok: d.ok, url: d.url ?? undefined, error: d.error ?? undefined });
              if (d.ok && d.url) {
                const url = d.url;
                toast.act("The fix is up as a pull request", "Open it", () => safeOpenUrl(url));
              } else if (d.ok) toast.done("The fix is in your clone");
              else if (d.path && d.error?.includes("uncommitted changes"))
                toast.act(
                  "Review local changes first",
                  "Open changes",
                  () =>
                    void navigate({
                      to: "/local/$id",
                      params: { id: toLocalId(d.path ?? "") },
                    }),
                  "The AI fix did not touch your files.",
                );
              else toast.fail("The fix didn’t land", d.error ?? undefined);
            }),
          ),
        ],
        { concurrency: "unbounded" },
      );
    });
    const fiber = runtime.runFork(program);
    return () => {
      void runtime.runPromise(Fiber.interrupt(fiber));
    };
  }, [qc, navigate, watched]);
}

/** The webview's own context menu stays only where text is typed; everywhere else it is noise. */
function useNativeChrome() {
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);
}

/** ⌘1–6 views, ⌘, settings; the rest goes to the screen's scope. */
function useGlobalKeys() {
  const navigate = useNavigate();
  useEffect(() => {
    const views = ["home", "inbox", "prs", "mentions", "health", "local"] as const;
    // `g` then a letter: the view by its name. Half a chord dies after a second.
    const GO: Record<string, string> = {
      h: "/",
      i: "/inbox",
      p: "/prs",
      m: "/mentions",
      a: "/health",
      t: "/turbo",
      v: "/spec-lens",
      x: "/merge-lab",
      l: "/local",
      y: "/history",
      s: "/settings",
    };
    let pendingG = 0;
    const onKey = (e: KeyboardEvent) => {
      const c = chord(e);
      if (/^mod\+[1-6]$/.test(c)) {
        e.preventDefault();
        void navigate({ to: VIEW_PATHS[views[Number(c.slice(-1)) - 1]] });
        return;
      }
      if (c === "mod+=" || c === "mod++" || c === "mod+-" || c === "mod+0") {
        e.preventDefault();
        if (c === "mod+0") zoomReset();
        else zoomBy(c === "mod+-" ? -1 : 1);
        return;
      }
      if (c === "mod+,") {
        e.preventDefault();
        void navigate({ to: "/settings" });
        return;
      }
      if (c === "mod+k") {
        e.preventDefault();
        overlays.set({ palette: !overlays.get().palette, keys: false });
        return;
      }
      if (isTyping(e.target) && e.key !== "Escape") return;
      if (e.key === "?" && !overlays.get().palette) {
        e.preventDefault();
        overlays.set({ keys: !overlays.get().keys });
        return;
      }
      if (overlays.get().palette || overlays.get().keys) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (pendingG && Date.now() - pendingG < 1000 && GO[e.key]) {
          pendingG = 0;
          e.preventDefault();
          void navigate({ to: GO[e.key] });
          return;
        }
        if (e.key === "g") {
          pendingG = Date.now();
          return;
        }
        pendingG = 0;
      }
      if (dispatchScopes(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
}
