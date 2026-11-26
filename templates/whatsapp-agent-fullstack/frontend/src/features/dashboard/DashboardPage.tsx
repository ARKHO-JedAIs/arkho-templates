import { useState } from 'react';
import { cn } from '@/lib/utils';
import { DASHBOARD_TABS } from './tabs';

/** The Dashboard: one tab per `DASHBOARD_TABS` entry. */
export function DashboardPage() {
  const [tab, setTab] = useState(DASHBOARD_TABS[0]?.id);
  const shown = DASHBOARD_TABS.find(item => item.id === tab) ?? DASHBOARD_TABS[0];
  const Content = shown?.component;

  return (
    <div className='flex flex-col gap-5 pb-20'>
      <h1 className='text-2xl font-bold text-foreground'>Dashboard</h1>

      <div
        role='tablist'
        aria-label='Secciones del Dashboard'
        className='flex gap-1 border-b border-border'
      >
        {DASHBOARD_TABS.map(item => (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={shown?.id === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              shown?.id === item.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <item.icon className='h-4 w-4' aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      {Content ? <Content /> : null}
    </div>
  );
}

export default DashboardPage;
