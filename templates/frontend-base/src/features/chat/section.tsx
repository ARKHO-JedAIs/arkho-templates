import { MessageSquare } from 'lucide-react';
import type { AppSection } from '@/app/sections';

export const section: AppSection = {
  path: '/chat',
  label: 'Asistente',
  icon: MessageSquare,
  load: () => import('./ChatPage'),
  order: 10,
};
