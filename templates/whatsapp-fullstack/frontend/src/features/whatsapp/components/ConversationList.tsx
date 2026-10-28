import { useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type InboxFilter, filterConversations, isWindowOpen } from '../services/mappers';
import type { Conversation } from '../types';
import { ContactAvatar } from './ContactAvatar';

interface ConversationListProps {
  conversations: readonly Conversation[];
  selected: string | null;
  onSelect: (phone: string) => void;
  loading: boolean;
  /** Re-checks the 24 hour windows; the page ticks it once a minute. */
  now?: number;
}

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'human', label: 'Con persona' },
  { value: 'closed', label: 'Ventana cerrada' },
];

const short = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' });
const hour = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? hour.format(date) : short.format(date);
}

const chip = 'rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4';

/** Who answers a conversation, as a small chip: violet for the AI agent, neutral for a person. */
export function ModeChip({ mode }: { mode: Conversation['mode'] }) {
  return mode === 'human' ? (
    <span className={cn(chip, 'bg-muted text-foreground')}>Persona</span>
  ) : (
    <span className={cn(chip, 'bg-agent-light text-agent-strong')}>Agente IA</span>
  );
}

/** The inbox: a search, quick filters and the conversations, most recent first. */
export function ConversationList({
  conversations,
  selected,
  onSelect,
  loading,
  now = Date.now(),
}: ConversationListProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('all');

  const visible = useMemo(
    () => filterConversations(conversations, query, filter, now),
    [conversations, query, filter, now]
  );

  let body: ReactNode;
  if (loading && conversations.length === 0) {
    body = (
      <p className='flex items-center justify-center gap-2 py-10 text-sm text-foreground-secondary'>
        <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
        Cargando…
      </p>
    );
  } else if (conversations.length === 0) {
    body = (
      <p className='px-4 py-10 text-center text-sm text-foreground-secondary'>
        Aún no hay conversaciones. Aparecen cuando alguien escribe al número, o al enviar una
        plantilla.
      </p>
    );
  } else if (visible.length === 0) {
    body = (
      <p className='px-4 py-10 text-center text-sm text-foreground-secondary'>
        Ninguna conversación coincide con la búsqueda o el filtro.
      </p>
    );
  } else {
    body = (
      <ul className='divide-y divide-border/60'>
        {visible.map(conversation => {
          const active = conversation.phone === selected;
          return (
            <li key={conversation.phone}>
              <button
                type='button'
                onClick={() => onSelect(conversation.phone)}
                aria-current={active}
                className={cn(
                  'flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active
                    ? 'bg-primary-light shadow-[inset_3px_0_0_hsl(var(--primary))]'
                    : 'hover:bg-muted'
                )}
              >
                <ContactAvatar name={conversation.name} phone={conversation.phone} />
                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='flex items-baseline justify-between gap-2'>
                    <span className='truncate text-sm font-semibold text-foreground'>
                      {conversation.name || `+${conversation.phone}`}
                    </span>
                    <span className='shrink-0 text-xs text-foreground-secondary'>
                      {when(conversation.lastMessageAt)}
                    </span>
                  </span>
                  <span className='truncate text-[13px] text-foreground-secondary'>
                    {conversation.lastDirection === 'outbound' ? 'Tú: ' : ''}
                    {conversation.lastMessage}
                  </span>
                  <span className='mt-0.5 flex flex-wrap gap-1.5'>
                    <ModeChip mode={conversation.mode} />
                    {isWindowOpen(conversation, now) ? null : (
                      <span className={cn(chip, 'bg-warning-light text-warning-strong')}>
                        Ventana cerrada
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex flex-col gap-2.5 border-b border-border/60 p-3.5 pb-2.5'>
        <label htmlFor='whatsapp-search' className='sr-only'>
          Buscar conversación
        </label>
        <div className='flex h-10 items-center gap-2 rounded-lg bg-muted px-3 focus-within:ring-2 focus-within:ring-ring'>
          <Search className='h-4 w-4 shrink-0 text-foreground-secondary' aria-hidden />
          <input
            id='whatsapp-search'
            type='search'
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='Buscar por nombre o número'
            className='min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-secondary focus:outline-none'
          />
        </div>
        <div role='group' aria-label='Filtrar conversaciones' className='flex flex-wrap gap-1.5'>
          {FILTERS.map(item => (
            <button
              key={item.value}
              type='button'
              aria-pressed={filter === item.value}
              onClick={() => setFilter(item.value)}
              className={cn(
                'h-8 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === item.value
                  ? 'border-primary bg-primary-light text-foreground'
                  : 'border-input bg-card text-foreground-secondary hover:bg-muted'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>{body}</div>
    </div>
  );
}
