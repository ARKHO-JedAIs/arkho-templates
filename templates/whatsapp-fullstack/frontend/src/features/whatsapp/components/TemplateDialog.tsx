import { useEffect, useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isSendable } from '../services/mappers';
import { fetchTemplates } from '../services/whatsappService';
import type { SendTemplateInput, WhatsAppTemplate } from '../types';

interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled and locked for an open conversation; empty to start a new one. */
  phone: string | null;
  onSend: (input: SendTemplateInput) => Promise<void>;
}

const templateKey = (template: WhatsAppTemplate) => `${template.name}|${template.language}`;

/** Sends an approved template: how a conversation starts, or resumes after 24 hours. */
export function TemplateDialog({ open, onOpenChange, phone, onSend }: TemplateDialogProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [to, setTo] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTo(phone ?? '');
    setLoading(true);
    setError(null);
    fetchTemplates()
      .then(all => {
        // The API lists every template; only the approved ones can be sent.
        const list = all.filter(isSendable);
        setTemplates(list);
        setSelected(list[0] ? templateKey(list[0]) : '');
      })
      .catch(err => setError(err instanceof Error ? err.message : 'No se pudieron cargar.'))
      .finally(() => setLoading(false));
  }, [open, phone]);

  const template = templates.find(item => templateKey(item) === selected) ?? null;

  useEffect(() => {
    setValues(Array.from({ length: template?.variables ?? 0 }, () => ''));
  }, [template]);

  const ready = Boolean(template && to.trim() && values.every(value => value.trim()));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!template || !ready) return;
    setSending(true);
    try {
      await onSend({
        phone: to.trim(),
        templateName: template.name,
        language: template.language,
        parameters: values.map(value => value.trim()),
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar la plantilla.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Enviar plantilla</DialogTitle>
            <DialogDescription>
              Solo se pueden enviar plantillas aprobadas por Meta.
            </DialogDescription>
          </DialogHeader>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='template-phone'>Número</Label>
            <Input
              id='template-phone'
              value={to}
              onChange={event => setTo(event.target.value)}
              placeholder='+56 9 1234 5678'
              disabled={Boolean(phone)}
            />
          </div>

          {loading ? (
            <p className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
              Cargando plantillas…
            </p>
          ) : error ? (
            <p className='text-sm text-destructive'>{error}</p>
          ) : templates.length === 0 ? (
            <p className='text-sm text-muted-foreground'>No hay plantillas aprobadas.</p>
          ) : (
            <>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='template-name'>Plantilla</Label>
                <select
                  id='template-name'
                  value={selected}
                  onChange={event => setSelected(event.target.value)}
                  className='h-10 rounded-md border border-input bg-background px-3 text-sm'
                >
                  {templates.map(item => (
                    <option key={templateKey(item)} value={templateKey(item)}>
                      {item.name} ({item.language})
                    </option>
                  ))}
                </select>
                {template?.body ? (
                  <p className='whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground'>
                    {template.body}
                  </p>
                ) : null}
              </div>
              {values.map((value, index) => (
                <div key={index} className='flex flex-col gap-1.5'>
                  <Label htmlFor={`template-variable-${index}`}>
                    {template?.parameterFormat === 'NAMED' && template.variableNames[index]
                      ? `Variable «${template.variableNames[index]}»`
                      : `Variable ${index + 1}`}
                  </Label>
                  <Input
                    id={`template-variable-${index}`}
                    value={value}
                    onChange={event =>
                      setValues(current =>
                        current.map((item, position) =>
                          position === index ? event.target.value : item
                        )
                      )
                    }
                  />
                </div>
              ))}
            </>
          )}

          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type='submit' disabled={!ready || sending}>
              {sending ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden /> : null}
              Enviar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
