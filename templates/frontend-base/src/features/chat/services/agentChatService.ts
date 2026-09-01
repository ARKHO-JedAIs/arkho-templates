import { getIdToken } from '@/lib/auth/session';
import { chatConfig } from '../chatConfig';
import type { AgentChatStreamEvent } from '../types/chat.types';

/** Thrown when the backend rejects the request because the session/token expired. */
export class AgentChatAuthError extends Error {}

interface StreamAgentChatParams {
  message: string;
  sessionId: string;
  imageKeys?: string[];
  signal?: AbortSignal;
  onEvent: (event: AgentChatStreamEvent) => void;
}

export interface ChatImageUploadTarget {
  s3Key: string;
  uploadUrl: string;
  contentType: string;
}

/**
 * Requests presigned S3 PUT URLs for one or more chat image attachments in a
 * single round trip - the caller uploads directly to S3 with these, the chat
 * request itself only ever carries the resulting `s3Key`s.
 *
 * Backend contract: POST {VITE_CHAT_IMAGES_UPLOAD_URL}
 *   body     { files: [{ filename, contentType }], sessionId }
 *   response { data: { uploads: [{ s3Key, uploadUrl, contentType }] } }
 */
export async function requestChatImageUploadUrls(
  files: { filename: string; contentType: string }[],
  sessionId: string
): Promise<ChatImageUploadTarget[]> {
  if (!chatConfig.imagesUploadUrl) {
    throw new Error('VITE_CHAT_IMAGES_UPLOAD_URL is not configured.');
  }

  const idToken = await getIdToken();

  const response = await fetch(chatConfig.imagesUploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files, sessionId }),
  });

  if (!response.ok) {
    throw new Error(`No se pudieron generar las URLs de subida (${response.status}).`);
  }

  const body = await response.json();
  return body.data.uploads as ChatImageUploadTarget[];
}

/**
 * Calls the agent chat backend and streams its SSE response, invoking
 * `onEvent` for every parsed `data: {...}` line as it arrives.
 *
 * Backend contract: POST {VITE_AGENT_CHAT_API_URL}/chat
 *   body     { message, sessionId, imageKeys }
 *   response text/event-stream of `data: <AgentChatStreamEvent>` lines
 */
export async function streamAgentChat({
  message,
  sessionId,
  imageKeys,
  signal,
  onEvent,
}: StreamAgentChatParams): Promise<void> {
  if (!chatConfig.apiUrl) {
    throw new Error('VITE_AGENT_CHAT_API_URL is not configured.');
  }

  const idToken = await getIdToken();

  const response = await fetch(`${chatConfig.apiUrl}/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sessionId,
      imageKeys: imageKeys ?? [],
    }),
    signal,
  });

  if (response.status === 401) {
    throw new AgentChatAuthError('Tu sesión expiró. Vuelve a iniciar sesión para continuar.');
  }
  if (!response.ok || !response.body) {
    throw new Error(`El asistente respondió ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a partial frame stays in the
    // buffer until its terminator arrives.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as AgentChatStreamEvent);
        } catch {
          // A malformed frame is not worth killing the stream over.
        }
      }
    }
  }
}
