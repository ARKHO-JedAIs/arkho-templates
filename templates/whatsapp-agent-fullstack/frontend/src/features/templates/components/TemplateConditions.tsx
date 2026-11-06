import { useState } from 'react';
import { AlertTriangle, ChevronDown, ScrollText } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  EDIT_CONDITIONS,
  EDIT_WARNINGS,
  TEMPLATE_CONDITIONS,
  TEMPLATE_RECOMMENDATIONS,
} from '../templateRules';

interface TemplateConditionsProps {
  /** Editing adds Meta's edit rules and the unverified edit warnings. */
  editing?: boolean;
}

/**
 * Meta's conditions for creating templates, read from `templateRules` (the
 * validator's own source). Collapsed by default; just a reference, not a gate.
 */
export function TemplateConditions({ editing = false }: TemplateConditionsProps) {
  const [open, setOpen] = useState(false);
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
              {editing ? 'Condiciones para editar plantillas' : 'Condiciones para crear plantillas'}
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
          {editing ? (
            <>
              <h3 className='font-semibold text-foreground'>Al editar</h3>
              <ul className='mb-4 mt-1.5 flex list-disc flex-col gap-1.5 pl-5'>
                {EDIT_CONDITIONS.map(condition => (
                  <li key={condition}>{condition}</li>
                ))}
              </ul>
              <ul className='mb-4 flex flex-col gap-1.5'>
                {EDIT_WARNINGS.map(warning => (
                  <li
                    key={warning}
                    className='flex items-start gap-2 rounded-lg bg-warning-light px-3 py-2 text-warning-strong'
                  >
                    <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' aria-hidden />
                    <span>
                      <span className='sr-only'>Advertencia: </span>
                      {warning}
                    </span>
                  </li>
                ))}
              </ul>
              <h3 className='font-semibold text-foreground'>Reglas de la plantilla</h3>
            </>
          ) : null}
          <ul className={cn('flex list-disc flex-col gap-1.5 pl-5', editing && 'mt-1.5')}>
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
    </section>
  );
}
