import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UsagePeriod, UsageSummary } from './usageService';

const summary: UsageSummary = {
  from: '2026-11-05',
  to: '2026-11-11',
  queries: 40,
  outcomes: { answered: 35, blocked: 3, handoff: 1, failed: 1 },
  avgResponseSeconds: 6.4,
  tokens: { input: 900000, output: 40000 },
  tokensPerQuery: 23500,
  messages: { in: 50, out: 60 },
  voiceAnswers: 5,
  voiceNotes: 2,
  templates: 3,
  costs: {
    bedrock: 3.3,
    agentcore: 0.01,
    polly: 0.02,
    transcribe: 0.01,
    whatsapp: 0.075,
    total: 3.405,
    perQuery: 0.0851,
  },
  byDay: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-11-${String(i + 5).padStart(2, '0')}`,
    queries: i * 2,
    cost: i * 0.2,
    bedrock: i * 0.2,
    agentcore: 0,
    polly: 0,
    transcribe: 0,
    whatsapp: 0,
  })),
  previous: { queries: 20, cost: 4, avgResponseSeconds: 7 },
  prices: {
    checkedOn: '2026-11-11',
    bedrockPerMillionTokens: {
      sonnet: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
    },
    pollyPerMillionCharacters: { neural: 16 },
    transcribePerMinute: 0.024,
    transcribeMinimumSeconds: 15,
    whatsappTemplateByCategory: { UTILITY: 0.02 },
    endUserMessagingPerMessage: 0.005,
  },
};

const fetchUsage = vi.fn<(period: UsagePeriod) => Promise<UsageSummary>>(async () => summary);
vi.mock('./usageService', async original => ({
  ...(await original<typeof import('./usageService')>()),
  fetchUsage: (period: UsagePeriod) => fetchUsage(period),
}));

const { UsageView } = await import('./UsageView');

describe('UsageView', () => {
  it('shows the cards of each outcome, the cost and the change vs. the previous period', async () => {
    render(<UsageView />);
    expect(await screen.findByText('Tokens por consulta')).toBeTruthy();
    expect(screen.getByText('23.500')).toBeTruthy();
    expect(screen.getByText('50 recibidos · 60 enviados')).toBeTruthy();
    expect(screen.getAllByText(/100%/).length).toBeGreaterThan(0);
    expect(screen.getByText('Costo estimado por servicio')).toBeTruthy();
    expect(screen.getByText('Ejecución del agente (AgentCore)')).toBeTruthy();
    // In the chart's title and in its table view.
    expect(screen.getAllByText('Consultas por día')).toHaveLength(2);
  });

  it('has the same filters as the trips: Todo reads every day, Personalizado any range', async () => {
    render(<UsageView />);
    await screen.findByText('Tokens por consulta');
    fireEvent.click(screen.getByRole('button', { name: 'Todo' }));
    await waitFor(() => expect(fetchUsage.mock.lastCall?.[0].from).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } });
    await waitFor(() => expect(fetchUsage.mock.lastCall?.[0].from).toBe('2026-01-01'));
  });
});
