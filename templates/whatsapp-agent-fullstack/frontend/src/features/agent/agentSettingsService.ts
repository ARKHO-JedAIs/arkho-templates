import { parseJsonBody } from '@/lib/apiFetch';
import { authHeaders, isMockAuth } from '@/lib/auth/session';

/** What the agent remembers: nothing, a clean start per message, or a window since the last message. */
export type MemoryMode = 'off' | 'each_message' | 'window';

export interface AgentSettings {
  memory: { mode: MemoryMode; minutes: number };
  rateLimit: { enabled: boolean; perHour: number };
  /** What AgentCore Memory keeps beyond a conversation, fixed when the backend was deployed. */
  longTermMemory?: string;
}

export interface AgentSettingsChanges {
  memory?: Partial<AgentSettings['memory']>;
  rateLimit?: Partial<AgentSettings['rateLimit']>;
}

/** The session expired: the page sends the user to sign in again. */
export class AgentSettingsAuthError extends Error {}

export const LIMITS = { minMinutes: 1, maxMinutes: 10080, minPerHour: 1, maxPerHour: 9999 };

const SETTINGS_URL = `${(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')}/admin/agent/settings`;

// Mock mode has no backend: the defaults the deploy seeds, kept in memory.
let mockSettings: AgentSettings = {
  memory: { mode: 'window', minutes: 60 },
  rateLimit: { enabled: true, perHour: 30 },
  longTermMemory: 'conversation',
};

async function call(init: RequestInit, fallback: string): Promise<AgentSettings> {
  const response = await fetch(SETTINGS_URL, { ...init, headers: await authHeaders() });
  if (response.status === 401) {
    throw new AgentSettingsAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  const body = await parseJsonBody<{ data?: AgentSettings; error?: { message?: string } }>(
    response
  );
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message || `${fallback} (${response.status}).`);
  }
  return body.data;
}

export async function fetchAgentSettings(): Promise<AgentSettings> {
  if (isMockAuth) return structuredClone(mockSettings);
  return call({ method: 'GET' }, 'No se pudo cargar la configuración');
}

export async function saveAgentSettings(changes: AgentSettingsChanges): Promise<AgentSettings> {
  if (isMockAuth) {
    mockSettings = {
      ...mockSettings,
      memory: { ...mockSettings.memory, ...changes.memory },
      rateLimit: { ...mockSettings.rateLimit, ...changes.rateLimit },
    };
    return structuredClone(mockSettings);
  }
  return call({ method: 'PUT', body: JSON.stringify(changes) }, 'No se pudo guardar');
}
