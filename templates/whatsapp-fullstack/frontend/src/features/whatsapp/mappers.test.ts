import { describe, expect, it } from 'vitest';
import {
  AVATAR_TONES,
  avatarTone,
  filterConversations,
  initials,
  isWindowOpen,
  mergeMessages,
  templateParts,
  toChatMessage,
  toConversation,
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
