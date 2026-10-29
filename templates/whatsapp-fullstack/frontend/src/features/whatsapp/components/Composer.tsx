import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  Clock,
  FileAudio,
  FileText,
  FileVideo,
  Loader2,
  Paperclip,
  SendHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ATTACHMENT_ACCEPT, checkAttachment } from '../services/attachments';
import { formatBytes } from '../services/mappers';
import type { ControlMode, MediaKind } from '../types';

interface Attachment {
  file: File;
  mimeType: string;
  kind: Exclude<MediaKind, 'sticker'>;
  /** An object URL for the image preview. */
  preview: string | null;
}

const ATTACHMENT_ICON = { audio: FileAudio, video: FileVideo, document: FileText } as const;

const progressStyle = (fraction: number) => ({ width: `${Math.round(fraction * 100)}%` });

interface ComposerProps {
  /** False outside WhatsApp's 24 hour window: only a template can be sent then. */
  windowOpen: boolean;
  /** Who answers: while the AI agent does, the person has to take the conversation first. */
  mode: ControlMode;
  onSend: (text: string) => Promise<void>;
  /** Uploads and sends a file; without it there is no attach button. */
  onSendMedia?: (
    file: File,
    mimeType: string,
    caption: string,
    onProgress: (fraction: number) => void
  ) => Promise<void>;
  onTemplate: () => void;
  /** Hands the conversation to a person (mode `human`). */
  onTakeOver: () => void;
  takingOver?: boolean;
}

export function Composer({
  windowOpen,
  mode,
  onSend,
  onSendMedia,
  onTemplate,
  onTakeOver,
  takingOver,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const preview = attachment?.preview;
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [attachment]);

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared so picking the same file again still fires a change.
    event.target.value = '';
    if (!file) return;
    const check = checkAttachment(file);
    if (!check.ok) {
      toast.error(check.error);
      return;
    }
    setAttachment({
      file,
      mimeType: check.mimeType,
      kind: check.kind,
      preview: check.kind === 'image' ? URL.createObjectURL(file) : null,
    });
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = text.trim();
    if (sending) return;
    if (attachment && onSendMedia) {
      setSending(true);
      setProgress(0);
      try {
        // WhatsApp takes no caption on audio.
        await onSendMedia(
          attachment.file,
          attachment.mimeType,
          attachment.kind === 'audio' ? '' : value,
          setProgress
        );
        setAttachment(null);
        setText('');
      } catch {
        // The page already told the user why; the file stays attached to retry.
      } finally {
        setSending(false);
        setProgress(null);
      }
      return;
    }
    if (!value) return;
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

  const Icon = attachment && attachment.kind !== 'image' ? ATTACHMENT_ICON[attachment.kind] : null;
  const captionAllowed = attachment?.kind !== 'audio';

  return (
    <form onSubmit={submit} className='flex flex-col gap-2 px-4 py-3'>
      {attachment ? (
        <div className='flex items-center gap-3 rounded-xl border border-border bg-background-secondary p-2'>
          {attachment.preview ? (
            <img
              src={attachment.preview}
              alt=''
              className='h-12 w-12 shrink-0 rounded-lg object-cover'
            />
          ) : Icon ? (
            <span className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary'>
              <Icon className='h-5 w-5' aria-hidden />
            </span>
          ) : null}
          <div className='min-w-0 flex-1'>
            <p className='truncate text-sm font-semibold text-foreground'>{attachment.file.name}</p>
            <p className='text-xs text-foreground-secondary'>
              {formatBytes(attachment.file.size)}
              {captionAllowed ? '' : ' · los audios se envían sin comentario'}
            </p>
            {progress !== null ? (
              <div
                className='mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted'
                role='progressbar'
                aria-label='Subiendo el archivo'
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                <div
                  className='h-full rounded-full bg-primary transition-[width]'
                  style={progressStyle(progress)}
                />
              </div>
            ) : null}
          </div>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='h-9 w-9 shrink-0 rounded-full'
            onClick={() => setAttachment(null)}
            disabled={sending}
            title='Quitar archivo'
            aria-label='Quitar archivo'
          >
            <X className='h-4 w-4' aria-hidden />
          </Button>
        </div>
      ) : null}
      <div className='flex items-end gap-2'>
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
        {onSendMedia ? (
          <>
            <input
              ref={picker}
              type='file'
              accept={ATTACHMENT_ACCEPT}
              onChange={pick}
              className='hidden'
              aria-hidden
              tabIndex={-1}
            />
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='h-11 w-11 shrink-0 rounded-full'
              onClick={() => picker.current?.click()}
              disabled={sending}
              title='Adjuntar archivo'
              aria-label='Adjuntar archivo'
            >
              <Paperclip className='h-[18px] w-[18px]' aria-hidden />
            </Button>
          </>
        ) : null}
        <Textarea
          value={text}
          onChange={event => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            attachment
              ? captionAllowed
                ? 'Añade un comentario (opcional)'
                : 'Los audios se envían sin comentario'
              : 'Escribe un mensaje · Enter envía, Shift+Enter salta línea'
          }
          rows={1}
          maxLength={attachment ? 1024 : 4096}
          disabled={Boolean(attachment) && !captionAllowed}
          className='max-h-40 min-h-11 resize-none rounded-[22px] bg-background-secondary px-4 py-[11px] shadow-none [field-sizing:content]'
          aria-label={attachment ? 'Comentario del archivo' : 'Mensaje'}
        />
        <Button
          type='submit'
          size='icon'
          className='h-11 w-11 shrink-0 rounded-full'
          disabled={(!text.trim() && !attachment) || sending}
          title='Enviar'
          aria-label='Enviar'
        >
          {sending ? (
            <Loader2 className='h-[18px] w-[18px] animate-spin' aria-hidden />
          ) : (
            <SendHorizontal className='h-[18px] w-[18px]' aria-hidden />
          )}
        </Button>
      </div>
    </form>
  );
}
