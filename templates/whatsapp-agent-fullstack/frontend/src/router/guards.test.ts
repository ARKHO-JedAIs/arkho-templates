import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isRedirect } from '@tanstack/react-router';
import type { AuthUser } from '@/lib/auth/session';

// Mocked so importing the guards never pulls aws-amplify into jsdom.
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
}));

const { default: useAuthStore } = await import('@/lib/stores/useAuthStore');
const { requireAdmin, requireAuth, requireSection } = await import('@/router/guards');
const { usePermissionsStore } = await import('@/lib/access/permissions');

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

describe('requireSection', () => {
  const templates = {
    path: '/settings/templates',
    label: 'Plantillas',
    icon: () => null,
    load: async () => ({ default: () => null }),
    menu: 'templates',
    requiresAdmin: true,
  };
  const ready = (menu: string[]) =>
    usePermissionsStore.setState({
      permissions: { roles: ['supervisor'], menu, actions: [] },
      status: 'ready',
      owner: 'bob',
    });

  it('lets a non-admin role in when its permissions include the page', async () => {
    useAuthStore.setState({ user: member });
    ready(['whatsapp', 'templates']);
    await expect(requireSection(templates)()).resolves.toEqual({ user: member });
  });

  it('redirects a role whose permissions lack the page, even an admin', async () => {
    useAuthStore.setState({ user: admin });
    usePermissionsStore.setState({
      permissions: { roles: ['admin'], menu: ['whatsapp'], actions: [] },
      status: 'ready',
      owner: 'ada',
    });
    await expect(requireSection(templates)()).rejects.toSatisfy(isRedirect);
  });

  it('redirects when there is no session', async () => {
    await expect(requireSection(templates)()).rejects.toSatisfy(isRedirect);
  });
});
