import { Users } from 'lucide-react';
import type { AppSection } from '@/app/sections';

export const section: AppSection = {
  path: '/admin/users',
  label: 'Usuarios',
  icon: Users,
  load: () => import('./UsersPage'),
  // Answered at generation time. `false` means this build has a single profile:
  // the route guard, the sidebar filter and the home grid all read this one flag,
  // so there is nothing left half-gated.
  requiresAdmin: {{ use_roles }},
  order: 90,
};
