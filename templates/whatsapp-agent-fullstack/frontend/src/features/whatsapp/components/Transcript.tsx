import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** The text of an audio message, hidden until asked for, as WhatsApp does. */
export function Transcript({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(current => !current)}
        className='flex w-fit items-center gap-1 rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        {open ? 'Ocultar transcripción' : 'Ver transcripción'}
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>
      {open ? (
        <p
          id={id}
          className='whitespace-pre-wrap break-words text-sm italic text-foreground-secondary'
        >
          “{text}”
        </p>
      ) : null}
    </div>
  );
}
