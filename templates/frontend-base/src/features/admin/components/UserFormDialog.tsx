import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import type { ManagedUser, UserRole } from '../types/user.types';

// The groups this app knows about, in a stable display order, each with what it
// actually lets the person do - the dialog is where that gets decided, so it is
// where the explanation belongs. More than one can be checked.
//
// These values are Cognito group names: they must match the groups on your user
// pool, and `admin` must match VITE_ADMIN_GROUP. Edit this list to match your
// own roles - it is the only place they are enumerated.
const ROLE_OPTIONS: { value: UserRole; label: string; hint: string }[] = [
  {
    value: 'admin',
    label: 'Administrador',
    hint: 'Acceso total, incluida la gestión de usuarios.',
  },
  { value: 'member', label: 'Miembro', hint: 'Acceso estándar a la aplicación.' },
];
const DEFAULT_ROLES: UserRole[] = ['member'];

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing user; absent when creating one. */
  user?: ManagedUser | null;
  /** Disallow changing the roles - used when editing the caller's own account. */
  disableRoleChange?: boolean;
  /** `roles` is omitted when the admin didn't touch them, so editing a name
   * can never rewrite someone's profiles - PATCH treats the field as the full
   * set and revokes whatever it doesn't mention. */
  onSubmit: (input: { email: string; name: string; roles?: UserRole[] }) => Promise<void>;
}

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  disableRoleChange,
  onSubmit,
}: UserFormDialogProps) {
  const isEditing = Boolean(user);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(DEFAULT_ROLES);
  // What the user held when the dialog opened, or null when that isn't known -
  // an API response without the field at all, as opposed to a user genuinely
  // holding none. Prefilling a default in that case is what silently demoted
  // administrators to member on the next save.
  const [initialRoles, setInitialRoles] = useState<UserRole[] | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEmail(user?.email ?? '');
    setName(user?.name ?? '');
    const known = Array.isArray(user?.roles) ? user.roles : null;
    setInitialRoles(isEditing ? known : null);
    setRoles(isEditing ? (known ?? []) : DEFAULT_ROLES);
  }, [open, user, isEditing]);

  // Rebuilt from ROLE_OPTIONS rather than appended to, so the order is stable
  // no matter which box was ticked first.
  const toggleRole = (role: UserRole, checked: boolean) => {
    const next = new Set(roles);
    if (checked) next.add(role);
    else next.delete(role);
    setRoles(ROLE_OPTIONS.map(option => option.value).filter(value => next.has(value)));
  };

  // Whether to send `roles` at all. Creating always does. Editing only when the
  // selection actually differs - and when the current profiles are unknown,
  // only if the admin explicitly ticked something, because sending a guess
  // would revoke whatever the request doesn't mention.
  const sendRoles = (() => {
    if (!isEditing) return true;
    if (initialRoles === null) return roles.length > 0;
    return roles.length !== initialRoles.length || roles.some(role => !initialRoles.includes(role));
  })();
  const rolesIncomplete = sendRoles && roles.length === 0;

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onSubmit({
        email: email.trim(),
        name: name.trim(),
        roles: sendRoles ? roles : undefined,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-4 py-2'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='user-email'>Email</Label>
            <Input
              id='user-email'
              type='email'
              value={email}
              disabled={isEditing}
              onChange={e => setEmail(e.target.value)}
              placeholder='nombre@empresa.com'
            />
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='user-name'>Nombre</Label>
            <Input
              id='user-name'
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder='Nombre completo'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label>Perfiles</Label>
            <p className='text-xs text-muted-foreground -mt-1'>
              Puedes asignar más de uno. Cada perfil corresponde a un grupo de Cognito y determina a
              qué puede acceder el usuario.
            </p>
            {ROLE_OPTIONS.map(option => (
              <label
                key={option.value}
                htmlFor={`role-${option.value}`}
                className='flex items-start gap-2.5 p-2.5 rounded-lg border border-border cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60'
              >
                <Checkbox
                  id={`role-${option.value}`}
                  checked={roles.includes(option.value)}
                  disabled={disableRoleChange}
                  onCheckedChange={checked => toggleRole(option.value, checked === true)}
                  className='mt-0.5'
                />
                <span className='min-w-0'>
                  <span className='block text-sm font-medium text-foreground'>{option.label}</span>
                  <span className='block text-xs text-muted-foreground'>{option.hint}</span>
                </span>
              </label>
            ))}
            {disableRoleChange && (
              <p className='text-xs text-muted-foreground'>
                No puedes cambiar tus propios perfiles.
              </p>
            )}
            {!disableRoleChange && isEditing && initialRoles === null && (
              <p className='text-xs text-warning'>
                No se pudieron leer los perfiles actuales de esta cuenta. Se dejan como están, salvo
                que marques alguno.
              </p>
            )}
            {!disableRoleChange && rolesIncomplete && (
              <p className='text-xs text-warning'>
                Asigna al menos un perfil; sin uno la cuenta no puede acceder a nada.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !email.trim() || rolesIncomplete}
          >
            {isEditing ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default UserFormDialog;
