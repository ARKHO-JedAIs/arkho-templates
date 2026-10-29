import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toChatMessage } from '../services/mappers';
import type { ChatMessage } from '../types';
import { ChatThread } from './ChatThread';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 10, 0, seconds)).toISOString();

const message = (seconds: number, fields: Record<string, unknown>): ChatMessage =>
  toChatMessage({
    phone: '56911111111',
    date: at(seconds),
    direction: 'inbound',
    message_id: `wamid.${seconds}`,
    ...fields,
  })!;

const messages: ChatMessage[] = [
  message(1, { type: 'request_welcome', message: '[Abrió el chat]' }),
  message(2, {
    type: 'text',
    message: 'Vi el anuncio',
    referral: { source_type: 'ad', headline: 'Oferta' },
  }),
  message(3, {
    type: 'image',
    message: '[Imagen] foto',
    media: { url: 'https://example.com/a.jpg', mimeType: 'image/jpeg', caption: 'foto' },
    reaction: { emoji: '👍' },
  }),
  message(4, { type: 'text', message: 'Respuesta', direction: 'outbound', reply_to: 'wamid.3' }),
  message(5, {
    type: 'document',
    media: { url: 'https://example.com/a.pdf', mimeType: 'application/pdf', filename: 'a.pdf' },
  }),
  message(6, { type: 'video', media: { mimeType: 'video/mp4', error: 'download_failed' } }),
  message(7, { type: 'location', payload: { latitude: -33.4, longitude: -70.6, name: 'Oficina' } }),
  message(8, { type: 'contacts', payload: { contacts: [{ name: 'Ana', phones: ['+569'] }] } }),
  message(9, { type: 'button_reply', message: 'Sí', payload: { id: 'yes', title: 'Sí' } }),
  message(10, {
    type: 'nfm_reply',
    payload: { body: 'Sent', response: { comuna: 'Providencia' } },
  }),
  message(11, {
    type: 'order',
    payload: {
      items: [{ product_retailer_id: 'SKU-1', quantity: 2, item_price: 10, currency: 'CLP' }],
    },
  }),
  message(12, { type: 'system', message: 'Cambió su número' }),
  message(13, { type: 'unsupported', message: '[Tipo de mensaje no soportado]' }),
];

describe('ChatThread message types', () => {
  it('renders every type', () => {
    render(<ChatThread messages={messages} />);
    expect(screen.getByText('El contacto abrió el chat por primera vez.')).toBeInTheDocument();
    expect(screen.getByText(/Desde anuncio/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Reacción: 👍' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Ver la imagen en tamaño completo' })
    ).toBeInTheDocument();
    // The quoted block shows the caption of the image it answers.
    expect(screen.getAllByText('foto').length).toBeGreaterThan(1);
    expect(screen.getByRole('link', { name: 'Descargar a.pdf' })).toBeInTheDocument();
    expect(screen.getByText('No se pudo descargar el archivo de WhatsApp.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir en Google Maps/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=-33.4,-70.6'
    );
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Respuesta a botón')).toBeInTheDocument();
    expect(screen.getByText('Providencia')).toBeInTheDocument();
    expect(screen.getByText(/SKU-1/)).toBeInTheDocument();
    expect(screen.getByText('Cambió su número')).toBeInTheDocument();
    expect(screen.getByText('Tipo de mensaje no soportado')).toBeInTheDocument();
  });

  it('asks for fresh URLs once when a file fails to load', () => {
    const onMediaExpired = vi.fn();
    render(<ChatThread messages={[messages[2]!]} onMediaExpired={onMediaExpired} />);
    fireEvent.error(screen.getAllByRole('img', { name: 'foto' })[0]!);
    expect(onMediaExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Actualizando el enlace del archivo…')).toBeInTheDocument();
  });
});
