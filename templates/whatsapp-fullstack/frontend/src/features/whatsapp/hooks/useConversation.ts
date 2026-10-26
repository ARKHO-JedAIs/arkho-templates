import { useCallback, useEffect, useRef, useState } from 'react';
import { type LiveState, hasRealtime, subscribe } from '../realtime';
import { mergeMessages, toChatMessage } from '../services/mappers';
import { WhatsAppAuthError, fetchMessages } from '../services/whatsappService';
import type { ChatMessage } from '../types';

const MESSAGE_EVENTS = new Set(['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'TEMPLATE_SENT']);

/**
 * One conversation: its history, plus every new message as it is stored.
 *
 * History and realtime events go through the same merge, keyed by message id,
 * so an event that lands while the history loads never shows twice.
 */
export function useConversation(phone: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [live, setLive] = useState<LiveState>('offline');
  // A response for a conversation no longer open is dropped, not shown in the wrong one.
  const current = useRef(phone);
  current.current = phone;

  const load = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMessages(phone);
      if (current.current === phone) setMessages(existing => mergeMessages(existing, page));
    } catch (err) {
      if (current.current !== phone) return;
      if (err instanceof WhatsAppAuthError) setAuthError(true);
      else setError(err instanceof Error ? err.message : 'No se pudo cargar la conversación.');
    } finally {
      if (current.current === phone) setLoading(false);
    }
  }, [phone]);

  /** A message sent from this screen: shown at once, de-duplicated against its event. */
  const add = useCallback((message: ChatMessage) => {
    setMessages(existing => mergeMessages(existing, [message]));
  }, []);

  useEffect(() => {
    setMessages([]);
    if (!phone) return;
    void load();
    setLive(hasRealtime() ? 'connecting' : 'offline');
    const stop = subscribe(
      phone,
      event => {
        if (current.current !== phone) return;
        setLive('live');
        if (!MESSAGE_EVENTS.has(event.type)) return;
        const message = toChatMessage(event.payload);
        if (message) add(message);
      },
      () => setLive('error')
    );
    // AppSync acknowledges a subscription without an event: no error by then means listening.
    const settled = stop
      ? window.setTimeout(() => setLive(state => (state === 'connecting' ? 'live' : state)), 1500)
      : null;
    return () => {
      if (settled !== null) window.clearTimeout(settled);
      stop?.();
    };
  }, [phone, load, add]);

  return { messages, loading, error, authError, live, reload: () => void load(), add };
}
