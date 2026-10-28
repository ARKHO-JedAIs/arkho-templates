import { FileText } from 'lucide-react';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: '/settings/templates',
  label: 'Plantillas',
  icon: FileText,
  group: 'Configuración',
  load: () => import('./TemplatesPage'),
  // Same answer as the users screen: with roles, configuration is for admins.
  requiresAdmin: {{ use_roles }},
  order: 80,
};
