import { describe, expect, it } from 'vitest';
import { checkAttachment, attachmentMimeType } from './services/attachments';
import { formatBytes, isMediaKind, mapsUrl, toChatMessage } from './services/mappers';

const stored = (fields: Record<string, unknown>) =>
  toChatMessage({
    phone: '56911111111',
    date: '2026-10-01T10:00:00.000+00:00',
    direction: 'inbound',
    message_id: 'wamid.1',
    ...fields,
  })!;

describe('toChatMessage by type', () => {
  it('maps media with its presigned URL', () => {
    const message = stored({
      type: 'document',
      message: '[Documento] receta',
      media: {
        url: 'https://bucket.s3.amazonaws.com/media/1.pdf?X-Amz-Signature=x',
        mimeType: 'application/pdf',
        size: '20480',
        filename: 'receta.pdf',
        caption: 'receta',
      },
    });
    expect(message.kind).toBe('document');
    expect(message.media).toEqual({
      url: 'https://bucket.s3.amazonaws.com/media/1.pdf?X-Amz-Signature=x',
      mimeType: 'application/pdf',
      size: 20480,
      filename: 'receta.pdf',
      caption: 'receta',
      error: null,
    });
  });

  it('keeps a failed download as an error without URL', () => {
    const message = stored({
      type: 'audio',
      media: { mimeType: 'audio/ogg', error: 'download_failed', voice: true },
    });
    expect(message.media?.url).toBeNull();
    expect(message.media?.error).toBe('download_failed');
    expect(message.media?.voice).toBe(true);
  });

  it('reads a location, with the numbers AppSync sends as strings', () => {
    const message = stored({
      type: 'location',
      payload: { latitude: '-33.4372', longitude: -70.6506, name: 'Oficina', address: 'Av. 1' },
    });
    expect(message.location).toEqual({
      latitude: -33.4372,
      longitude: -70.6506,
      name: 'Oficina',
      address: 'Av. 1',
    });
    expect(mapsUrl(message.location!)).toBe(
      'https://www.google.com/maps/search/?api=1&query=-33.4372,-70.6506'
    );
  });

  it('reads contact cards', () => {
    const message = stored({
      type: 'contacts',
      payload: {
        contacts: [
          {
            name: 'Ana Pérez',
            phones: [{ phone: '+56 9 2222 3333', wa_id: '56922223333' }],
            emails: ['ana@example.com'],
            org: 'ACME',
          },
        ],
      },
    });
    expect(message.contacts).toEqual([
      { name: 'Ana Pérez', phones: ['+56 9 2222 3333'], emails: ['ana@example.com'], org: 'ACME' },
    ]);
  });

  it('reads button, list and template quick replies', () => {
    expect(stored({ type: 'button_reply', payload: { id: 'yes', title: 'Sí' } }).reply).toEqual({
      id: 'yes',
      title: 'Sí',
    });
    expect(
      stored({ type: 'list_reply', payload: { id: 'a', title: 'A', description: 'd' } }).reply
    ).toEqual({ id: 'a', title: 'A', description: 'd' });
    expect(stored({ type: 'button', payload: { text: 'Confirmar', payload: 'OK' } }).reply).toEqual(
      { id: 'OK', title: 'Confirmar' }
    );
  });

  it('turns a Flow response into key/value fields without the token', () => {
    const message = stored({
      type: 'nfm_reply',
      payload: {
        body: 'Sent',
        response: { flow_token: 't', rut: '1-9', score: '4.5', tags: ['a'] },
      },
    });
    expect(message.flow).toEqual({
      body: 'Sent',
      fields: [
        { key: 'rut', value: '1-9' },
        { key: 'score', value: '4.5' },
        { key: 'tags', value: '["a"]' },
      ],
    });
    expect(stored({ type: 'nfm_reply', payload: { response: 'raw' } }).flow?.fields).toEqual([
      { key: 'respuesta', value: 'raw' },
    ]);
  });

  it('reads an order', () => {
    const message = stored({
      type: 'order',
      payload: {
        catalog_id: 'c1',
        text: 'Para mañana',
        items: [
          { product_retailer_id: 'SKU', quantity: '2', item_price: '9990.5', currency: 'CLP' },
        ],
      },
    });
    expect(message.order).toEqual({
      catalogId: 'c1',
      text: 'Para mañana',
      items: [{ id: 'SKU', quantity: 2, price: 9990.5, currency: 'CLP' }],
    });
  });

  it('keeps the reaction, the quoted message, the ad and the forward flag', () => {
    const message = stored({
      type: 'text',
      message: 'Hola',
      reaction: { emoji: '👍', date: 'x' },
      reply_to: 'wamid.0',
      referral: { source_type: 'ad', headline: 'Oferta', source_url: 'https://fb.me/x' },
      forwarded: true,
    });
    expect(message.reaction).toBe('👍');
    expect(message.replyTo).toBe('wamid.0');
    expect(message.referral).toEqual({
      sourceType: 'ad',
      headline: 'Oferta',
      sourceUrl: 'https://fb.me/x',
    });
    expect(message.forwarded).toBe(true);
  });

  it('maps system notices, welcome requests and unknown types', () => {
    expect(stored({ type: 'system', message: 'Cambió de número' }).kind).toBe('system');
    expect(stored({ type: 'request_welcome' }).kind).toBe('request_welcome');
    expect(stored({ type: 'unsupported' }).kind).toBe('unsupported');
    expect(stored({ type: 'something_new' }).kind).toBe('unsupported');
    expect(stored({ type: 'text', deleted: true }).deleted).toBe(true);
  });

  it('only gives media to the media kinds', () => {
    expect(stored({ type: 'text', media: { url: 'x' } }).media).toBeUndefined();
    expect(isMediaKind('sticker')).toBe(true);
    expect(isMediaKind('location')).toBe(false);
  });
});

describe('attachments', () => {
  const file = (name: string, type: string, size: number) => ({ name, type, size });

  it('accepts what WhatsApp takes, as the right message type', () => {
    expect(checkAttachment(file('a.jpg', 'image/jpeg', 1024))).toEqual({
      ok: true,
      kind: 'image',
      mimeType: 'image/jpeg',
    });
    expect(checkAttachment(file('a.pdf', 'application/pdf', 100 * 1024 * 1024))).toMatchObject({
      ok: true,
      kind: 'document',
    });
    expect(checkAttachment(file('nota.ogg', 'audio/ogg', 2048))).toMatchObject({ kind: 'audio' });
  });

  it('enforces the size limits per type', () => {
    expect(checkAttachment(file('a.png', 'image/png', 5 * 1024 * 1024 + 1))).toMatchObject({
      ok: false,
    });
    expect(checkAttachment(file('a.mp4', 'video/mp4', 17 * 1024 * 1024))).toMatchObject({
      ok: false,
    });
    expect(checkAttachment(file('a.png', 'image/png', 0))).toMatchObject({ ok: false });
  });

  it('rejects types WhatsApp does not take', () => {
    expect(checkAttachment(file('a.gif', 'image/gif', 10))).toMatchObject({ ok: false });
    expect(checkAttachment(file('a.zip', '', 10))).toMatchObject({ ok: false });
  });

  it('falls back to the extension when the browser gives no type', () => {
    expect(attachmentMimeType(file('voz.amr', '', 1))).toBe('audio/amr');
    expect(attachmentMimeType(file('clip.3gp', 'video/3gp', 1))).toBe('video/3gpp');
  });
});

describe('formatBytes', () => {
  it('writes sizes for people', () => {
    expect(formatBytes(820)).toBe('820 B');
    expect(formatBytes(14 * 1024)).toBe('14 KB');
    expect(formatBytes(null)).toBe('');
  });
});
