import { AudioLines } from 'lucide-react';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: '/settings/voice',
  label: 'Voz',
  icon: AudioLines,
  group: 'Configuración',
  load: () => import('./VoicePage'),
  // Only where the backend was deployed with voice (VOICE_PROVIDER=polly).
  enabled: import.meta.env.VITE_VOICE_PROVIDER === 'polly',
  // The role's permissions decide (menu); without them, admins only. The backend checks the
  // `voice` page on every call as well.
  menu: 'voice',
  requiresAdmin: true,
  order: 75,
};
