import { parseJsonBody } from '@/lib/apiFetch';
import { authHeaders, isMockAuth } from '@/lib/auth/session';
import type {
  ChatMessage,
  ControlMode,
  Conversation,
  SendTemplateInput,
  WhatsAppTemplate,
} from '../types';
import { toChatMessage, toConversation, toTemplate } from './mappers';
import { mockWhatsApp } from './mockWhatsApp';

/** Thrown when the backend rejects the request because the session expired. */
export class WhatsAppAuthError extends Error {}

/**
 * The WhatsApp API of the backend (`lib/stack/whatsapp`), or the in-memory demo.
 *
 * Under mock auth there is no token the API would accept, so the section runs
 * on demo data instead: every screen can be tried with no backend at all.
 */
export const usingDemoData = isMockAuth;

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

async function request<T>(path: string, init: RequestInit = {}, failure: string): Promise<T> {
  if (!BASE_URL) throw new Error('VITE_API_BASE_URL no está configurada.');
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers: await authHeaders() });
  if (response.status === 401) {
    throw new WhatsAppAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  const body = await parseJsonBody<{ data?: T; error?: { message?: string } }>(response);
  if (!response.ok || !body) {
    throw new Error(body?.error?.message || `${failure} (${response.status}).`);
  }
  return body.data as T;
}

export async function fetchConversations(): Promise<Conversation[]> {
  if (usingDemoData) return mockWhatsApp.conversations();
  const data = await request<unknown[]>(
    '/whatsapp/conversations',
    { method: 'GET' },
    'No se pudieron cargar las conversaciones'
  );
  return (data ?? []).flatMap(item => toConversation(item) ?? []);
}

export async function fetchMessages(phone: string, before?: string): Promise<ChatMessage[]> {
  if (usingDemoData) return mockWhatsApp.messages(phone, before);
  const query = new URLSearchParams(before ? { phone, before } : { phone });
  const data = await request<{ messages?: unknown[] }>(
    `/whatsapp/messages?${query.toString()}`,
    { method: 'GET' },
    'No se pudo cargar la conversación'
  );
  return (data?.messages ?? []).flatMap(item => toChatMessage(item) ?? []);
}

export async function sendMessage(phone: string, message: string): Promise<ChatMessage | null> {
  if (usingDemoData) return mockWhatsApp.send(phone, message);
  const data = await request<unknown>(
    '/whatsapp/messages',
    { method: 'POST', body: JSON.stringify({ phone, message }) },
    'No se pudo enviar el mensaje'
  );
  return toChatMessage(data);
}

/**
 * Every template of the account, whatever its review status: the templates page
 * shows them all, and the send dialog keeps the approved ones (`isSendable`).
 */
export async function fetchTemplates(): Promise<WhatsAppTemplate[]> {
  const data = usingDemoData
    ? await mockWhatsApp.templates()
    : await request<unknown[]>(
        '/whatsapp/templates',
        { method: 'GET' },
        'No se pudieron cargar las plantillas'
      );
  return (data ?? []).flatMap(item => toTemplate(item) ?? []);
}

export async function sendTemplate(input: SendTemplateInput): Promise<ChatMessage | null> {
  if (usingDemoData) return mockWhatsApp.sendTemplate(input);
  const data = await request<unknown>(
    '/whatsapp/templates/send',
    {
      method: 'POST',
      body: JSON.stringify({
        phone: input.phone,
        template_name: input.templateName,
        language: input.language,
        parameters: input.parameters,
      }),
    },
    'No se pudo enviar la plantilla'
  );
  return toChatMessage(data);
}

export async function setControl(phone: string, mode: ControlMode): Promise<Conversation | null> {
  if (usingDemoData) return mockWhatsApp.setControl(phone, mode);
  const data = await request<unknown>(
    '/whatsapp/control',
    { method: 'PUT', body: JSON.stringify({ phone, mode }) },
    'No se pudo cambiar quién responde'
  );
  return toConversation(data);
}
