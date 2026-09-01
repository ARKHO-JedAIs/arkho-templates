import { X } from 'lucide-react';
import type { ChatAttachment } from '../types/chat.types';

interface AttachmentThumbnailStripProps {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
}

export function AttachmentThumbnailStrip({ attachments, onRemove }: AttachmentThumbnailStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div className='flex gap-2 overflow-x-auto px-3 sm:px-4 pt-3'>
      {attachments.map(attachment => (
        <div
          key={attachment.id}
          className='relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted'
        >
          <img src={attachment.previewUrl} alt='' className='w-full h-full object-cover' />

          {attachment.status === 'uploading' && (
            <div className='absolute inset-x-0 bottom-0 h-1 bg-black/10'>
              <div
                className='h-full bg-primary transition-[width] duration-150'
                style={{ width: `${attachment.progress}%` }}
              />
            </div>
          )}

          {attachment.status === 'error' && (
            <div className='absolute inset-0 flex items-center justify-center bg-card/80 text-[10px] font-medium text-destructive text-center px-1'>
              Error
            </div>
          )}

          <button
            type='button'
            onClick={() => onRemove(attachment.id)}
            aria-label='Quitar imagen'
            className='absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80'
          >
            <X className='w-2.5 h-2.5' />
          </button>
        </div>
      ))}
    </div>
  );
}
