import { authHeaders } from '@/lib/auth/session';
import { parseJsonBody } from '@/lib/apiFetch';
import type { CreateUserInput, ManagedUser, UpdateUserInput } from '../types/user.types';

/** Thrown when the backend rejects the request because the session/token expired. */
export class UsersAuthError extends Error {}

const BASE_URL = `${import.meta.env.VITE_API_BASE_URL}${import.meta.env.VITE_USERS_API_PATH ?? '/admin/users'}`;

async function parseErrorMessage(response: Response, fallback: string): Promise<never> {
  if (response.status === 401) {
    throw new UsersAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  const body = await parseJsonBody<{ error?: { message?: string } }>(response);
  throw new Error(body?.error?.message || `${fallback} (${response.status}).`);
}

export async function fetchUsers(): Promise<ManagedUser[]> {
  const response = await fetch(BASE_URL, { method: 'GET', headers: await authHeaders() });
  if (!response.ok) {
    await parseErrorMessage(response, 'No se pudieron cargar los usuarios');
  }
  const body = await parseJsonBody<{ data?: ManagedUser[] }>(response);
  if (!body) {
    throw new Error('No se pudieron cargar los usuarios.');
  }
  return body.data ?? [];
}

export async function createUser(input: CreateUserInput): Promise<ManagedUser> {
  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await parseErrorMessage(response, 'No se pudo crear el usuario');
  }
  const body = await parseJsonBody<{ data?: ManagedUser }>(response);
  if (!body?.data) {
    throw new Error('No se pudo crear el usuario.');
  }
  return body.data;
}

export async function updateUser(username: string, input: UpdateUserInput): Promise<void> {
  const response = await fetch(`${BASE_URL}/${encodeURIComponent(username)}`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    await parseErrorMessage(response, 'No se pudo actualizar el usuario');
  }
}

export async function updateUserStatus(username: string, enabled: boolean): Promise<void> {
  const response = await fetch(`${BASE_URL}/${encodeURIComponent(username)}/status`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    await parseErrorMessage(response, 'No se pudo actualizar el estado del usuario');
  }
}

export async function resetUserPassword(username: string): Promise<string> {
  const response = await fetch(`${BASE_URL}/${encodeURIComponent(username)}/password`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!response.ok) {
    await parseErrorMessage(response, 'No se pudo restablecer la contraseña');
  }
  const body = await parseJsonBody<{ data?: { temporaryPassword?: string } }>(response);
  if (!body?.data?.temporaryPassword) {
    throw new Error('No se pudo restablecer la contraseña.');
  }
  return body.data.temporaryPassword;
}

export async function deleteUser(username: string): Promise<void> {
  const response = await fetch(`${BASE_URL}/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!response.ok) {
    await parseErrorMessage(response, 'No se pudo eliminar el usuario');
  }
}
