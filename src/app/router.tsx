import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";

import { Shell } from "@/app/shell";
import { prefsStore } from "@/effect/services/Prefs";
import { APP_STORE } from "@/lib/edition";
import { InboxScreen } from "@/screens/inbox";

const root = createRootRoute({ component: Shell });

/** Screens that read a local repository; the sandboxed App Store edition sends them home. */
const localOnly = () => {
  if (APP_STORE) throw redirect({ to: "/" });
};

const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: lazyRouteComponent(() => import("@/screens/home"), "HomeScreen"),
});
const inbox = createRoute({
  getParentRoute: () => root,
  path: "/inbox",
  component: InboxScreen,
});
const fastLane = createRoute({
  getParentRoute: () => root,
  path: "/fast-lane",
  component: lazyRouteComponent(() => import("@/screens/fast-lane"), "FastLaneScreen"),
});
const prs = createRoute({
  getParentRoute: () => root,
  path: "/prs",
  component: lazyRouteComponent(() => import("@/screens/prs"), "PrsScreen"),
});
const team = createRoute({
  getParentRoute: () => root,
  path: "/team",
  component: lazyRouteComponent(() => import("@/screens/team"), "TeamScreen"),
});
const mentions = createRoute({
  getParentRoute: () => root,
  path: "/mentions",
  component: lazyRouteComponent(() => import("@/screens/mentions"), "MentionsScreen"),
});
const health = createRoute({
  getParentRoute: () => root,
  path: "/health",
  component: lazyRouteComponent(() => import("@/screens/health"), "HealthScreen"),
});
const turbo = createRoute({
  getParentRoute: () => root,
  path: "/turbo",
  beforeLoad: localOnly,
  component: lazyRouteComponent(() => import("@/screens/turbo"), "TurboScreen"),
});
const specLens = createRoute({
  getParentRoute: () => root,
  path: "/spec-lens",
  beforeLoad: localOnly,
  component: lazyRouteComponent(() => import("@/screens/spec-lens"), "SpecLensScreen"),
});
const mergeLab = createRoute({
  getParentRoute: () => root,
  path: "/merge-lab",
  component: lazyRouteComponent(() => import("@/screens/merge-lab"), "MergeLabScreen"),
});
const history = createRoute({
  getParentRoute: () => root,
  path: "/history",
  component: lazyRouteComponent(() => import("@/screens/history"), "HistoryScreen"),
});
const environments = createRoute({
  getParentRoute: () => root,
  path: "/environments",
  component: lazyRouteComponent(() => import("@/screens/environments"), "EnvironmentsScreen"),
});
const local = createRoute({
  getParentRoute: () => root,
  path: "/local",
  beforeLoad: localOnly,
  component: lazyRouteComponent(() => import("@/screens/local"), "LocalScreen"),
});
const localRepo = createRoute({
  getParentRoute: () => root,
  path: "/local/$id",
  beforeLoad: localOnly,
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    file?: string;
    line?: number;
    from?: "spec-lens" | "living-architecture";
  } => {
    const parsed: {
      file?: string;
      line?: number;
      from?: "spec-lens" | "living-architecture";
    } = {};
    if (typeof search.file === "string") parsed.file = search.file;
    if (typeof search.line === "number") parsed.line = search.line;
    if (search.from === "spec-lens" || search.from === "living-architecture") {
      parsed.from = search.from;
    }
    return parsed;
  },
  component: lazyRouteComponent(() => import("@/screens/local-repo"), "LocalRepoScreen"),
});
const settings = createRoute({
  getParentRoute: () => root,
  path: "/settings",
  component: lazyRouteComponent(() => import("@/screens/settings"), "SettingsScreen"),
});
const firstRun = createRoute({
  getParentRoute: () => root,
  path: "/first-run",
  component: lazyRouteComponent(() => import("@/screens/first-run"), "FirstRunScreen"),
});
const pr = createRoute({
  getParentRoute: () => root,
  path: "/pr/$owner/$repo/$number",
  component: lazyRouteComponent(() => import("@/screens/pr"), "PrScreen"),
});
const chat = createRoute({
  getParentRoute: () => root,
  path: "/chat/$owner/$repo/$number",
  component: lazyRouteComponent(() => import("@/screens/chat-window"), "ChatWindowScreen"),
});

const routeTree = root.addChildren([
  home,
  inbox,
  fastLane,
  prs,
  team,
  mentions,
  health,
  turbo,
  specLens,
  mergeLab,
  history,
  environments,
  local,
  localRepo,
  settings,
  firstRun,
  pr,
  chat,
]);

/** A window opened at /chat/… is the detached Ask window: bare, no rail, no title bar. */
export const isChatWindow =
  typeof window !== "undefined" && window.location.pathname.startsWith("/chat/");

/** In-memory history: a desktop window has no address bar and no reload-to-restore. */
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({
    initialEntries: [
      isChatWindow
        ? window.location.pathname
        : import.meta.env.DEV && window.location.pathname !== "/"
          ? window.location.pathname
          : prefsStore.get().landing === "home"
            ? "/"
            : "/inbox",
    ],
  }),
  defaultPreload: "intent",
});

if (import.meta.env.DEV) (window as unknown as { __router: typeof router }).__router = router;

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export type ListView = "inbox" | "prs" | "mentions" | "health" | "local";
export const VIEW_PATHS: Record<
  ListView | "home" | "history" | "environments" | "settings" | "team" | "fastLane",
  string
> = {
  home: "/",
  inbox: "/inbox",
  fastLane: "/fast-lane",
  prs: "/prs",
  team: "/team",
  mentions: "/mentions",
  health: "/health",
  local: "/local",
  history: "/history",
  environments: "/environments",
  settings: "/settings",
};
