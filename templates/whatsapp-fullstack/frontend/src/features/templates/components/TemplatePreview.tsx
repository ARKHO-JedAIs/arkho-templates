import {
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Phone,
  Reply,
  Video,
} from 'lucide-react';
import { templateSegments } from '@/features/whatsapp/services/mappers';
import type { TemplateButton, WhatsAppTemplate } from '@/features/whatsapp/types';
import { cn } from '@/lib/utils';
import { variableToken } from '../templateStatus';

/** A variable inside a text, as a chip: it is replaced by a value when sent. */
export function VariableChip({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'mx-0.5 inline-flex items-center rounded-md border border-agent-border bg-agent-light px-1.5 py-px font-mono text-[0.8em] font-semibold text-agent-strong',
        className
      )}
    >
      {variableToken(name)}
    </span>
  );
}

function RichText({ text }: { text: string }) {
  return (
    <>
      {templateSegments(text).map((segment, index) =>
        segment.kind === 'text' ? (
          <span key={index}>{segment.value}</span>
        ) : (
          <VariableChip key={index} name={segment.name} />
        )
      )}
    </>
  );
}

const BUTTON_ICON: Record<string, typeof Reply> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
};

/** A media header the template will carry; the file itself is chosen when sending. */
export type PreviewMedia = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

const MEDIA: Record<PreviewMedia, { icon: typeof Reply; label: string }> = {
  IMAGE: { icon: ImageIcon, label: 'Imagen' },
  VIDEO: { icon: Video, label: 'Video' },
  DOCUMENT: { icon: FileText, label: 'Documento' },
};

function MediaPlaceholder({ media }: { media: PreviewMedia }) {
  const { icon: Icon, label } = MEDIA[media];
  return (
    <div className='mb-2 flex aspect-[16/9] flex-col items-center justify-center gap-1 rounded-md bg-muted text-foreground-secondary'>
      <Icon className='h-6 w-6' aria-hidden />
      <span className='text-xs font-medium'>{label}</span>
    </div>
  );
}

function PreviewButton({ button }: { button: TemplateButton }) {
  const Icon = BUTTON_ICON[button.type] ?? Reply;
  return (
    <div className='flex items-center justify-center gap-1.5 rounded-lg bg-card px-3 py-2 text-sm font-medium text-info-strong shadow-sm'>
      <Icon className='h-3.5 w-3.5' aria-hidden />
      {button.text}
    </div>
  );
}

/**
 * The template as the contact would see it in WhatsApp, with its variables
 * highlighted. `media` draws a placeholder for an image, video or document header.
 */
export function TemplatePreview({
  template,
  media,
}: {
  template: WhatsAppTemplate;
  media?: PreviewMedia;
}) {
  return (
    <div className='chat-wallpaper rounded-xl border border-border p-4'>
      <div className='max-w-[19rem]'>
        <div className='rounded-lg rounded-tl-none bg-card px-3 py-2 text-sm leading-relaxed text-foreground shadow-sm'>
          {media ? <MediaPlaceholder media={media} /> : null}
          {template.header ? (
            <p className='mb-1 font-bold'>
              <RichText text={template.header} />
            </p>
          ) : null}
          <p className='whitespace-pre-wrap break-words'>
            <RichText text={template.body} />
          </p>
          {template.footer ? (
            <p className='mt-1.5 text-xs text-foreground-secondary'>{template.footer}</p>
          ) : null}
        </div>
        {template.buttons.length > 0 ? (
          <div className='mt-1 flex flex-col gap-1'>
            {template.buttons.map((button, index) => (
              <PreviewButton key={`${button.type}-${index}`} button={button} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
