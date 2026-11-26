import { fetchOrFail, friendlyError, type ApiErrorBody } from '@/lib/apiErrors';
import { authHeaders, isMockAuth } from '@/lib/auth/session';
import { parseJsonBody } from '@/lib/apiFetch';
import type { VoiceSettings, VoiceState } from './types';

/** The session expired: the page sends the user to sign in again. */
export class VoiceAuthError extends Error {}

const API_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const BASE_URL = `${API_URL}/whatsapp/voice`;

type Choice = Pick<
  VoiceSettings,
  'provider' | 'replyWithAudio' | 'voiceId' | 'engine' | 'transcribeLanguage'
>;

// Mock mode has no backend: the defaults the deploy seeds, kept in memory.
let mockState: VoiceState = {
  settings: {
    provider: 'polly',
    replyWithAudio: 'voice_notes',
    voiceId: 'Lupe',
    engine: 'neural',
    transcribeLanguage: 'es-US',
  },
  voices: [
    {
      id: 'Lupe',
      name: 'Lupe',
      gender: 'Female',
      languageCode: 'es-US',
      languageName: 'Español (EE.UU.)',
      engines: ['neural', 'generative', 'standard'],
    },
    {
      id: 'Pedro',
      name: 'Pedro',
      gender: 'Male',
      languageCode: 'es-US',
      languageName: 'Español (EE.UU.)',
      engines: ['neural'],
    },
  ],
  languages: [
    { code: 'es-US', label: 'Español latino (es-US)' },
    { code: 'es-ES', label: 'Español de España (es-ES)' },
  ],
};

async function request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetchOrFail(`${BASE_URL}${path}`, {
    ...init,
    headers: await authHeaders(),
  });
  if (response.status === 401) {
    throw new VoiceAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  if (response.status === 403) {
    throw new Error('Tu perfil no permite cambiar la voz.');
  }
  const body = await parseJsonBody<{ data?: T } & ApiErrorBody>(response);
  if (!response.ok || !body?.data) {
    throw new Error(friendlyError(response.status, body, fallback));
  }
  return body.data;
}

export async function fetchVoice(): Promise<VoiceState> {
  if (isMockAuth) return structuredClone(mockState);
  return request<VoiceState>('', { method: 'GET' }, 'No se pudo leer la configuración de voz');
}

export async function saveVoice(settings: Choice): Promise<VoiceState> {
  if (isMockAuth) {
    mockState = { ...mockState, settings: { ...mockState.settings, ...settings } };
    return structuredClone(mockState);
  }
  return request<VoiceState>(
    '',
    { method: 'PUT', body: JSON.stringify(settings) },
    'No se pudo guardar la voz'
  );
}

/** An MP3 sample of the voice, ready for an <audio> element. */
export async function previewVoice(voiceId: string, engine: string): Promise<string> {
  if (isMockAuth) throw new Error('La muestra de voz no está disponible en el modo demo.');
  const data = await request<{ audio: string; mimeType: string }>(
    '/preview',
    { method: 'POST', body: JSON.stringify({ voiceId, engine }) },
    'No se pudo generar la muestra'
  );
  return `data:${data.mimeType};base64,${data.audio}`;
}
