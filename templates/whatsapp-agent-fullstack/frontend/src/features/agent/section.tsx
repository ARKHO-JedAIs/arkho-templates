import { Bot } from 'lucide-react';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: '/settings/agent',
  label: 'Agente IA',
  icon: Bot,
  group: 'Configuración',
  load: () => import('./AgentConfigPage'),
  // The role's permissions decide (menu); without them, developers only. The backend checks agent.edit / agent.publish / agent.model on every call as well.
  menu: 'agent',
  requiresAdmin: true,
  requiresDeveloper: true,
  order: 70,
};
