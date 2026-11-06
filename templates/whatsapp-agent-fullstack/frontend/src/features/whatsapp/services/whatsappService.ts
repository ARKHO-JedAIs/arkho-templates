import { parseJsonBody } from '@/lib/apiFetch';
import { authHeaders, isMockAuth } from '@/lib/auth/session';
import type {
  ChatMessage,
  ControlMode,
  Conversation,
  OutboundMedia,
  SendTemplateInput,
  TemplateRequest,
  WhatsAppTemplate,
} from '../types';
import { toChatMessage, toConversation, toTemplate } from './mappers';
import { mockWhatsApp } from './mockWhatsApp';

/** Thrown when the backend rejects the request because the session expired. */
export class WhatsAppAuthError extends Error {}

/**
 * Thrown when the backend refuses a template that breaks Meta's rules:
 * `rules` are the failing rule ids, the same the creator's checklist uses.
 */
export class TemplateRulesError extends Error {
  constructor(
    message: string,
    readonly rules: string[]
  ) {
    super(message);
  }
}

/**
 * The WhatsApp API of the backend (`lib/stack/whatsapp`), or the in-memory demo.
 *
 * Under mock auth there is no token the API would accept, so the section runs
 * on demo data instead: every screen can be tried with no backend at all.
 */
export const usingDemoData = isMockAuth;

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

interface ApiBody<T> {
  data?: T;
  error?: { message?: string; code?: string; details?: { rules?: unknown } };
}

async function request<T>(path: string, init: RequestInit = {}, failure: string): Promise<T> {
  if (!BASE_URL) throw new Error('VITE_API_BASE_URL no está configurada.');
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers: await authHeaders() });
  if (response.status === 401) {
    throw new WhatsAppAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  const body = await parseJsonBody<ApiBody<T>>(response);
  if (!response.ok || !body) {
    const message = body?.error?.message || `${failure} (${response.status}).`;
    const rules = body?.error?.details?.rules;
    if (body?.error?.code === 'TEMPLATE_INVALID' && Array.isArray(rules)) {
      throw new TemplateRulesError(message, rules.map(String));
    }
    throw new Error(message);
  }
  return body.data as T;
}

/**
 * The inbox, most recent first. With `search` (2+ characters) the backend
 * filters by contact name (case and accents ignored) or phone digits.
 */
export async function fetchConversations(search?: string): Promise<Conversation[]> {
  if (usingDemoData) return mockWhatsApp.conversations(search);
  const query = search ? `?${new URLSearchParams({ search }).toString()}` : '';
  const data = await request<unknown[]>(
    `/whatsapp/conversations${query}`,
    { method: 'GET' },
    search ? 'No se pudo buscar' : 'No se pudieron cargar las conversaciones'
  );
  return (data ?? []).flatMap(item => toConversation(item) ?? []);
}

/** Someone read the conversation: its unread counter goes back to 0. */
export async function markConversationRead(phone: string): Promise<Conversation | null> {
  if (usingDemoData) return mockWhatsApp.markRead(phone);
  const data = await request<unknown>(
    `/whatsapp/conversations/${encodeURIComponent(phone)}/read`,
    { method: 'PUT' },
    'No se pudo marcar como leída'
  );
  return toConversation(data);
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

/** The progress of an upload, from 0 to 1. */
export type UploadProgress = (fraction: number) => void;

interface UploadTicket {
  upload_url: string;
  key: string;
  headers?: Record<string, string>;
}

/** PUTs the file to its presigned URL; no auth header, the URL is the authorization. */
function putFile(
  url: string,
  file: Blob,
  headers: Record<string, string>,
  onProgress?: UploadProgress
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`No se pudo subir el archivo (${xhr.status}).`));
    xhr.onerror = () => reject(new Error('No se pudo subir el archivo: revisa tu conexión.'));
    xhr.send(file);
  });
}

/**
 * Uploads a file to the media bucket through a presigned URL (`POST
 * /whatsapp/media/upload-url`, then a PUT); the object key the other calls
 * take. `phone` is omitted for a template header sample.
 */
async function uploadFile(
  file: File,
  mimeType: string,
  phone?: string,
  onProgress?: UploadProgress
): Promise<string> {
  const ticket = await request<UploadTicket>(
    '/whatsapp/media/upload-url',
    {
      method: 'POST',
      body: JSON.stringify({
        ...(phone ? { phone } : {}),
        filename: file.name,
        mimeType,
        size: file.size,
      }),
    },
    'No se pudo preparar el envío del archivo'
  );
  await putFile(
    ticket.upload_url,
    file,
    ticket.headers ?? { 'Content-Type': mimeType },
    onProgress
  );
  return ticket.key;
}

/**
 * Sends a file: uploads it straight to the media bucket, then sends it
 * (`POST /whatsapp/messages` with `media`). Validate it with
 * `checkAttachment` first; the backend checks it again.
 */
export async function sendMedia(
  phone: string,
  file: File,
  mimeType: string,
  caption: string,
  onProgress?: UploadProgress
): Promise<ChatMessage | null> {
  if (usingDemoData) return mockWhatsApp.sendMedia(phone, file, mimeType, caption, onProgress);
  const key = await uploadFile(file, mimeType, phone, onProgress);
  const media: OutboundMedia = {
    key,
    mimeType,
    filename: file.name,
    ...(caption ? { caption } : {}),
  };
  const data = await request<unknown>(
    '/whatsapp/messages',
    { method: 'POST', body: JSON.stringify({ phone, media }) },
    'No se pudo enviar el archivo'
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

/** What creating a template returns: Meta's id and where its review starts. */
export interface CreatedTemplate {
  metaTemplateId: string | null;
  status: string;
}

/** Submits a new template to Meta's review (`POST /whatsapp/templates`). */
export async function createTemplate(input: TemplateRequest): Promise<CreatedTemplate> {
  if (usingDemoData) return mockWhatsApp.createTemplate(input);
  const data = await request<{ metaTemplateId?: string; status?: string }>(
    '/whatsapp/templates',
    { method: 'POST', body: JSON.stringify(input) },
    'No se pudo crear la plantilla'
  );
  return { metaTemplateId: data?.metaTemplateId ?? null, status: data?.status ?? 'PENDING' };
}

/** Replaces a template's components; Meta reviews it again (`PUT /whatsapp/templates/{id}`). */
export async function updateTemplate(
  metaTemplateId: string,
  input: TemplateRequest
): Promise<void> {
  if (usingDemoData) return mockWhatsApp.updateTemplate(metaTemplateId, input);
  await request<unknown>(
    `/whatsapp/templates/${encodeURIComponent(metaTemplateId)}`,
    { method: 'PUT', body: JSON.stringify(input) },
    'No se pudo editar la plantilla'
  );
}

/** Deletes one language version of a template (`DELETE /whatsapp/templates`). */
export async function deleteTemplate(name: string, metaTemplateId: string | null): Promise<void> {
  if (usingDemoData) return mockWhatsApp.deleteTemplate(name, metaTemplateId);
  const query = new URLSearchParams(metaTemplateId ? { name, metaTemplateId } : { name });
  await request<unknown>(
    `/whatsapp/templates?${query.toString()}`,
    { method: 'DELETE' },
    'No se pudo eliminar la plantilla'
  );
}

/**
 * The sample file of a media header: uploaded to the bucket, then handed to
 * Meta (`POST /whatsapp/templates/media`); the handle the template refers to.
 */
export async function uploadTemplateHeader(
  file: File,
  mimeType: string,
  onProgress?: UploadProgress
): Promise<string> {
  if (usingDemoData) return mockWhatsApp.uploadTemplateHeader(file, onProgress);
  const key = await uploadFile(file, mimeType, undefined, onProgress);
  const data = await request<{ handle?: string }>(
    '/whatsapp/templates/media',
    { method: 'POST', body: JSON.stringify({ key, mimeType }) },
    'No se pudo subir el archivo de ejemplo'
  );
  if (!data?.handle) throw new Error('Meta no devolvió el archivo de ejemplo.');
  return data.handle;
}

export async function sendTemplate(input: SendTemplateInput): Promise<ChatMessage | null> {
  if (usingDemoData) return mockWhatsApp.sendTemplate(input);
  const header: Record<string, unknown> = {};
  if (input.headerText) header.text = input.headerText;
  if (input.headerFile) {
    const { file, mimeType } = input.headerFile;
    const key = await uploadFile(file, mimeType, input.phone);
    header.media = { key, mimeType, filename: file.name };
  }
  const data = await request<unknown>(
    '/whatsapp/templates/send',
    {
      method: 'POST',
      body: JSON.stringify({
        phone: input.phone,
        template_name: input.templateName,
        language: input.language,
        parameters: input.parameters,
        ...(Object.keys(header).length ? { header } : {}),
        ...(input.buttons?.length ? { buttons: input.buttons } : {}),
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
