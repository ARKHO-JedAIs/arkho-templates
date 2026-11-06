import { FileText } from 'lucide-react';
import type { AppSection } from '@/app/sections';
import { TEMPLATE_PATHS } from './paths';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: TEMPLATE_PATHS.list,
  label: 'Plantillas',
  icon: FileText,
  group: 'Configuración',
  load: () => import('./TemplatesPage'),
  // The creator: reached from the list's "Agregar plantilla" or a template's
  // "Editar" (same page, prefilled), no sidebar entry.
  routes: [
    { path: TEMPLATE_PATHS.create, load: () => import('./CreateTemplatePage') },
    { path: TEMPLATE_PATHS.edit, load: () => import('./CreateTemplatePage') },
  ],
  // Same answer as the users screen: with roles, configuration is for admins.
  requiresAdmin: true,
  order: 80,
};
