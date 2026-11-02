import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus, KeyRound, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import useAuthStore from '@/lib/stores/useAuthStore';
import { ResetPasswordResultDialog } from './components/ResetPasswordResultDialog';
import { UserFormDialog } from './components/UserFormDialog';
import { useUsers } from './hooks/useUsers';
import {
  createUser,
  deleteUser,
  resetUserPassword,
  updateUser,
  updateUserStatus,
} from './services/usersService';
import type { ManagedUser, UserRole } from './types/user.types';

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Administrador', member: 'Miembro' };

// Cognito's UserStatus, in Spanish. Feminine throughout because the implied
// subject is "la cuenta". Anything unmapped falls through to the raw value
// rather than rendering blank: AWS can add states, and an unfamiliar status is
// still more useful than an empty cell.
const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmada',
  UNCONFIRMED: 'Sin confirmar',
  FORCE_CHANGE_PASSWORD: 'Debe cambiar contraseña',
  RESET_REQUIRED: 'Debe restablecer contraseña',
  ARCHIVED: 'Archivada',
  COMPROMISED: 'Comprometida',
  EXTERNAL_PROVIDER: 'Proveedor externo',
  UNKNOWN: 'Desconocido',
};

// The role column exists to tell two roles apart at a glance, so they get
// visibly different weights rather than two dark chips: the privileged role is
// solid, the default one is a quiet neutral outline. "Sin rol" is an anomaly -
// that account cannot do anything until a role is assigned - so it reads as a
// warning instead of blending in with Member.
// No hover styles on purpose: a badge is not clickable, and giving it one
// suggests it is.
const ROLE_BADGE_CLASS: Record<UserRole | 'none', string> = {
  admin: 'border-transparent bg-primary text-primary-foreground',
  member: 'border-border bg-muted text-foreground',
  none: 'border-warning/25 bg-warning/10 text-warning',
};

export function UsersPage() {
  const navigate = useNavigate();
  const currentUsername = useAuthStore(state => state.user?.username);
  const { users, isLoading, error, authError, reload } = useUsers();

  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<ManagedUser | null>(null);
  const [resetResult, setResetResult] = useState<{ username: string; password: string } | null>(
    null
  );

  useEffect(() => {
    if (!authError) return;
    toast.error('Tu sesión expiró. Vuelve a iniciar sesión.');
    navigate({ to: '/login' });
  }, [authError, navigate]);

  const handleCreateOrUpdate = async (input: {
    email: string;
    name: string;
    /** Absent when the admin didn't touch the profiles - the request then
     * leaves them alone instead of rewriting them. */
    roles?: UserRole[];
  }) => {
    try {
      if (editingUser) {
        await updateUser(editingUser.username, {
          name: input.name,
          // Omitted for your own account so the request can't strip your own
          // admin profile - the backend rejects it as well.
          roles: editingUser.username === currentUsername ? undefined : input.roles,
        });
        toast.success('Usuario actualizado');
      } else {
        await createUser({
          email: input.email,
          name: input.name || undefined,
          roles: input.roles,
        });
        toast.success('Usuario creado. Recibirá un correo con su contraseña temporal.');
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar el usuario');
      throw err;
    }
  };

  const handleToggleStatus = async (user: ManagedUser, enabled: boolean) => {
    try {
      await updateUserStatus(user.username, enabled);
      toast.success(enabled ? 'Usuario activado' : 'Usuario desactivado');
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo actualizar el estado');
    }
  };

  const handleResetPassword = async (user: ManagedUser) => {
    try {
      const temporaryPassword = await resetUserPassword(user.username);
      setResetResult({ username: user.username, password: temporaryPassword });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña');
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    try {
      await deleteUser(deletingUser.username);
      toast.success('Usuario eliminado');
      setDeletingUser(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el usuario');
    }
  };

  // Same as the other list screens: page margins and horizontal padding come
  // from the Layout's SidebarInset, not from here.
  return (
    <div className='h-full flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold text-foreground leading-tight'>Usuarios</h1>
          <p className='text-muted-foreground text-sm mt-1'>
            Administra las cuentas y sus permisos.
          </p>
        </div>
        <button
          type='button'
          onClick={() => {
            setEditingUser(null);
            setFormOpen(true);
          }}
          className='flex items-center gap-1.5 flex-shrink-0 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 px-3 sm:px-4 py-2.5 rounded-xl transition-colors min-h-[44px]'
        >
          <Plus className='w-4 h-4' />
          <span className='hidden sm:inline'>Nuevo usuario</span>
        </button>
      </div>

      {isLoading ? (
        <div className='rounded-xl border border-border bg-card overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className='text-right'>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i} className='animate-pulse'>
                  <TableCell>
                    <div className='flex flex-col gap-1.5'>
                      <div className='h-4 w-32 rounded bg-muted' />
                      <div className='h-3 w-40 rounded bg-muted' />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className='h-5 w-20 rounded-full bg-muted' />
                  </TableCell>
                  <TableCell>
                    <div className='h-3.5 w-16 rounded bg-muted' />
                  </TableCell>
                  <TableCell>
                    <div className='h-5 w-9 rounded-full bg-muted' />
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center justify-end gap-1'>
                      <div className='h-9 w-9 rounded-md bg-muted' />
                      <div className='h-9 w-9 rounded-md bg-muted' />
                      <div className='h-9 w-9 rounded-md bg-muted' />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : error ? (
        <div className='flex flex-col items-start gap-3 py-4'>
          <p className='text-sm text-destructive'>{error}</p>
          <Button variant='outline' onClick={reload}>
            Reintentar
          </Button>
        </div>
      ) : users.length === 0 ? (
        <p className='text-sm text-muted-foreground py-10 text-center'>Todavía no hay usuarios.</p>
      ) : (
        <div className='rounded-xl border border-border bg-card overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className='text-right'>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map(user => {
                const isSelf = user.username === currentUsername;
                return (
                  <TableRow key={user.username}>
                    <TableCell>
                      <p className='font-medium text-foreground'>{user.name || user.email}</p>
                      {user.name && <p className='text-xs text-muted-foreground'>{user.email}</p>}
                    </TableCell>
                    <TableCell>
                      {/* One badge per profile: a user holding both is the
                          point of this column, and picking a single "primary"
                          role to show would hide exactly that. */}
                      <div className='flex flex-wrap items-center gap-1'>
                        {user.roles.length === 0 ? (
                          <Badge variant='outline' className={ROLE_BADGE_CLASS.none}>
                            Sin rol
                          </Badge>
                        ) : (
                          user.roles.map(role => (
                            <Badge key={role} variant='outline' className={ROLE_BADGE_CLASS[role]}>
                              {ROLE_LABEL[role]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {user.status ? (STATUS_LABEL[user.status] ?? user.status) : '—'}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={user.enabled}
                        disabled={isSelf}
                        onCheckedChange={checked => handleToggleStatus(user, checked)}
                        aria-label={user.enabled ? 'Desactivar usuario' : 'Activar usuario'}
                      />
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Editar usuario'
                          onClick={() => {
                            setEditingUser(user);
                            setFormOpen(true);
                          }}
                        >
                          <Pencil className='w-4 h-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Restablecer contraseña'
                          onClick={() => handleResetPassword(user)}
                        >
                          <KeyRound className='w-4 h-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label='Eliminar usuario'
                          disabled={isSelf}
                          onClick={() => setDeletingUser(user)}
                        >
                          <Trash2 className='w-4 h-4 text-destructive' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        user={editingUser}
        disableRoleChange={editingUser?.username === currentUsername}
        onSubmit={handleCreateOrUpdate}
      />

      <ResetPasswordResultDialog
        open={resetResult !== null}
        onOpenChange={open => !open && setResetResult(null)}
        username={resetResult?.username ?? null}
        temporaryPassword={resetResult?.password ?? null}
      />

      <AlertDialog
        open={deletingUser !== null}
        onOpenChange={open => !open && setDeletingUser(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingUser?.name || deletingUser?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. El usuario pierde el acceso de inmediato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default UsersPage;
