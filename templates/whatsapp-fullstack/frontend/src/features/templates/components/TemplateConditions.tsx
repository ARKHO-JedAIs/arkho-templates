import { useState } from 'react';
import { ChevronDown, ScrollText } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { TEMPLATE_CONDITIONS, TEMPLATE_RECOMMENDATIONS } from '../templateRules';

interface TemplateConditionsProps {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
}

/**
 * Meta's conditions for creating templates, read from `templateRules` (the
 * validator's own source), and the checkbox that confirms they were read. The
 * checkbox stays visible when the list is collapsed.
 */
export function TemplateConditions({ accepted, onAcceptedChange }: TemplateConditionsProps) {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-labelledby='template-conditions-title'
      className='rounded-2xl border border-border bg-card'
    >
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className='flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <span className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-light text-info-strong'>
            <ScrollText className='h-4 w-4' aria-hidden />
          </span>
          <span className='flex-1'>
            <span id='template-conditions-title' className='block font-semibold text-foreground'>
              Condiciones para crear plantillas
            </span>
            <span className='block text-xs text-foreground-secondary'>
              {open ? 'Ocultar' : 'Mostrar'} las reglas de Meta
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-foreground-secondary transition-transform',
              open && 'rotate-180'
            )}
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent className='border-t border-border px-4 py-3 text-sm text-foreground'>
          <ul className='flex list-disc flex-col gap-1.5 pl-5'>
            {TEMPLATE_CONDITIONS.map(condition => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
          <h3 className='mt-4 font-semibold text-foreground'>
            Recomendaciones de Meta (pueden causar rechazo)
          </h3>
          <ul className='mt-1.5 flex list-disc flex-col gap-1.5 pl-5'>
            {TEMPLATE_RECOMMENDATIONS.map(recommendation => (
              <li key={recommendation}>{recommendation}</li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
      <div className='flex items-center gap-2.5 border-t border-border px-4 py-3'>
        <Checkbox
          id='template-conditions-accepted'
          checked={accepted}
          onCheckedChange={checked => onAcceptedChange(checked === true)}
        />
        <Label htmlFor='template-conditions-accepted' className='text-sm font-medium'>
          He leído las condiciones
        </Label>
      </div>
    </section>
  );
}
