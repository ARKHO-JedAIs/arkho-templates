import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@/lib/auth/session';

// Mocked so importing the store never pulls aws-amplify into jsdom.
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
  authHeaders: vi.fn(async () => ({ Authorization: 'Bearer t' })),
  isMockAuth: false,
}));

const { default: useAuthStore } = await import('@/lib/stores/useAuthStore');
const { isSectionAllowed, usePermissionsStore } = await import('./permissions');

const ana: AuthUser = { username: 'ana', email: 'ana@x.cl', groups: ['supervisor'] };

function respond(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  useAuthStore.setState({ user: ana, loading: false });
  usePermissionsStore.getState().reset();
});

describe('isSectionAllowed', () => {
  const flags = { isAdmin: false, isDeveloper: false };
  const permissions = { roles: ['supervisor'], menu: ['whatsapp', 'templates'], actions: [] };

  it('follows the role permissions when the section names a page', () => {
    expect(isSectionAllowed({ menu: 'templates', requiresAdmin: true }, permissions, flags)).toBe(
      true
    );
    expect(isSectionAllowed({ menu: 'users', requiresAdmin: true }, permissions, flags)).toBe(
      false
    );
  });

  it('lets a custom role see a page that used to be admin only', () => {
    expect(isSectionAllowed({ menu: 'templates', requiresAdmin: true }, permissions, flags)).toBe(
      true
    );
  });

  it('falls back to the admin and developer flags when the permissions are unavailable', () => {
    expect(isSectionAllowed({ menu: 'users', requiresAdmin: true }, null, flags)).toBe(false);
    expect(
      isSectionAllowed({ menu: 'users', requiresAdmin: true }, null, { ...flags, isAdmin: true })
    ).toBe(true);
    expect(
      isSectionAllowed({ menu: 'agent', requiresAdmin: true, requiresDeveloper: true }, null, {
        isAdmin: true,
        isDeveloper: false,
      })
    ).toBe(false);
  });

  it('shows a section with no restriction at all', () => {
    expect(isSectionAllowed({}, null, flags)).toBe(true);
  });
});

describe('usePermissionsStore', () => {
  it('loads /me/permissions once and keeps them for the same user', async () => {
    const fetchMock = respond({
      data: { roles: ['supervisor'], menu: ['whatsapp'], actions: ['whatsapp.reply'] },
    });
    vi.stubGlobal('fetch', fetchMock);
    await usePermissionsStore.getState().load();
    await usePermissionsStore.getState().load();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usePermissionsStore.getState().status).toBe('ready');
    expect(usePermissionsStore.getState().permissions?.menu).toEqual(['whatsapp']);
  });

  it('shares one request between concurrent loads', async () => {
    const fetchMock = respond({ data: { roles: ['member'], menu: ['whatsapp'], actions: [] } });
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([
      usePermissionsStore.getState().load(),
      usePermissionsStore.getState().load(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops the previous user permissions when another user signs in', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ data: { roles: ['admin'], menu: ['whatsapp', 'users'], actions: [] } })
    );
    await usePermissionsStore.getState().load();
    useAuthStore.setState({ user: { username: 'bob', email: 'bob@x.cl', groups: ['member'] } });
    vi.stubGlobal(
      'fetch',
      respond({ data: { roles: ['member'], menu: ['whatsapp'], actions: [] } })
    );
    const loading = usePermissionsStore.getState().load();
    expect(usePermissionsStore.getState().permissions).toBeNull();
    await loading;
    expect(usePermissionsStore.getState().permissions?.menu).toEqual(['whatsapp']);
  });

  it('reports an error without permissions when the request fails', async () => {
    vi.stubGlobal('fetch', respond({ error: { message: 'boom' } }, 500));
    await usePermissionsStore.getState().load();
    expect(usePermissionsStore.getState().status).toBe('error');
    expect(usePermissionsStore.getState().permissions).toBeNull();
  });
});
