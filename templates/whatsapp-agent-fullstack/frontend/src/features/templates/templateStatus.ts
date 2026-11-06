import {
  Ban,
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import type { TemplateQuality, WhatsAppTemplate } from '@/features/whatsapp/types';

export interface StatusMeta {
  /** Singular, for the badge. */
  label: string;
  /** Plural, for the filter chip. */
  plural: string;
  icon: LucideIcon;
  /** Badge tint: a -light background and the -strong ink that reads on it at 4.5:1. */
  badge: string;
  /** What it means for whoever wants to send it. */
  hint: string;
}

/** The review states, in the order the filter chips show them. */
export const STATUS_ORDER = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'] as const;

export type KnownStatus = (typeof STATUS_ORDER)[number];

export const STATUS_META: Record<KnownStatus, StatusMeta> = {
  APPROVED: {
    label: 'Aprobada',
    plural: 'Aprobadas',
    icon: CircleCheck,
    badge: 'bg-success-light text-success-strong',
    hint: 'Meta la aprobó: ya se puede enviar desde las conversaciones.',
  },
  PENDING: {
    label: 'En revisión',
    plural: 'En revisión',
    icon: Clock,
    badge: 'bg-info-light text-info-strong',
    hint: 'Meta la está revisando. Suele tardar desde minutos hasta 24 horas.',
  },
  REJECTED: {
    label: 'Rechazada',
    plural: 'Rechazadas',
    icon: CircleX,
    badge: 'bg-destructive-light text-destructive-strong',
    hint: 'Meta la rechazó. Revisa el motivo en el Administrador de WhatsApp, corrígela y vuelve a enviarla a revisión.',
  },
  PAUSED: {
    label: 'Pausada',
    plural: 'Pausadas',
    icon: CirclePause,
    badge: 'bg-warning-light text-warning-strong',
    hint: 'Meta la pausó por comentarios negativos de quienes la recibieron. No se puede enviar mientras siga pausada.',
  },
  DISABLED: {
    label: 'Desactivada',
    plural: 'Desactivadas',
    icon: Ban,
    badge: 'bg-muted text-foreground-secondary',
    hint: 'Meta la desactivó por su baja calidad. Ya no se puede enviar.',
  },
};

const UNKNOWN_STATUS: StatusMeta = {
  label: 'Desconocido',
  plural: 'Otras',
  icon: CircleHelp,
  badge: 'bg-muted text-foreground-secondary',
  hint: 'Meta informó un estado que esta pantalla no conoce.',
};

const isKnownStatus = (status: string): status is KnownStatus =>
  (STATUS_ORDER as readonly string[]).includes(status);

export function statusMeta(status: string): StatusMeta {
  return isKnownStatus(status) ? STATUS_META[status] : { ...UNKNOWN_STATUS, label: status };
}

/** Meta's quality rating: a dot plus a word, never the colour alone. */
export const QUALITY_META: Record<TemplateQuality, { label: string; dot: string }> = {
  GREEN: { label: 'Alta', dot: 'bg-success' },
  YELLOW: { label: 'Media', dot: 'bg-warning' },
  RED: { label: 'Baja', dot: 'bg-destructive' },
  UNKNOWN: { label: 'Sin datos', dot: 'bg-muted-foreground' },
};

export const CATEGORY_LABEL: Record<string, string> = {
  UTILITY: 'Utilidad',
  MARKETING: 'Marketing',
  AUTHENTICATION: 'Autenticación',
};

export const categoryLabel = (category: string) => CATEGORY_LABEL[category] ?? category;

/** The status filter: every template, or one review state. */
export type StatusFilter = 'all' | KnownStatus;

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The templates matching a search (name, body, category; accents and case ignored) and a status. */
export function filterTemplates(
  list: readonly WhatsAppTemplate[],
  query: string,
  status: StatusFilter
): WhatsAppTemplate[] {
  const words = fold(query.trim());
  return list.filter(template => {
    if (status !== 'all' && template.status !== status) return false;
    if (!words) return true;
    return [template.name, template.body, template.category, categoryLabel(template.category)]
      .map(fold)
      .some(value => value.includes(words));
  });
}

/** How many templates are in each review state. */
export function countByStatus(list: readonly WhatsAppTemplate[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: list.length,
    APPROVED: 0,
    PENDING: 0,
    REJECTED: 0,
    PAUSED: 0,
    DISABLED: 0,
  };
  for (const template of list) {
    if (isKnownStatus(template.status)) counts[template.status] += 1;
  }
  return counts;
}

/** While any template is in review, the list is fetched again this often. */
export const REVIEW_POLL_MS = 45_000;

/** Whether the list should keep polling: something is still in Meta's review. */
export const hasPending = (list: readonly WhatsAppTemplate[]) =>
  list.some(template => template.status === 'PENDING');

/** A template that left review, for the "approved" / "rejected" toast. */
export interface ReviewOutcome {
  name: string;
  language: string;
  status: 'APPROVED' | 'REJECTED';
}

/** The templates that went from in review to approved or rejected between two fetches. */
export function reviewOutcomes(
  before: readonly WhatsAppTemplate[],
  after: readonly WhatsAppTemplate[]
): ReviewOutcome[] {
  const key = (template: WhatsAppTemplate) => `${template.name}|${template.language}`;
  const pending = new Set(before.filter(t => t.status === 'PENDING').map(key));
  return after.flatMap((template): ReviewOutcome[] => {
    const status = template.status;
    if (!pending.has(key(template)) || (status !== 'APPROVED' && status !== 'REJECTED')) return [];
    return [
      {
        name: template.name,
        language: template.language,
        status: status === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      },
    ];
  });
}

/**
 * A WhatsApp variable as it is written in the template, built at runtime: the
 * generator's token engine would treat the literal double braces as one of its
 * own placeholders.
 */
export const variableToken = (name: string) => '{'.repeat(2) + name + '}'.repeat(2);
