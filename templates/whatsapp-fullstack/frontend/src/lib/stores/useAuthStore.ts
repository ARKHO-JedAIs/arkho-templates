import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getCurrentUser, signOut as providerSignOut, type AuthUser } from '@/lib/auth/session';

/**
 * The Cognito group that grants admin screens. Configurable because group
 * naming is a per-organization convention, not something a template can assume.
 */
const ADMIN_GROUP = import.meta.env.VITE_ADMIN_GROUP ?? 'admin';

/**
 * The store holds facts only - the signed-in user and whether a check is in
 * flight. `isAuthenticated` and `isAdmin` are derived by the selectors below
 * rather than stored.
 *
 * That is a security property, not a style choice: a stored `isAdmin` gets
 * persisted to localStorage, where anyone can edit it, and the route guard
 * would then trust it. Deriving it from `user.groups` means the only way to
 * fake an admin is to fake the group claim, which the backend re-checks anyway.
 */
interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  checkAuth: () => Promise<void>;
  signOut: () => Promise<void>;
}

const useAuthStore = create<AuthState>()(
  persist(
    set => ({
      user: null,
      loading: true,

      checkAuth: async () => {
        set({ loading: true });
        try {
          const user = await getCurrentUser();
          if (!user) {
            set({ user: null, loading: false });
            return;
          }
          set(state => ({
            // groups === null means "could not read them", not "has none" -
            // keep what we already knew instead of demoting the user.
            user: { ...user, groups: user.groups ?? state.user?.groups ?? null },
            loading: false,
          }));
        } catch {
          // A failed read is not a signed-out user. Clearing the session here is
          // what used to demote a signed-in admin on a dropped connection - and
          // persist() then wrote the demotion to localStorage, where it survived
          // every reload until the next successful sign-in.
          set({ loading: false });
        }
      },

      signOut: async () => {
        await providerSignOut();
        set({ user: null, loading: false });
      },
    }),
    {
      name: 'auth-store',
      storage: createJSONStorage(() => localStorage),
      // `loading` is a per-boot concern, never restored: rehydrating it as true
      // would leave the app on a spinner that nothing resolves.
      partialize: state => ({ user: state.user }),
    }
  )
);

export const selectIsAuthenticated = (state: AuthState): boolean => state.user !== null;

export const selectIsAdmin = (state: AuthState): boolean =>
  state.user?.groups?.includes(ADMIN_GROUP) ?? false;

/** Non-reactive read for route guards, which run outside React. */
export const isAdminNow = (): boolean => selectIsAdmin(useAuthStore.getState());

export default useAuthStore;
