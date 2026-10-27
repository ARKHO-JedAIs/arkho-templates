import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { AlertCircle, Check, CheckCheck, FileText, Loader2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatMessage, MessageStatus } from '../types';
import { formatMessage } from './formatMessage';

interface ChatThreadProps {
  messages: readonly ChatMessage[];
  header?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
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

/** WhatsApp's ticks: one when sent, two when delivered, two in colour when read. */
function StatusIcon({ status, error }: { status: MessageStatus; error?: string }) {
  const label = error ? `${STATUS_LABEL[status]}: ${error}` : STATUS_LABEL[status];
  if (status === 'failed') {
    return <AlertCircle className='h-3.5 w-3.5 text-destructive' aria-label={label} />;
  }
  const Icon = status === 'sent' ? Check : CheckCheck;
  return (
    <Icon className={cn('h-3.5 w-3.5', status === 'read' && 'text-primary')} aria-label={label} />
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
  onRetry,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
}: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  // What was on screen last render, to tell a new message (scroll to it) from
  // older ones loaded above (keep the reader where they were).
  const last = useRef<{ newest?: string; height: number }>({ height: 0 });

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

  return (
    <section className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card'>
      {header ? <header className='border-b border-border px-4 py-3'>{header}</header> : null}
      <div
        ref={scroller}
        className='min-h-0 flex-1 overflow-y-auto bg-background-secondary/50 px-3 py-4 sm:px-5'
        aria-live='polite'
        aria-busy={loading}
      >
        {loading && messages.length === 0 ? (
          <p className='flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground'>
            <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
            Cargando mensajes…
          </p>
        ) : error ? (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='flex items-start gap-2 text-sm text-destructive'>
              <AlertCircle className='mt-0.5 h-4 w-4 shrink-0' aria-hidden />
              {error}
            </p>
            {onRetry ? (
              <Button variant='outline' size='sm' onClick={onRetry}>
                Reintentar
              </Button>
            ) : null}
          </div>
        ) : messages.length === 0 ? (
          <p className='py-10 text-center text-sm text-muted-foreground'>
            Todavía no hay mensajes.
          </p>
        ) : (
          <div className='flex flex-col gap-4'>
            {canLoadOlder && onLoadOlder ? (
              <div className='flex justify-center'>
                <Button variant='ghost' size='sm' onClick={onLoadOlder} disabled={loadingOlder}>
                  {loadingOlder ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden /> : null}
                  Ver mensajes anteriores
                </Button>
              </div>
            ) : null}
            {days.map(day => (
              <div key={day.key} className='flex flex-col gap-1.5'>
                <p className='sticky top-0 z-10 mx-auto my-1 rounded-full bg-card px-3 py-0.5 text-xs font-medium text-muted-foreground shadow-sm'>
                  {day.label}
                </p>
                {day.messages.map(message => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex flex-col',
                      message.direction === 'in' ? 'items-start' : 'items-end'
                    )}
                  >
                    {message.sentBy ? (
                      <span className='mb-0.5 flex items-center gap-1 px-1 text-xs font-medium text-foreground'>
                        <UserRound className='h-3 w-3 shrink-0 text-secondary' aria-hidden />
                        {message.sentBy}
                      </span>
                    ) : null}
                    <div
                      className={cn(
                        'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm sm:max-w-[70%]',
                        message.direction === 'in'
                          ? 'rounded-tl-md border border-border bg-card text-foreground'
                          : message.sentBy
                            ? 'rounded-tr-md border border-secondary/20 bg-secondary/10 text-foreground'
                            : 'rounded-tr-md bg-primary/10 text-foreground',
                        message.kind === 'template' && 'border border-dashed border-primary/40'
                      )}
                    >
                      {message.kind === 'template' ? (
                        <p className='mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
                          <FileText className='h-3.5 w-3.5' aria-hidden />
                          Plantilla
                        </p>
                      ) : null}
                      <p className='whitespace-pre-wrap break-words'>
                        {formatMessage(message.text)}
                      </p>
                      <p className='mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground'>
                        <time dateTime={message.timestamp}>
                          {time.format(new Date(message.timestamp))}
                        </time>
                        {message.direction === 'out' && message.status ? (
                          <StatusIcon status={message.status} error={message.error} />
                        ) : null}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {footer ? <footer className='border-t border-border p-3'>{footer}</footer> : null}
    </section>
  );
}
