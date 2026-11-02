import { WhatsAppIcon } from '@/components/brand/WhatsAppIcon';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page and the realtime client load in their own chunk. */
export const section: AppSection = {
  path: '/whatsapp',
  label: 'WhatsApp',
  icon: WhatsAppIcon,
  load: () => import('./WhatsAppPage'),
  order: 20,
};
