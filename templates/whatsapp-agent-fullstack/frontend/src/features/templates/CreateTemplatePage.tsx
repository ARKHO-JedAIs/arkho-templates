import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, FilePen, FilePlus2, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  TemplateRulesError,
  WhatsAppAuthError,
  createTemplate,
  fetchTemplates,
  updateTemplate,
  uploadTemplateHeader,
  usingDemoData,
} from '@/features/whatsapp/services/whatsappService';
import type { WhatsAppTemplate } from '@/features/whatsapp/types';
import { cn } from '@/lib/utils';
import { TEMPLATE_PATHS } from './paths';
import { draftFromTemplate, requestSize, toTemplateRequest } from './templateRequest';
import { ButtonsEditor, Counter } from './components/ButtonsEditor';
import { TemplateConditions } from './components/TemplateConditions';
import { TemplatePreview } from './components/TemplatePreview';
import { ValidationChecklist } from './components/ValidationChecklist';
import {
  BUTTON_TYPE_LABEL,
  CATEGORY_OPTIONS,
  HEADER_OPTIONS,
  LANGUAGE_OPTIONS,
  TEMPLATE_LIMITS as L,
  formatNumber,
  type HeaderFormat,
  type ParameterFormat,
} from './templateRules';
import { variableToken } from './templateStatus';
import {
  type RuleResult,
  type TemplateDraft,
  detectVariables,
  emptyDraft,
  exampleKey,
  fillExamples,
  nextPositional,
  normalizeName,
  normalizeVariableName,
  validateTemplate,
} from './validateTemplate';

const LIST_PATH = TEMPLATE_PATHS.list;

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/** A form block with a heading. */
function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = `block-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className='rounded-2xl border border-border bg-card p-4 sm:p-5'>
      <h2 id={id} className='font-semibold text-foreground'>
        {title}
      </h2>
      {hint ? <p className='mt-0.5 text-sm text-foreground-secondary'>{hint}</p> : null}
      <div className='mt-4 flex flex-col gap-4'>{children}</div>
    </section>
  );
}

/** A labelled text field with its character counter and hint. */
function TextField({
  id,
  label,
  value,
  max,
  hint,
  required,
  disabled,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  hint?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-baseline justify-between gap-2'>
        <Label htmlFor={id}>
          {label}
          {required ? null : (
            <span className='font-normal text-foreground-secondary'> (opcional)</span>
          )}
        </Label>
        <Counter id={`${id}-count`} value={value.length} max={max} />
      </div>
      <Input
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        onBlur={onBlur}
        aria-describedby={`${id}-count${hint ? ` ${id}-hint` : ''}`}
        aria-invalid={value.length > max}
      />
      {hint ? (
        <p id={`${id}-hint`} className='text-xs text-foreground-secondary'>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Native radios drawn as pills: keyboard and screen readers get a real radio group. */
function RadioPills<T extends string>({
  name,
  legend,
  options,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className='flex flex-col gap-1.5'>
      <legend className='mb-1.5 text-sm font-medium text-foreground'>{legend}</legend>
      <div className='flex flex-wrap gap-2'>
        {options.map(option => (
          <label
            key={option.value}
            className={cn(
              'inline-flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
              value === option.value
                ? 'border-secondary bg-secondary text-secondary-foreground'
                : 'border-border bg-card text-foreground hover:bg-muted'
            )}
          >
            <input
              type='radio'
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className='sr-only'
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** What Meta takes as the sample file of a media header, by header format. */
const HEADER_SAMPLE: Record<
  Exclude<HeaderFormat, 'NONE' | 'TEXT'>,
  { accept: string; mimeTypes: string[]; maxBytes: number; hint: string }
> = {
  IMAGE: {
    accept: 'image/jpeg,image/png,.jpg,.jpeg,.png',
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
    hint: 'JPG o PNG, hasta 5 MB.',
  },
  VIDEO: {
    accept: 'video/mp4,.mp4',
    mimeTypes: ['video/mp4'],
    maxBytes: 16 * 1024 * 1024,
    hint: 'MP4, hasta 16 MB.',
  },
  DOCUMENT: {
    accept: 'application/pdf,.pdf',
    mimeTypes: ['application/pdf'],
    maxBytes: 100 * 1024 * 1024,
    hint: 'PDF, hasta 100 MB.',
  },
};

/**
 * Creating or editing a WhatsApp template: the form, a live preview and Meta's
 * rules checked as you type, then `POST /whatsapp/templates` (or `PUT` on the
 * template's id when editing) sends it to Meta's review. The same page serves
 * `/settings/templates/new` and `/settings/templates/$metaTemplateId/edit`;
 * under mock auth it works on the demo list.
 */
export function CreateTemplatePage() {
  const navigate = useNavigate();
  const params: { metaTemplateId?: string } = useParams({ strict: false });
  const editingId = params.metaTemplateId ?? null;
  const [draft, setDraft] = useState<TemplateDraft>(emptyDraft);
  const [original, setOriginal] = useState<WhatsAppTemplate | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(Boolean(editingId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [variableName, setVariableName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [serverRules, setServerRules] = useState<string[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const editing = editingId !== null;

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    setLoadingOriginal(true);
    fetchTemplates()
      .then(all => {
        if (cancelled) return;
        const found = all.find(template => template.metaTemplateId === editingId) ?? null;
        setOriginal(found);
        if (found) setDraft(draftFromTemplate(found));
        else setLoadError('No encontramos esa plantilla. Puede que se haya eliminado.');
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof WhatsAppAuthError) {
          void navigate({ to: '/login' });
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'No se pudo cargar la plantilla.');
      })
      .finally(() => {
        if (!cancelled) setLoadingOriginal(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editingId, navigate]);

  const update = (patch: Partial<TemplateDraft>) => {
    setServerRules([]);
    setDraft(current => ({ ...current, ...patch }));
  };

  const request = useMemo(
    () => toTemplateRequest(draft, editing ? original?.category : undefined),
    [draft, editing, original]
  );
  const sizeLimit = editing ? L.editComponentsMaxChars : L.createDefinitionMaxBytes;
  const size = useMemo(() => requestSize(request), [request]);
  const validation = useMemo(() => validateTemplate(draft), [draft]);
  const variables = useMemo(() => detectVariables(draft), [draft]);
  const checklist: RuleResult[] = useMemo(
    () => [
      ...validation.results,
      {
        id: 'definition-size',
        level: 'error',
        ok: size <= sizeLimit,
        label: editing
          ? `La edición ocupa hasta ${formatNumber(sizeLimit)} caracteres`
          : `La plantilla ocupa hasta ${formatNumber(sizeLimit)} bytes`,
        ...(size <= sizeLimit ? {} : { detail: `Ocupa unos ${formatNumber(size)}.` }),
      },
      ...serverRules.map((id): RuleResult => ({
        id: `server-${id}`,
        level: 'error',
        ok: false,
        label: `WhatsApp rechazó la regla «${id}»`,
        detail: 'Corrígela y vuelve a enviar.',
      })),
    ],
    [validation, size, sizeLimit, editing, serverRules]
  );
  const ready =
    checklist.every(result => result.level !== 'error' || result.ok) &&
    uploading === null &&
    (!editing || original !== null);
  const categoryLocked = editing && original?.status === 'APPROVED';
  const named = draft.parameterFormat === 'NAMED';
  const normalizedName = normalizeName(draft.name);

  const preview: WhatsAppTemplate = useMemo(() => {
    const fill = (text: string, scope: 'header' | 'body') =>
      fillExamples(text, draft.examples, name => exampleKey(scope, name));
    return {
      name: draft.name,
      language: draft.language,
      category: draft.category,
      status: 'PENDING',
      qualityScore: 'UNKNOWN',
      metaTemplateId: null,
      header:
        draft.headerFormat === 'TEXT' && draft.headerText.trim()
          ? fill(draft.headerText, 'header')
          : null,
      headerFormat: draft.headerFormat === 'NONE' ? null : draft.headerFormat,
      headerVariableNames: [],
      headerHandle: null,
      examples: {},
      body: draft.body.trim() ? fill(draft.body, 'body') : 'El cuerpo del mensaje aparecerá aquí.',
      footer: draft.footer.trim() || null,
      buttons: draft.buttons.map(button => ({
        type: button.type,
        text: button.text.trim() || BUTTON_TYPE_LABEL[button.type],
      })),
      variables: 0,
      variableNames: [],
      parameterFormat: draft.parameterFormat,
    };
  }, [draft]);

  /** Inserts a variable at the cursor (or the end) and puts the cursor after it. */
  const insertVariable = (name: string) => {
    const token = variableToken(name);
    const field = bodyRef.current;
    const start = field?.selectionStart ?? draft.body.length;
    const end = field?.selectionEnd ?? draft.body.length;
    const body = draft.body.slice(0, start) + token + draft.body.slice(end);
    update({ body });
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  /** Uploads the header's sample file to Meta right away: the template needs its handle. */
  const uploadSample = async (file: File | undefined) => {
    setUploadError(null);
    if (!file || draft.headerFormat === 'NONE' || draft.headerFormat === 'TEXT') return;
    const rules = HEADER_SAMPLE[draft.headerFormat];
    const mimeType = file.type.split(';')[0]!.trim().toLowerCase();
    if (!rules.mimeTypes.includes(mimeType)) {
      setUploadError(`Tipo de archivo no admitido: ${rules.hint}`);
      return;
    }
    if (file.size <= 0 || file.size > rules.maxBytes) {
      setUploadError(`El archivo está vacío o es muy grande: ${rules.hint}`);
      return;
    }
    setUploading(0);
    try {
      const handle = await uploadTemplateHeader(file, mimeType, fraction => setUploading(fraction));
      update({ headerHandle: handle, headerFileName: file.name });
    } catch (err) {
      if (err instanceof WhatsAppAuthError) {
        void navigate({ to: '/login' });
        return;
      }
      setUploadError(err instanceof Error ? err.message : 'No se pudo subir el archivo.');
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    if (!ready || submitting) return;
    setSubmitting(true);
    try {
      if (editingId) {
        await updateTemplate(editingId, request);
        toast.success('Edición enviada a revisión', {
          description: `${draft.name} (${draft.language}). Meta vuelve a revisarla antes de que se pueda enviar.`,
        });
      } else {
        await createTemplate(request);
        toast.success('Plantilla enviada a revisión', {
          description: `${draft.name} (${draft.language}). Meta suele responder en menos de ${L.reviewHours} horas.`,
        });
      }
      void navigate({ to: LIST_PATH });
    } catch (err) {
      if (err instanceof WhatsAppAuthError) {
        void navigate({ to: '/login' });
        return;
      }
      if (err instanceof TemplateRulesError) setServerRules(err.rules);
      toast.error(err instanceof Error ? err.message : 'No se pudo enviar la plantilla.');
    } finally {
      setSubmitting(false);
    }
  };

  const pending = checklist.filter(result => result.level === 'error' && !result.ok).length;

  if (editing && (loadingOriginal || !original)) {
    return (
      <div className='flex flex-col gap-4'>
        <Link
          to={LIST_PATH}
          className='inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          <ArrowLeft className='h-4 w-4' aria-hidden />
          Plantillas
        </Link>
        {loadingOriginal ? (
          <p className='flex items-center gap-2 text-sm text-foreground-secondary'>
            <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
            Cargando la plantilla…
          </p>
        ) : (
          <p className='text-sm text-destructive-strong'>
            {loadError ?? 'No encontramos esa plantilla.'}
          </p>
        )}
      </div>
    );
  }

  const sample =
    draft.headerFormat === 'NONE' || draft.headerFormat === 'TEXT'
      ? null
      : HEADER_SAMPLE[draft.headerFormat];

  return (
    <div className='flex flex-col gap-5'>
      <div>
        <Link
          to={LIST_PATH}
          className='inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-foreground-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          <ArrowLeft className='h-4 w-4' aria-hidden />
          Plantillas
        </Link>
        <h1 className='mt-2 flex items-center gap-2.5 text-2xl font-bold leading-tight text-foreground'>
          <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-primary'>
            {editing ? (
              <FilePen className='h-5 w-5' aria-hidden />
            ) : (
              <FilePlus2 className='h-5 w-5' aria-hidden />
            )}
          </span>
          {editing ? `Editar ${draft.name}` : 'Nueva plantilla'}
        </h1>
        <p className='mt-1 max-w-2xl text-sm text-foreground-secondary'>
          {editing
            ? 'Cambia lo que necesites: la edición reemplaza la plantilla y Meta la vuelve a revisar.'
            : 'Escribe la plantilla y revisa cómo se verá. Meta la revisa antes de que se pueda enviar.'}
          {usingDemoData ? ' Datos de demostración: solo cambia la lista de prueba.' : ''}
        </p>
      </div>

      <div className='grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]'>
        <form
          className='flex min-w-0 flex-col gap-5'
          noValidate
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <TemplateConditions editing={editing} />

          <Block title='Datos generales'>
            <TextField
              id='template-name'
              label='Nombre'
              required
              disabled={editing}
              value={draft.name}
              max={L.nameMax}
              onChange={name => update({ name })}
              onBlur={() => {
                if (normalizedName !== draft.name) update({ name: normalizedName });
              }}
              hint={
                editing ? (
                  'El nombre no se puede cambiar.'
                ) : normalizedName && normalizedName !== draft.name ? (
                  <>
                    Solo minúsculas, números y _. Se guardará como{' '}
                    <code className='rounded bg-muted px-1 font-mono text-foreground'>
                      {normalizedName}
                    </code>
                    .
                  </>
                ) : (
                  'Solo minúsculas, números y _. Ejemplo: confirmacion_pedido.'
                )
              }
            />

            <fieldset className='flex flex-col gap-2'>
              <legend className='mb-1.5 text-sm font-medium text-foreground'>Categoría</legend>
              <p className='-mt-1 text-xs text-foreground-secondary'>
                {categoryLocked
                  ? 'Meta no permite cambiar la categoría de una plantilla aprobada.'
                  : 'Define el precio de cada envío. Meta puede cambiarla si no coincide con el contenido.'}
              </p>
              <div className='grid gap-2 sm:grid-cols-3'>
                {CATEGORY_OPTIONS.map(option => {
                  const checked = draft.category === option.value;
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        'flex cursor-pointer flex-col gap-0.5 rounded-xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                        checked
                          ? 'border-secondary bg-secondary-light'
                          : 'border-border bg-card hover:bg-muted'
                      )}
                    >
                      <span className='flex items-center gap-2 text-sm font-semibold text-foreground'>
                        <input
                          type='radio'
                          name='template-category'
                          value={option.value}
                          checked={checked}
                          disabled={categoryLocked}
                          onChange={() => update({ category: option.value })}
                          className='h-4 w-4 accent-secondary'
                        />
                        {option.label}
                      </span>
                      <span className='text-xs text-foreground-secondary'>{option.hint}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='template-language'>Idioma</Label>
                <select
                  id='template-language'
                  className={selectClass}
                  value={draft.language}
                  disabled={editing}
                  onChange={event => update({ language: event.target.value })}
                  aria-describedby='template-language-hint'
                >
                  {LANGUAGE_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p id='template-language-hint' className='text-xs text-foreground-secondary'>
                  Cada idioma cuenta como una plantilla aparte.
                </p>
              </div>
              <RadioPills<ParameterFormat>
                name='template-format'
                legend='Formato de variables'
                value={draft.parameterFormat}
                onChange={parameterFormat => update({ parameterFormat })}
                options={[
                  { value: 'POSITIONAL', label: 'Por posición' },
                  { value: 'NAMED', label: 'Con nombre' },
                ]}
              />
            </div>
          </Block>

          <Block title='Encabezado' hint='Opcional. Lo primero que se ve, en negrita.'>
            <RadioPills
              name='template-header'
              legend='Tipo de encabezado'
              value={draft.headerFormat}
              onChange={headerFormat =>
                update({ headerFormat, headerHandle: '', headerFileName: '' })
              }
              options={HEADER_OPTIONS}
            />
            {draft.headerFormat === 'TEXT' ? (
              <TextField
                id='template-header-text'
                label='Texto del encabezado'
                required
                value={draft.headerText}
                max={L.headerTextMax}
                onChange={headerText => update({ headerText })}
                hint={`Máximo ${L.headerVariablesMax} variable, por ejemplo ${variableToken(named ? 'numero_pedido' : '1')}.`}
              />
            ) : null}
            {sample ? (
              <div className='flex flex-col gap-1.5 rounded-xl border border-dashed border-border bg-muted px-4 py-4'>
                <Label htmlFor='template-header-file' className='flex items-center gap-2'>
                  <Upload className='h-4 w-4 text-foreground-secondary' aria-hidden />
                  Archivo de ejemplo
                </Label>
                <Input
                  id='template-header-file'
                  type='file'
                  accept={sample.accept}
                  disabled={uploading !== null}
                  onChange={event => void uploadSample(event.target.files?.[0])}
                  aria-describedby='template-header-file-hint'
                  aria-invalid={Boolean(uploadError)}
                  className='bg-background'
                />
                <p
                  id='template-header-file-hint'
                  className={cn(
                    'text-xs',
                    uploadError ? 'text-destructive-strong' : 'text-foreground-secondary'
                  )}
                  aria-live='polite'
                >
                  {uploading !== null
                    ? `Subiendo… ${Math.round(uploading * 100)} %`
                    : uploadError
                      ? uploadError
                      : draft.headerHandle
                        ? `Listo: ${draft.headerFileName || 'archivo subido'}. Al enviar cada mensaje eliges el archivo real.`
                        : `Meta revisa la plantilla con este archivo. ${sample.hint}`}
                </p>
              </div>
            ) : null}
          </Block>

          <Block title='Cuerpo' hint='Obligatorio. El mensaje principal.'>
            <div className='flex flex-col gap-1.5'>
              <div className='flex items-baseline justify-between gap-2'>
                <Label htmlFor='template-body'>Texto del cuerpo</Label>
                <Counter id='template-body-count' value={draft.body.length} max={L.bodyMax} />
              </div>
              <Textarea
                id='template-body'
                ref={bodyRef}
                rows={6}
                required
                value={draft.body}
                onChange={event => update({ body: event.target.value })}
                aria-describedby='template-body-count template-body-hint'
                aria-invalid={draft.body.length > L.bodyMax}
                className='bg-background'
              />
              <p id='template-body-hint' className='text-xs text-foreground-secondary'>
                Hasta {formatNumber(L.bodyMax)} caracteres. Admite *negrita*, _cursiva_ y ~tachado~.
              </p>
            </div>
            {named ? (
              <div className='flex flex-wrap items-end gap-2'>
                <div className='flex min-w-[12rem] flex-1 flex-col gap-1.5'>
                  <Label htmlFor='template-variable-name'>Nombre de la variable</Label>
                  <Input
                    id='template-variable-name'
                    value={variableName}
                    placeholder='nombre_cliente'
                    onChange={event => setVariableName(normalizeVariableName(event.target.value))}
                  />
                </div>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!variableName}
                  onClick={() => {
                    insertVariable(variableName);
                    setVariableName('');
                  }}
                >
                  Insertar variable
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => insertVariable(nextPositional(draft.body))}
                >
                  Insertar variable {variableToken(nextPositional(draft.body))}
                </Button>
              </div>
            )}
          </Block>

          <Block title='Pie' hint='Opcional. Texto pequeño al final, sin variables.'>
            <TextField
              id='template-footer'
              label='Texto del pie'
              value={draft.footer}
              max={L.footerMax}
              onChange={footer => update({ footer })}
            />
          </Block>

          <Block
            title='Botones'
            hint={`Opcional. Hasta ${L.buttonsMax}: respuestas rápidas, enlaces, un teléfono o copiar un código.`}
          >
            <ButtonsEditor buttons={draft.buttons} onChange={buttons => update({ buttons })} />
          </Block>

          <Block
            title='Valores de ejemplo'
            hint='Meta revisa la plantilla con estos valores. Cada variable necesita uno.'
          >
            {variables.length === 0 ? (
              <p className='text-sm text-foreground-secondary'>La plantilla no tiene variables.</p>
            ) : (
              <div className='grid gap-3 sm:grid-cols-2'>
                {variables.map(variable => {
                  const id = `example-${variable.key.replace(/\W+/g, '-')}`;
                  const value = draft.examples[variable.key] ?? '';
                  return (
                    <div key={variable.key} className='flex flex-col gap-1.5'>
                      <Label htmlFor={id}>{variable.label}</Label>
                      <Input
                        id={id}
                        required
                        value={value}
                        onChange={event =>
                          update({
                            examples: { ...draft.examples, [variable.key]: event.target.value },
                          })
                        }
                        aria-invalid={!value.trim()}
                        aria-describedby={`${id}-hint`}
                      />
                      <p id={`${id}-hint`} className='text-xs text-foreground-secondary'>
                        Obligatorio.
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </Block>

          <div className='mb-10 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4 sm:mb-12'>
            <p className='mr-auto text-sm text-foreground-secondary' aria-live='polite'>
              {pending === 0
                ? 'Lista para enviar.'
                : `${pending} ${pending === 1 ? 'requisito pendiente' : 'requisitos pendientes'}.`}
            </p>
            <Button asChild variant='outline' className='h-11 rounded-[10px]'>
              <Link to={LIST_PATH}>Cancelar</Link>
            </Button>
            <Button
              type='submit'
              disabled={!ready || submitting}
              className='h-11 rounded-[10px] font-semibold'
            >
              {submitting ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden /> : null}
              {editing ? 'Guardar y enviar a revisión' : 'Enviar a revisión'}
            </Button>
          </div>
        </form>

        <aside
          aria-label='Vista previa y validación'
          className='flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto'
        >
          <section
            aria-labelledby='template-preview-title'
            className='rounded-2xl border border-border bg-card p-4'
          >
            <h2 id='template-preview-title' className='font-semibold text-foreground'>
              Vista previa
            </h2>
            <p className='mb-3 mt-0.5 text-xs text-foreground-secondary'>
              Con los valores de ejemplo; las variables sin ejemplo se ven resaltadas.
            </p>
            <TemplatePreview
              template={preview}
              media={
                draft.headerFormat === 'NONE' || draft.headerFormat === 'TEXT'
                  ? undefined
                  : draft.headerFormat
              }
            />
          </section>
          <ValidationChecklist results={checklist} />
        </aside>
      </div>
    </div>
  );
}

export default CreateTemplatePage;
