import type {
  ChatMessage,
  ControlMode,
  Conversation,
  SendTemplateInput,
  WhatsAppTemplate,
} from '../types';
import { publishDemoEvent } from '../realtime';

/**
 * In-memory WhatsApp for `VITE_AUTH_PROVIDER=mock`: two demo contacts, and a
 * contact that answers a few seconds after you write, through the same event
 * path the AppSync channel uses. Nothing leaves the browser.
 */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const conversations = new Map<string, Conversation>([
  [
    '56911111111',
    {
      phone: '56911111111',
      name: 'Camila Rojas',
      lastMessage: '¿Tienen disponibilidad para mañana?',
      lastMessageAt: minutesAgo(5),
      lastDirection: 'inbound',
      lastInboundAt: minutesAgo(5),
      mode: 'assistant',
      takenByName: null,
    },
  ],
  [
    '56922222222',
    {
      phone: '56922222222',
      name: 'Diego Soto',
      lastMessage: 'recordatorio_cita (es)',
      lastMessageAt: minutesAgo(60 * 30),
      lastDirection: 'outbound',
      lastInboundAt: minutesAgo(60 * 48),
      mode: 'assistant',
      takenByName: null,
    },
  ],
]);

const messages = new Map<string, ChatMessage[]>([
  [
    '56911111111',
    [
      { id: 'demo-1', direction: 'in', kind: 'text', text: 'Hola 👋', timestamp: minutesAgo(7) },
      {
        id: 'demo-2',
        direction: 'out',
        kind: 'text',
        text: 'Gracias por escribirnos, en breve te respondemos.',
        timestamp: minutesAgo(7),
      },
      {
        id: 'demo-3',
        direction: 'in',
        kind: 'text',
        text: '¿Tienen disponibilidad para mañana?',
        timestamp: minutesAgo(5),
      },
    ],
  ],
  [
    '56922222222',
    [
      {
        id: 'demo-4',
        direction: 'in',
        kind: 'text',
        text: 'Perfecto, nos vemos el jueves',
        timestamp: minutesAgo(60 * 48),
      },
      {
        id: 'demo-5',
        direction: 'out',
        kind: 'template',
        text: 'recordatorio_cita (es): Diego, jueves 10:00',
        timestamp: minutesAgo(60 * 30),
        sentBy: 'demo@example.com',
      },
    ],
  ],
]);

const templates: WhatsAppTemplate[] = [
  {
    name: 'recordatorio_cita',
    language: 'es',
    category: 'UTILITY',
    body: 'Hola {{1}}, te recordamos tu cita el {{2}}.',
    variables: 2,
  },
  {
    name: 'hello_world',
    language: 'en_US',
    category: 'UTILITY',
    body: 'Hello World',
    variables: 0,
  },
];

let sequence = 0;
const nextId = () => `demo-${Date.now()}-${++sequence}`;

function append(phone: string, message: ChatMessage) {
  messages.set(phone, [...(messages.get(phone) ?? []), message]);
  const current = conversations.get(phone);
  const conversation: Conversation = {
    phone,
    name: current?.name ?? '',
    lastMessage: message.text,
    lastMessageAt: message.timestamp,
    lastDirection: message.direction === 'in' ? 'inbound' : 'outbound',
    lastInboundAt:
      message.direction === 'in' ? message.timestamp : (current?.lastInboundAt ?? null),
    mode: current?.mode ?? 'assistant',
    takenByName: current?.takenByName ?? null,
  };
  conversations.set(phone, conversation);
  publishDemoEvent('inbox', 'CONVERSATION_UPDATED', toPayload(conversation));
  return conversation;
}

/** The API's snake_case shape, so demo events go through the real mappers. */
function toPayload(conversation: Conversation) {
  return {
    phone: conversation.phone,
    name: conversation.name,
    last_message: conversation.lastMessage,
    last_message_at: conversation.lastMessageAt,
    last_direction: conversation.lastDirection,
    last_inbound_at: conversation.lastInboundAt,
    mode: conversation.mode,
    taken_by_name: conversation.takenByName,
  };
}

function messagePayload(phone: string, message: ChatMessage) {
  return {
    phone,
    date: message.timestamp,
    message_id: message.id,
    direction: message.direction === 'in' ? 'inbound' : 'outbound',
    type: message.kind,
    message: message.text,
    ...(message.sentBy ? { sent_by: 'human', sent_by_name: message.sentBy } : {}),
  };
}

/** The contact answers a moment later, as a real one would. */
function simulateReply(phone: string) {
  window.setTimeout(() => {
    const reply: ChatMessage = {
      id: nextId(),
      direction: 'in',
      kind: 'text',
      text: '¡Gracias! (respuesta de demostración)',
      timestamp: new Date().toISOString(),
    };
    append(phone, reply);
    publishDemoEvent(phone, 'MESSAGE_RECEIVED', messagePayload(phone, reply));
  }, 2500);
}

const delay = <T>(value: T) =>
  new Promise<T>(resolve => window.setTimeout(() => resolve(value), 150));

export const mockWhatsApp = {
  conversations: () =>
    delay(
      [...conversations.values()].sort((a, b) =>
        (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
      )
    ),

  messages: (phone: string) => delay([...(messages.get(phone) ?? [])]),

  send: (phone: string, text: string) => {
    const message: ChatMessage = {
      id: nextId(),
      direction: 'out',
      kind: 'text',
      text,
      timestamp: new Date().toISOString(),
      sentBy: 'demo@example.com',
    };
    append(phone, message);
    simulateReply(phone);
    return delay(message);
  },

  templates: () => delay(templates),

  sendTemplate: (input: SendTemplateInput) => {
    const message: ChatMessage = {
      id: nextId(),
      direction: 'out',
      kind: 'template',
      text:
        `${input.templateName} (${input.language})` +
        (input.parameters.length ? `: ${input.parameters.join(', ')}` : ''),
      timestamp: new Date().toISOString(),
      sentBy: 'demo@example.com',
    };
    append(input.phone, message);
    simulateReply(input.phone);
    return delay(message);
  },

  setControl: (phone: string, mode: ControlMode) => {
    const current = conversations.get(phone);
    if (!current) return delay(null);
    const conversation: Conversation = {
      ...current,
      mode,
      takenByName: mode === 'human' ? 'demo@example.com' : null,
    };
    conversations.set(phone, conversation);
    publishDemoEvent('inbox', 'CONVERSATION_UPDATED', toPayload(conversation));
    return delay(conversation);
  },
};
