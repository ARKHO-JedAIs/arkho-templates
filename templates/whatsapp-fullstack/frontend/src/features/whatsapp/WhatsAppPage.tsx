import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, MessagesSquare, Plus, RefreshCw, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { WhatsAppIcon } from '@/components/brand/WhatsAppIcon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ContactAvatar } from './components/ContactAvatar';
import { ConversationList } from './components/ConversationList';
import { TemplateDialog } from './components/TemplateDialog';
import { useConversation } from './hooks/useConversation';
import { useConversations } from './hooks/useConversations';
import type { LiveState } from './realtime';
import { isWindowOpen, totalUnread, windowHoursLeft } from './services/mappers';
import {
  markConversationRead,
  sendMedia,
  sendMessage,
  sendTemplate,
  setControl,
  usingDemoData,
} from './services/whatsappService';
import type { ChatMessage, ControlMode, SendTemplateInput } from './types';

const LIVE_LABEL: Record<LiveState, { text: string; pill: string; dot: string }> = {
  connecting: { text: 'Conectando…', pill: 'bg-muted', dot: 'bg-muted-foreground' },
  live: { text: 'En vivo', pill: 'bg-success/10', dot: 'bg-success' },
  offline: { text: 'Sin tiempo real', pill: 'bg-muted', dot: 'bg-muted-foreground' },
  error: { text: 'Tiempo real caído', pill: 'bg-warning-light', dot: 'bg-warning' },
};

const pill = 'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs';

/** How often the 24 hour windows are re-checked while the page is open. */
const CLOCK_MS = 60_000;

/** The tab title without the "(N) " unread prefix this page adds. */
const withoutCounter = (title: string) => title.replace(/^\(\d+\) /, '');

export function WhatsAppPage() {
  const navigate = useNavigate();
  const inbox = useConversations();
  const [selected, setSelected] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templatePhone, setTemplatePhone] = useState<string | null>(null);
  const [changingControl, setChangingControl] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const thread = useConversation(selected);

  const sessionExpired = inbox.authError || thread.authError;
  useEffect(() => {
    if (sessionExpired) void navigate({ to: '/login' });
  }, [sessionExpired, navigate]);

  // A window closes with nobody writing: tick so the pill and the composer follow.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const conversation = inbox.conversations.find(item => item.phone === selected) ?? null;
  const windowOpen = isWindowOpen(conversation, now);
  const hoursLeft = windowHoursLeft(conversation, now);

  // The open conversation is being read: on opening it, and whenever a new
  // message raises its counter while it stays open.
  const { apply } = inbox;
  const unread = conversation?.unreadCount ?? 0;
  const reading = useRef<string | null>(null);
  useEffect(() => {
    if (!conversation || unread === 0 || reading.current === conversation.phone) return;
    const phone = conversation.phone;
    reading.current = phone;
    apply({ ...conversation, unreadCount: 0 });
    markConversationRead(phone)
      .then(updated => {
        if (updated) apply(updated);
      })
      .catch(() => {
        // The badge comes back with the next inbox update; nothing to tell the user.
      })
      .finally(() => {
        if (reading.current === phone) reading.current = null;
      });
  }, [conversation, unread, apply]);

  // "(3) " in the tab title while the page is open: unread messages at a glance.
  const total = totalUnread(inbox.conversations);
  useEffect(() => {
    const base = withoutCounter(document.title);
    document.title = total > 0 ? `(${total}) ${base}` : base;
  }, [total]);
  useEffect(
    () => () => {
      document.title = withoutCounter(document.title);
    },
    []
  );

  const send = async (text: string) => {
    if (!selected) return;
    try {
      const message = await sendMessage(selected, text);
      if (message) thread.add(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.');
      throw err;
    }
  };

  const sendFile = async (
    file: File,
    mimeType: string,
    caption: string,
    onProgress: (fraction: number) => void
  ) => {
    if (!selected) return;
    try {
      const message = await sendMedia(selected, file, mimeType, caption, onProgress);
      if (message) thread.add(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar el archivo.');
      throw err;
    }
  };

  /** A failed message goes out again as a new one, through the same path. */
  const retry = (message: ChatMessage) => send(message.text);

  const sendTemplateMessage = async (input: SendTemplateInput) => {
    const message = await sendTemplate(input);
    toast.success('Plantilla enviada.');
    if (message && input.phone === selected) thread.add(message);
    if (!selected) inbox.reload();
  };

  const openTemplate = (phone: string | null) => {
    setTemplatePhone(phone);
    setTemplateOpen(true);
  };

  const changeControl = async (mode: ControlMode) => {
    if (!conversation || conversation.mode === mode || changingControl) return;
    setChangingControl(true);
    try {
      const updated = await setControl(conversation.phone, mode);
      if (updated) inbox.apply(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar quién responde.');
    } finally {
      setChangingControl(false);
    }
  };

  const live = LIVE_LABEL[thread.live];
  const mode = conversation?.mode ?? 'assistant';
  const segment =
    'flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h1 className='flex items-center gap-2.5 text-2xl font-bold leading-tight text-foreground'>
            <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-whatsapp text-whatsapp-foreground'>
              <WhatsAppIcon className='h-[22px] w-[22px]' />
            </span>
            WhatsApp
          </h1>
          <p className='mt-1 text-sm text-foreground-secondary'>
            {usingDemoData
              ? 'Datos de demostración: nada sale del navegador.'
              : 'Conversaciones de tu número de WhatsApp Business.'}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='icon'
            className='h-11 w-11 rounded-[10px]'
            onClick={inbox.reload}
            title='Recargar'
            aria-label='Recargar'
          >
            <RefreshCw className='h-[18px] w-[18px]' aria-hidden />
          </Button>
          <Button className='h-11 rounded-[10px] font-semibold' onClick={() => openTemplate(null)}>
            <Plus className='h-4 w-4' aria-hidden />
            Nueva conversación
          </Button>
        </div>
      </div>

      <div className='flex min-h-[28rem] flex-1 gap-4'>
        <aside
          aria-label='Conversaciones'
          className={cn(
            'w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card md:w-80 lg:w-[22rem]',
            selected ? 'hidden md:flex' : 'flex'
          )}
        >
          {inbox.error ? (
            <p className='px-4 py-10 text-center text-sm text-destructive-strong'>{inbox.error}</p>
          ) : (
            <ConversationList
              conversations={inbox.conversations}
              selected={selected}
              onSelect={setSelected}
              loading={inbox.loading}
              now={now}
            />
          )}
        </aside>

        {selected ? (
          <ChatThread
            messages={thread.messages}
            loading={thread.loading}
            error={thread.error}
            onReload={thread.reload}
            onRetry={windowOpen ? retry : undefined}
            canLoadOlder={thread.canLoadOlder}
            loadingOlder={thread.loadingOlder}
            onLoadOlder={thread.loadOlder}
            onMediaExpired={thread.reload}
            header={
              <div className='flex flex-wrap items-center justify-between gap-2.5'>
                <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2'>
                  <div className='flex min-w-0 items-center gap-2.5'>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='-ml-2 h-11 w-11 md:hidden'
                      onClick={() => setSelected(null)}
                      title='Volver'
                      aria-label='Volver'
                    >
                      <ArrowLeft className='h-5 w-5' aria-hidden />
                    </Button>
                    <ContactAvatar
                      name={conversation?.name ?? ''}
                      phone={selected}
                      className='size-10'
                    />
                    <div className='min-w-0'>
                      <p className='truncate text-[15px] font-semibold text-foreground'>
                        {conversation?.name || `+${selected}`}
                      </p>
                      <p className='text-xs text-foreground-secondary'>+{selected}</p>
                    </div>
                  </div>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className={cn(pill, 'font-semibold text-foreground', live.pill)}>
                      <span className={cn('h-[7px] w-[7px] rounded-full', live.dot)} aria-hidden />
                      {live.text}
                    </span>
                    {windowOpen ? (
                      <span className={cn(pill, 'bg-muted font-medium text-foreground')}>
                        Ventana abierta · quedan {hoursLeft} h
                      </span>
                    ) : (
                      <span
                        className={cn(pill, 'bg-warning-light font-semibold text-warning-strong')}
                      >
                        Ventana cerrada
                      </span>
                    )}
                  </div>
                </div>
                <div
                  role='group'
                  aria-label='Quién responde'
                  className='flex items-center gap-1 rounded-xl bg-muted p-1'
                >
                  <button
                    type='button'
                    aria-pressed={mode === 'assistant'}
                    onClick={() => void changeControl('assistant')}
                    disabled={!conversation || changingControl}
                    title='Las respuestas automáticas contestan esta conversación'
                    className={cn(
                      segment,
                      mode === 'assistant'
                        ? 'bg-agent-strong text-agent-foreground shadow-sm'
                        : 'text-foreground-secondary hover:text-foreground'
                    )}
                  >
                    <Sparkles className='h-4 w-4' aria-hidden />
                    Agente IA
                  </button>
                  <button
                    type='button'
                    aria-pressed={mode === 'human'}
                    onClick={() => void changeControl('human')}
                    disabled={!conversation || changingControl}
                    title='Pausa las respuestas automáticas mientras atiendes'
                    className={cn(
                      segment,
                      mode === 'human'
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-foreground-secondary hover:text-foreground'
                    )}
                  >
                    <UserRound className='h-4 w-4' aria-hidden />
                    Persona
                  </button>
                </div>
              </div>
            }
            footer={
              <Composer
                windowOpen={windowOpen}
                mode={mode}
                onSend={send}
                onSendMedia={sendFile}
                onTemplate={() => openTemplate(selected)}
                onTakeOver={() => void changeControl('human')}
                takingOver={changingControl}
              />
            }
          />
        ) : (
          <div className='chat-wallpaper hidden flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-border text-sm text-foreground-secondary md:flex'>
            <span className='flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-sm'>
              <MessagesSquare className='h-6 w-6' aria-hidden />
            </span>
            <p className='rounded-full bg-card px-3 py-1 shadow-sm'>Elige una conversación.</p>
          </div>
        )}
      </div>

      <TemplateDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        phone={templatePhone}
        onSend={sendTemplateMessage}
      />
    </div>
  );
}

export default WhatsAppPage;
