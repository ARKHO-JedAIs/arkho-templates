import * as React from 'react';
import { Home, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarRail, useSidebar } from '@/components/ui/sidebar';
import { sections } from '@/app/sections';
import useAuthStore, { selectIsAdmin } from '@/lib/stores/useAuthStore';
import { NavMain } from './NavMain';

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state: sidebarState, toggleSidebar } = useSidebar();
  const isAdmin = useAuthStore(selectIsAdmin);

  // Home is always here; everything else is whatever sections this build has.
  // Hiding an admin link is cosmetic only - the route itself is enforced by
  // requireAdmin in src/router/routes.tsx.
  const navMain = [
    { title: 'Inicio', url: '/', icon: Home },
    ...sections
      .filter(section => !section.requiresAdmin || isAdmin)
      .map(section => ({ title: section.label, url: section.path, icon: section.icon })),
  ];

  return (
    <Sidebar className='h-full border-r border-border bg-card' collapsible='icon' {...props}>
      <div className='flex flex-col items-start px-3 pt-[3.75rem]'>
        <button
          onClick={toggleSidebar}
          aria-label={sidebarState === 'expanded' ? 'Contraer menú' : 'Expandir menú'}
          className='p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200'
        >
          {sidebarState === 'expanded' ? (
            <PanelLeftClose className='w-4 h-4' />
          ) : (
            <PanelLeftOpen className='w-4 h-4' />
          )}
        </button>
      </div>

      <SidebarContent className='mt-2 mb-6 px-2'>
        <NavMain items={navMain} />
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
