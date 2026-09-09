import { AppLayout, ChatWindowLayout } from "@/app/layout";
import { CrashFallback } from "@/components/error-boundary";
import { HomePage } from "@/routes/home";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** The detached AI-chat window (label `chat-*`) gets a bare layout; every other
 *  window is the main app shell. Resolved once from the window label, which is
 *  fixed for a window's lifetime. */
function RootLayout() {
  let bare = false;
  try {
    bare = getCurrentWindow().label.startsWith("chat-");
  } catch {
    bare = false;
  }
  const Layout = bare ? ChatWindowLayout : AppLayout;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  // A render crash inside any route shows the in-app "Something went wrong"
  // fallback (with a Reload) instead of leaving a blank window.
  errorComponent: ({ error, reset }) => <CrashFallback error={error} onReload={reset} />,
});

// The dashboard is the entry route, so keep it eager. Every other route is
// code-split — the heavy pr-detail bundle (diff viewer, markdown, Prism, guided
// tour) no longer ships in the initial chunk.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  component: lazyRouteComponent(() => import("@/routes/onboarding"), "OnboardingPage"),
});

const prsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prs",
  component: lazyRouteComponent(() => import("@/routes/prs"), "PRsPage"),
});

const prDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/prs/$owner/$repo/$number",
  component: lazyRouteComponent(() => import("@/routes/pr-detail"), "PRDetailPage"),
});

const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notifications",
  component: lazyRouteComponent(() => import("@/routes/notifications"), "NotificationsPage"),
});

const turborepoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/turborepo",
  component: lazyRouteComponent(() => import("@/routes/turborepo"), "TurborepoPage"),
});

const dependabotRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dependabot",
  component: lazyRouteComponent(() => import("@/routes/dependabot"), "DependabotPage"),
});

const reposRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos",
  component: lazyRouteComponent(() => import("@/routes/repos"), "ReposPage"),
});

const repoDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos/$owner/$repo",
  component: lazyRouteComponent(() => import("@/routes/repo-detail"), "RepoDetailPage"),
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: lazyRouteComponent(() => import("@/routes/settings"), "SettingsPage"),
});

// Loaded only in a detached chat window (see RootLayout / the pop-out button).
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat/$owner/$repo/$number",
  component: lazyRouteComponent(() => import("@/routes/chat"), "ChatWindowPage"),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  prsRoute,
  prDetailRoute,
  reposRoute,
  repoDetailRoute,
  notificationsRoute,
  dependabotRoute,
  turborepoRoute,
  settingsRoute,
  chatRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
