import { AppLayout } from "@/app/layout";
import { CrashFallback } from "@/components/error-boundary";
import { DashboardPage } from "@/routes/dashboard";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from "@tanstack/react-router";

const rootRoute = createRootRoute({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
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
  component: DashboardPage,
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

const routeTree = rootRoute.addChildren([
  indexRoute,
  onboardingRoute,
  prsRoute,
  prDetailRoute,
  reposRoute,
  repoDetailRoute,
  notificationsRoute,
  dependabotRoute,
  settingsRoute,
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
