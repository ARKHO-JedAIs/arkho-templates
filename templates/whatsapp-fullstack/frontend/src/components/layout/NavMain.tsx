import { useEffect, useState, type ComponentType, type MouseEvent } from 'react';
import { Link, useMatches } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

type NavIcon = ComponentType<{ className?: string }>;

export interface NavLink {
  title: string;
  url: string;
  icon?: NavIcon;
}

/** Sections sharing `AppSection.group`: one collapsible entry, a sub-item each. */
export interface NavGroup {
  title: string;
  icon?: NavIcon;
  items: NavLink[];
}

export type NavEntry = NavLink | NavGroup;

export const isNavGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry;

const buttonClass = (active: boolean) =>
  cn(
    'py-2.5 rounded-lg font-medium text-sm transition-all duration-200 group-data-[collapsible=icon]:justify-center',
    active
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  );

const iconClass = (active: boolean) =>
  cn(
    'w-4 h-4 shrink-0',
    active ? 'text-primary' : 'text-muted-foreground group-hover/nav:text-foreground'
  );

/**
 * The sidebar's link list. A section is a top-level link unless it declares a
 * `group` (see src/app/sections.ts); grouped sections collapse under one parent
 * entry. The active item is derived from the current path on every render, and
 * a group opens by itself when one of its children is the current route.
 */
export function NavMain({ items }: { items: NavEntry[] }) {
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
          if (isNavGroup(item)) {
            return (
              <NavGroupItem
                key={`group:${item.title}`}
                group={item}
                isActive={isActive}
                onNavigate={handleLinkClick}
              />
            );
          }
          const active = isActive(item.url);
          return (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton asChild tooltip={item.title} className={buttonClass(active)}>
                <Link
                  to={item.url}
                  className='group/nav flex items-center gap-2.5'
                  onClick={handleLinkClick}
                >
                  {item.icon && <item.icon className={iconClass(active)} />}
                  <span className='group-data-[collapsible=icon]:hidden'>{item.title}</span>
                  {active && (
                    <span className='ml-auto w-1.5 h-1.5 rounded-full bg-primary group-data-[collapsible=icon]:hidden' />
                  )}
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function NavGroupItem({
  group,
  isActive,
  onNavigate,
}: {
  group: NavGroup;
  isActive: (url: string) => boolean;
  onNavigate: () => void;
}) {
  const { state, isMobile, setOpen: setSidebarOpen } = useSidebar();
  const childActive = group.items.some(item => isActive(item.url));
  const [open, setOpen] = useState(childActive);

  // Arriving on a child route (a link elsewhere, the back button) opens the group.
  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  // Collapsed to icons, the sub-items have nowhere to show: expand the sidebar
  // with the group open instead of toggling something invisible.
  const handleTriggerClick = (event: MouseEvent) => {
    if (state === 'collapsed' && !isMobile) {
      event.preventDefault();
      setSidebarOpen(true);
      setOpen(true);
    }
  };

  const Icon = group.icon;
  // Highlight the parent only when its active child is out of sight.
  const parentActive = childActive && (!open || state === 'collapsed');
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen} className='group/collapsible'>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={group.title}
            onClick={handleTriggerClick}
            className={cn(buttonClass(parentActive), 'group/nav gap-2.5')}
          >
            {Icon && <Icon className={iconClass(childActive)} />}
            <span className='group-data-[collapsible=icon]:hidden'>{group.title}</span>
            <ChevronRight
              aria-hidden
              className='ml-auto h-4 w-4 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 group-data-[collapsible=icon]:hidden motion-reduce:transition-none'
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className='mt-1'>
            {group.items.map(item => {
              const active = isActive(item.url);
              return (
                <SidebarMenuSubItem key={item.url}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={active}
                    className={cn(
                      'h-8 rounded-lg font-medium transition-colors',
                      active
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Link
                      to={item.url}
                      aria-current={active ? 'page' : undefined}
                      onClick={onNavigate}
                      className='group/nav'
                    >
                      {item.icon && <item.icon className={iconClass(active)} />}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
