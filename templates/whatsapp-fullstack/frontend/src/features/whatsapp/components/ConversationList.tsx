import { Loader2, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Conversation } from '../types';

interface ConversationListProps {
  conversations: readonly Conversation[];
  selected: string | null;
  onSelect: (phone: string) => void;
  loading: boolean;
}

const short = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' });
const hour = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });

function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString() ? hour.format(date) : short.format(date);
}

export function ConversationList({
  conversations,
  selected,
  onSelect,
  loading,
}: ConversationListProps) {
  if (loading && conversations.length === 0) {
    return (
      <p className='flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground'>
        <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
        Cargando…
      </p>
    );
  }
  if (conversations.length === 0) {
    return (
      <p className='px-4 py-10 text-center text-sm text-muted-foreground'>
        Aún no hay conversaciones. Aparecen cuando alguien escribe al número, o al enviar una
        plantilla.
      </p>
    );
  }
  return (
    <ul className='divide-y divide-border'>
      {conversations.map(conversation => (
        <li key={conversation.phone}>
          <button
            type='button'
            onClick={() => onSelect(conversation.phone)}
            aria-current={conversation.phone === selected}
            className={cn(
              'flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              conversation.phone === selected && 'bg-primary/10'
            )}
          >
            <span className='flex items-center justify-between gap-2'>
              <span className='truncate text-sm font-medium text-foreground'>
                {conversation.name || `+${conversation.phone}`}
              </span>
              <span className='shrink-0 text-xs text-muted-foreground'>
                {when(conversation.lastMessageAt)}
              </span>
            </span>
            <span className='flex items-center gap-1.5'>
              {conversation.mode === 'human' ? (
                <UserRound
                  className='h-3.5 w-3.5 shrink-0 text-secondary'
                  aria-label='Atendida por una persona'
                />
              ) : null}
              <span className='truncate text-xs text-muted-foreground'>
                {conversation.lastDirection === 'outbound' ? 'Tú: ' : ''}
                {conversation.lastMessage}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
