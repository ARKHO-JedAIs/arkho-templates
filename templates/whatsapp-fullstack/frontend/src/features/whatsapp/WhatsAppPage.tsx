import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Bot, Plus, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChatThread } from './components/ChatThread';
import { Composer } from './components/Composer';
import { ConversationList } from './components/ConversationList';
import { TemplateDialog } from './components/TemplateDialog';
import { useConversation } from './hooks/useConversation';
import { useConversations } from './hooks/useConversations';
import type { LiveState } from './realtime';
import { isWindowOpen } from './services/mappers';
import { sendMessage, sendTemplate, setControl, usingDemoData } from './services/whatsappService';
import type { SendTemplateInput } from './types';

const LIVE_LABEL: Record<LiveState, { text: string; className: string }> = {
  connecting: { text: 'Conectando…', className: 'border-border text-muted-foreground' },
  live: { text: 'En vivo', className: 'border-success/30 bg-success/10 text-success' },
  offline: { text: 'Sin tiempo real', className: 'border-border text-muted-foreground' },
  error: { text: 'Tiempo real caído', className: 'border-warning/30 bg-warning/10 text-warning' },
};

export function WhatsAppPage() {
  const navigate = useNavigate();
  const inbox = useConversations();
  const [selected, setSelected] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templatePhone, setTemplatePhone] = useState<string | null>(null);
  const [changingControl, setChangingControl] = useState(false);
  const thread = useConversation(selected);

  const sessionExpired = inbox.authError || thread.authError;
  useEffect(() => {
    if (sessionExpired) void navigate({ to: '/login' });
  }, [sessionExpired, navigate]);

  const conversation = inbox.conversations.find(item => item.phone === selected) ?? null;
  const windowOpen = isWindowOpen(conversation);

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

  const toggleControl = async () => {
    if (!conversation) return;
    setChangingControl(true);
    try {
      const updated = await setControl(
        conversation.phone,
        conversation.mode === 'human' ? 'assistant' : 'human'
      );
      if (updated) inbox.apply(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo cambiar quién responde.');
    } finally {
      setChangingControl(false);
    }
  };

  const live = LIVE_LABEL[thread.live];

  return (
    <div className='flex h-full min-h-0 flex-col gap-4'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold leading-tight text-foreground'>WhatsApp</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            {usingDemoData
              ? 'Datos de demostración: nada sale del navegador.'
              : 'Conversaciones de tu número de WhatsApp Business.'}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' size='icon' onClick={inbox.reload} title='Recargar'>
            <RefreshCw className='h-4 w-4' aria-hidden />
            <span className='sr-only'>Recargar</span>
          </Button>
          <Button onClick={() => openTemplate(null)}>
            <Plus className='h-4 w-4' aria-hidden />
            Nueva conversación
          </Button>
        </div>
      </div>

      <div className='flex min-h-[28rem] flex-1 gap-4'>
        <aside
          className={cn(
            'w-full shrink-0 overflow-y-auto rounded-2xl border border-border bg-card md:w-80',
            selected && 'hidden md:block'
          )}
        >
          {inbox.error ? (
            <p className='px-4 py-10 text-center text-sm text-destructive'>{inbox.error}</p>
          ) : (
            <ConversationList
              conversations={inbox.conversations}
              selected={selected}
              onSelect={setSelected}
              loading={inbox.loading}
            />
          )}
        </aside>

        {selected ? (
          <ChatThread
            messages={thread.messages}
            loading={thread.loading}
            error={thread.error}
            onRetry={thread.reload}
            header={
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='flex min-w-0 items-center gap-2'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='md:hidden'
                    onClick={() => setSelected(null)}
                    title='Volver'
                  >
                    <ArrowLeft className='h-4 w-4' aria-hidden />
                    <span className='sr-only'>Volver</span>
                  </Button>
                  <div className='min-w-0'>
                    <p className='truncate font-medium text-foreground'>
                      {conversation?.name || `+${selected}`}
                    </p>
                    <p className='text-xs text-muted-foreground'>+{selected}</p>
                  </div>
                  <Badge variant='outline' className={live.className}>
                    {live.text}
                  </Badge>
                </div>
                <Button
                  variant={conversation?.mode === 'human' ? 'secondary' : 'outline'}
                  size='sm'
                  onClick={toggleControl}
                  disabled={!conversation || changingControl}
                  title={
                    conversation?.mode === 'human'
                      ? 'Las respuestas automáticas están pausadas'
                      : 'Pausa las respuestas automáticas mientras atiendes'
                  }
                >
                  {conversation?.mode === 'human' ? (
                    <>
                      <Bot className='h-4 w-4' aria-hidden />
                      Devolver al asistente
                    </>
                  ) : (
                    <>
                      <UserRound className='h-4 w-4' aria-hidden />
                      Tomar conversación
                    </>
                  )}
                </Button>
              </div>
            }
            footer={
              <Composer
                windowOpen={windowOpen}
                onSend={send}
                onTemplate={() => openTemplate(selected)}
              />
            }
          />
        ) : (
          <div className='hidden flex-1 items-center justify-center rounded-2xl border border-dashed border-border text-sm text-muted-foreground md:flex'>
            Elige una conversación.
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
