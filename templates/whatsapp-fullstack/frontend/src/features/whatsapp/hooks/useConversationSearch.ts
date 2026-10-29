import { useEffect, useState } from 'react';
import { fetchConversations } from '../services/whatsappService';
import type { Conversation } from '../types';

/** Typing pauses this long before the backend is asked. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Shorter searches filter what the inbox already loaded. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * The backend's search over every conversation (`GET
 * /whatsapp/conversations?search=`), debounced. `results` is `null` while the
 * query is shorter than `SEARCH_MIN_LENGTH`: the caller filters locally then.
 */
export function useConversationSearch(query: string) {
  const term = query.trim();
  const active = term.length >= SEARCH_MIN_LENGTH;
  const [results, setResults] = useState<Conversation[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setResults(null);
      setSearching(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      fetchConversations(term)
        .then(found => {
          if (cancelled) return;
          setResults(found);
          setError(null);
        })
        .catch(err => {
          if (cancelled) return;
          setResults(null);
          setError(err instanceof Error ? err.message : 'No se pudo buscar.');
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term, active]);

  return { results: active ? results : null, searching: active && searching, error };
}
