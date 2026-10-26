import type { ChatMessage, Conversation } from '../types';

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

/** A stored message from the API or a realtime payload; `null` if unusable. */
export function toChatMessage(item: unknown): ChatMessage | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const timestamp = text(raw.date);
  if (!timestamp) return null;
  const direction = text(raw.direction) === 'inbound' ? 'in' : 'out';
  const type = text(raw.type);
  return {
    id: text(raw.message_id) || `${timestamp}-${direction}`,
    direction,
    kind: type === 'text' ? 'text' : type === 'template' ? 'template' : 'other',
    text: text(raw.message),
    timestamp,
    ...(raw.sent_by === 'human' ? { sentBy: text(raw.sent_by_name) || 'Operador' } : {}),
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
