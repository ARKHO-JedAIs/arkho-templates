import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Ban,
  BarChart3,
  Bot,
  CheckCircle2,
  Coins,
  Cpu,
  DollarSign,
  FileText,
  Inbox,
  MessageCircle,
  Mic,
  RefreshCw,
  Send,
  Sparkles,
  Timer,
  UserRound,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { HelpTip } from '@/components/HelpTip';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  SERVICES,
  fetchUsage,
  type Service,
  type UsagePeriod,
  type UsageDay,
  type UsageSummary,
} from './usageService';

type Preset = 'today' | 'yesterday' | 'last7' | 'all' | 'custom';

/** Personalizado takes any range up to today. */
const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'last7', label: 'Últimos 7 días' },
  { id: 'all', label: 'Todo' },
  { id: 'custom', label: 'Personalizado' },
];

function presetPeriod(preset: Exclude<Preset, 'custom'>): UsagePeriod {
  switch (preset) {
    case 'today':
      return { from: localDay(), to: localDay() };
    case 'yesterday':
      return { from: localDay(-1), to: localDay(-1) };
    case 'last7':
      return { from: localDay(-6), to: localDay() };
    case 'all':
      return { from: null, to: localDay() };
  }
}

const SERVICE_LABELS: Record<Service, { name: string; help: string }> = {
  bedrock: {
    name: 'Modelo de IA (Bedrock)',
    help: 'Lo que lee y escribe el modelo en cada respuesta, y al preparar una respuesta para leerla en voz alta.',
  },
  agentcore: {
    name: 'Ejecución del agente (AgentCore)',
    help: 'El cómputo mientras el agente arma cada respuesta, estimado con su tiempo de respuesta.',
  },
  polly: { name: 'Voz (Polly)', help: 'Las respuestas que el agente envía como audio.' },
  transcribe: {
    name: 'Notas de voz (Transcribe)',
    help: 'Las notas de voz que envían los usuarios y el asistente transcribe para entenderlas.',
  },
  whatsapp: {
    name: 'Mensajes de WhatsApp',
    help: 'AWS cobra cada mensaje enviado o recibido. Meta cobra además cada plantilla según su categoría; las respuestas dentro de las 24 horas no tienen costo de Meta.',
  },
};

// One icon and colour per service, shared by the stacked bar and its rows.
const SERVICE_STYLES: Record<Service, { icon: LucideIcon; tone: Tone }> = {
  bedrock: { icon: Sparkles, tone: 'agent' },
  agentcore: { icon: Cpu, tone: 'info' },
  polly: { icon: Volume2, tone: 'warning' },
  transcribe: { icon: Mic, tone: 'secondary' },
  whatsapp: { icon: MessageCircle, tone: 'success' },
};

const ESTIMATE_HELP =
  'Estimación con los precios de lista de AWS y Meta (ver "Precios de referencia" al final). La factura real puede variar por impuestos, niveles de uso y tipo de cambio.';

/**
 * A bar's size from a percentage. A helper and not an inline `style` object:
 * the template engine reads double braces as a token and would blank them.
 */
function percentStyle(property: 'height' | 'width', percent: number): CSSProperties {
  return { [property]: `${percent}%` };
}

/** A local calendar day as YYYY-MM-DD, `offset` days from today. */
function localDay(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Every amount on the page with at most two decimals.
const usd = (value: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const decimal = (value: number) =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(value);

const integer = (value: number) => new Intl.NumberFormat('es-CL').format(Math.round(value));

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short' }).format(
    new Date(`${iso}T00:00:00`)
  );

/** % change vs. the previous period; null when there is nothing to compare with. */
function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

type Tone =
  'primary' | 'agent' | 'info' | 'success' | 'warning' | 'danger' | 'secondary' | 'neutral';

// Full class strings per tone so Tailwind's scanner sees every one; colours only from tokens.
// Pastel only: soft tints of the theme tokens, no coloured borders.
const TONES: Record<Tone, { chip: string; bar: string; barSoft: string; surface: string }> = {
  primary: {
    chip: 'bg-primary-light text-primary',
    bar: 'bg-primary/55',
    barSoft: 'bg-primary/25',
    surface: 'bg-primary-light/60',
  },
  agent: {
    chip: 'bg-agent-light text-agent-strong',
    bar: 'bg-agent/55',
    barSoft: 'bg-agent/25',
    surface: 'bg-agent-light/60',
  },
  info: {
    chip: 'bg-info-light text-info-strong',
    bar: 'bg-info/55',
    barSoft: 'bg-info/25',
    surface: 'bg-info-light/60',
  },
  success: {
    chip: 'bg-success-light text-success-strong',
    bar: 'bg-success/55',
    barSoft: 'bg-success/25',
    surface: 'bg-success-light/60',
  },
  warning: {
    chip: 'bg-warning-light text-warning-strong',
    bar: 'bg-warning/55',
    barSoft: 'bg-warning/25',
    surface: 'bg-warning-light/60',
  },
  danger: {
    chip: 'bg-destructive-light text-destructive-strong',
    bar: 'bg-destructive/55',
    barSoft: 'bg-destructive/25',
    surface: 'bg-destructive-light/60',
  },
  secondary: {
    chip: 'bg-secondary-light text-secondary',
    bar: 'bg-secondary/55',
    barSoft: 'bg-secondary/25',
    surface: 'bg-secondary-light/60',
  },
  neutral: {
    chip: 'bg-muted text-foreground-secondary',
    bar: 'bg-foreground-secondary/55',
    barSoft: 'bg-foreground-secondary/25',
    surface: 'bg-muted/60',
  },
};

function IconChip({ icon: Icon, tone, small }: { icon: LucideIcon; tone: Tone; small?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl',
        small ? 'h-7 w-7 rounded-lg' : 'h-9 w-9',
        TONES[tone].chip
      )}
      aria-hidden
    >
      <Icon className={small ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]'} />
    </span>
  );
}

/** The change vs. the previous period as a small pill: green when it is good news. */
function Trend({ value, goodWhenUp }: { value: number | null; goodWhenUp: boolean }) {
  if (value === null) return null;
  if (value === 0) {
    return (
      <span className='inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground-secondary'>
        sin cambio
      </span>
    );
  }
  const up = value > 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold',
        good
          ? 'bg-success-light text-success-strong'
          : 'bg-destructive-light text-destructive-strong'
      )}
    >
      <Icon className='h-3.5 w-3.5' aria-hidden />
      {Math.abs(value)}%
    </span>
  );
}

function Tile({
  label,
  value,
  help,
  footer,
  icon,
  tone,
  size = 'md',
}: {
  label: string;
  value: string;
  help: ReactNode;
  footer?: ReactNode;
  icon: LucideIcon;
  tone: Tone;
  size?: 'md' | 'lg';
}) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-2xl p-5', TONES[tone].surface)}>
      <div className='flex items-start justify-between gap-2'>
        <span className='flex items-center gap-1 text-sm font-medium text-foreground-secondary'>
          {label}
          <HelpTip content={help} />
        </span>
        <IconChip icon={icon} tone={tone} />
      </div>
      <span
        className={cn(
          'font-bold tabular-nums text-foreground',
          size === 'lg' ? 'text-4xl' : 'text-3xl'
        )}
      >
        {value}
      </span>
      {footer ? (
        <span className='flex flex-wrap items-center gap-1.5 text-xs text-foreground-secondary'>
          {footer}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Queries or cost per day: one series, so one colour and no legend. The header
 * shows the period's total and busiest day; hovering a bar shows that day.
 */
function DailyBars({
  days,
  measure,
  format,
  title,
  icon,
  tone,
}: {
  days: UsageDay[];
  measure: 'queries' | 'cost';
  format: (value: number) => string;
  title: string;
  icon: LucideIcon;
  tone: Tone;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map(day => day[measure]), 0);
  const total = days.reduce((sum, day) => sum + day[measure], 0);
  const peak = max > 0 ? days.find(day => day[measure] === max) : undefined;
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  const shown = active !== null ? days[active] : null;
  return (
    <figure className='flex flex-col gap-3 rounded-2xl border border-border bg-card p-5'>
      <figcaption className='flex items-start justify-between gap-3'>
        <span className='flex items-center gap-2.5'>
          <IconChip icon={icon} tone={tone} small />
          <span className='text-sm font-semibold text-foreground'>{title}</span>
        </span>
        <span className='flex flex-col items-end text-right' aria-live='polite'>
          <span className='text-lg font-bold tabular-nums leading-tight text-foreground'>
            {shown ? format(shown[measure]) : format(total)}
          </span>
          <span className='text-xs text-foreground-secondary'>
            {shown
              ? shortDay(shown.date)
              : peak
                ? `en el período · máx. ${shortDay(peak.date)}`
                : 'en el período'}
          </span>
        </span>
      </figcaption>
      <div
        className='relative flex h-40 items-end gap-1 border-b border-border'
        onMouseLeave={() => setActive(null)}
      >
        {/* Guide lines at a half and at the top, so the heights read at a glance. */}
        <div className='pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/70' />
        <div className='pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/70' />
        {days.map((day, index) => {
          const height = max > 0 ? (day[measure] / max) * 100 : 0;
          const highlighted = active === null ? day[measure] === max && max > 0 : active === index;
          return (
            <div
              key={day.date}
              className='relative flex h-full flex-1 items-end'
              onMouseEnter={() => setActive(index)}
              title={`${shortDay(day.date)}: ${format(day[measure])}`}
            >
              <div
                className={cn(
                  'w-full rounded-t-md transition-colors',
                  highlighted ? TONES[tone].bar : TONES[tone].barSoft,
                  day[measure] > 0 && 'min-h-[3px]'
                )}
                style={percentStyle('height', height)}
              />
            </div>
          );
        })}
      </div>
      <div className='flex gap-[2px] text-[10px] text-foreground-secondary' aria-hidden>
        {days.map((day, index) => (
          <span key={day.date} className='flex-1 truncate text-center'>
            {index % labelEvery === 0 ? shortDay(day.date) : ''}
          </span>
        ))}
      </div>
      <details className='text-xs text-foreground-secondary'>
        <summary className='cursor-pointer font-semibold'>Ver tabla</summary>
        <table className='mt-2 w-full'>
          <thead>
            <tr className='text-left'>
              <th className='py-1 font-semibold'>Día</th>
              <th className='py-1 text-right font-semibold'>{title}</th>
            </tr>
          </thead>
          <tbody>
            {days.map(day => (
              <tr key={day.date} className='border-t border-border/60'>
                <td className='py-1'>{shortDay(day.date)}</td>
                <td className='py-1 text-right tabular-nums'>{format(day[measure])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** The estimated cost of each service, as a bar list sorted by cost. */
function CostByService({ summary }: { summary: UsageSummary }) {
  const rows = [...SERVICES].sort((a, b) => summary.costs[b] - summary.costs[a]);
  const max = Math.max(...rows.map(service => summary.costs[service]), 0);
  const total = rows.reduce((sum, service) => sum + summary.costs[service], 0);
  return (
    <section className='flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-5'>
      <h2 className='flex items-center gap-1 text-sm font-semibold text-foreground'>
        Costo estimado por servicio
        <HelpTip content={ESTIMATE_HELP} />
      </h2>
      {/* The share of each service in one stacked bar, then the detail per service. */}
      <div className='flex h-3 overflow-hidden rounded-full bg-muted' aria-hidden>
        {rows.map(service =>
          total > 0 && summary.costs[service] > 0 ? (
            <div
              key={service}
              className={TONES[SERVICE_STYLES[service].tone].bar}
              style={percentStyle('width', (summary.costs[service] / total) * 100)}
            />
          ) : null
        )}
      </div>
      {rows.map(service => {
        const { icon, tone } = SERVICE_STYLES[service];
        const share = total > 0 ? Math.round((summary.costs[service] / total) * 100) : 0;
        return (
          <div key={service} className='flex items-center gap-3'>
            <IconChip icon={icon} tone={tone} small />
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <div className='flex items-center justify-between gap-2 text-sm'>
                <span className='flex min-w-0 items-center gap-1 text-foreground'>
                  {SERVICE_LABELS[service].name}
                  <HelpTip content={SERVICE_LABELS[service].help} />
                </span>
                <span className='flex shrink-0 items-baseline gap-2'>
                  <span className='text-xs tabular-nums text-foreground-secondary'>{share}%</span>
                  <span className='font-semibold tabular-nums text-foreground'>
                    {usd(summary.costs[service])}
                  </span>
                </span>
              </div>
              <div className='h-2 overflow-hidden rounded-full bg-muted'>
                <div
                  className={cn('h-full rounded-full', TONES[tone].bar)}
                  style={percentStyle('width', max > 0 ? (summary.costs[service] / max) * 100 : 0)}
                />
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Activity({ summary }: { summary: UsageSummary }) {
  const rows: [string, number, string, LucideIcon, Tone][] = [
    [
      'Respondidas',
      summary.outcomes.answered,
      'El agente respondió con datos de la flota.',
      CheckCircle2,
      'success',
    ],
    [
      'Fuera de tema',
      summary.outcomes.blocked,
      'Preguntas fuera del tema del negocio: el agente no las responde.',
      Ban,
      'warning',
    ],
    [
      'Derivadas a una persona',
      summary.outcomes.handoff,
      'El agente pasó la conversación al equipo.',
      UserRound,
      'info',
    ],
    [
      'Con error',
      summary.outcomes.failed,
      'El agente no pudo responder y la conversación pasó a una persona.',
      AlertTriangle,
      summary.outcomes.failed > 0 ? 'danger' : 'neutral',
    ],
    [
      'Convertidas a voz',
      summary.voiceAnswers,
      'Respuestas que el agente envió como audio.',
      Volume2,
      'warning',
    ],
    [
      'Notas de voz recibidas',
      summary.voiceNotes,
      'Audios que envió un usuario y el asistente transcribió.',
      Mic,
      'secondary',
    ],
    [
      'Plantillas enviadas',
      summary.templates,
      'Mensajes de plantilla enviados desde la bandeja.',
      FileText,
      'primary',
    ],
    [
      'Mensajes recibidos',
      summary.messages.in,
      'Mensajes de WhatsApp que llegaron al número.',
      Inbox,
      'success',
    ],
    [
      'Mensajes enviados',
      summary.messages.out,
      'Mensajes de WhatsApp enviados por el agente o el equipo, plantillas incluidas.',
      Send,
      'success',
    ],
  ];
  return (
    <section className='flex flex-col gap-2 rounded-2xl border border-border bg-card p-5'>
      <h2 className='text-sm font-semibold text-foreground'>Actividad</h2>
      <dl className='divide-y divide-border/60'>
        {rows.map(([label, value, help, icon, tone]) => (
          <div key={label} className='flex items-center justify-between gap-2 py-2 text-sm'>
            <dt className='flex items-center gap-2.5 text-foreground-secondary'>
              <IconChip icon={icon} tone={tone} small />
              {label}
              <HelpTip content={help} />
            </dt>
            <dd className='font-semibold tabular-nums text-foreground'>{integer(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Hidden for now (see the commented use below); exported so it stays one line away. */
export function Prices({ summary }: { summary: UsageSummary }) {
  const { prices } = summary;
  const items: [string, string][] = [
    ...Object.entries(prices.bedrockPerMillionTokens).map(([family, p]): [string, string] => [
      `Claude ${family} (por millón de tokens)`,
      `entrada ${usd(p.input)} · salida ${usd(p.output)} · caché ${usd(p.cache_read)}`,
    ]),
    ...Object.entries(prices.pollyPerMillionCharacters).map(([engine, price]): [string, string] => [
      `Polly ${engine} (por millón de caracteres)`,
      usd(price),
    ]),
    [
      'Transcribe (por minuto)',
      `${usd(prices.transcribePerMinute)}, mínimo ${prices.transcribeMinimumSeconds} s por nota`,
    ],
    ...Object.entries(prices.whatsappTemplateByCategory).map(
      ([category, price]): [string, string] => [
        `Plantilla ${category.toLowerCase()} a Chile (Meta)`,
        usd(price),
      ]
    ),
    ['End User Messaging (por mensaje)', usd(prices.endUserMessagingPerMessage)],
  ];
  return (
    <details className='rounded-2xl border border-border bg-card p-5 text-sm'>
      <summary className='cursor-pointer font-semibold text-foreground'>
        Precios de referencia
        <span className='ml-2 font-normal text-foreground-secondary'>
          precios de lista revisados el {prices.checkedOn}
        </span>
      </summary>
      <dl className='mt-3 divide-y divide-border/60'>
        {items.map(([label, value]) => (
          <div key={label} className='flex flex-wrap justify-between gap-2 py-1.5'>
            <dt className='text-foreground-secondary'>{label}</dt>
            <dd className='tabular-nums text-foreground'>{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function UsageSkeleton() {
  return (
    <div role='status' aria-label='Cargando el uso' className='flex flex-col gap-6'>
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6'>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className='h-[116px] rounded-2xl' />
        ))}
      </div>
      <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
        <Skeleton className='h-64 rounded-2xl' />
        <Skeleton className='h-64 rounded-2xl' />
      </div>
    </div>
  );
}

/** The "Uso y costos" tab of the Dashboard: how much the assistant is used and what it costs, estimated. */
export function UsageView() {
  const [preset, setPreset] = useState<Preset>('last7');
  const [customFrom, setCustomFrom] = useState(localDay(-30));
  const [customTo, setCustomTo] = useState(localDay());
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The custom range waits until both ends are valid (from <= to <= today).
  const period = useMemo<UsagePeriod | null>(() => {
    if (preset !== 'custom') return presetPeriod(preset);
    if (!customFrom || !customTo || customFrom > customTo || customTo > localDay()) return null;
    return { from: customFrom, to: customTo };
  }, [preset, customFrom, customTo]);

  const load = useCallback(async (forPeriod: UsagePeriod) => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await fetchUsage(forPeriod));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el uso.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (period) void load(period);
  }, [period, load]);

  const versus = (current: number, previous: number | undefined, goodWhenUp: boolean) =>
    summary?.previous && previous !== undefined ? (
      <>
        <Trend value={change(current, previous)} goodWhenUp={goodWhenUp} /> vs. el período anterior
      </>
    ) : undefined;

  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-3'>
        <p className='text-sm text-foreground-secondary'>
          Cuánto se usa el asistente y cuánto cuesta, estimado con precios de lista.
        </p>
        <div className='flex flex-wrap items-center gap-2'>
          {PRESETS.map(option => (
            <Button
              key={option.id}
              size='sm'
              variant={preset === option.id ? 'default' : 'outline'}
              aria-pressed={preset === option.id}
              onClick={() => setPreset(option.id)}
            >
              {option.label}
            </Button>
          ))}
          <Button
            variant='outline'
            size='sm'
            onClick={() => period && void load(period)}
            disabled={loading || !period}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} aria-hidden />
            Actualizar
          </Button>
        </div>
        {preset === 'custom' ? (
          <div className='flex flex-wrap items-center gap-3 text-sm text-foreground-secondary'>
            <label className='flex items-center gap-2'>
              Desde
              <input
                type='date'
                value={customFrom}
                max={customTo || localDay()}
                onChange={event => setCustomFrom(event.target.value)}
                className='rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground'
              />
            </label>
            <label className='flex items-center gap-2'>
              Hasta
              <input
                type='date'
                value={customTo}
                min={customFrom}
                max={localDay()}
                onChange={event => setCustomTo(event.target.value)}
                className='rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground'
              />
            </label>
            {!period ? (
              <span className='text-destructive'>
                Elige un rango hasta hoy, con la fecha inicial antes de la final.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading && !summary ? (
        <UsageSkeleton />
      ) : error ? (
        <div className='flex items-start gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-destructive-strong'>
          <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' aria-hidden />
          <span>{error}</span>
        </div>
      ) : summary ? (
        <>
          <div className='grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6'>
            <Tile
              label='Respondidas'
              value={integer(summary.outcomes.answered)}
              help='Consultas que el agente respondió correctamente por WhatsApp.'
              footer={versus(summary.queries, summary.previous?.queries, true)}
              icon={CheckCircle2}
              tone='success'
            />
            <Tile
              label='Con errores'
              value={integer(summary.outcomes.failed)}
              help='El agente no pudo responder y la conversación pasó a una persona.'
              icon={AlertTriangle}
              tone={summary.outcomes.failed > 0 ? 'danger' : 'neutral'}
            />
            <Tile
              label='Fuera de tema'
              value={integer(summary.outcomes.blocked)}
              help='Preguntas fuera del tema del negocio: el agente funciona bien y no las responde.'
              icon={Ban}
              tone='warning'
            />
            <Tile
              icon={Timer}
              tone='info'
              label='Tiempo de respuesta'
              value={
                summary.avgResponseSeconds === null
                  ? '—'
                  : `${decimal(summary.avgResponseSeconds)} s`
              }
              help='Promedio desde que llega la pregunta hasta que el agente tiene la respuesta.'
            />
            <Tile
              icon={Bot}
              tone='agent'
              label='Tokens por consulta'
              value={summary.tokensPerQuery === null ? '—' : integer(summary.tokensPerQuery)}
              help='Lo que el modelo lee (instrucciones, datos y conversación) y escribe en cada consulta, en promedio.'
            />
            <Tile
              icon={Coins}
              tone='primary'
              label='Costo por consulta'
              value={summary.costs.perQuery === null ? '—' : usd(summary.costs.perQuery)}
              help={`Costo estimado del período dividido por las consultas. ${ESTIMATE_HELP}`}
            />
          </div>

          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <Tile
              label='Costo estimado del período'
              value={usd(summary.costs.total)}
              help={ESTIMATE_HELP}
              footer={versus(summary.costs.total, summary.previous?.cost, false)}
              icon={DollarSign}
              tone='primary'
              size='lg'
            />
            <Tile
              label='Mensajes de WhatsApp'
              value={integer(summary.messages.in + summary.messages.out)}
              help='Mensajes recibidos y enviados por el número, plantillas incluidas.'
              footer={`${integer(summary.messages.in)} recibidos · ${integer(summary.messages.out)} enviados`}
              icon={MessageCircle}
              tone='success'
              size='lg'
            />
          </div>

          <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
            <DailyBars
              days={summary.byDay}
              measure='queries'
              format={integer}
              title='Consultas por día'
              icon={BarChart3}
              tone='info'
            />
            <DailyBars
              days={summary.byDay}
              measure='cost'
              format={value => usd(value)}
              title='Costo estimado por día'
              icon={DollarSign}
              tone='primary'
            />
          </div>

          <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
            <CostByService summary={summary} />
            <Activity summary={summary} />
          </div>

          {/* <Prices summary={summary} /> */}
        </>
      ) : null}
    </div>
  );
}
