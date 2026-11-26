import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HelpTipProps {
  /** The explanation, shown on hover or focus. */
  content: ReactNode;
  /** What the explanation is about; a help icon when omitted. */
  children?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/**
 * A short explanation on hover or focus. Its own provider, so it works on
 * screens outside the sidebar's. With `children` (for example a chip inside
 * a clickable row) the trigger is that element and is not focusable; the
 * explanation is then repeated for screen readers.
 */
export function HelpTip({ content, children, side = 'top', className }: HelpTipProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children ? (
            <span className={className}>
              {children}
              <span className='sr-only'>{content}</span>
            </span>
          ) : (
            <button
              type='button'
              aria-label='Ayuda'
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                className
              )}
            >
              <CircleHelp className='h-4 w-4' aria-hidden />
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent side={side} className='max-w-xs leading-relaxed'>
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
