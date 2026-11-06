import { useState, type ReactNode } from 'react';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { WhatsAppTemplate } from '@/features/whatsapp/types';
import { TEMPLATE_LIMITS } from '../templateRules';
import { categoryLabel, statusMeta } from '../templateStatus';
import { QualityLabel, StatusBadge } from './StatusBadge';
import { TemplatePreview, VariableChip } from './TemplatePreview';

interface TemplateDetailSheetProps {
  template: WhatsAppTemplate | null;
  onOpenChange: (open: boolean) => void;
  /** Opens the creator on this template. */
  onEdit?: (template: WhatsAppTemplate) => void;
  /** Deletes this language version; rejects with the reason when it fails. */
  onDelete?: (template: WhatsAppTemplate) => Promise<void>;
}

/** Meta only lets approved, rejected and paused templates be edited. */
const EDITABLE = new Set(['APPROVED', 'REJECTED', 'PAUSED']);

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className='flex flex-col gap-0.5'>
      <dt className='text-xs font-medium text-foreground-secondary'>{term}</dt>
      <dd className='text-sm text-foreground'>{children}</dd>
    </div>
  );
}

/** One template in detail: where it stands, what it looks like, how to fill it in. */
export function TemplateDetailSheet({
  template,
  onOpenChange,
  onEdit,
  onDelete,
}: TemplateDetailSheetProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!template || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(template);
      setConfirming(false);
    } catch {
      // The page already told the user why; the dialog stays open to retry.
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Sheet open={template !== null} onOpenChange={onOpenChange}>
      <SheetContent className='w-full gap-0 overflow-y-auto sm:max-w-md'>
        {template ? (
          <>
            <Detail template={template} />
            {onEdit || onDelete ? (
              <div className='flex flex-wrap gap-2 border-t border-border p-5'>
                {onEdit && template.metaTemplateId ? (
                  <Button
                    variant='outline'
                    disabled={!EDITABLE.has(template.status)}
                    title={
                      EDITABLE.has(template.status)
                        ? undefined
                        : 'Meta solo permite editar plantillas aprobadas, rechazadas o pausadas.'
                    }
                    onClick={() => onEdit(template)}
                  >
                    <Pencil className='h-4 w-4' aria-hidden />
                    Editar
                  </Button>
                ) : null}
                {onDelete ? (
                  <Button variant='destructive' onClick={() => setConfirming(true)}>
                    <Trash2 className='h-4 w-4' aria-hidden />
                    Eliminar
                  </Button>
                ) : null}
              </div>
            ) : null}
            <AlertDialog open={confirming} onOpenChange={open => !deleting && setConfirming(open)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar {template.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se elimina la versión en {template.language || 'este idioma'} y deja de poder
                    enviarse. Si estaba aprobada, Meta no permite crear otra plantilla con el nombre
                    «{template.name}» por {TEMPLATE_LIMITS.deletedNameDays} días.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={deleting}
                    onClick={event => {
                      event.preventDefault();
                      void remove();
                    }}
                  >
                    {deleting ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden /> : null}
                    Eliminar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ template }: { template: WhatsAppTemplate }) {
  const meta = statusMeta(template.status);
  const named = template.parameterFormat === 'NAMED';
  return (
    <>
      <SheetHeader className='gap-2 border-b border-border p-5 pr-12'>
        <SheetTitle className='break-all font-mono text-base'>{template.name}</SheetTitle>
        <SheetDescription className='text-foreground-secondary'>{meta.hint}</SheetDescription>
        <div>
          <StatusBadge status={template.status} />
        </div>
      </SheetHeader>

      <div className='flex flex-col gap-6 p-5'>
        <dl className='grid grid-cols-2 gap-4'>
          <Fact term='Idioma'>{template.language || '—'}</Fact>
          <Fact term='Categoría'>{categoryLabel(template.category) || '—'}</Fact>
          <Fact term='Calidad'>
            <QualityLabel quality={template.qualityScore} />
          </Fact>
          <Fact term='ID en Meta'>
            <span className='break-all font-mono text-xs'>{template.metaTemplateId ?? '—'}</span>
          </Fact>
        </dl>

        <section aria-labelledby='template-preview-title' className='flex flex-col gap-2'>
          <h3 id='template-preview-title' className='text-sm font-semibold text-foreground'>
            Vista previa
          </h3>
          <TemplatePreview template={template} />
        </section>

        <section aria-labelledby='template-variables-title' className='flex flex-col gap-2'>
          <h3 id='template-variables-title' className='text-sm font-semibold text-foreground'>
            Variables ({template.variables})
          </h3>
          {template.variables === 0 ? (
            <p className='text-sm text-foreground-secondary'>
              Esta plantilla no tiene variables: se envía tal cual.
            </p>
          ) : (
            <>
              <p className='text-sm text-foreground-secondary'>
                {named
                  ? 'Al enviar se reemplaza cada variable por el valor que le des a su nombre.'
                  : 'Al enviar se reemplaza cada variable por un valor, en orden: la primera por el primer valor, la segunda por el segundo, y así.'}
              </p>
              <ol className='flex flex-col divide-y divide-border rounded-lg border border-border'>
                {template.variableNames.map((name, index) => (
                  <li key={name} className='flex items-center justify-between gap-3 px-3 py-2'>
                    <VariableChip name={name} className='mx-0' />
                    <span className='text-sm text-foreground-secondary'>
                      {named ? `Valor de «${name}»` : `Valor ${index + 1}`}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {template.status !== 'APPROVED' ? (
            <p className='rounded-lg bg-muted px-3 py-2 text-sm text-foreground-secondary'>
              Solo las plantillas aprobadas aparecen al enviar una plantilla desde WhatsApp.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
