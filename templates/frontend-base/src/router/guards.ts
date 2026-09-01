import { redirect } from '@tanstack/react-router';
import useAuthStore, { isAdminNow } from '@/lib/stores/useAuthStore';

/**
 * Route policy, kept apart from the route tree so it can be read - and tested -
 * without building the whole application. `routes.tsx` is then just wiring.
 *
 * Redirects are THROWN, not returned. That is the documented TanStack idiom and
 * it is what keeps the return value unambiguous: these guards either resolve to
 * a user or they never return at all, so a guard that builds on another - like
 * requireAdmin below - cannot mistake a redirect for a signed-in user.
 */

/**
 * Resolves the session once, then hands the user to the route.
 *
 * `checkAuth()` only runs when the store has no user yet, so navigating between
 * screens does not re-hit the provider on every transition.
 */
export const requireAuth = async () => {
  const { checkAuth, user } = useAuthStore.getState();
  if (!user) {
    await checkAuth();
  }
  const current = useAuthStore.getState().user;
  if (!current) {
    throw redirect({ to: '/login' });
  }
  return { user: current };
};

/** Auth, then the role check. Composes safely because requireAuth throws on failure. */
export const requireAdmin = async () => {
  const result = await requireAuth();
  if (!isAdminNow()) {
    throw redirect({ to: '/' });
  }
  return result;
};
