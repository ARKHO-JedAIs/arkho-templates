import { create } from 'zustand';
import type { AppSection } from '@/app/sections';
import { parseJsonBody } from '@/lib/apiFetch';
import { authHeaders, isMockAuth } from '@/lib/auth/session';
import useAuthStore, { selectIsAdmin, selectIsDeveloper } from '@/lib/stores/useAuthStore';

/** What the signed-in user may see (`menu`: page ids) and do (`actions`), as GET /me/permissions returns it. */
export interface Permissions {
  roles: string[];
  menu: string[];
  actions: string[];
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface PermissionsState {
  permissions: Permissions | null;
  status: Status;
  /** Whose permissions these are, so another sign-in never reuses them. */
  owner: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

const API_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

// Mock mode has no backend: the same defaults the seed writes, so the demo shows what a real deploy would.
const MOCK_ACTIONS: Record<string, string[]> = {
  developer: ['agent.edit', 'agent.publish', 'agent.settings', 'access.manage'],
  admin: ['access.manage'],
  member: [],
};

const MOCK_MENU: Record<string, string[]> = {
  developer: ['dashboard', 'whatsapp', 'templates', 'users', 'agent', 'voice', 'access'],
  admin: ['dashboard', 'whatsapp', 'templates', 'users', 'voice', 'access'],
  member: ['whatsapp'],
};

function mockPermissions(groups: string[]): Permissions {
  const roles = groups.filter(group => !group.includes('_'));
  const effective = roles.length > 0 ? roles : ['member'];
  const menu = [...new Set(effective.flatMap(role => MOCK_MENU[role] ?? []))];
  const actions = [...new Set(effective.flatMap(role => MOCK_ACTIONS[role] ?? []))];
  return { roles: effective, menu, actions };
}

async function fetchPermissions(groups: string[]): Promise<Permissions> {
  if (isMockAuth) return mockPermissions(groups);
  const response = await fetch(`${API_URL}/me/permissions`, {
    method: 'GET',
    headers: await authHeaders(),
  });
  const body = await parseJsonBody<{ data?: Permissions }>(response);
  if (!response.ok || !body?.data) {
    throw new Error(`Could not read the permissions (${response.status})`);
  }
  return body.data;
}

function ownerOf(): string | null {
  const user = useAuthStore.getState().user;
  return user ? (user.email ?? user.username) : null;
}

let inFlight: Promise<void> | null = null;

export const usePermissionsStore = create<PermissionsState>()((set, get) => ({
  permissions: null,
  status: 'idle',
  owner: null,

  load: async () => {
    const owner = ownerOf();
    const state = get();
    if (state.status === 'ready' && state.owner === owner) return;
    if (inFlight && state.status === 'loading' && state.owner === owner) return inFlight;

    set({
      status: 'loading',
      owner,
      permissions: state.owner === owner ? state.permissions : null,
    });
    const run = (async () => {
      try {
        const permissions = await fetchPermissions(useAuthStore.getState().user?.groups ?? []);
        if (get().owner === owner) set({ permissions, status: 'ready' });
      } catch {
        if (get().owner === owner) set({ permissions: null, status: 'error' });
      } finally {
        inFlight = null;
      }
    })();
    inFlight = run;
    return run;
  },

  reset: () => {
    inFlight = null;
    set({ permissions: null, status: 'idle', owner: null });
  },
}));

/**
 * Whether the user may open a section.
 *
 * A section with a `menu` id follows the role's permissions. When they could
 * not be read (or the section declares none) it falls back to the admin and
 * developer flags, which only ever narrow access. The backend checks every call
 * again, so this only decides what is shown.
 */
export function isSectionAllowed(
  section: Pick<AppSection, 'menu' | 'requiresAdmin' | 'requiresDeveloper'>,
  permissions: Permissions | null,
  flags: { isAdmin: boolean; isDeveloper: boolean }
): boolean {
  if (section.menu && permissions) return permissions.menu.includes(section.menu);
  if (section.requiresDeveloper) return flags.isDeveloper;
  if (section.requiresAdmin) return flags.isAdmin;
  return true;
}

/** Non-reactive read for route guards, which run outside React. */
export function isSectionAllowedNow(section: AppSection): boolean {
  const auth = useAuthStore.getState();
  return isSectionAllowed(section, usePermissionsStore.getState().permissions, {
    isAdmin: selectIsAdmin(auth),
    isDeveloper: selectIsDeveloper(auth),
  });
}

/** Whether the user holds a page or action id. False until the permissions load. */
export function useCan(permission: string): boolean {
  return usePermissionsStore(state => {
    const permissions = state.permissions;
    return permissions
      ? permissions.menu.includes(permission) || permissions.actions.includes(permission)
      : false;
  });
}
