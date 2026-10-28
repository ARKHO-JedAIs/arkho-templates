import type { ChatMessage, ControlMode, Conversation, SendTemplateInput } from '../types';
import { publishDemoEvent } from '../realtime';

/**
 * In-memory WhatsApp for `VITE_AUTH_PROVIDER=mock`: three demo contacts - one
 * answered by the AI agent, one taken by a person (with a message that failed
 * to deliver), one whose 24 hour window has closed - and a
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
    '56933333333',
    {
      phone: '56933333333',
      name: 'María Fernández',
      lastMessage: 'Listo, ya quedó actualizada. Te aviso cuando salga el despacho.',
      lastMessageAt: minutesAgo(20),
      lastDirection: 'outbound',
      lastInboundAt: minutesAgo(22),
      mode: 'human',
      takenByName: 'demo@example.com',
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
        status: 'read',
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
    '56933333333',
    [
      {
        id: 'demo-6',
        direction: 'in',
        kind: 'text',
        text: 'Hola, quería saber el estado de mi pedido 4821',
        timestamp: minutesAgo(30),
      },
      {
        id: 'demo-7',
        direction: 'out',
        kind: 'text',
        text: '¡Hola María! Tu pedido 4821 salió hoy y llega *mañana* entre 9:00 y 13:00.',
        timestamp: minutesAgo(29),
        status: 'read',
      },
      {
        id: 'demo-8',
        direction: 'in',
        kind: 'text',
        text: '¿Puedo cambiar la dirección de entrega? Av. Providencia 1234, depto 56',
        timestamp: minutesAgo(22),
      },
      {
        id: 'demo-9',
        direction: 'out',
        kind: 'text',
        text: 'Claro, María. Ya la cambiamos.',
        timestamp: minutesAgo(21),
        sentBy: 'demo@example.com',
        status: 'delivered',
      },
      {
        id: 'demo-10',
        direction: 'out',
        kind: 'text',
        text: 'Listo, ya quedó actualizada. Te aviso cuando salga el despacho.',
        timestamp: minutesAgo(20),
        sentBy: 'demo@example.com',
        status: 'failed',
        error: 'Mensaje de demostración: falla simulada',
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

/**
 * The account's templates in the API's shape (`GET /whatsapp/templates`), so
 * they go through the real mapper: one per review status, the three
 * categories, numbered and named variables, and one with header and buttons.
 *
 * This file is excluded from the generator's token substitution, which is why
 * WhatsApp's double-brace variables can be written here literally.
 */
const templates = [
  {
    name: 'recordatorio_cita',
    language: 'es',
    category: 'UTILITY',
    status: 'APPROVED',
    qualityScore: 'GREEN',
    metaTemplateId: '1029384756',
    header: null,
    body: 'Hola {{1}}, te recordamos tu cita el {{2}}.',
    footer: null,
    buttons: [],
    variables: 2,
    variableNames: ['1', '2'],
    parameterFormat: 'POSITIONAL',
  },
  {
    name: 'confirmacion_pedido',
    language: 'es',
    category: 'UTILITY',
    status: 'APPROVED',
    qualityScore: 'YELLOW',
    metaTemplateId: '1029384757',
    header: 'Pedido confirmado',
    body: 'Hola {{nombre}}, recibimos tu pedido {{numero_pedido}}. Llegará el {{fecha_entrega}}.',
    footer: 'Responde a este mensaje si necesitas ayuda',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Ver estado' },
      { type: 'URL', text: 'Seguir envío' },
    ],
    variables: 3,
    variableNames: ['nombre', 'numero_pedido', 'fecha_entrega'],
    parameterFormat: 'NAMED',
  },
  {
    name: 'hello_world',
    language: 'en_US',
    category: 'UTILITY',
    status: 'APPROVED',
    qualityScore: 'UNKNOWN',
    metaTemplateId: '1029384758',
    header: 'Hello World',
    body: 'Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API.',
    footer: 'WhatsApp Business Platform sample message',
    buttons: [],
    variables: 0,
    variableNames: [],
    parameterFormat: 'POSITIONAL',
  },
  {
    name: 'promocion_temporada',
    language: 'es',
    category: 'MARKETING',
    status: 'PENDING',
    qualityScore: 'UNKNOWN',
    metaTemplateId: '1029384759',
    header: null,
    body: '¡{{1}}, esta semana tienes {{2}} de descuento en toda la tienda!',
    footer: 'Para dejar de recibir promociones responde SALIR',
    buttons: [{ type: 'QUICK_REPLY', text: 'No me interesa' }],
    variables: 2,
    variableNames: ['1', '2'],
    parameterFormat: 'POSITIONAL',
  },
  {
    name: 'codigo_verificacion',
    language: 'es',
    category: 'AUTHENTICATION',
    status: 'REJECTED',
    qualityScore: 'UNKNOWN',
    metaTemplateId: '1029384760',
    header: null,
    body: 'Tu código de verificación es {{1}}. No lo compartas con nadie.',
    footer: null,
    buttons: [{ type: 'URL', text: 'Copiar código' }],
    variables: 1,
    variableNames: ['1'],
    parameterFormat: 'POSITIONAL',
  },
  {
    name: 'reactivacion_cliente',
    language: 'es',
    category: 'MARKETING',
    status: 'PAUSED',
    qualityScore: 'RED',
    metaTemplateId: '1029384761',
    header: null,
    body: 'Te extrañamos, {{nombre}}. Vuelve y obtén un regalo en tu próxima compra.',
    footer: null,
    buttons: [],
    variables: 1,
    variableNames: ['nombre'],
    parameterFormat: 'NAMED',
  },
  {
    name: 'encuesta_antigua',
    language: 'es',
    category: 'MARKETING',
    status: 'DISABLED',
    qualityScore: 'RED',
    metaTemplateId: '1029384762',
    header: null,
    body: '¿Cómo evaluarías tu última compra, {{1}}?',
    footer: null,
    buttons: [],
    variables: 1,
    variableNames: ['1'],
    parameterFormat: 'POSITIONAL',
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
    ...(message.status ? { status: message.status } : {}),
  };
}

/** sent -> delivered -> read, through the same event the backend publishes. */
function simulateStatuses(phone: string, message: ChatMessage) {
  (['delivered', 'read'] as const).forEach((status, index) => {
    window.setTimeout(
      () => {
        message.status = status;
        publishDemoEvent(phone, 'MESSAGE_STATUS', messagePayload(phone, message));
      },
      700 * (index + 1)
    );
  });
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

  // The demo history fits in one page: there is never anything older.
  messages: (phone: string, before?: string) =>
    delay(before ? [] : [...(messages.get(phone) ?? [])]),

  send: (phone: string, text: string) => {
    const message: ChatMessage = {
      id: nextId(),
      direction: 'out',
      kind: 'text',
      text,
      timestamp: new Date().toISOString(),
      sentBy: 'demo@example.com',
      status: 'sent',
    };
    append(phone, message);
    simulateStatuses(phone, message);
    simulateReply(phone);
    return delay(message);
  },

  templates: (): Promise<unknown[]> => delay(templates),

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
      status: 'sent',
    };
    append(input.phone, message);
    simulateStatuses(input.phone, message);
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
