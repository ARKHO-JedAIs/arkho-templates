import { LayoutDashboard } from 'lucide-react';
import type { AppSection } from '@/app/sections';

/** Metadata only - the page loads in its own chunk. */
export const section: AppSection = {
  path: '/dashboard',
  label: 'Dashboard',
  icon: LayoutDashboard,
  load: () => import('./DashboardPage'),
  // The role's permissions decide (menu); without them, admins only. The backend checks the
  // `dashboard` page on every usage call as well.
  menu: 'dashboard',
  requiresAdmin: true,
  order: 10,
};
