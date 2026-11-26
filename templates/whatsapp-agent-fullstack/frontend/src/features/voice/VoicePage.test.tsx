import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceState } from './types';

const service = vi.hoisted(() => ({
  fetchVoice: vi.fn(),
  saveVoice: vi.fn(),
  previewVoice: vi.fn(),
}));

vi.mock('./voiceService', async importOriginal => ({
  ...(await importOriginal<typeof import('./voiceService')>()),
  ...service,
}));
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
  authHeaders: vi.fn(async () => ({})),
  isMockAuth: true,
}));

const { usePermissionsStore } = await import('@/lib/access/permissions');
const { default: VoicePage } = await import('./VoicePage');

const state = (provider: 'polly' | 'none' = 'polly'): VoiceState => ({
  settings: {
    provider,
    replyWithAudio: 'voice_notes',
    voiceId: 'Lupe',
    engine: 'neural',
    transcribeLanguage: 'es-US',
  },
  voices: [
    {
      id: 'Lupe',
      name: 'Lupe',
      gender: 'Female',
      languageCode: 'es-US',
      languageName: 'Español (EE.UU.)',
      engines: ['neural', 'generative'],
    },
  ],
  languages: [{ code: 'es-US', label: 'Español latino (es-US)' }],
});

const grant = (menu: string[]) =>
  usePermissionsStore.setState({
    permissions: { roles: ['admin'], menu, actions: [] },
    status: 'ready',
    owner: 'me',
  });

beforeEach(() => {
  vi.clearAllMocks();
  service.fetchVoice.mockResolvedValue(state());
  service.saveVoice.mockImplementation(async choice => ({
    ...state(),
    settings: { ...state().settings, ...choice },
  }));
  grant(['voice']);
});

describe('VoicePage', () => {
  it('offers none or Amazon Polly and shows the Polly settings for Polly', async () => {
    render(<VoicePage />);
    const polly = await screen.findByRole('radio', { name: /amazon polly/i });
    expect((polly as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /ninguna/i })).toBeTruthy();
    expect(screen.getByLabelText('Voz')).toBeTruthy();
    expect(screen.getByLabelText('Motor')).toBeTruthy();
    expect(screen.getByLabelText('Responder con audio')).toBeTruthy();
    expect(screen.getByLabelText('Idioma de transcripción')).toBeTruthy();
  });

  it('hides the Polly settings when there is no voice', async () => {
    service.fetchVoice.mockResolvedValue(state('none'));
    render(<VoicePage />);
    await screen.findByRole('radio', { name: /ninguna/i });
    expect(screen.queryByLabelText('Motor')).toBeNull();
    expect(screen.queryByLabelText('Idioma de transcripción')).toBeNull();
  });

  it('shows the settings as soon as Polly is chosen and saves the whole choice', async () => {
    service.fetchVoice.mockResolvedValue(state('none'));
    render(<VoicePage />);
    const save = await screen.findByRole('button', { name: 'Guardar' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /amazon polly/i }));
    fireEvent.change(screen.getByLabelText('Responder con audio'), { target: { value: 'always' } });
    fireEvent.click(save);

    await waitFor(() => expect(service.saveVoice).toHaveBeenCalledTimes(1));
    expect(service.saveVoice.mock.calls[0]?.[0]).toEqual({
      provider: 'polly',
      replyWithAudio: 'always',
      voiceId: 'Lupe',
      engine: 'neural',
      transcribeLanguage: 'es-US',
    });
  });

  it('is read only without the voice permission', async () => {
    grant([]);
    render(<VoicePage />);
    const none = await screen.findByRole('radio', { name: /ninguna/i });
    expect((none as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Guardar' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('shows the error when the settings cannot be read', async () => {
    service.fetchVoice.mockRejectedValueOnce(new Error('No se pudo leer la configuración de voz'));
    render(<VoicePage />);
    expect(await screen.findByText('No se pudo leer la configuración de voz')).toBeTruthy();
  });
});
