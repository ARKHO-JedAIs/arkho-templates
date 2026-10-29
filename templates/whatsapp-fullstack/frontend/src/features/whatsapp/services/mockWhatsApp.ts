import type {
  ChatMessage,
  ControlMode,
  Conversation,
  CreateTemplateInput,
  MediaKind,
  SendTemplateInput,
} from '../types';
import { publishDemoEvent } from '../realtime';
import { checkAttachment } from './attachments';

/**
 * In-memory WhatsApp for `VITE_AUTH_PROVIDER=mock`: four demo contacts - one
 * answered by the AI agent, one taken by a person (with a message that failed
 * to deliver), one whose 24 hour window has closed, and one that sent one
 * message of every type WhatsApp delivers - and a contact that answers a few
 * seconds after you write, through the same event path the AppSync channel
 * uses. Nothing leaves the browser: the files are generated inline.
 */

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A generated picture, so the demo needs no external URL. */
const svg = (width: number, height: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`
  )}`;

const DEMO_PHOTO = svg(
  320,
  220,
  '<rect width="320" height="220" fill="lightsteelblue"/>' +
    '<circle cx="250" cy="60" r="28" fill="lightyellow"/>' +
    '<path d="M0 220 L110 90 L190 180 L240 130 L320 220 Z" fill="seagreen"/>' +
    '<text x="16" y="34" font-family="sans-serif" font-size="18" fill="white">Foto de demostración</text>'
);

const DEMO_STICKER = svg(
  160,
  160,
  '<circle cx="80" cy="80" r="72" fill="gold"/>' +
    '<circle cx="56" cy="66" r="9" fill="black"/><circle cx="104" cy="66" r="9" fill="black"/>' +
    '<path d="M48 100 Q80 132 112 100" stroke="black" stroke-width="7" fill="none" stroke-linecap="round"/>'
);

/** One second of a soft 440 Hz tone as an 8-bit mono WAV. */
function demoTone(): string {
  const rate = 8000;
  const samples = rate;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) =>
    [...value].forEach((char, index) => bytes.set([char.charCodeAt(0)], offset + index));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  for (let index = 0; index < samples; index++) {
    const fade = Math.min(1, index / 400, (samples - index) / 400);
    bytes[44 + index] = 128 + Math.round(40 * fade * Math.sin((2 * Math.PI * 440 * index) / rate));
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const DEMO_DOCUMENT = `data:text/plain;charset=utf-8,${encodeURIComponent(
  'Presupuesto de demostración\n\n2 x Producto A ... $19.980\nTotal ... $19.980\n'
)}`;

const media = (
  url: string | null,
  mimeType: string,
  extra: Partial<NonNullable<ChatMessage['media']>> = {}
): NonNullable<ChatMessage['media']> => ({
  url,
  mimeType,
  size: null,
  filename: null,
  caption: null,
  error: null,
  ...extra,
});

/** One message of every type the backend normalizes, from one contact. */
function everyType(): ChatMessage[] {
  const at = (minutes: number) => minutesAgo(minutes);
  const inbound = (id: string, minutes: number, rest: Partial<ChatMessage>): ChatMessage => ({
    id,
    direction: 'in',
    kind: 'text',
    text: '',
    timestamp: at(minutes),
    ...rest,
  });
  return [
    inbound('demo-t1', 95, { kind: 'request_welcome', text: '[Abrió el chat]' }),
    inbound('demo-t2', 94, {
      text: 'Hola, vi su anuncio de la promoción',
      referral: { sourceType: 'ad', headline: 'Promoción de temporada', sourceUrl: '' },
    }),
    inbound('demo-t3', 93, {
      kind: 'image',
      text: '[Imagen] ¿Tienen este modelo?',
      media: media(DEMO_PHOTO, 'image/png', { caption: '¿Tienen este modelo?', size: 48_213 }),
      reaction: '❤️',
    }),
    {
      id: 'demo-t4',
      direction: 'out',
      kind: 'text',
      text: 'Sí, lo tenemos en tres colores.',
      timestamp: at(92),
      sentBy: 'demo@example.com',
      status: 'read',
      replyTo: 'demo-t3',
      reaction: '👍',
    },
    inbound('demo-t5', 90, {
      kind: 'audio',
      text: '[Audio]',
      media: media(demoTone(), 'audio/wav', { voice: true, size: 8_044 }),
    }),
    inbound('demo-t6', 89, {
      kind: 'video',
      text: '[Video] Así se ve',
      media: media(null, 'video/mp4', { caption: 'Así se ve', error: 'download_failed' }),
    }),
    inbound('demo-t7', 88, {
      kind: 'document',
      text: '[Documento]',
      media: media(DEMO_DOCUMENT, 'text/plain', { filename: 'presupuesto.txt', size: 74 }),
    }),
    inbound('demo-t8', 87, {
      kind: 'sticker',
      text: '[Sticker]',
      media: media(DEMO_STICKER, 'image/svg+xml'),
    }),
    inbound('demo-t9', 86, {
      kind: 'location',
      text: '[Ubicación] Oficina',
      location: {
        latitude: -33.4263,
        longitude: -70.6205,
        name: 'Oficina',
        address: 'Av. Providencia 1234, Santiago',
      },
    }),
    inbound('demo-t10', 85, {
      kind: 'contacts',
      text: '[Contacto] Ana Pérez',
      contacts: [
        { name: 'Ana Pérez', phones: ['+56 9 2222 3333'], emails: ['ana@example.com'], org: '' },
      ],
    }),
    inbound('demo-t11', 84, {
      kind: 'button_reply',
      text: 'Sí, confirmo',
      reply: { id: 'confirm', title: 'Sí, confirmo' },
    }),
    inbound('demo-t12', 83, {
      kind: 'list_reply',
      text: 'Jueves 10:00',
      reply: { id: 'slot-thu-10', title: 'Jueves 10:00', description: 'Sucursal centro' },
    }),
    inbound('demo-t13', 82, {
      kind: 'button',
      text: 'Ver estado',
      reply: { id: 'ORDER_STATUS', title: 'Ver estado' },
    }),
    inbound('demo-t14', 81, {
      kind: 'nfm_reply',
      text: 'Formulario enviado',
      flow: {
        body: 'Formulario enviado',
        fields: [
          { key: 'nombre', value: 'Valentina Muñoz' },
          { key: 'comuna', value: 'Providencia' },
          { key: 'acepta_terminos', value: 'true' },
        ],
      },
    }),
    inbound('demo-t15', 80, {
      kind: 'order',
      text: '[Pedido] 2 producto(s)',
      order: {
        catalogId: 'demo-catalog',
        text: 'Para el viernes',
        items: [
          { id: 'SKU-001', quantity: 2, price: 9990, currency: 'CLP' },
          { id: 'SKU-007', quantity: 1, price: 4990, currency: 'CLP' },
        ],
      },
    }),
    inbound('demo-t16', 79, {
      kind: 'system',
      text: 'Valentina cambió su número de teléfono.',
    }),
    inbound('demo-t17', 78, {
      kind: 'unsupported',
      text: '[Tipo de mensaje no soportado] Message type unknown',
    }),
  ];
}

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
    '56944444444',
    {
      phone: '56944444444',
      name: 'Valentina Muñoz',
      lastMessage: '[Tipo de mensaje no soportado] Message type unknown',
      lastMessageAt: minutesAgo(78),
      lastDirection: 'inbound',
      lastInboundAt: minutesAgo(80),
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
  ['56944444444', everyType()],
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
const templates: Record<string, unknown>[] = [
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
    ...(message.media ? { media: message.media } : {}),
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

  /**
   * A file "sent" from the demo: the upload progress is simulated and the file
   * is shown from an object URL. Validated like the real path.
   */
  sendMedia: async (
    phone: string,
    file: File,
    mimeType: string,
    caption: string,
    onProgress?: (fraction: number) => void
  ) => {
    const check = checkAttachment({ name: file.name, type: mimeType, size: file.size });
    if (!check.ok) throw new Error(check.error);
    for (const step of [0.25, 0.5, 0.75, 1]) {
      await new Promise(resolve => window.setTimeout(resolve, 150));
      onProgress?.(step);
    }
    const kind: MediaKind = check.kind;
    const label = {
      image: '[Imagen]',
      audio: '[Audio]',
      video: '[Video]',
      document: '[Documento]',
    }[check.kind];
    const message: ChatMessage = {
      id: nextId(),
      direction: 'out',
      kind,
      text: `${label} ${caption}`.trim(),
      timestamp: new Date().toISOString(),
      sentBy: 'demo@example.com',
      status: 'sent',
      media: media(URL.createObjectURL(file), mimeType, {
        size: file.size,
        filename: file.name,
        caption: caption || null,
      }),
    };
    append(phone, message);
    simulateStatuses(phone, message);
    simulateReply(phone);
    return delay(message);
  },

  templates: (): Promise<unknown[]> => delay(templates),

  /** A new template goes straight to review, as it would in Meta. Gone on reload. */
  createTemplate: (input: CreateTemplateInput) => {
    const taken = templates.some(
      template => template.name === input.name && template.language === input.language
    );
    if (taken) {
      return Promise.reject(new Error('Ya existe una plantilla con ese nombre en ese idioma.'));
    }
    const template = {
      ...input,
      status: 'PENDING',
      qualityScore: 'UNKNOWN',
      metaTemplateId: null,
      variables: input.variableNames.length,
    };
    templates.unshift(template);
    return delay(template);
  },

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
