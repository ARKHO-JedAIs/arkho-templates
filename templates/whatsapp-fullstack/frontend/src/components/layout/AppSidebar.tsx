import * as React from 'react';
import { Home, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { Sidebar, SidebarContent, SidebarRail, useSidebar } from '@/components/ui/sidebar';
import { sections } from '@/app/sections';
import useAuthStore, { selectIsAdmin } from '@/lib/stores/useAuthStore';
import { NavMain, isNavGroup, type NavEntry, type NavGroup } from './NavMain';

/** Groups with an icon of their own; any other group borrows its first item's. */
const GROUP_ICONS: Record<string, NavGroup['icon']> = {
  Configuración: Settings,
};

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { state: sidebarState, toggleSidebar } = useSidebar();
  const isAdmin = useAuthStore(selectIsAdmin);

  // Home is always here; everything else is whatever sections this build has.
  // Hiding an admin link is cosmetic only - the route itself is enforced by
  // requireAdmin in src/router/routes.tsx. The filter runs per section, before
  // grouping, so a group whose children are all hidden never appears.
  const navMain: NavEntry[] = [{ title: 'Inicio', url: '/', icon: Home }];
  for (const section of sections) {
    if (section.requiresAdmin && !isAdmin) continue;
    const link = { title: section.label, url: section.path, icon: section.icon };
    if (!section.group) {
      navMain.push(link);
      continue;
    }
    // A group sits where its first (lowest `order`) section would have been.
    const group = navMain.find(
      (entry): entry is NavGroup => isNavGroup(entry) && entry.title === section.group
    );
    if (group) group.items.push(link);
    else
      navMain.push({
        title: section.group,
        icon: GROUP_ICONS[section.group] ?? section.icon,
        items: [link],
      });
  }

  return (
    <Sidebar className='h-full border-r border-border bg-card' collapsible='icon' {...props}>
      <div className='flex flex-col items-start px-3 pt-[3.75rem] group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0'>
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

      {/* Collapsed, the rail is 3rem: the group's own p-2 already centres the
          2rem icon buttons, so the content padding must go. */}
      <SidebarContent className='mt-2 mb-6 px-2 group-data-[collapsible=icon]:px-0'>
        <NavMain items={navMain} />
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
