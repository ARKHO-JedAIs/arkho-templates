import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/lib/auth/session';

// Mocked so the store's transitive import of aws-amplify never loads under jsdom.
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
}));

const { getCurrentUser } = await import('@/lib/auth/session');
const { default: useAuthStore, selectIsAdmin } = await import('@/lib/stores/useAuthStore');

const admin: AuthUser = { username: 'ada', email: 'ada@example.com', groups: ['admin'] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ user: null, loading: false });
});

describe('selectIsAdmin', () => {
  it('grants admin when the user is in the admin group', () => {
    useAuthStore.setState({ user: admin });
    expect(selectIsAdmin(useAuthStore.getState())).toBe(true);
  });

  it('denies admin for a user with no groups', () => {
    useAuthStore.setState({ user: { ...admin, groups: [] } });
    expect(selectIsAdmin(useAuthStore.getState())).toBe(false);
  });

  // `null` means "the groups could not be read", which is not the same as "has
  // none" - but it is not proof of admin either, so it must deny without throwing.
  it('denies admin, without throwing, when groups are unknown', () => {
    useAuthStore.setState({ user: { ...admin, groups: null } });
    expect(selectIsAdmin(useAuthStore.getState())).toBe(false);
  });
});

describe('checkAuth', () => {
  // The regression this guards: collapsing an unreadable token into "no groups"
  // silently demoted a signed-in administrator, and persist() then wrote that
  // demotion to localStorage where it survived every reload.
  it('keeps the groups it already knew when the provider returns none', async () => {
    useAuthStore.setState({ user: admin });
    vi.mocked(getCurrentUser).mockResolvedValue({ ...admin, groups: null });

    await useAuthStore.getState().checkAuth();

    expect(selectIsAdmin(useAuthStore.getState())).toBe(true);
  });

  // A failed read is not a signed-out user. Clearing here is what turned a
  // dropped connection into a logout.
  it('keeps the session when the provider throws', async () => {
    useAuthStore.setState({ user: admin });
    vi.mocked(getCurrentUser).mockRejectedValue(new Error('network down'));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().user).not.toBeNull();
    expect(selectIsAdmin(useAuthStore.getState())).toBe(true);
  });

  it('clears the session when the provider reports nobody is signed in', async () => {
    useAuthStore.setState({ user: admin });
    vi.mocked(getCurrentUser).mockResolvedValue(null);

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState().user).toBeNull();
  });
});
