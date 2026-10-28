import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Clock, FileText, Loader2, SendHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ControlMode } from '../types';

interface ComposerProps {
  /** False outside WhatsApp's 24 hour window: only a template can be sent then. */
  windowOpen: boolean;
  /** Who answers: while the AI agent does, the person has to take the conversation first. */
  mode: ControlMode;
  onSend: (text: string) => Promise<void>;
  onTemplate: () => void;
  /** Hands the conversation to a person (mode `human`). */
  onTakeOver: () => void;
  takingOver?: boolean;
}

export function Composer({
  windowOpen,
  mode,
  onSend,
  onTemplate,
  onTakeOver,
  takingOver,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await onSend(value);
      setText('');
    } finally {
      setSending(false);
    }
  };

  // Enter sends, Shift+Enter breaks the line, as in WhatsApp Web.
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  if (!windowOpen) {
    return (
      <div className='flex flex-col gap-3 bg-warning-light/40 px-4 pb-5 pt-3.5'>
        <div className='flex items-start gap-2.5'>
          <Clock className='mt-0.5 h-5 w-5 shrink-0 text-warning-strong' aria-hidden />
          <p className='text-[13px] leading-normal text-foreground-secondary'>
            <strong className='font-semibold text-foreground'>
              Pasaron más de 24 h desde su último mensaje.
            </strong>{' '}
            WhatsApp solo permite escribirle con una plantilla aprobada. Si responde, la
            conversación se reabre.
          </p>
        </div>
        <Button size='lg' className='h-12 w-full rounded-xl px-4 font-bold' onClick={onTemplate}>
          <FileText className='h-[18px] w-[18px]' aria-hidden />
          Elegir plantilla
        </Button>
      </div>
    );
  }

  if (mode === 'assistant') {
    return (
      <div className='flex flex-wrap items-center justify-between gap-2.5 bg-agent-light px-4 py-3'>
        <div className='flex items-center gap-2.5'>
          <span className='agent-pulse flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-agent text-agent-foreground'>
            <Sparkles className='h-4 w-4' aria-hidden />
          </span>
          <p className='text-[13px] text-foreground-secondary'>
            <strong className='font-semibold text-foreground'>
              El Agente IA está respondiendo.
            </strong>{' '}
            Tómala para escribir tú.
          </p>
        </div>
        <Button className='rounded-lg font-bold' onClick={onTakeOver} disabled={takingOver}>
          {takingOver ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden /> : null}
          Tomar conversación
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className='flex items-end gap-2 px-4 py-3'>
      <Button
        type='button'
        variant='outline'
        size='icon'
        className='h-11 w-11 shrink-0 rounded-full'
        onClick={onTemplate}
        title='Enviar plantilla'
        aria-label='Enviar plantilla'
      >
        <FileText className='h-[18px] w-[18px]' aria-hidden />
      </Button>
      <Textarea
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder='Escribe un mensaje · Enter envía, Shift+Enter salta línea'
        rows={1}
        maxLength={4096}
        className='max-h-40 min-h-11 resize-none rounded-[22px] bg-background-secondary px-4 py-[11px] shadow-none [field-sizing:content]'
        aria-label='Mensaje'
      />
      <Button
        type='submit'
        size='icon'
        className='h-11 w-11 shrink-0 rounded-full'
        disabled={!text.trim() || sending}
        title='Enviar'
        aria-label='Enviar'
      >
        {sending ? (
          <Loader2 className='h-[18px] w-[18px] animate-spin' aria-hidden />
        ) : (
          <SendHorizontal className='h-[18px] w-[18px]' aria-hidden />
        )}
      </Button>
    </form>
  );
}
