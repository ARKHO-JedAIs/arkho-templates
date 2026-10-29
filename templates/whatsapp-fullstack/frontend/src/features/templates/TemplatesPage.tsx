import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  WhatsAppAuthError,
  fetchTemplates,
  usingDemoData,
} from '@/features/whatsapp/services/whatsappService';
import type { WhatsAppTemplate } from '@/features/whatsapp/types';
import { cn } from '@/lib/utils';
import { QualityLabel, StatusBadge } from './components/StatusBadge';
import { TemplateDetailSheet } from './components/TemplateDetailSheet';
import { TEMPLATE_PATHS } from './paths';
import {
  STATUS_META,
  STATUS_ORDER,
  categoryLabel,
  countByStatus,
  filterTemplates,
  type StatusFilter,
} from './templateStatus';

const templateKey = (template: WhatsAppTemplate) => `${template.name}|${template.language}`;

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  ...STATUS_ORDER.map(status => ({ value: status, label: STATUS_META[status].plural })),
];

/**
 * The account's WhatsApp message templates and where each one stands in Meta's
 * review. "Agregar plantilla" opens the creator (a frontend preview for now);
 * editing still happens in Meta.
 */
export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await fetchTemplates());
    } catch (err) {
      if (err instanceof WhatsAppAuthError) {
        void navigate({ to: '/login' });
        return;
      }
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las plantillas.');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countByStatus(templates), [templates]);
  const visible = useMemo(
    () => filterTemplates(templates, query, status),
    [templates, query, status]
  );
  const detail = templates.find(template => templateKey(template) === selected) ?? null;

  return (
    <div className='flex flex-col gap-5'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div className='max-w-2xl'>
          <h1 className='flex items-center gap-2.5 text-2xl font-bold leading-tight text-foreground'>
            <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-primary-light text-primary'>
              <FileText className='h-5 w-5' aria-hidden />
            </span>
            Plantillas
          </h1>
          <p className='mt-1 text-sm text-foreground-secondary'>
            Las plantillas se aprueban en Meta; aquí ves su estado y cómo se ven. Solo las aprobadas
            se pueden enviar, y son la única forma de escribirle a un contacto después de 24 horas
            sin respuesta.
            {usingDemoData ? ' Datos de demostración.' : ''}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='icon'
            className='h-11 w-11 rounded-[10px]'
            onClick={() => void load()}
            disabled={loading}
            title='Actualizar'
            aria-label='Actualizar'
          >
            <RefreshCw className={cn('h-[18px] w-[18px]', loading && 'animate-spin')} aria-hidden />
          </Button>
          <Button asChild className='h-11 rounded-[10px] font-semibold'>
            <Link to={TEMPLATE_PATHS.create}>
              <Plus className='h-4 w-4' aria-hidden />
              Agregar plantilla
            </Link>
          </Button>
        </div>
      </div>

      <div className='flex flex-col gap-3'>
        <div className='relative w-full sm:max-w-sm'>
          <Search
            className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-secondary'
            aria-hidden
          />
          <Input
            type='search'
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder='Buscar por nombre o texto'
            aria-label='Buscar plantillas'
            className='h-10 pl-9'
          />
        </div>
        <div role='group' aria-label='Filtrar por estado' className='flex flex-wrap gap-2'>
          {FILTERS.map(filter => {
            const active = status === filter.value;
            return (
              <button
                key={filter.value}
                type='button'
                aria-pressed={active}
                onClick={() => setStatus(filter.value)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'border-secondary bg-secondary text-secondary-foreground'
                    : 'border-border bg-card text-foreground hover:bg-muted'
                )}
              >
                {filter.label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs tabular-nums',
                    active ? 'bg-card/20' : 'bg-muted text-foreground-secondary'
                  )}
                >
                  {counts[filter.value]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className='overflow-hidden rounded-2xl border border-border bg-card'>
        {loading && templates.length === 0 ? (
          <p className='flex items-center justify-center gap-2 px-4 py-12 text-sm text-foreground-secondary'>
            <Loader2 className='h-4 w-4 animate-spin' aria-hidden />
            Cargando plantillas…
          </p>
        ) : error ? (
          <div className='flex flex-col items-center gap-3 px-4 py-12 text-center'>
            <p className='text-sm text-destructive-strong'>{error}</p>
            <Button variant='outline' onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <p className='px-4 py-12 text-center text-sm text-foreground-secondary'>
            {templates.length === 0
              ? 'Esta cuenta aún no tiene plantillas. Créalas en el Administrador de WhatsApp de Meta.'
              : 'Ninguna plantilla coincide con la búsqueda o el filtro.'}
          </p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-sm'>
              <caption className='sr-only'>
                Plantillas de WhatsApp. Elige una para ver su vista previa y sus variables.
              </caption>
              <thead className='border-b border-border bg-muted/60 text-xs font-semibold text-foreground-secondary'>
                <tr>
                  <th scope='col' className='px-4 py-3'>
                    Nombre
                  </th>
                  <th scope='col' className='hidden px-4 py-3 md:table-cell'>
                    Idioma
                  </th>
                  <th scope='col' className='hidden px-4 py-3 sm:table-cell'>
                    Categoría
                  </th>
                  <th scope='col' className='px-4 py-3'>
                    Estado
                  </th>
                  <th scope='col' className='hidden px-4 py-3 lg:table-cell'>
                    Calidad
                  </th>
                  <th scope='col' className='hidden px-4 py-3 text-right md:table-cell'>
                    Variables
                  </th>
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {visible.map(template => (
                  <tr
                    key={templateKey(template)}
                    className='relative transition-colors focus-within:bg-muted/60 hover:bg-muted/60'
                  >
                    <td className='max-w-0 px-4 py-3 sm:max-w-none'>
                      {/* The whole row is clickable through this button's
                          stretched hit area; it is also the keyboard stop. */}
                      <button
                        type='button'
                        onClick={() => setSelected(templateKey(template))}
                        className='block w-full text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring'
                      >
                        <span className='block truncate font-mono text-[13px] font-semibold text-foreground'>
                          {template.name}
                        </span>
                        <span className='mt-0.5 block truncate text-xs text-foreground-secondary sm:max-w-md'>
                          {template.header ? `${template.header} · ` : ''}
                          {template.body}
                        </span>
                      </button>
                    </td>
                    <td className='hidden whitespace-nowrap px-4 py-3 text-foreground md:table-cell'>
                      {template.language}
                    </td>
                    <td className='hidden whitespace-nowrap px-4 py-3 text-foreground sm:table-cell'>
                      {categoryLabel(template.category)}
                    </td>
                    <td className='px-4 py-3'>
                      <StatusBadge status={template.status} />
                    </td>
                    <td className='hidden px-4 py-3 lg:table-cell'>
                      <QualityLabel quality={template.qualityScore} />
                    </td>
                    <td className='hidden px-4 py-3 text-right tabular-nums text-foreground md:table-cell'>
                      {template.variables}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TemplateDetailSheet
        template={detail}
        onOpenChange={open => {
          if (!open) setSelected(null);
        }}
      />
    </div>
  );
}

export default TemplatesPage;
