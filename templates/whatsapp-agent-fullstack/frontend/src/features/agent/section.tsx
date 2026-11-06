import { Bot } from 'lucide-react';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: '/settings/agent',
  label: 'Agente IA',
  icon: Bot,
  group: 'Configuración',
  load: () => import('./AgentConfigPage'),
  // Developers only; the backend checks agent.edit / agent.publish / agent.model on every call as well.
  requiresAdmin: true,
  requiresDeveloper: true,
  order: 70,
};
