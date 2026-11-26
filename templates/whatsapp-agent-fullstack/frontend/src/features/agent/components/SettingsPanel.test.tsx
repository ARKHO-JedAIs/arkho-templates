import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSettings } from '../agentSettingsService';

const service = vi.hoisted(() => ({
  fetchAgentSettings: vi.fn(),
  saveAgentSettings: vi.fn(),
}));

vi.mock('../agentSettingsService', async importOriginal => ({
  ...(await importOriginal<typeof import('../agentSettingsService')>()),
  ...service,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
  authHeaders: vi.fn(async () => ({})),
  isMockAuth: true,
}));

const { usePermissionsStore } = await import('@/lib/access/permissions');
const { SettingsPanel } = await import('./SettingsPanel');

const settings = (overrides: Partial<AgentSettings> = {}): AgentSettings => ({
  memory: { mode: 'window', minutes: 60 },
  rateLimit: { enabled: true, perHour: 30 },
  longTermMemory: 'conversation',
  ...overrides,
});

const grant = (actions: string[]) =>
  usePermissionsStore.setState({
    permissions: { roles: ['developer'], menu: ['agent'], actions },
    status: 'ready',
    owner: 'me',
  });

beforeEach(() => {
  vi.clearAllMocks();
  service.fetchAgentSettings.mockResolvedValue(settings());
  service.saveAgentSettings.mockImplementation(async changes => ({
    ...settings(),
    memory: { ...settings().memory, ...changes.memory },
    rateLimit: { ...settings().rateLimit, ...changes.rateLimit },
  }));
  grant(['agent.settings']);
});

describe('SettingsPanel', () => {
  it('shows the three memory choices with the current one selected', async () => {
    render(<SettingsPanel />);
    const window = await screen.findByRole('radio', { name: /mantener la conversación/i });
    expect((window as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /empezar limpio/i })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /sin memoria/i })).toBeTruthy();
    expect((screen.getByLabelText(/minutos sin mensajes/i) as HTMLInputElement).value).toBe('60');
  });

  it('saves only after a change and sends the new memory mode', async () => {
    render(<SettingsPanel />);
    const save = await screen.findByRole('button', { name: 'Guardar' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /empezar limpio/i }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(service.saveAgentSettings).toHaveBeenCalledTimes(1));
    expect(service.saveAgentSettings.mock.calls[0]?.[0].memory.mode).toBe('each_message');
  });

  it('hides the minutes unless the memory lasts a window', async () => {
    render(<SettingsPanel />);
    await screen.findByLabelText(/minutos sin mensajes/i);
    fireEvent.click(screen.getByRole('radio', { name: /sin memoria/i }));
    expect(screen.queryByLabelText(/minutos sin mensajes/i)).toBeNull();
  });

  it('refuses minutes out of range', async () => {
    render(<SettingsPanel />);
    const minutes = await screen.findByLabelText(/minutos sin mensajes/i);
    fireEvent.change(minutes, { target: { value: '0' } });
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    fireEvent.change(minutes, { target: { value: '45' } });
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('turns the answer limit off and hides its number', async () => {
    render(<SettingsPanel />);
    const toggle = await screen.findByRole('switch', { name: /limitar las respuestas/i });
    expect(screen.getByLabelText(/respuestas por cliente y hora/i)).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByLabelText(/respuestas por cliente y hora/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(service.saveAgentSettings).toHaveBeenCalled());
    expect(service.saveAgentSettings.mock.calls[0]?.[0].rateLimit.enabled).toBe(false);
  });

  it('is read only without the agent.settings permission', async () => {
    grant([]);
    render(<SettingsPanel />);
    const radio = await screen.findByRole('radio', { name: /empezar limpio/i });
    expect((radio as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText(/no tienes permiso/i)).toBeTruthy();
  });

  it('warns that the long-term memory of the deploy stays unless there is no memory', async () => {
    service.fetchAgentSettings.mockResolvedValue(settings({ longTermMemory: 'facts' }));
    render(<SettingsPanel />);
    expect(await screen.findByText(/guarda datos del cliente entre conversaciones/i)).toBeTruthy();
  });

  it('shows the error and retries', async () => {
    service.fetchAgentSettings.mockRejectedValueOnce(
      new Error('No se pudo cargar la configuración')
    );
    render(<SettingsPanel />);
    expect(await screen.findByText('No se pudo cargar la configuración')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('radio', { name: /sin memoria/i })).toBeTruthy();
  });
});
