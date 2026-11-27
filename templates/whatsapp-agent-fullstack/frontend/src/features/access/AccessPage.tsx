import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { usePermissionsStore } from '@/lib/access/permissions';
import { EditRoleDialog } from './components/EditRoleDialog';
import { NewRoleDialog } from './components/NewRoleDialog';
import {
  createRole,
  deleteRole,
  fetchAccess,
  updateRoleDetails,
  updateRolePermissions,
} from './accessService';
import type {
  AccessOverview,
  AccessRole,
  CatalogItem,
  NewRoleInput,
  RoleDetailsInput,
  RolePermissions,
} from './types';

/** The part of an action id before the dot groups the rows of the table. */
const ACTION_GROUPS: Record<string, string> = {
  whatsapp: 'Bandeja WhatsApp',
  templates: 'Plantillas',
  users: 'Usuarios',
  agent: 'Agente IA',
  access: 'Roles y permisos',
};

type Draft = Record<string, RolePermissions>;
type Kind = keyof RolePermissions;

function sameList(a: string[], b: string[]): boolean {
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return (
    sortedA.length === sortedB.length && sortedA.every((item, index) => item === sortedB[index])
  );
}

function groupActions(actions: CatalogItem[]): { title: string; items: CatalogItem[] }[] {
  const groups = new Map<string, CatalogItem[]>();
  for (const action of actions) {
    const key = action.id.split('.')[0] ?? action.id;
    groups.set(key, [...(groups.get(key) ?? []), action]);
  }
  return [...groups].map(([key, items]) => ({ title: ACTION_GROUPS[key] ?? key, items }));
}

export function AccessPage() {
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AccessRole | null>(null);
  const [editing, setEditing] = useState<AccessRole | null>(null);
  const permissions = usePermissionsStore(state => state.permissions);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchAccess();
      setOverview(data);
      setDraft(Object.fromEntries(data.roles.map(role => [role.id, role.permissions])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los roles.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const holds = useCallback(
    (id: string) =>
      Boolean(
        permissions &&
        (permissions.roles.includes('developer') ||
          permissions.menu.includes(id) ||
          permissions.actions.includes(id))
      ),
    [permissions]
  );

  const dirty = useMemo(() => {
    if (!overview) return [];
    return overview.roles.filter(role => {
      const next = draft[role.id];
      return (
        next &&
        !role.locked &&
        (!sameList(next.menu, role.permissions.menu) ||
          !sameList(next.actions, role.permissions.actions))
      );
    });
  }, [overview, draft]);

  const toggle = (role: AccessRole, kind: Kind, id: string, checked: boolean) => {
    setDraft(current => {
      const before = current[role.id] ?? { menu: [], actions: [] };
      const list = before[kind];
      const next = checked ? [...new Set([...list, id])] : list.filter(item => item !== id);
      return { ...current, [role.id]: { ...before, [kind]: next } };
    });
  };

  const save = async () => {
    setSaving(true);
    const failures: string[] = [];
    for (const role of dirty) {
      try {
        const next = draft[role.id];
        if (next) await updateRolePermissions(role.id, next);
      } catch (err) {
        failures.push(`${role.name}: ${err instanceof Error ? err.message : 'no se pudo guardar'}`);
      }
    }
    setSaving(false);
    if (failures.length > 0) toast.error(failures.join(' '));
    else toast.success('Permisos guardados');
    await load();
    // The signed-in user may hold one of the roles just edited: refresh what their own menu shows.
    usePermissionsStore.getState().reset();
    await usePermissionsStore.getState().load();
  };

  const create = async (input: NewRoleInput) => {
    try {
      await createRole(input);
      toast.success('Rol creado');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear el rol');
      throw err;
    }
  };

  const editDetails = async (role: AccessRole, input: RoleDetailsInput) => {
    try {
      await updateRoleDetails(role.id, input);
      toast.success('Rol actualizado');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo editar el rol');
      throw err;
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await deleteRole(deleting.id);
      toast.success('Rol eliminado');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el rol');
    }
    setDeleting(null);
  };

  return (
    <div className='flex h-full flex-col gap-4 pb-8'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-2xl font-bold leading-tight text-foreground'>Roles y permisos</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Marca qué páginas ve cada rol y qué acciones puede hacer. Los cambios se aplican en
            menos de un minuto, sin desplegar.
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button variant='outline' onClick={() => setCreating(true)} disabled={!overview}>
            <Plus className='h-4 w-4' aria-hidden />
            Nuevo rol
          </Button>
          <Button onClick={() => void save()} disabled={dirty.length === 0 || saving}>
            <Save className='h-4 w-4' aria-hidden />
            Guardar cambios
          </Button>
        </div>
      </div>

      {error ? (
        <div className='flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4'>
          <p className='text-sm text-destructive'>{error}</p>
          <Button variant='outline' onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : !overview ? (
        <div role='status' aria-label='Cargando roles' className='flex flex-col gap-3'>
          <Skeleton className='h-10 w-full' />
          <Skeleton className='h-72 w-full rounded-xl' />
        </div>
      ) : (
        <div className='overflow-x-auto rounded-xl border border-border bg-card'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b border-border'>
                <th className='sticky left-0 z-10 border-r border-border bg-card px-4 py-3 text-left font-medium text-muted-foreground'>
                  Permiso
                </th>
                {overview.roles.map(role => (
                  <th key={role.id} className='min-w-[8.5rem] px-3 py-3 text-center align-top'>
                    <div className='flex flex-col items-center gap-1'>
                      <span className='font-semibold text-foreground'>{role.name}</span>
                      {role.system ? (
                        <Badge variant='outline'>{role.locked ? 'Oculto' : 'Del sistema'}</Badge>
                      ) : (
                        <div className='flex items-center gap-1'>
                          <button
                            type='button'
                            onClick={() => setEditing(role)}
                            aria-label={`Editar el rol ${role.name}`}
                            className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground'
                          >
                            <Pencil className='h-4 w-4' aria-hidden />
                          </button>
                          <button
                            type='button'
                            onClick={() => setDeleting(role)}
                            aria-label={`Eliminar el rol ${role.name}`}
                            className='rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive'
                          >
                            <Trash2 className='h-4 w-4' aria-hidden />
                          </button>
                        </div>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SectionRow title='Páginas del menú' span={overview.roles.length + 1} />
              {overview.menu.map(item => (
                <PermissionRow
                  key={item.id}
                  item={item}
                  kind='menu'
                  roles={overview.roles}
                  draft={draft}
                  holds={holds}
                  onToggle={toggle}
                />
              ))}
              {groupActions(overview.actions).map(group => (
                <Fragment key={group.title}>
                  <SectionRow title={`Acciones: ${group.title}`} span={overview.roles.length + 1} />
                  {group.items.map(item => (
                    <PermissionRow
                      key={item.id}
                      item={item}
                      kind='actions'
                      roles={overview.roles}
                      draft={draft}
                      holds={holds}
                      onToggle={toggle}
                    />
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewRoleDialog open={creating} onOpenChange={setCreating} onSubmit={create} />
      <EditRoleDialog
        role={editing}
        onOpenChange={open => !open && setEditing(null)}
        onSubmit={editDetails}
      />

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar el rol {deleting?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Nadie puede tenerlo asignado: mueve primero a sus usuarios a otro rol.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SectionRow({ title, span }: { title: string; span: number }) {
  return (
    <tr className='bg-muted/50'>
      <th
        colSpan={span}
        className='px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'
      >
        <span className='sticky left-4'>{title}</span>
      </th>
    </tr>
  );
}

interface PermissionRowProps {
  item: CatalogItem;
  kind: Kind;
  roles: AccessRole[];
  draft: Draft;
  holds: (id: string) => boolean;
  onToggle: (role: AccessRole, kind: Kind, id: string, checked: boolean) => void;
}

function PermissionRow({ item, kind, roles, draft, holds, onToggle }: PermissionRowProps) {
  return (
    <tr className='border-t border-border/60'>
      <td className='sticky left-0 z-10 border-r border-border bg-card px-4 py-2.5 text-foreground'>
        {item.label}
      </td>
      {roles.map(role => {
        const checked = (draft[role.id]?.[kind] ?? []).includes(item.id);
        // Nobody grants what they do not hold themselves (the backend enforces it too).
        const disabled = role.locked || (!checked && !holds(item.id));
        return (
          <td key={role.id} className='px-3 py-2.5 text-center'>
            <Checkbox
              checked={checked}
              disabled={disabled}
              aria-label={`${item.label}: ${role.name}`}
              onCheckedChange={value => onToggle(role, kind, item.id, value === true)}
            />
          </td>
        );
      })}
    </tr>
  );
}

export default AccessPage;
