import { authHeaders } from '@/lib/auth/session';
import { parseJsonBody } from '@/lib/apiFetch';
import type {
  AgentConfig,
  AgentConfigState,
  AgentDraft,
  AgentVersion,
  AgentVersions,
  ModelOption,
} from './types';
import { normalizeConfig } from './types';

/** The session expired: the page sends the user to sign in again. */
export class AgentConfigAuthError extends Error {}

/** Someone else saved or published meanwhile: reload before going on. */
export class AgentConfigConflictError extends Error {}

const API_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const BASE_URL = `${API_URL}/admin/agent/config`;

/** The backend's error codes, in the words of this screen. */
const MESSAGES: Record<string, string> = {
  MISSING_VARIABLE: 'Hay variables {{...}} sin valor: complétalas en la pestaña Parámetros.',
  MODEL_UNAVAILABLE:
    'Ese modelo no está habilitado en la cuenta de AWS. Habilítalo en Bedrock o elige otro.',
  TOO_LONG: 'Las instrucciones son demasiado largas. Acórtalas un poco.',
  NOT_APPLIED: 'La versión se guardó pero no se aplicó al agente. Publica de nuevo.',
};

async function request<T>(
  path: string,
  init: RequestInit,
  fallback: string,
  url = BASE_URL
): Promise<T | null> {
  const response = await fetch(`${url}${path}`, { ...init, headers: await authHeaders() });
  if (response.status === 401) {
    throw new AgentConfigAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  const body = await parseJsonBody<{ data?: T; error?: { message?: string; code?: string } }>(
    response
  );
  if (response.status === 409) {
    throw new AgentConfigConflictError(
      'Otra persona cambió la configuración mientras editabas. Recarga para ver su versión.'
    );
  }
  if (response.status === 403) {
    throw new Error('Tu perfil no permite hacer esto.');
  }
  if (!response.ok) {
    const code = body?.error?.code ?? '';
    throw new Error(MESSAGES[code] || body?.error?.message || `${fallback} (${response.status}).`);
  }
  return body?.data ?? null;
}

export async function fetchAgentConfig(): Promise<AgentConfigState> {
  const data = await request<AgentConfigState>(
    '',
    { method: 'GET' },
    'No se pudo cargar la configuración'
  );
  if (!data) throw new Error('No se pudo cargar la configuración.');
  return {
    ...data,
    published: { ...data.published, config: normalizeConfig(data.published?.config) },
    draft: data.draft ? { ...data.draft, config: normalizeConfig(data.draft.config) } : null,
    liveMatches: data.liveMatches ?? true,
    consoleDraft: data.consoleDraft
      ? {
          instructions: data.consoleDraft.instructions,
          model: normalizeConfig({ model: data.consoleDraft.model }).model,
        }
      : null,
    bedrockPrompt: data.bedrockPrompt ?? null,
  };
}

export async function saveDraft(config: AgentConfig, revision?: number): Promise<AgentDraft> {
  const data = await request<AgentDraft>(
    '/draft',
    { method: 'PUT', body: JSON.stringify({ config, revision }) },
    'No se pudo guardar el borrador'
  );
  if (!data) throw new Error('No se pudo guardar el borrador.');
  return { ...data, config: normalizeConfig(data.config) };
}

export async function discardDraft(): Promise<void> {
  await request('/draft', { method: 'DELETE' }, 'No se pudo descartar el borrador');
}

export async function publishDraft(comment: string, revision: number): Promise<AgentVersion> {
  const data = await request<AgentVersion>(
    '/publish',
    { method: 'POST', body: JSON.stringify({ comment, revision }) },
    'No se pudo publicar'
  );
  if (!data) throw new Error('No se pudo publicar.');
  return data;
}

export async function fetchVersions(): Promise<AgentVersions> {
  const data = await request<AgentVersions | AgentVersions['versions']>(
    '/versions',
    { method: 'GET' },
    'No se pudo cargar el historial'
  );
  // The API from before Bedrock answered with the bare list.
  if (Array.isArray(data)) return { versions: data, consoleVersions: [] };
  return { versions: data?.versions ?? [], consoleVersions: data?.consoleVersions ?? [] };
}

/** Makes a version created in the AWS console the one the agent uses. */
export async function adoptConsoleVersion(bedrockVersion: string): Promise<AgentVersion> {
  const data = await request<AgentVersion>(
    '/adopt',
    { method: 'POST', body: JSON.stringify({ bedrockVersion }) },
    'No se pudo usar la versión'
  );
  if (!data) throw new Error('No se pudo usar la versión.');
  return data;
}

export async function fetchModels(): Promise<ModelOption[]> {
  return (
    (await request<ModelOption[]>(
      '/admin/agent/models',
      { method: 'GET' },
      'No se pudo cargar la lista de modelos',
      API_URL
    )) ?? []
  );
}

export async function fetchVersion(version: string): Promise<AgentVersion> {
  const data = await request<AgentVersion>(
    `/versions/${encodeURIComponent(version)}`,
    { method: 'GET' },
    'No se pudo cargar la versión'
  );
  if (!data) throw new Error('No se pudo cargar la versión.');
  return { ...data, config: normalizeConfig(data.config) };
}

export async function rollbackTo(version: string, comment: string): Promise<AgentVersion> {
  const data = await request<AgentVersion>(
    '/rollback',
    { method: 'POST', body: JSON.stringify({ version, comment }) },
    'No se pudo restaurar la versión'
  );
  if (!data) throw new Error('No se pudo restaurar la versión.');
  return data;
}
