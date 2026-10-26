import { useCallback, useEffect, useState } from 'react';
import { INBOX_CHANNEL, subscribe } from '../realtime';
import { toConversation, upsertConversation } from '../services/mappers';
import { WhatsAppAuthError, fetchConversations } from '../services/whatsappService';
import type { Conversation } from '../types';

/** The inbox: every conversation, reordered live as messages come and go. */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConversations(await fetchConversations());
    } catch (err) {
      if (err instanceof WhatsAppAuthError) setAuthError(true);
      else
        setError(err instanceof Error ? err.message : 'No se pudieron cargar las conversaciones.');
    } finally {
      setLoading(false);
    }
  }, []);

  /** A conversation changed here (sent, taken over): show it without waiting for the event. */
  const apply = useCallback((conversation: Conversation) => {
    setConversations(list => upsertConversation(list, conversation));
  }, []);

  useEffect(() => {
    void reload();
    const stop = subscribe(INBOX_CHANNEL, event => {
      if (event.type !== 'CONVERSATION_UPDATED') return;
      const conversation = toConversation(event.payload);
      if (conversation) apply(conversation);
    });
    return () => {
      stop?.();
    };
  }, [reload, apply]);

  return { conversations, loading, error, authError, reload: () => void reload(), apply };
}
