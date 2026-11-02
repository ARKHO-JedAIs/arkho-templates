import { Skeleton } from '@/components/ui/skeleton';

/**
 * Shown while a section's chunk is in flight.
 *
 * Section pages are code-split, so there is a real gap between navigating and
 * having something to render. The router debounces this (`defaultPendingMs`), so
 * on a warm cache it never appears; on a cold one it replaces a blank frame.
 */
export function SectionPending() {
  return (
    <div className='flex flex-col gap-4 py-2' role='status' aria-label='Cargando sección'>
      <Skeleton className='h-8 w-48' />
      <Skeleton className='h-4 w-72' />
      <Skeleton className='h-64 w-full rounded-xl' />
    </div>
  );
}
