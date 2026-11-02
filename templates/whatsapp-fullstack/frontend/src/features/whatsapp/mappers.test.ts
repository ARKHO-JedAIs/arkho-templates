import { describe, expect, it } from 'vitest';
import {
  AVATAR_TONES,
  avatarTone,
  fillTemplate,
  filterConversations,
  initials,
  isSendable,
  isWindowOpen,
  mergeMessages,
  templateNeeds,
  templateParts,
  templateSegments,
  templateVariableNames,
  toChatMessage,
  toConversation,
  toTemplate,
  totalUnread,
  upsertConversation,
  windowHoursLeft,
} from './services/mappers';

const conversation = (phone: string, lastMessageAt: string) =>
  toConversation({ phone, last_message_at: lastMessageAt, mode: 'assistant' })!;

describe('toChatMessage', () => {
  it('maps a stored inbound text', () => {
    expect(
      toChatMessage({
        phone: '56911111111',
        date: '2026-10-01T10:00:00.000+00:00',
        direction: 'inbound',
        type: 'text',
        message: 'Hola',
        message_id: 'wamid.1',
      })
    ).toEqual({
      id: 'wamid.1',
      direction: 'in',
      kind: 'text',
      text: 'Hola',
      timestamp: '2026-10-01T10:00:00.000+00:00',
    });
  });

  it('names the person who sent an outbound message', () => {
    const message = toChatMessage({
      date: '2026-10-01T10:00:00.000+00:00',
      direction: 'outbound',
      type: 'template',
      message: 'hello_world (en_US)',
      sent_by: 'human',
      sent_by_name: 'ana@example.com',
    });
    expect(message?.kind).toBe('template');
    expect(message?.sentBy).toBe('ana@example.com');
  });

  it('keeps the delivery status and the failure reason', () => {
    const message = toChatMessage({
      date: '2026-10-01T10:00:00.000+00:00',
      direction: 'outbound',
      type: 'text',
      status: 'failed',
      error: 'Re-engagement message',
    });
    expect(message?.status).toBe('failed');
    expect(message?.error).toBe('Re-engagement message');
    expect(
      toChatMessage({ date: '2026-10-01T10:00:00Z', status: 'deleted' })?.status
    ).toBeUndefined();
  });

  it('drops an item without a date', () => {
    expect(toChatMessage({ message: 'x' })).toBeNull();
  });
});

describe('mergeMessages', () => {
  it('keeps one entry per id, oldest first', () => {
    const a = toChatMessage({ date: '2026-10-01T10:00:01Z', message_id: 'a', type: 'text' })!;
    const b = toChatMessage({ date: '2026-10-01T10:00:00Z', message_id: 'b', type: 'text' })!;
    expect(mergeMessages([a], [b, a]).map(message => message.id)).toEqual(['b', 'a']);
  });
});

describe('upsertConversation', () => {
  it('replaces the conversation and puts the most recent first', () => {
    const list = [
      conversation('1', '2026-10-01T10:00:00Z'),
      conversation('2', '2026-10-01T09:00:00Z'),
    ];
    const updated = upsertConversation(list, conversation('2', '2026-10-01T11:00:00Z'));
    expect(updated.map(item => item.phone)).toEqual(['2', '1']);
  });
});

describe('isWindowOpen', () => {
  const now = new Date('2026-10-02T10:00:00Z').getTime();

  it('is open within 24 hours of the last inbound message', () => {
    const open = toConversation({ phone: '1', last_inbound_at: '2026-10-01T12:00:00Z' });
    expect(isWindowOpen(open, now)).toBe(true);
  });

  it('is closed after 24 hours, or when the contact never wrote', () => {
    const closed = toConversation({ phone: '1', last_inbound_at: '2026-10-01T09:00:00Z' });
    expect(isWindowOpen(closed, now)).toBe(false);
    expect(isWindowOpen(toConversation({ phone: '1' }), now)).toBe(false);
  });
});

describe('windowHoursLeft', () => {
  const now = new Date('2026-10-02T10:00:00Z').getTime();
  const at = (lastInboundAt: string) =>
    toConversation({ phone: '1', last_inbound_at: lastInboundAt });

  it('counts the whole hours left, rounding up', () => {
    expect(windowHoursLeft(at('2026-10-02T04:00:00Z'), now)).toBe(18);
    expect(windowHoursLeft(at('2026-10-02T03:30:00Z'), now)).toBe(18);
    expect(windowHoursLeft(at('2026-10-01T10:30:00Z'), now)).toBe(1);
  });

  it('is 0 when the window closed or the contact never wrote', () => {
    expect(windowHoursLeft(at('2026-10-01T10:00:00Z'), now)).toBe(0);
    expect(windowHoursLeft(at('2026-09-30T10:00:00Z'), now)).toBe(0);
    expect(windowHoursLeft(toConversation({ phone: '1' }), now)).toBe(0);
    expect(windowHoursLeft(null, now)).toBe(0);
  });

  it('agrees with isWindowOpen', () => {
    for (const iso of ['2026-10-02T09:59:00Z', '2026-10-01T10:00:01Z', '2026-10-01T09:59:59Z']) {
      const conversation = at(iso);
      expect(windowHoursLeft(conversation, now) > 0).toBe(isWindowOpen(conversation, now));
    }
  });
});

describe('initials', () => {
  it('takes the first and last word of the name', () => {
    expect(initials('María Fernández', '56911111111')).toBe('MF');
    expect(initials('ana maría de la paz', '1')).toBe('AP');
    expect(initials('Diego', '1')).toBe('D');
  });

  it('falls back to the last digits of the phone', () => {
    expect(initials('', '56911111234')).toBe('34');
    expect(initials('  🙂 ', '56911111234')).toBe('34');
  });
});

describe('avatarTone', () => {
  it('is stable and within the tints colors.css defines', () => {
    for (const phone of ['56911111111', '56922222222', '1', '']) {
      const tone = avatarTone(phone);
      expect(tone).toBe(avatarTone(phone));
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(AVATAR_TONES);
    }
  });
});

describe('filterConversations', () => {
  const now = new Date('2026-10-02T10:00:00Z').getTime();
  const list = [
    toConversation({
      phone: '56911111111',
      name: 'María Fernández',
      last_inbound_at: '2026-10-02T09:00:00Z',
      mode: 'human',
    })!,
    toConversation({
      phone: '56922222222',
      name: 'Diego Soto',
      last_inbound_at: '2026-09-30T09:00:00Z',
      mode: 'assistant',
    })!,
  ];
  const phones = (query: string, filter: 'all' | 'human' | 'closed' = 'all') =>
    filterConversations(list, query, filter, now).map(item => item.phone);

  it('searches the name ignoring case and accents', () => {
    expect(phones('maria')).toEqual(['56911111111']);
    expect(phones('SOTO')).toEqual(['56922222222']);
  });

  it('searches the phone ignoring spaces and the plus sign', () => {
    expect(phones('+56 9 2222')).toEqual(['56922222222']);
    expect(phones('nadie')).toEqual([]);
  });

  it('keeps everything for an empty search', () => {
    expect(phones('  ')).toEqual(['56911111111', '56922222222']);
  });

  it('applies the quick filters', () => {
    expect(phones('', 'human')).toEqual(['56911111111']);
    expect(phones('', 'closed')).toEqual(['56922222222']);
    expect(phones('maria', 'closed')).toEqual([]);
  });

  it('keeps only the conversations with unread messages', () => {
    const unread = [
      toConversation({ phone: '1', unreadCount: 2 })!,
      toConversation({ phone: '2', unread_count: 0 })!,
    ];
    expect(filterConversations(unread, '', 'unread', now).map(item => item.phone)).toEqual(['1']);
  });
});

describe('unread counters', () => {
  it('reads the API field, or the stored one from a realtime payload', () => {
    expect(toConversation({ phone: '1', unreadCount: 3 })!.unreadCount).toBe(3);
    expect(toConversation({ phone: '1', unread_count: '4' })!.unreadCount).toBe(4);
    expect(toConversation({ phone: '1' })!.unreadCount).toBe(0);
    expect(toConversation({ phone: '1', unreadCount: -2 })!.unreadCount).toBe(0);
  });

  it('adds up the inbox for the tab title', () => {
    const list = [
      toConversation({ phone: '1', unreadCount: 2 })!,
      toConversation({ phone: '2', unreadCount: 5 })!,
      toConversation({ phone: '3' })!,
    ];
    expect(totalUnread(list)).toBe(7);
  });
});

describe('inbox notices', () => {
  it('maps a takeover notice', () => {
    const message = toChatMessage({
      phone: '1',
      date: '2026-10-01T10:06:00.000+00:00',
      direction: 'internal',
      type: 'event',
      message: 'ana@example.com tomó la conversación',
      payload: { kind: 'human_takeover', by: 'ana@example.com' },
    })!;
    expect(message.kind).toBe('event');
    expect(message.event).toEqual({ kind: 'human_takeover', by: 'ana@example.com' });
  });
});

describe('templateParts', () => {
  it('splits a stored template message', () => {
    expect(templateParts('recordatorio_cita (es): Diego, jueves 10:00')).toEqual({
      name: 'recordatorio_cita',
      language: 'es',
      detail: 'Diego, jueves 10:00',
    });
    expect(templateParts('hello_world (en_US)')).toEqual({
      name: 'hello_world',
      language: 'en_US',
      detail: '',
    });
  });

  it('is null for anything else', () => {
    expect(templateParts('Hola, ¿cómo estás?')).toBeNull();
  });
});

// WhatsApp variables are written with double braces, which the template
// generator would read as its own placeholders: build them at runtime.
const v = (name: string) => '{'.repeat(2) + name + '}'.repeat(2);

describe('toTemplate', () => {
  const api = {
    name: 'confirmacion_pedido',
    language: 'es',
    category: 'utility',
    status: 'pending',
    qualityScore: 'YELLOW',
    metaTemplateId: '123',
    header: 'Pedido',
    body: `Hola ${v('nombre')}, tu pedido ${v('numero')}.`,
    footer: '',
    buttons: [{ type: 'QUICK_REPLY', text: 'Ver estado' }, { type: 'URL' }, null],
    variables: 2,
    variableNames: ['nombre', 'numero'],
    parameterFormat: 'NAMED',
  };

  it('maps the API contract', () => {
    expect(toTemplate(api)).toEqual({
      name: 'confirmacion_pedido',
      language: 'es',
      category: 'UTILITY',
      status: 'PENDING',
      qualityScore: 'YELLOW',
      metaTemplateId: '123',
      header: 'Pedido',
      body: api.body,
      footer: null,
      buttons: [{ type: 'QUICK_REPLY', text: 'Ver estado' }],
      variables: 2,
      variableNames: ['nombre', 'numero'],
      parameterFormat: 'NAMED',
      headerFormat: 'TEXT',
      headerVariableNames: [],
      headerHandle: null,
      examples: {},
    });
  });

  it('keeps what sending and editing need: header format, button URLs and examples', () => {
    const template = toTemplate({
      name: 'envio',
      body: `Hola ${v('1')}`,
      headerFormat: 'image',
      headerHandle: '4::aW1n',
      buttons: [
        { type: 'URL', text: 'Seguir', url: `https://example.com/p/${v('1')}` },
        { type: 'COPY_CODE', text: '', example: 'DESC10' },
      ],
      examples: { 'body:1': 'Ana', 'button:0': 'A-1', bad: 3 },
    })!;
    expect(template.headerFormat).toBe('IMAGE');
    expect(template.headerHandle).toBe('4::aW1n');
    expect(template.buttons).toEqual([
      { type: 'URL', text: 'Seguir', url: `https://example.com/p/${v('1')}` },
      { type: 'COPY_CODE', text: '', example: 'DESC10' },
    ]);
    expect(template.examples).toEqual({ 'body:1': 'Ana', 'button:0': 'A-1' });
    expect(templateNeeds(template)).toEqual({
      headerVariable: null,
      headerMedia: 'IMAGE',
      urlButtons: [{ index: 0, text: 'Seguir', base: 'https://example.com/p/' }],
    });
  });

  it('asks for the text header variable', () => {
    const template = toTemplate({
      name: 'pedido',
      header: `Pedido ${v('1')}`,
      body: 'Gracias',
    })!;
    expect(templateNeeds(template).headerVariable).toBe('1');
    expect(fillTemplate(template.header!, { 1: 'A-1' })).toBe('Pedido A-1');
    expect(fillTemplate(template.header!, {})).toBe(`Pedido ${v('1')}`);
  });

  it('fills what an older backend left out', () => {
    const template = toTemplate({
      name: 'recordatorio',
      language: 'es',
      category: 'UTILITY',
      body: `Hola ${v('1')}, tu cita es el ${v('2')}.`,
      variables: 2,
    })!;
    // The old endpoint only listed approved templates, without a status.
    expect(template.status).toBe('APPROVED');
    expect(template.qualityScore).toBe('UNKNOWN');
    expect(template.variableNames).toEqual(['1', '2']);
    expect(template.parameterFormat).toBe('POSITIONAL');
    expect(template.buttons).toEqual([]);
    expect(template.header).toBeNull();
  });

  it('reads named variables from the body when the names are missing', () => {
    const template = toTemplate({ name: 'x', body: `Hola ${v('nombre')}` })!;
    expect(template.variableNames).toEqual(['nombre']);
    expect(template.variables).toBe(1);
    expect(template.parameterFormat).toBe('NAMED');
  });

  it('drops an item without a name', () => {
    expect(toTemplate({ body: 'x' })).toBeNull();
    expect(toTemplate(null)).toBeNull();
  });
});

describe('isSendable', () => {
  it('only lets approved templates through', () => {
    const statuses = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'];
    const sendable = statuses.filter(status => isSendable(toTemplate({ name: 'x', status })!));
    expect(sendable).toEqual(['APPROVED']);
  });
});

describe('template variables', () => {
  it('lists each variable once, in order of appearance', () => {
    expect(templateVariableNames(`${v('2')} ${v('1')} ${v('2')} ${v(' nombre ')}`)).toEqual([
      '2',
      '1',
      'nombre',
    ]);
    expect(templateVariableNames('Sin variables')).toEqual([]);
  });

  it('splits a text into plain runs and variables', () => {
    expect(templateSegments(`Hola ${v('1')}, nos vemos el ${v('2')}`)).toEqual([
      { kind: 'text', value: 'Hola ' },
      { kind: 'variable', name: '1' },
      { kind: 'text', value: ', nos vemos el ' },
      { kind: 'variable', name: '2' },
    ]);
    expect(templateSegments('Hola')).toEqual([{ kind: 'text', value: 'Hola' }]);
  });
});
