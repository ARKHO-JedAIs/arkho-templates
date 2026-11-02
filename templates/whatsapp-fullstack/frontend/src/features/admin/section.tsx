import { Users } from 'lucide-react';
import type { AppSection } from '@/app/sections';

export const section: AppSection = {
  path: '/admin/users',
  label: 'Usuarios',
  icon: Users,
  group: 'Configuración',
  load: () => import('./UsersPage'),
  // Answered at generation time. `false` means this build has a single profile:
  // the route guard and the sidebar filter both read this one flag,
  // so there is nothing left half-gated.
  requiresAdmin: {{ use_roles }},
  order: 90,
};
