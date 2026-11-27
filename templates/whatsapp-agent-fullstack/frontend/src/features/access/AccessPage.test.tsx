import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessOverview } from './types';

const service = vi.hoisted(() => ({
  fetchAccess: vi.fn(),
  createRole: vi.fn(),
  updateRolePermissions: vi.fn(),
  deleteRole: vi.fn(),
  updateRoleDetails: vi.fn(),
}));

vi.mock('./accessService', () => ({ ...service, AccessAuthError: class extends Error {} }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/session', () => ({
  getCurrentUser: vi.fn(),
  signOut: vi.fn(),
  authHeaders: vi.fn(async () => ({})),
  isMockAuth: true,
}));

const { usePermissionsStore } = await import('@/lib/access/permissions');
const { AccessPage } = await import('./AccessPage');

const overview = (): AccessOverview => ({
  roles: [
    {
      id: 'admin',
      name: 'Administrador',
      description: '',
      system: true,
      locked: false,
      permissions: { menu: ['whatsapp', 'templates', 'access'], actions: ['access.manage'] },
    },
    {
      id: 'supervisor',
      name: 'Supervisor',
      description: '',
      system: false,
      locked: false,
      permissions: { menu: ['whatsapp'], actions: [] },
    },
  ],
  menu: [
    { id: 'whatsapp', label: 'Bandeja WhatsApp' },
    { id: 'templates', label: 'Plantillas' },
    { id: 'access', label: 'Roles y permisos' },
  ],
  actions: [
    { id: 'templates.manage', label: 'Crear, editar y borrar plantillas' },
    { id: 'access.manage', label: 'Crear y editar roles y sus permisos' },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  service.fetchAccess.mockResolvedValue(overview());
  service.updateRolePermissions.mockResolvedValue(undefined);
  usePermissionsStore.setState({
    permissions: { roles: ['developer'], menu: ['whatsapp', 'templates', 'access'], actions: [] },
    status: 'ready',
    owner: 'me',
  });
});

describe('AccessPage', () => {
  it('shows a column per role and a row per page and action', async () => {
    render(<AccessPage />);
    expect(await screen.findByText('Supervisor')).toBeTruthy();
    expect(screen.getByText('Administrador')).toBeTruthy();
    expect(screen.getByText('Plantillas')).toBeTruthy();
    expect(screen.getByText('Crear, editar y borrar plantillas')).toBeTruthy();
  });

  it('saves only the roles that changed, with their full permissions', async () => {
    render(<AccessPage />);
    const save = await screen.findByRole('button', { name: /guardar cambios/i });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Plantillas: Supervisor' }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(service.updateRolePermissions).toHaveBeenCalledTimes(1));
    expect(service.updateRolePermissions).toHaveBeenCalledWith('supervisor', {
      menu: ['whatsapp', 'templates'],
      actions: [],
    });
  });

  it('does not let the editor grant what they do not hold', async () => {
    usePermissionsStore.setState({
      permissions: { roles: ['admin'], menu: ['whatsapp', 'access'], actions: ['access.manage'] },
    });
    render(<AccessPage />);
    const templates = await screen.findByRole('checkbox', { name: 'Plantillas: Supervisor' });
    expect(templates.hasAttribute('disabled')).toBe(true);
    const whatsapp = screen.getByRole('checkbox', { name: 'Bandeja WhatsApp: Supervisor' });
    expect(whatsapp.hasAttribute('disabled')).toBe(false);
  });

  it('offers delete only on a role made from the web', async () => {
    render(<AccessPage />);
    await screen.findByText('Supervisor');
    expect(screen.getByRole('button', { name: 'Eliminar el rol Supervisor' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Eliminar el rol Administrador' })).toBeNull();
  });

  it('renames a role made from the web and keeps system roles out of it', async () => {
    service.updateRoleDetails.mockResolvedValue(undefined);
    render(<AccessPage />);
    await screen.findByText('Supervisor');
    expect(screen.queryByRole('button', { name: 'Editar el rol Administrador' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Editar el rol Supervisor' }));
    fireEvent.change(await screen.findByLabelText('Nombre'), {
      target: { value: 'Jefe de turno' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(service.updateRoleDetails).toHaveBeenCalledWith('supervisor', {
        name: 'Jefe de turno',
        description: expect.any(String),
      })
    );
  });

  it('shows the error and lets the user retry', async () => {
    service.fetchAccess.mockRejectedValueOnce(new Error('No se pudieron cargar los roles'));
    render(<AccessPage />);
    expect(await screen.findByText('No se pudieron cargar los roles')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Supervisor')).toBeTruthy();
  });
});
