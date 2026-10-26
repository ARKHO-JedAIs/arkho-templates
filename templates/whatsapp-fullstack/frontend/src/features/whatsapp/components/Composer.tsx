import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { FileText, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ComposerProps {
  /** False outside WhatsApp's 24 hour window: only a template can be sent then. */
  windowOpen: boolean;
  onSend: (text: string) => Promise<void>;
  onTemplate: () => void;
}

export function Composer({ windowOpen, onSend, onTemplate }: ComposerProps) {
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
      <div className='flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <p className='text-sm text-muted-foreground'>
          El contacto no escribe hace más de 24 horas: WhatsApp solo permite enviarle una plantilla
          aprobada.
        </p>
        <Button size='sm' onClick={onTemplate}>
          <FileText className='h-4 w-4' aria-hidden />
          Enviar plantilla
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className='flex items-end gap-2'>
      <Textarea
        value={text}
        onChange={event => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder='Escribe un mensaje'
        rows={1}
        maxLength={4096}
        className='min-h-10 resize-none'
        aria-label='Mensaje'
      />
      <Button type='button' variant='outline' size='icon' onClick={onTemplate} title='Plantilla'>
        <FileText className='h-4 w-4' aria-hidden />
        <span className='sr-only'>Enviar plantilla</span>
      </Button>
      <Button type='submit' size='icon' disabled={!text.trim() || sending} title='Enviar'>
        {sending ? (
          <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
        ) : (
          <Send className='h-4 w-4' aria-hidden />
        )}
        <span className='sr-only'>Enviar</span>
      </Button>
    </form>
  );
}
