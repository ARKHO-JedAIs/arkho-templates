import type { ChatMessage, Conversation, MessageStatus } from '../types';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const orNull = (value: unknown) => text(value) || null;

/** A conversation item from the API or a realtime payload; `null` if unusable. */
export function toConversation(item: unknown): Conversation | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const phone = text(raw.phone);
  if (!phone) return null;
  const direction = text(raw.last_direction);
  return {
    phone,
    name: text(raw.name),
    lastMessage: text(raw.last_message),
    lastMessageAt: orNull(raw.last_message_at),
    lastDirection: direction === 'inbound' || direction === 'outbound' ? direction : null,
    lastInboundAt: orNull(raw.last_inbound_at),
    mode: raw.mode === 'human' ? 'human' : 'assistant',
    takenByName: orNull(raw.taken_by_name),
  };
}

const STATUSES: readonly MessageStatus[] = ['sent', 'delivered', 'read', 'failed'];

/** A stored message from the API or a realtime payload; `null` if unusable. */
export function toChatMessage(item: unknown): ChatMessage | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const timestamp = text(raw.date);
  if (!timestamp) return null;
  const direction = text(raw.direction) === 'inbound' ? 'in' : 'out';
  const type = text(raw.type);
  const status = text(raw.status) as MessageStatus;
  return {
    id: text(raw.message_id) || `${timestamp}-${direction}`,
    direction,
    kind: type === 'text' ? 'text' : type === 'template' ? 'template' : 'other',
    text: text(raw.message),
    timestamp,
    ...(raw.sent_by === 'human' ? { sentBy: text(raw.sent_by_name) || 'Operador' } : {}),
    ...(STATUSES.includes(status) ? { status } : {}),
    ...(text(raw.error) ? { error: text(raw.error) } : {}),
  };
}

/** Oldest first, one entry per id: what a thread shows. */
export function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[]
): ChatMessage[] {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/** The inbox with `conversation` replaced or added, most recent first. */
export function upsertConversation(
  list: readonly Conversation[],
  conversation: Conversation
): Conversation[] {
  const others = list.filter(item => item.phone !== conversation.phone);
  return [conversation, ...others].sort((a, b) =>
    (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
  );
}

const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** WhatsApp only accepts free-form text within 24 hours of the contact's last message. */
export function isWindowOpen(conversation: Conversation | null, now = Date.now()): boolean {
  if (!conversation?.lastInboundAt) return false;
  return now - new Date(conversation.lastInboundAt).getTime() < SERVICE_WINDOW_MS;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Whole hours left in the 24 hour window, rounded up (30 minutes left reads
 * "1 h"); 0 when the window is closed or the contact never wrote.
 */
export function windowHoursLeft(conversation: Conversation | null, now = Date.now()): number {
  if (!conversation?.lastInboundAt) return 0;
  const left = SERVICE_WINDOW_MS - (now - new Date(conversation.lastInboundAt).getTime());
  return left > 0 ? Math.ceil(left / HOUR_MS) : 0;
}

/** Up to two letters for an avatar: first and last word of the name, else the phone's last digits. */
export function initials(name: string, phone: string): string {
  const words = name
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const [first, ...rest] = words;
  if (!first) return phone.slice(-2);
  return (first.charAt(0) + (rest.at(-1)?.charAt(0) ?? '')).toUpperCase();
}

/** How many avatar tints colors.css defines (`--avatar-1` ... `--avatar-5`). */
export const AVATAR_TONES = 5;

/** The same tint for the same contact on every render and every device. */
export function avatarTone(phone: string): number {
  let hash = 0;
  for (const char of phone) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % AVATAR_TONES;
}

/** The inbox's quick filters. */
export type InboxFilter = 'all' | 'human' | 'closed';

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * The conversations matching a search (name, accents and case ignored, or
 * phone digits, spaces and "+" ignored) and a quick filter. Client-side, over
 * what the inbox has already loaded.
 */
export function filterConversations(
  list: readonly Conversation[],
  query: string,
  filter: InboxFilter,
  now = Date.now()
): Conversation[] {
  const words = fold(query.trim());
  const digits = query.replace(/\D/g, '');
  return list.filter(conversation => {
    if (filter === 'human' && conversation.mode !== 'human') return false;
    if (filter === 'closed' && isWindowOpen(conversation, now)) return false;
    if (!words) return true;
    return (
      fold(conversation.name).includes(words) ||
      (digits.length > 0 && conversation.phone.includes(digits))
    );
  });
}

/**
 * A template message as the backend stores it - `name (language)` plus
 * `: parameters` when it has any - split for the bubble; `null` otherwise.
 */
export function templateParts(
  text: string
): { name: string; language: string; detail: string } | null {
  const [, name, language, detail] =
    /^(\S+) \(([^)]+)\)(?::\s*([\s\S]*))?$/.exec(text.trim()) ?? [];
  if (!name || !language) return null;
  return { name, language, detail: (detail ?? '').trim() };
}
