import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfigState } from './types';

const service = vi.hoisted(() => ({
  fetchAgentConfig: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
  discardDraft: vi.fn(),
  fetchVersions: vi.fn(),
  fetchModels: vi.fn(),
  adoptConsoleVersion: vi.fn(),
  fetchVersion: vi.fn(),
  rollbackTo: vi.fn(),
}));

vi.mock('./agentConfigService', () => ({
  ...service,
  AgentConfigAuthError: class extends Error {},
  AgentConfigConflictError: class extends Error {},
}));
// Stable, like the real hook: a new function per render would re-run the page's load.
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AgentConfigPage } = await import('./AgentConfigPage');

const config = {
  enabled: true,
  businessName: 'AquaChile Logística',
  instructions: 'Eres el asistente logístico de AquaChile y respondes con todos los datos.',
  greeting: 'Hola',
  refusal: 'Solo logística',
  handoffMessage: 'Te paso con una persona',
  model: { id: 'us.anthropic.claude-sonnet-4-6', temperature: 0.3, maxTokens: 4096, topP: null },
  parameters: {},
};

const state = (overrides: Partial<AgentConfigState> = {}): AgentConfigState => ({
  published: {
    version: 'v0003',
    config,
    publishedAt: '2026-11-06T15:00:00+00:00',
    publishedBy: 'ana@aquachile.cl',
    comment: '',
    bedrockVersion: '3',
  },
  draft: null,
  liveMatches: true,
  consoleDraft: null,
  bedrockPrompt: { id: 'P1', arn: 'arn:aws:bedrock:us-east-1:1:prompt/P1', name: 'agent' },
  ...overrides,
});

describe('AgentConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.fetchVersions.mockResolvedValue({ versions: [], consoleVersions: [] });
    service.fetchModels.mockResolvedValue([]);
  });

  it('shows the version in use and keeps Publicar off until something changes', async () => {
    service.fetchAgentConfig.mockResolvedValue(state());
    render(<AgentConfigPage />);
    expect(await screen.findByText('En uso: v0003')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', true);
  });

  it('saves the edit as a draft and then publishes that revision', async () => {
    service.fetchAgentConfig.mockResolvedValue(state());
    service.saveDraft.mockResolvedValue({
      config,
      revision: 1,
      updatedAt: null,
      updatedBy: null,
      basedOn: 'v0003',
    });
    service.publishDraft.mockResolvedValue({ ...state().published, version: 'v0004' });
    render(<AgentConfigPage />);

    const instructions = await screen.findByLabelText('Instrucciones del negocio');
    fireEvent.change(instructions, { target: { value: `${config.instructions} Más detalle.` } });
    fireEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    const confirm = await screen.findAllByRole('button', { name: 'Publicar' });
    fireEvent.click(confirm[confirm.length - 1]!);

    await waitFor(() => expect(service.publishDraft).toHaveBeenCalledWith('', 1));
    expect(service.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ instructions: `${config.instructions} Más detalle.` }),
      undefined
    );
  });

  it('asks for the value of a {{variable}} before publishing', async () => {
    service.fetchAgentConfig.mockResolvedValue(state());
    render(<AgentConfigPage />);
    const instructions = await screen.findByLabelText('Instrucciones del negocio');
    fireEvent.change(instructions, {
      target: { value: `${config.instructions} Atraso tras {{tolerancia}} minutos.` },
    });
    expect(screen.getByText(/Falta el valor de \{\{tolerancia\}\}/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publicar' })).toHaveProperty('disabled', true);
  });

  it('offers to bring in what was edited in the AWS console', async () => {
    service.fetchAgentConfig.mockResolvedValue(
      state({
        consoleDraft: { instructions: 'Editado en la consola de AWS.', model: config.model },
      })
    );
    render(<AgentConfigPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Traer cambios de AWS' }));
    expect((screen.getByLabelText('Instrucciones del negocio') as HTMLTextAreaElement).value).toBe(
      'Editado en la consola de AWS.'
    );
  });

  it('warns when the configuration in use was changed outside the web', async () => {
    service.fetchAgentConfig.mockResolvedValue(state({ liveMatches: false }));
    render(<AgentConfigPage />);
    expect(await screen.findByText(/no coincide con la última versión publicada/)).toBeTruthy();
  });
});
