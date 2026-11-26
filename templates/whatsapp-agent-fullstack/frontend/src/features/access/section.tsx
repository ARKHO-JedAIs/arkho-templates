import { ShieldCheck } from 'lucide-react';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: '/settings/access',
  label: 'Roles y permisos',
  icon: ShieldCheck,
  group: 'Configuración',
  load: () => import('./AccessPage'),
  // Falls back to admins only if the permissions cannot be read; the backend checks access.manage on every call.
  menu: 'access',
  requiresAdmin: true,
  order: 95,
};
