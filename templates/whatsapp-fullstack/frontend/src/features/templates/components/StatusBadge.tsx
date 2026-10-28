import type { TemplateQuality } from '@/features/whatsapp/types';
import { cn } from '@/lib/utils';
import { QUALITY_META, statusMeta } from '../templateStatus';

/** A review state: tint, icon and word, so the colour is never the only signal. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        meta.badge,
        className
      )}
    >
      <Icon className='h-3.5 w-3.5 shrink-0' aria-hidden />
      {meta.label}
    </span>
  );
}

export function QualityLabel({ quality }: { quality: TemplateQuality }) {
  const meta = QUALITY_META[quality];
  return (
    <span className='inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-foreground'>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}
