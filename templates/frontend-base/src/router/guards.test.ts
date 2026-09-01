import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import type { AuthUser } from '@/lib/auth/session';

// Mocked so importing the guards never pulls aws-amplify into jsdom.
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
}));

const { default: useAuthStore } = await import('@/lib/stores/useAuthStore');
const { requireAdmin, requireAuth } = await import('@/router/guards');

const admin: AuthUser = { username: 'ada', groups: ['admin'] };
const member: AuthUser = { username: 'bob', groups: ['member'] };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({ user: null, loading: false });
});

describe('requireAuth', () => {
  it('redirects when there is no session', async () => {
    await expect(requireAuth()).rejects.toSatisfy(isRedirect);
  });

  it('resolves with the user when there is a session', async () => {
    useAuthStore.setState({ user: admin });
    await expect(requireAuth()).resolves.toEqual({ user: admin });
  });
});

describe('requireAdmin', () => {
  it('redirects a signed-in user who is not an admin', async () => {
    useAuthStore.setState({ user: member });
    await expect(requireAdmin()).rejects.toSatisfy(isRedirect);
  });

  // The composition property: because requireAuth *throws* rather than returning
  // a redirect descriptor, requireAdmin can never mistake one for a real user.
  it('resolves for an admin', async () => {
    useAuthStore.setState({ user: admin });
    await expect(requireAdmin()).resolves.toEqual({ user: admin });
  });

  it('redirects when there is no session at all', async () => {
    await expect(requireAdmin()).rejects.toSatisfy(isRedirect);
  });
});
