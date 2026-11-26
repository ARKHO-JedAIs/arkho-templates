import { parseJsonBody } from '@/lib/apiFetch';
import { authHeaders, isMockAuth } from '@/lib/auth/session';
import type { AccessOverview, AccessRole, NewRoleInput, RolePermissions } from './types';

/** Thrown when the backend rejects the request because the session expired. */
export class AccessAuthError extends Error {}

const BASE_URL = `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')}/admin/access`;

async function fail(response: Response, fallback: string): Promise<never> {
  if (response.status === 401) {
    throw new AccessAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  const body = await parseJsonBody<{ error?: { message?: string } }>(response);
  throw new Error(body?.error?.message || `${fallback} (${response.status}).`);
}

// Mock mode has no backend: the same defaults the seed writes, kept in memory.
const mockOverview: AccessOverview = {
  roles: [
    {
      id: 'developer',
      name: 'Developer',
      description: 'Acceso técnico completo.',
      system: true,
      locked: true,
      permissions: {
        menu: ['dashboard', 'whatsapp', 'templates', 'users', 'agent', 'access'],
        actions: [
          'whatsapp.reply',
          'templates.manage',
          'users.manage',
          'agent.edit',
          'access.manage',
        ],
      },
    },
    {
      id: 'admin',
      name: 'Administrador',
      description: 'Gestiona usuarios, plantillas y roles.',
      system: true,
      locked: false,
      permissions: {
        menu: ['dashboard', 'whatsapp', 'templates', 'users', 'access'],
        actions: ['whatsapp.reply', 'templates.manage', 'users.manage', 'access.manage'],
      },
    },
    {
      id: 'member',
      name: 'Miembro',
      description: 'Usa la bandeja.',
      system: true,
      locked: false,
      permissions: { menu: ['whatsapp'], actions: ['whatsapp.reply'] },
    },
  ],
  menu: [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'whatsapp', label: 'Bandeja WhatsApp' },
    { id: 'templates', label: 'Plantillas' },
    { id: 'users', label: 'Usuarios' },
    { id: 'agent', label: 'Agente IA' },
    { id: 'access', label: 'Roles y permisos' },
  ],
  actions: [
    { id: 'whatsapp.reply', label: 'Responder desde la bandeja' },
    { id: 'templates.manage', label: 'Crear, editar y borrar plantillas' },
    { id: 'users.manage', label: 'Crear, editar, desactivar y resetear usuarios' },
    { id: 'agent.edit', label: 'Editar instrucciones y mensajes del agente' },
    { id: 'access.manage', label: 'Crear y editar roles y sus permisos' },
  ],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function fetchAccess(): Promise<AccessOverview> {
  if (isMockAuth) return clone(mockOverview);
  const response = await fetch(BASE_URL, { method: 'GET', headers: await authHeaders() });
  if (!response.ok) await fail(response, 'No se pudieron cargar los roles');
  const body = await parseJsonBody<{ data?: AccessOverview }>(response);
  if (!body?.data) throw new Error('No se pudieron cargar los roles.');
  return body.data;
}

export async function createRole(input: NewRoleInput): Promise<AccessRole> {
  if (isMockAuth) {
    const role: AccessRole = {
      id: input.id,
      name: input.name,
      description: input.description ?? '',
      system: false,
      locked: false,
      permissions: { menu: input.menu ?? [], actions: input.actions ?? [] },
    };
    mockOverview.roles.push(role);
    return clone(role);
  }
  const response = await fetch(`${BASE_URL}/roles`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) await fail(response, 'No se pudo crear el rol');
  const body = await parseJsonBody<{ data?: AccessRole }>(response);
  if (!body?.data) throw new Error('No se pudo crear el rol.');
  return body.data;
}

export async function updateRolePermissions(
  role: string,
  permissions: RolePermissions
): Promise<void> {
  if (isMockAuth) {
    const target = mockOverview.roles.find(item => item.id === role);
    if (target) target.permissions = clone(permissions);
    return;
  }
  const response = await fetch(`${BASE_URL}/roles/${encodeURIComponent(role)}`, {
    method: 'PUT',
    headers: await authHeaders(),
    body: JSON.stringify(permissions),
  });
  if (!response.ok) await fail(response, 'No se pudieron guardar los permisos');
}

export async function deleteRole(role: string): Promise<void> {
  if (isMockAuth) {
    mockOverview.roles = mockOverview.roles.filter(item => item.id !== role);
    return;
  }
  const response = await fetch(`${BASE_URL}/roles/${encodeURIComponent(role)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!response.ok) await fail(response, 'No se pudo eliminar el rol');
}
