import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AccessRole, RoleDetailsInput } from '../types';

interface EditRoleDialogProps {
  role: AccessRole | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (role: AccessRole, input: RoleDetailsInput) => Promise<void>;
}

/** Only the name and the description change: the id is the Cognito group and stays. */
export function EditRoleDialog({ role, onOpenChange, onSubmit }: EditRoleDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (role) {
      setName(role.name);
      setDescription(role.description ?? '');
      setSubmitting(false);
    }
  }, [role]);

  const valid = name.trim().length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!role || !valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(role, { name: name.trim(), description: description.trim() });
      onOpenChange(false);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={role !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Editar el rol</DialogTitle>
            <DialogDescription>
              Cambia el nombre y la descripción. El identificador ({role?.id}) no cambia, y los
              permisos y los usuarios del rol siguen igual.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='edit-role-name'>Nombre</Label>
            <Input
              id='edit-role-name'
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={60}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='edit-role-description'>Descripción (opcional)</Label>
            <Input
              id='edit-role-description'
              value={description}
              onChange={event => setDescription(event.target.value)}
              maxLength={200}
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type='submit' disabled={!valid || submitting}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
