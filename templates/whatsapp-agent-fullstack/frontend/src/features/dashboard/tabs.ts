import type { ComponentType } from 'react';
import { Coins, type LucideIcon } from 'lucide-react';
import { UsageView } from './usage/UsageView';

export interface DashboardTab {
  id: string;
  label: string;
  icon: LucideIcon;
  /** The tab's content. */
  component: ComponentType;
}

/**
 * The tabs of the Dashboard, in order. The template ships "Uso y costos"; a
 * project adds its own (KPIs of its business, say) by adding an entry here:
 * the page shows a tab bar whatever the count, so a new tab needs nothing else.
 */
export const DASHBOARD_TABS: DashboardTab[] = [
  { id: 'usage', label: 'Uso y costos', icon: Coins, component: UsageView },
];
