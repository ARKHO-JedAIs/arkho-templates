import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Loading placeholders with the shape of what is coming, so a screen keeps its
 * layout while its data loads instead of showing a spinner and then jumping.
 * Each one is a `status` region named for screen readers.
 */

/** Rows with an avatar and two lines: conversations, contacts. */
export function AvatarRowsSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role='status' aria-label={label} className='divide-y divide-border/60'>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className='flex items-start gap-3 px-3.5 py-3'>
          <Skeleton className='h-10 w-10 shrink-0 rounded-full' />
          <div className='flex flex-1 flex-col gap-2 pt-0.5'>
            <div className='flex justify-between gap-2'>
              <Skeleton className='h-3.5 w-32' />
              <Skeleton className='h-3 w-10' />
            </div>
            <Skeleton className='h-3 w-4/5' />
            <Skeleton className='h-4 w-16 rounded-full' />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Chat bubbles on both sides. */
export function ChatSkeleton() {
  const bubbles = [
    { side: 'start', width: 'w-2/3' },
    { side: 'end', width: 'w-1/2' },
    { side: 'start', width: 'w-3/5' },
    { side: 'end', width: 'w-2/5' },
    { side: 'start', width: 'w-1/2' },
  ] as const;
  return (
    <div role='status' aria-label='Cargando mensajes' className='flex flex-col gap-3'>
      {bubbles.map((bubble, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-12 max-w-md rounded-2xl',
            bubble.width,
            bubble.side === 'end' && 'self-end'
          )}
        />
      ))}
    </div>
  );
}

/** Table-like rows: a title and a detail line, with a chip on the right. */
export function ListRowsSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div role='status' aria-label={label} className='divide-y divide-border'>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className='flex items-center justify-between gap-4 px-4 py-3.5'>
          <div className='flex flex-1 flex-col gap-2'>
            <Skeleton className='h-4 w-48' />
            <Skeleton className='h-3 w-72 max-w-full' />
          </div>
          <Skeleton className='h-5 w-20 rounded-full' />
        </div>
      ))}
    </div>
  );
}

/** A form: label and field pairs. */
export function FormSkeleton({ fields = 4, label }: { fields?: number; label: string }) {
  return (
    <div role='status' aria-label={label} className='flex flex-col gap-5'>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className='flex flex-col gap-2'>
          <Skeleton className='h-3.5 w-28' />
          <Skeleton className='h-10 w-full rounded-lg' />
        </div>
      ))}
    </div>
  );
}
