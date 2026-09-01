import { Link, useMatches } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

interface NavItem {
  title: string;
  url: string;
  icon?: LucideIcon;
}

/**
 * The sidebar's link list. Flat on purpose: sections declare one route each
 * (see src/app/sections.ts), so there is no submenu to collapse and no open/closed
 * state to track - the active item is derived from the current path on every render.
 */
export function NavMain({ items }: { items: NavItem[] }) {
  const matches = useMatches();
  const currentPath = matches.at(-1)?.pathname ?? '/';
  const { isMobile, setOpenMobile } = useSidebar();

  const isActive = (url: string): boolean =>
    url === currentPath || (url !== '/' && currentPath.startsWith(url));

  const handleLinkClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map(item => {
          const active = isActive(item.url);
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                className={cn(
                  'py-2.5 rounded-lg font-medium text-sm transition-all duration-200',
                  active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Link
                  to={item.url}
                  className='group flex items-center gap-2.5'
                  onClick={handleLinkClick}
                >
                  {item.icon && (
                    <item.icon
                      className={cn(
                        'w-4 h-4',
                        active
                          ? 'text-primary'
                          : 'text-muted-foreground group-hover:text-foreground'
                      )}
                    />
                  )}
                  <span>{item.title}</span>
                  {active && <span className='ml-auto w-1.5 h-1.5 rounded-full bg-primary' />}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
