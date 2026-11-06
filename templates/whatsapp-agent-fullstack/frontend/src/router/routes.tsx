import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';
import Layout from '@/components/layout';
import { sections } from '@/app/sections';
import LoginPage from '@/features/auth/LoginPage';
import AuthCallbackPage from '@/features/auth/AuthCallbackPage';
import HomePage from '@/features/home/HomePage';
import { AppError } from '@/components/AppError';
import { SectionPending } from '@/components/SectionPending';
import NotFoundPage from '@/components/NotFoundPage';
import { requireAdmin, requireAuth, requireDeveloper } from './guards';

const rootRoute = createRootRoute({
  notFoundComponent: () => <NotFoundPage />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

// Cognito sends the browser back here after Microsoft or Google sign-in.
const authCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/callback',
  component: AuthCallbackPage,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: Layout,
  beforeLoad: requireAuth,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: HomePage,
});

// One route per discovered section. Adding a section is creating its folder;
// removing one is deleting it. Neither touches this file.
// A section's extra pages (`routes`) are siblings with the same guard.
const sectionRoutes = sections.flatMap(section =>
  [{ path: section.path, load: section.load }, ...(section.routes ?? [])].map(page =>
    createRoute({
      getParentRoute: () => appRoute,
      path: page.path,
      component: lazyRouteComponent(page.load),
      beforeLoad: section.requiresDeveloper
        ? requireDeveloper
        : section.requiresAdmin
          ? requireAdmin
          : requireAuth,
    })
  )
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  authCallbackRoute,
  appRoute.addChildren([homeRoute, ...sectionRoutes]),
]);

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => <NotFoundPage />,
  // Covers every route at once. Without it an uncaught render or loader error
  // unmounts the tree and leaves a blank page - and since section pages are
  // loaded lazily, a stale chunk after a deploy lands here too.
  defaultErrorComponent: AppError,
  // Section pages arrive in their own chunk, so there is a moment with nothing
  // to render. Declaring this also switches each match to a real Suspense
  // wrapper rather than relying on implicit router behaviour.
  defaultPendingComponent: SectionPending,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
