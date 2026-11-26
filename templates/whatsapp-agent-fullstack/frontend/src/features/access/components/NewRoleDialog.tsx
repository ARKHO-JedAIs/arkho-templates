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
import type { NewRoleInput } from '../types';

const ID_PATTERN = /^[a-z][a-z0-9-]{1,29}$/;

/** The id the backend wants (a Cognito group name) from a display name: lowercase, hyphens, no accents. */
export function roleIdFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

interface NewRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: NewRoleInput) => Promise<void>;
}

export function NewRoleDialog({ open, onOpenChange, onSubmit }: NewRoleDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setSubmitting(false);
    }
  }, [open]);

  const id = roleIdFrom(name);
  const valid = name.trim().length > 0 && ID_PATTERN.test(id);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ id, name: name.trim(), description: description.trim() });
      onOpenChange(false);
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='flex flex-col gap-4'>
          <DialogHeader>
            <DialogTitle>Nuevo rol</DialogTitle>
            <DialogDescription>
              Empieza sin permisos: luego marca qué páginas y acciones tiene en la tabla.
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='role-name'>Nombre</Label>
            <Input
              id='role-name'
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={60}
            />
            {name.trim() && !valid ? (
              <p className='text-xs text-destructive'>
                Usa letras o números: el nombre debe dar un identificador de 2 a 30 caracteres.
              </p>
            ) : id ? (
              <p className='text-xs text-muted-foreground'>Identificador: {id}</p>
            ) : null}
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='role-description'>Descripción (opcional)</Label>
            <Input
              id='role-description'
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
              Crear rol
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
