import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  FileText,
  Loader2,
  RotateCw,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { templateParts } from '../services/mappers';
import type { ChatMessage, MessageStatus } from '../types';
import { formatMessage } from './formatMessage';

interface ChatThreadProps {
  messages: readonly ChatMessage[];
  header?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: string | null;
  /** Loads the conversation again after `error`. */
  onReload?: () => void;
  /** Sends a failed text message again; without it the bubble only says it failed. */
  onRetry?: (message: ChatMessage) => Promise<void> | void;
  /** Older messages exist and can be asked for. */
  canLoadOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}

const STATUS_LABEL: Record<MessageStatus, string> = {
  sent: 'Enviado',
  delivered: 'Entregado',
  read: 'Leído',
  failed: 'No se pudo entregar',
};

/**
 * WhatsApp's ticks: one when sent, two when delivered, two in blue when read.
 * The blue is --info, never the brand: a brand colour close to grey would make
 * "read" indistinguishable from "delivered".
 */
function StatusIcon({ status }: { status: Exclude<MessageStatus, 'failed'> }) {
  const Icon = status === 'sent' ? Check : CheckCheck;
  return (
    <Icon
      className={cn('h-3.5 w-3.5', status === 'read' && 'text-info')}
      role='img'
      aria-label={STATUS_LABEL[status]}
    />
  );
}

/** The line above one of our bubbles: who wrote it. */
function Author({ message }: { message: ChatMessage }) {
  if (message.direction !== 'out') return null;
  if (message.sentBy) {
    return (
      <span className='flex items-center gap-1 px-1 text-[11px] font-semibold text-foreground-secondary'>
        <UserRound className='h-3 w-3 shrink-0' aria-hidden />
        {message.sentBy}
      </span>
    );
  }
  // An automatic outbound text is the AI agent; a template without a person
  // was sent by the backend itself, and its bubble already says "Plantilla".
  if (message.kind === 'template') return null;
  return (
    <span className='flex items-center gap-1 px-1 text-[11px] font-bold text-agent-strong'>
      <Sparkles className='h-3 w-3 shrink-0' aria-hidden />
      Agente IA
    </span>
  );
}

const time = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
const longDay = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

function dayLabel(date: Date, now = new Date()): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Hoy';
  if (dayKey(date) === dayKey(yesterday)) return 'Ayer';
  const label = longDay.format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** One conversation, its messages grouped by day: the contact on the left, us on the right. */
export function ChatThread({
  messages,
  header,
  footer,
  loading,
  error,
  onReload,
  onRetry,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
}: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  // What was on screen last render, to tell a new message (scroll to it) from
  // older ones loaded above (keep the reader where they were).
  const last = useRef<{ newest?: string; height: number }>({ height: 0 });
  // Failed messages being sent again, so their button cannot fire twice.
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());

  const days = useMemo(() => {
    const groups: { key: string; label: string; messages: ChatMessage[] }[] = [];
    for (const message of messages) {
      const date = new Date(message.timestamp);
      const key = dayKey(date);
      const group = groups.at(-1);
      if (group && group.key === key) group.messages.push(message);
      else groups.push({ key, label: dayLabel(date), messages: [message] });
    }
    return groups;
  }, [messages]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const newest = messages.at(-1)?.id;
    if (newest !== last.current.newest) {
      element.scrollTop = element.scrollHeight;
    } else {
      // Older messages went in above: keep the same message under the eye.
      element.scrollTop += element.scrollHeight - last.current.height;
    }
    last.current = { newest, height: element.scrollHeight };
  }, [messages]);

  const retry = async (message: ChatMessage) => {
    if (!onRetry || retrying.has(message.id)) return;
    setRetrying(current => new Set(current).add(message.id));
    try {
      await onRetry(message);
    } catch {
      // The page already told the user why; the bubble stays as failed.
    } finally {
      setRetrying(current => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };

  return (
    <section className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card'>
      {header ? <header className='border-b border-border/60 px-4 py-3'>{header}</header> : null}
      <div
        ref={scroller}
        className='chat-wallpaper min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5'
        aria-live='polite'
        aria-busy={loading}
      >
        {loading && messages.length === 0 ? (
          <p className='mx-auto flex w-fit items-center justify-center gap-2 rounded-lg bg-card px-3 py-2 text-sm text-foreground-secondary shadow-sm'>
            <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
            Cargando mensajes…
          </p>
        ) : error ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='flex items-start gap-2 rounded-lg bg-card px-3 py-2 text-sm text-destructive-strong shadow-sm'>
              <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' aria-hidden />
              {error}
            </p>
            {onReload ? (
              <Button variant='outline' size='sm' onClick={onReload}>
                Reintentar
              </Button>
            ) : null}
          </div>
        ) : messages.length === 0 ? (
          <p className='mx-auto w-fit rounded-lg bg-card px-3 py-2 text-center text-sm text-foreground-secondary shadow-sm'>
            Todavía no hay mensajes.
          </p>
        ) : (
          <div className='flex flex-col gap-3'>
            {canLoadOlder && onLoadOlder ? (
              <div className='flex justify-center'>
                <Button
                  variant='outline'
                  size='sm'
                  className='rounded-full'
                  onClick={onLoadOlder}
                  disabled={loadingOlder}
                >
                  {loadingOlder ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden /> : null}
                  Ver mensajes anteriores
                </Button>
              </div>
            ) : null}
            {days.map(day => (
              <div key={day.key} className='flex flex-col gap-1.5'>
                <p className='sticky top-0 z-10 mx-auto my-1 rounded-full bg-card px-3 py-1 text-xs font-semibold text-foreground-secondary shadow-sm'>
                  {day.label}
                </p>
                {day.messages.map(message => (
                  <Bubble
                    key={message.id}
                    message={message}
                    onRetry={onRetry && message.kind === 'text' ? retry : undefined}
                    retrying={retrying.has(message.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {footer ? <footer className='border-t border-border/60'>{footer}</footer> : null}
    </section>
  );
}

interface BubbleProps {
  message: ChatMessage;
  onRetry?: (message: ChatMessage) => void;
  retrying: boolean;
}

/** One message: white on the left for the contact, the brand's soft tint on the right for us. */
function Bubble({ message, onRetry, retrying }: BubbleProps) {
  const inbound = message.direction === 'in';
  const failed = !inbound && message.status === 'failed';
  const template = message.kind === 'template' ? templateParts(message.text) : null;
  const text = template ? template.detail : message.text;

  return (
    <div
      className={cn(
        'flex max-w-[85%] flex-col gap-0.5 sm:max-w-[70%]',
        inbound ? 'items-start self-start' : 'items-end self-end'
      )}
    >
      <Author message={message} />
      <div
        className={cn(
          // The square corner is the bubble's "tail", on the speaker's side.
          'rounded-2xl px-3 py-2 text-sm leading-relaxed text-foreground shadow-sm',
          inbound ? 'rounded-tl-[4px] bg-card' : 'rounded-tr-[4px]',
          !inbound &&
            (failed ? 'border border-destructive/30 bg-destructive-light' : 'bg-primary-light'),
          message.kind === 'template' && !failed && 'border border-dashed border-primary'
        )}
      >
        {message.kind === 'template' ? (
          <p className='mb-1 flex items-center gap-1.5 text-[11px] font-bold text-foreground-secondary'>
            <FileText className='h-3 w-3 shrink-0' aria-hidden />
            <span>
              PLANTILLA
              {template ? ` · ${template.name}` : null}
            </span>
          </p>
        ) : null}
        {text ? (
          <p className='whitespace-pre-wrap break-words'>{formatMessage(text)}</p>
        ) : template ? (
          <p className='text-xs text-foreground-secondary'>Idioma: {template.language}</p>
        ) : null}
        <p
          className={cn(
            'mt-1 flex items-center justify-end gap-1 text-[11px]',
            failed ? 'text-destructive-strong' : 'text-foreground-secondary'
          )}
        >
          <time dateTime={message.timestamp}>{time.format(new Date(message.timestamp))}</time>
          {failed ? (
            <span className='flex items-center gap-1 font-semibold' title={message.error}>
              <AlertCircle className='h-3.5 w-3.5' aria-hidden />
              {STATUS_LABEL.failed}
              {message.error ? <span className='sr-only'>: {message.error}</span> : null}
            </span>
          ) : !inbound && message.status && message.status !== 'failed' ? (
            <StatusIcon status={message.status} />
          ) : null}
        </p>
      </div>
      {failed && onRetry ? (
        <button
          type='button'
          onClick={() => onRetry(message)}
          disabled={retrying}
          aria-label={`Reintentar el envío de «${message.text.slice(0, 60)}»`}
          className='flex items-center gap-1 rounded px-1 py-1 text-xs font-semibold text-destructive-strong underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
        >
          {retrying ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden />
          ) : (
            <RotateCw className='h-3.5 w-3.5' aria-hidden />
          )}
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
