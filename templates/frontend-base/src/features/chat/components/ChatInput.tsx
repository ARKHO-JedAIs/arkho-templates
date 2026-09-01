import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Mic, Paperclip, Send } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { chatConfig } from '../chatConfig';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { useImageAttachments } from '../hooks/useImageAttachments';
import { AttachmentThumbnailStrip } from './AttachmentThumbnailStrip';

interface ChatInputProps {
  disabled?: boolean;
  sessionId: string;
  onSend: (text: string, attachments?: { s3Key: string; previewUrl: string }[]) => void;
}

const MAX_TEXTAREA_HEIGHT_PX = 120;

function isEditableElement(element: Element | null): boolean {
  if (!element) return false;
  if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') return true;
  return (element as HTMLElement).isContentEditable;
}

export function ChatInput({ disabled, sessionId, onSend }: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef('');
  valueRef.current = value;
  // Whatever was already typed when voice input started - the live transcript
  // is composed on top of it, never overwrites it.
  const voiceBaseTextRef = useRef('');

  const {
    attachments,
    addFiles,
    removeAttachment,
    reset: resetAttachments,
    isUploading,
    uploadedTargets,
  } = useImageAttachments(sessionId);

  const handleFilesPicked = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  };

  const resizeTextarea = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  };

  const {
    state: voiceState,
    notice: voiceNotice,
    isSupported: isVoiceSupported,
    start: startVoice,
    stop: stopVoice,
  } = useVoiceInput(sessionText => {
    const base = voiceBaseTextRef.current;
    setValue((base ? `${base} ${sessionText}` : sessionText).trim());
    resizeTextarea();
  });

  const isListening = voiceState === 'listening';
  const isRequestingMic = voiceState === 'requesting-mic';
  const voiceActive = isListening || isRequestingMic;
  // Releasing the button doesn't end things instantly: the last words of the
  // sentence only arrive from Transcribe once the audio stream closes. Until
  // they do, the text in the box is incomplete - so the mic can't be pressed
  // again and the message can't be sent yet.
  const isFinishingVoice = voiceState === 'stopping';
  const voiceBusy = voiceActive || isFinishingVoice;

  // Push-to-talk, the way voice notes work in messaging apps: hold to record,
  // release to finish. Replaces tap-to-start plus an automatic pause cutoff,
  // which chopped a sentence in two whenever the user paused mid-thought to
  // value off a label.
  const beginHold = () => {
    if (disabled || voiceBusy) return;
    voiceBaseTextRef.current = valueRef.current;
    startVoice();
  };
  const endHold = () => {
    if (!voiceActive) return;
    stopVoice();
  };
  const holdRefs = useRef({ begin: beginHold, end: endHold });
  holdRefs.current = { begin: beginHold, end: endHold };

  // Keyboard equivalent of the same gesture: hold Space. Only while focus
  // isn't on something editable, so it never fights typing a literal space.
  useEffect(() => {
    if (!isVoiceSupported) return;

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;
      if (isEditableElement(document.activeElement)) return;
      event.preventDefault();
      holdRefs.current.begin();
    };
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.code !== 'Space') return;
      holdRefs.current.end();
    };
    // Losing the window mid-hold (alt-tab, a phone call) never delivers the
    // matching keyup/pointerup, so treat it as a release rather than leaving
    // the microphone open.
    const onWindowBlur = () => holdRefs.current.end();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isVoiceSupported]);

  const submit = () => {
    const text = value.trim();
    if (disabled || isUploading || voiceBusy) return;
    if (!text && uploadedTargets.length === 0) return;

    onSend(text, uploadedTargets);
    setValue('');
    resetAttachments();
    requestAnimationFrame(resizeTextarea);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  // Hand focus back once the assistant's reply finishes streaming (disabled
  // goes true -> false), so the user can reply right away. Not on mount,
  // where `disabled` merely starts out false.
  const wasDisabledRef = useRef(disabled);
  useEffect(() => {
    if (wasDisabledRef.current && !disabled) {
      textareaRef.current?.focus();
    }
    wasDisabledRef.current = disabled;
  }, [disabled]);

  return (
    <div className='border-t border-border bg-card'>
      {voiceNotice && (
        <div className='px-3 sm:px-4 pt-2 text-sm text-destructive'>{voiceNotice}</div>
      )}
      {/* A hold gesture has to say out loud that it is still capturing: the
          button state alone is easy to miss, and there is no automatic stop to
          fall back on. */}
      {voiceBusy && (
        <div
          className='flex items-center gap-2 px-3 sm:px-4 pt-2 text-sm text-foreground'
          role='status'
        >
          <span
            className={cn(
              'w-2 h-2 rounded-full',
              isFinishingVoice ? 'bg-muted-foreground' : 'bg-primary animate-pulse'
            )}
            aria-hidden
          />
          {isListening && 'Grabando… suelta para terminar'}
          {isRequestingMic && 'Preparando micrófono…'}
          {isFinishingVoice && 'Transcribiendo el final…'}
        </div>
      )}
      {chatConfig.imagesEnabled && (
        <AttachmentThumbnailStrip attachments={attachments} onRemove={removeAttachment} />
      )}
      <div className='flex items-end gap-2 p-3 sm:p-4'>
        {chatConfig.imagesEnabled && (
          <>
            <input
              ref={fileInputRef}
              type='file'
              accept='image/*'
              multiple
              onChange={handleFilesPicked}
              className='hidden'
            />
            <button
              type='button'
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label='Adjuntar imágenes'
              title='Adjuntar imágenes'
              className={cn(
                'flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl transition-colors duration-200',
                'bg-card border border-border text-foreground hover:bg-muted',
                'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed disabled:border-transparent'
              )}
            >
              <Paperclip className='w-4 h-4' />
            </button>
          </>
        )}

        <Textarea
          ref={textareaRef}
          value={value}
          onChange={event => {
            setValue(event.target.value);
            resizeTextarea();
          }}
          onKeyDown={handleKeyDown}
          placeholder='Escribe tu mensaje...'
          rows={1}
          disabled={disabled}
          className='min-h-[44px] max-h-[120px] resize-none rounded-xl border-border text-base focus-visible:ring-ring/30 focus-visible:border-primary'
        />

        {isVoiceSupported && (
          <div className='relative flex-shrink-0'>
            {isListening && (
              <span
                className='absolute inset-0 rounded-xl bg-primary animate-ping opacity-60'
                aria-hidden
              />
            )}
            <button
              type='button'
              // Pointer events rather than mouse/touch pairs: one code path for
              // finger, pen and mouse. Capturing the pointer means the release
              // still reaches this button even if the finger slides off it
              // while talking, which is easy to do one-handed on a phone.
              onPointerDown={event => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                beginHold();
              }}
              onPointerUp={endHold}
              onPointerCancel={endHold}
              // Long-press on mobile would otherwise pop the context menu or
              // start a text selection over the button.
              onContextMenu={event => event.preventDefault()}
              disabled={disabled || isFinishingVoice}
              aria-label={
                voiceActive ? 'Grabando, suelta para terminar' : 'Mantén presionado para hablar'
              }
              aria-pressed={isListening}
              title='Mantén presionado para hablar (o la barra espaciadora)'
              className={cn(
                'relative flex items-center justify-center w-11 h-11 rounded-xl transition-colors duration-200',
                // touch-none keeps the hold from scrolling the chat; select-none
                // stops the press turning into a text selection.
                'touch-none select-none',
                voiceActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card border border-border text-foreground hover:bg-muted',
                'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed disabled:border-transparent'
              )}
            >
              <Mic className='w-4 h-4' />
            </button>
          </div>
        )}

        <button
          type='button'
          onClick={submit}
          disabled={
            disabled || isUploading || voiceBusy || (!value.trim() && uploadedTargets.length === 0)
          }
          aria-label='Enviar mensaje'
          className={cn(
            'flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-xl transition-colors duration-200',
            'bg-primary hover:bg-primary/90 active:bg-primary/90 text-primary-foreground',
            'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed'
          )}
        >
          <Send className='w-4 h-4' />
        </button>
      </div>
    </div>
  );
}
