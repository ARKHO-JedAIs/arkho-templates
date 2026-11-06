import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileText, Image as ImageIcon, Loader2, Video } from 'lucide-react';
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
import { ATTACHMENT_ACCEPT, checkAttachment } from '../services/attachments';
import { fillTemplate, isSendable, templateNeeds } from '../services/mappers';
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

const MEDIA_LABEL = {
  IMAGE: { label: 'Imagen del encabezado', kind: 'image', hint: 'JPG o PNG, hasta 5 MB.' },
  VIDEO: { label: 'Video del encabezado', kind: 'video', hint: 'MP4, hasta 16 MB.' },
  DOCUMENT: {
    label: 'Documento del encabezado',
    kind: 'document',
    hint: 'PDF u Office, hasta 100 MB.',
  },
} as const;

const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText } as const;

/**
 * Sends an approved template: how a conversation starts, or resumes after 24
 * hours. It asks for exactly what the template needs - the body variables,
 * the header variable or file, and the end of each URL button's address - and
 * previews the result.
 */
export function TemplateDialog({ open, onOpenChange, phone, onSend }: TemplateDialogProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [to, setTo] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState('');
  const [headerFile, setHeaderFile] = useState<{ file: File; mimeType: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [suffixes, setSuffixes] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    // `phone` is already a complete number (no "+"): marking it as one keeps
    // the backend from treating it as a local number and gluing its default
    // country code onto the front of it.
    setTo(phone ? `+${phone}` : '');
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
  const needs = useMemo(() => (template ? templateNeeds(template) : null), [template]);

  useEffect(() => {
    setValues(Array.from({ length: template?.variables ?? 0 }, () => ''));
    setHeaderText('');
    setHeaderFile(null);
    setFileError(null);
    setSuffixes({});
  }, [template]);

  const ready = Boolean(
    template &&
    needs &&
    to.trim() &&
    values.every(value => value.trim()) &&
    (!needs.headerVariable || headerText.trim()) &&
    (!needs.headerMedia || headerFile) &&
    needs.urlButtons.every(button => suffixes[button.index]?.trim())
  );

  const preview = useMemo(() => {
    if (!template || !needs) return null;
    const bodyValues = Object.fromEntries(
      template.variableNames.map((name, index) => [name, values[index] ?? ''])
    );
    return {
      header: template.header
        ? fillTemplate(
            template.header,
            needs.headerVariable ? { [needs.headerVariable]: headerText } : {}
          )
        : null,
      body: fillTemplate(template.body, bodyValues),
    };
  }, [template, needs, values, headerText]);

  const chooseFile = (file: File | undefined) => {
    setFileError(null);
    setHeaderFile(null);
    if (!file || !needs?.headerMedia) return;
    const check = checkAttachment(file);
    if (!check.ok) {
      setFileError(check.error);
      return;
    }
    if (check.kind !== MEDIA_LABEL[needs.headerMedia].kind) {
      setFileError(`Esta plantilla lleva ${MEDIA_LABEL[needs.headerMedia].hint}`);
      return;
    }
    setHeaderFile({ file, mimeType: check.mimeType });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!template || !needs || !ready) return;
    setSending(true);
    try {
      await onSend({
        phone: to.trim(),
        templateName: template.name,
        language: template.language,
        parameters: values.map(value => value.trim()),
        ...(needs.headerVariable ? { headerText: headerText.trim() } : {}),
        ...(needs.headerMedia && headerFile ? { headerFile } : {}),
        ...(needs.urlButtons.length
          ? {
              buttons: needs.urlButtons.map(button => ({
                index: button.index,
                text: suffixes[button.index]!.trim(),
              })),
            }
          : {}),
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar la plantilla.');
    } finally {
      setSending(false);
    }
  };

  const MediaIcon = needs?.headerMedia ? MEDIA_ICON[needs.headerMedia] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto'>
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
              aria-describedby='template-phone-hint'
            />
            {!phone ? (
              <p id='template-phone-hint' className='text-xs text-muted-foreground'>
                Incluye el código de país con «+» (ej. +57 para Colombia); sin él se asume Chile.
              </p>
            ) : null}
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
              </div>

              {needs?.headerVariable ? (
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='template-header-text'>Variable del encabezado</Label>
                  <Input
                    id='template-header-text'
                    value={headerText}
                    maxLength={60}
                    onChange={event => setHeaderText(event.target.value)}
                  />
                </div>
              ) : null}

              {needs?.headerMedia ? (
                <div className='flex flex-col gap-1.5'>
                  <Label htmlFor='template-header-file'>
                    {MEDIA_LABEL[needs.headerMedia].label}
                  </Label>
                  <Input
                    id='template-header-file'
                    type='file'
                    accept={ATTACHMENT_ACCEPT}
                    onChange={event => chooseFile(event.target.files?.[0])}
                    aria-describedby='template-header-file-hint'
                    aria-invalid={Boolean(fileError)}
                  />
                  <p
                    id='template-header-file-hint'
                    className={
                      fileError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                    }
                  >
                    {fileError ?? MEDIA_LABEL[needs.headerMedia].hint}
                  </p>
                </div>
              ) : null}

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

              {needs?.urlButtons.map(button => (
                <div key={button.index} className='flex flex-col gap-1.5'>
                  <Label htmlFor={`template-button-${button.index}`}>
                    Final de la dirección del botón «{button.text}»
                  </Label>
                  <div className='flex items-center gap-1.5'>
                    <span className='max-w-[50%] truncate text-xs text-muted-foreground'>
                      {button.base}
                    </span>
                    <Input
                      id={`template-button-${button.index}`}
                      value={suffixes[button.index] ?? ''}
                      onChange={event =>
                        setSuffixes(current => ({ ...current, [button.index]: event.target.value }))
                      }
                    />
                  </div>
                </div>
              ))}

              {preview && template ? (
                <section aria-label='Vista previa' className='flex flex-col gap-1.5'>
                  <p className='text-sm font-medium text-foreground'>Vista previa</p>
                  <div className='chat-wallpaper rounded-md p-3'>
                    <div className='max-w-[18rem] rounded-lg bg-card px-3 py-2 text-sm text-foreground shadow-sm'>
                      {MediaIcon ? (
                        <p className='mb-1.5 flex items-center gap-1.5 rounded-md bg-muted px-2 py-3 text-xs text-muted-foreground'>
                          <MediaIcon className='h-4 w-4 shrink-0' aria-hidden />
                          <span className='truncate'>
                            {headerFile?.file.name ?? 'Archivo del encabezado'}
                          </span>
                        </p>
                      ) : null}
                      {preview.header ? <p className='font-bold'>{preview.header}</p> : null}
                      <p className='whitespace-pre-wrap break-words'>{preview.body}</p>
                      {template.footer ? (
                        <p className='mt-1 text-xs text-muted-foreground'>{template.footer}</p>
                      ) : null}
                      {template.buttons.map((button, index) => (
                        <p
                          key={`${button.type}-${index}`}
                          className='mt-1.5 border-t border-border pt-1.5 text-center text-xs font-medium text-info-strong'
                        >
                          {button.text || 'Copiar código'}
                        </p>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}
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
