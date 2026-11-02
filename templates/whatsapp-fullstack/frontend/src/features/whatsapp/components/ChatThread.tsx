import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCheck,
  FileText,
  Forward,
  Info,
  Loader2,
  Megaphone,
  RotateCw,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isMediaKind, templateParts } from '../services/mappers';
import type { ChatMessage, MessageStatus } from '../types';
import { formatMessage } from './formatMessage';
import {
  ContactCards,
  FlowCard,
  LocationCard,
  MediaView,
  OrderCard,
  QuotedBlock,
  ReplyView,
} from './MessageContent';

interface ChatThreadProps {
  messages: readonly ChatMessage[];
  /** How many were unread when this conversation was opened; draws the
   * "N mensajes no leídos" divider above the oldest of them, like WhatsApp. */
  unreadCount?: number;
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
  /** A file URL failed (they expire): reload the messages to get fresh ones. */
  onMediaExpired?: () => void;
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
  unreadCount = 0,
  header,
  footer,
  loading,
  error,
  onReload,
  onRetry,
  canLoadOlder,
  loadingOlder,
  onLoadOlder,
  onMediaExpired,
}: ChatThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  // What was on screen last render, to tell a new message (scroll to it) from
  // older ones loaded above (keep the reader where they were).
  const last = useRef<{ newest?: string; height: number }>({ height: 0 });
  // Failed messages being sent again, so their button cannot fire twice.
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(() => new Set());
  // Messages whose file URL was already refreshed once: a second failure is an
  // error, not another reload.
  const refreshed = useRef(new Set<string>());

  const byId = useMemo(() => new Map(messages.map(message => [message.id, message])), [messages]);

  // The oldest unread message: unreadCount only counts the contact's own
  // messages (ws-handler), so this walks back from the newest one counting
  // those, same as WhatsApp's own "N mensajes no leídos" line.
  const unreadDividerId = useMemo(() => {
    if (unreadCount <= 0) return null;
    let remaining = unreadCount;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].direction === 'in') {
        remaining -= 1;
        if (remaining === 0) return messages[i].id;
      }
    }
    return messages[0]?.id ?? null;
  }, [messages, unreadCount]);

  const expire = useCallback(
    (id: string) => {
      if (!onMediaExpired || refreshed.current.has(id)) return false;
      refreshed.current.add(id);
      onMediaExpired();
      return true;
    },
    [onMediaExpired]
  );

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
                  <Fragment key={message.id}>
                    {message.id === unreadDividerId ? <UnreadDivider count={unreadCount} /> : null}
                    {message.kind === 'system' ||
                    message.kind === 'request_welcome' ||
                    message.kind === 'event' ? (
                      <Notice message={message} />
                    ) : (
                      <Bubble
                        message={message}
                        quoted={message.replyTo ? byId.get(message.replyTo) : undefined}
                        onRetry={onRetry && message.kind === 'text' ? retry : undefined}
                        retrying={retrying.has(message.id)}
                        onMediaExpired={() => expire(message.id)}
                      />
                    )}
                  </Fragment>
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

/** "N mensajes no leídos" above the oldest unread message, like WhatsApp's own divider. */
function UnreadDivider({ count }: { count: number }) {
  return (
    <p className='sticky top-0 z-10 mx-auto my-1 rounded-full bg-success-light px-3 py-1 text-xs font-semibold text-success-strong shadow-sm'>
      {count === 1 ? '1 mensaje no leído' : `${count} mensajes no leídos`}
    </p>
  );
}

/** The text of an inbox notice: who took the conversation, or that the agent resumed. */
function eventText(message: ChatMessage): string {
  const event = message.event;
  if (event?.kind === 'human_takeover') return `${event.by || 'Una persona'} tomó la conversación`;
  if (event?.kind === 'assistant_resumed') return 'El Agente IA retomó la conversación';
  if (event?.kind === 'agent_handoff') return 'El Agente IA pasó la conversación a una persona';
  if (event?.kind === 'agent_failed')
    return 'El Agente IA no pudo responder: atiende tú esta conversación';
  return message.text || 'Aviso';
}

/** What is not a message from someone: centered, like WhatsApp's own notices. */
function Notice({ message }: { message: ChatMessage }) {
  if (message.kind === 'event') {
    const Icon = message.event?.kind === 'assistant_resumed' ? Sparkles : UserRound;
    return (
      <p className='mx-auto my-1 flex max-w-[85%] items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-center text-xs text-foreground-secondary shadow-sm'>
        <Icon className='h-3.5 w-3.5 shrink-0' aria-hidden />
        {eventText(message)} · {time.format(new Date(message.timestamp))}
      </p>
    );
  }
  return (
    <p className='mx-auto my-1 flex max-w-[85%] items-center gap-1.5 rounded-lg bg-card px-3 py-1.5 text-center text-xs text-foreground-secondary shadow-sm'>
      <Info className='h-3.5 w-3.5 shrink-0' aria-hidden />
      {message.kind === 'request_welcome'
        ? 'El contacto abrió el chat por primera vez.'
        : message.text || 'Aviso del sistema'}
    </p>
  );
}

/** The body of a bubble, by message type. */
function Content({
  message,
  text,
  onMediaExpired,
}: {
  message: ChatMessage;
  text: string;
  onMediaExpired: () => boolean;
}) {
  const plain = text ? (
    <p className='whitespace-pre-wrap break-words'>{formatMessage(text)}</p>
  ) : null;
  if (message.deleted) {
    return (
      <p className='flex items-center gap-1.5 italic text-foreground-secondary'>
        <Ban className='h-3.5 w-3.5' aria-hidden />
        Mensaje eliminado
      </p>
    );
  }
  if (isMediaKind(message.kind) && message.media) {
    const caption = message.media.caption;
    return (
      <div className='flex flex-col gap-1.5'>
        <MediaView
          key={message.media.url ?? 'none'}
          kind={message.kind}
          media={message.media}
          onExpired={onMediaExpired}
        />
        {caption ? (
          <p className='whitespace-pre-wrap break-words'>{formatMessage(caption)}</p>
        ) : null}
      </div>
    );
  }
  if (message.kind === 'location' && message.location) {
    return <LocationCard location={message.location} />;
  }
  if (message.kind === 'contacts' && message.contacts) {
    return <ContactCards contacts={message.contacts} />;
  }
  if (
    (message.kind === 'button_reply' ||
      message.kind === 'list_reply' ||
      message.kind === 'button') &&
    message.reply
  ) {
    return <ReplyView kind={message.kind} reply={message.reply} />;
  }
  if (message.kind === 'nfm_reply' && message.flow) {
    return (
      <div className='flex flex-col gap-1.5'>
        <FlowCard flow={message.flow} />
        {message.flow.body ? (
          <p className='text-xs text-foreground-secondary'>{message.flow.body}</p>
        ) : null}
      </div>
    );
  }
  if (message.kind === 'order' && message.order) return <OrderCard order={message.order} />;
  if (message.kind === 'unsupported') {
    return (
      <p className='flex items-center gap-1.5 italic text-foreground-secondary'>
        <AlertCircle className='h-3.5 w-3.5' aria-hidden />
        Tipo de mensaje no soportado
      </p>
    );
  }
  return plain;
}

interface BubbleProps {
  message: ChatMessage;
  /** The message `message.replyTo` points to, when it is loaded. */
  quoted?: ChatMessage;
  onRetry?: (message: ChatMessage) => void;
  retrying: boolean;
  onMediaExpired: () => boolean;
}

/** One message: white on the left for the contact, the brand's soft tint on the right for us. */
function Bubble({ message, quoted, onRetry, retrying, onMediaExpired }: BubbleProps) {
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
      {message.referral ? (
        <span className='flex items-center gap-1 px-1 text-[11px] font-semibold text-foreground-secondary'>
          <Megaphone className='h-3 w-3 shrink-0' aria-hidden />
          Desde anuncio
          {message.referral.headline ? `: ${message.referral.headline}` : null}
        </span>
      ) : null}
      <div
        className={cn(
          // The square corner is the bubble's "tail", on the speaker's side.
          'relative rounded-2xl px-3 py-2 text-sm leading-relaxed text-foreground shadow-sm',
          message.reaction && 'mb-3',
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
        {message.forwarded ? (
          <p className='mb-0.5 flex items-center gap-1 text-[11px] italic text-foreground-secondary'>
            <Forward className='h-3 w-3' aria-hidden />
            Reenviado
          </p>
        ) : null}
        {message.replyTo ? <QuotedBlock quoted={quoted} /> : null}
        {template && !text ? (
          <p className='text-xs text-foreground-secondary'>Idioma: {template.language}</p>
        ) : (
          <Content message={message} text={text} onMediaExpired={onMediaExpired} />
        )}
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
        {message.reaction ? (
          <span
            className={cn(
              'absolute -bottom-3 flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-card px-1 text-sm shadow-sm',
              inbound ? 'left-2' : 'right-2'
            )}
            role='img'
            aria-label={`Reacción: ${message.reaction}`}
          >
            {message.reaction}
          </span>
        ) : null}
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
