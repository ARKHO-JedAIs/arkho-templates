import { fetchOrFail, friendlyError, type ApiErrorBody } from '@/lib/apiErrors';
import { parseJsonBody } from '@/lib/apiFetch';
import { authHeaders, isMockAuth } from '@/lib/auth/session';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export const SERVICES = ['bedrock', 'agentcore', 'polly', 'transcribe', 'whatsapp'] as const;
export type Service = (typeof SERVICES)[number];

export interface UsageDay extends Record<Service, number> {
  date: string;
  queries: number;
  cost: number;
}

/** GET /whatsapp/usage: the assistant's usage and its estimated cost (USD) for a period. */
export interface UsageSummary {
  from: string;
  to: string;
  queries: number;
  outcomes: { answered: number; blocked: number; handoff: number; failed: number };
  avgResponseSeconds: number | null;
  tokens: { input: number; output: number };
  tokensPerQuery: number | null;
  messages: { in: number; out: number };
  voiceAnswers: number;
  voiceNotes: number;
  templates: number;
  costs: Record<Service, number> & { total: number; perQuery: number | null };
  byDay: UsageDay[];
  /** Null for "Todo": there is no previous period to compare with. */
  previous: { queries: number; cost: number; avgResponseSeconds: number | null } | null;
  prices: UsagePrices;
}

export interface UsagePrices {
  checkedOn: string;
  bedrockPerMillionTokens: Record<
    string,
    { input: number; output: number; cache_read: number; cache_write: number }
  >;
  pollyPerMillionCharacters: Record<string, number>;
  transcribePerMinute: number;
  transcribeMinimumSeconds: number;
  whatsappTemplateByCategory: Record<string, number>;
  endUserMessagingPerMessage: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the raw snake_case API body */
function toSummary(raw: any): UsageSummary {
  const prices = raw.prices ?? {};
  const costs = raw.costs ?? {};
  return {
    from: raw.from,
    to: raw.to,
    queries: raw.queries ?? 0,
    outcomes: { answered: 0, blocked: 0, handoff: 0, failed: 0, ...raw.outcomes },
    avgResponseSeconds: raw.avg_response_seconds ?? null,
    tokens: { input: raw.tokens?.input ?? 0, output: raw.tokens?.output ?? 0 },
    tokensPerQuery: raw.tokens_per_query ?? null,
    messages: { in: raw.messages?.in ?? 0, out: raw.messages?.out ?? 0 },
    voiceAnswers: raw.voice_answers ?? 0,
    voiceNotes: raw.voice_notes ?? 0,
    templates: raw.templates ?? 0,
    costs: {
      bedrock: costs.bedrock ?? 0,
      agentcore: costs.agentcore ?? 0,
      polly: costs.polly ?? 0,
      transcribe: costs.transcribe ?? 0,
      whatsapp: costs.whatsapp ?? 0,
      total: costs.total ?? 0,
      perQuery: costs.per_query ?? null,
    },
    byDay: (raw.by_day ?? []).map((day: any) => ({
      date: day.date,
      queries: day.queries ?? 0,
      cost: day.cost ?? 0,
      bedrock: day.bedrock ?? 0,
      agentcore: day.agentcore ?? 0,
      polly: day.polly ?? 0,
      transcribe: day.transcribe ?? 0,
      whatsapp: day.whatsapp ?? 0,
    })),
    previous: raw.previous
      ? {
          queries: raw.previous.queries ?? 0,
          cost: raw.previous.cost ?? 0,
          avgResponseSeconds: raw.previous.avg_response_seconds ?? null,
        }
      : null,
    prices: {
      checkedOn: prices.checked_on ?? '',
      bedrockPerMillionTokens: prices.bedrock_per_million_tokens ?? {},
      pollyPerMillionCharacters: prices.polly_per_million_characters ?? {},
      transcribePerMinute: prices.transcribe_per_minute ?? 0,
      transcribeMinimumSeconds: prices.transcribe_minimum_seconds ?? 0,
      whatsappTemplateByCategory: prices.whatsapp_template_by_category ?? {},
      endUserMessagingPerMessage: prices.end_user_messaging_per_message ?? 0,
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Days to read, both included; `from: null` = every day recorded ("Todo"). */
export interface UsagePeriod {
  from: string | null;
  to: string;
}

const DAY_MS = 86_400_000;

/** Mock mode has no backend: a believable week, so the whole tab can be seen. */
function demoSummary(period: UsagePeriod): UsageSummary {
  const end = new Date(`${period.to}T00:00:00`);
  const start = period.from
    ? new Date(`${period.from}T00:00:00`)
    : new Date(end.getTime() - 6 * DAY_MS);
  const days: UsageDay[] = [];
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    const index = days.length;
    const queries = 8 + ((index * 7) % 13);
    const bedrock = queries * 0.021;
    const agentcore = queries * 0.0004;
    const whatsapp = queries * 2 * 0.005;
    const date = new Date(time);
    const pad = (n: number) => String(n).padStart(2, '0');
    days.push({
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      queries,
      cost: bedrock + agentcore + whatsapp,
      bedrock,
      agentcore,
      polly: 0,
      transcribe: 0,
      whatsapp,
    });
  }
  const sum = (pick: (day: UsageDay) => number) =>
    days.reduce((total, day) => total + pick(day), 0);
  const queries = sum(day => day.queries);
  const total = sum(day => day.cost);
  return {
    from: days[0]?.date ?? period.to,
    to: period.to,
    queries,
    outcomes: {
      answered: Math.round(queries * 0.86),
      blocked: Math.round(queries * 0.08),
      handoff: Math.round(queries * 0.05),
      failed: 0,
    },
    avgResponseSeconds: 5.8,
    tokens: { input: queries * 7200, output: queries * 310 },
    tokensPerQuery: 7510,
    messages: { in: queries, out: queries },
    voiceAnswers: 0,
    voiceNotes: 0,
    templates: 2,
    costs: {
      bedrock: sum(day => day.bedrock),
      agentcore: sum(day => day.agentcore),
      polly: 0,
      transcribe: 0,
      whatsapp: sum(day => day.whatsapp),
      total,
      perQuery: queries ? total / queries : null,
    },
    byDay: days,
    previous: period.from
      ? { queries: Math.round(queries * 0.9), cost: total * 0.85, avgResponseSeconds: 6.4 }
      : null,
    prices: {
      checkedOn: '2026-11-11',
      bedrockPerMillionTokens: {
        sonnet: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
      },
      pollyPerMillionCharacters: { neural: 16 },
      transcribePerMinute: 0.024,
      transcribeMinimumSeconds: 15,
      whatsappTemplateByCategory: { UTILITY: 0.02, MARKETING: 0.0889 },
      endUserMessagingPerMessage: 0.005,
    },
  };
}

export async function fetchUsage(period: UsagePeriod): Promise<UsageSummary> {
  if (isMockAuth) return demoSummary(period);
  if (!BASE_URL) throw new Error('VITE_API_BASE_URL no está configurada.');
  const query = new URLSearchParams(
    period.from === null ? { all: 'true' } : { from: period.from, to: period.to }
  ).toString();
  const response = await fetchOrFail(`${BASE_URL}/whatsapp/usage?${query}`, {
    headers: await authHeaders(),
  });
  const body = await parseJsonBody<{ data?: unknown } & ApiErrorBody>(response);
  if (!response.ok || !body?.data) {
    throw new Error(friendlyError(response.status, body, 'No se pudo cargar el uso'));
  }
  return toSummary(body.data);
}
