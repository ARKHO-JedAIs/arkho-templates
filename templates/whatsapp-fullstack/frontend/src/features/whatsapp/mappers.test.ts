import { describe, expect, it } from 'vitest';
import {
  isWindowOpen,
  mergeMessages,
  toChatMessage,
  toConversation,
  upsertConversation,
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
