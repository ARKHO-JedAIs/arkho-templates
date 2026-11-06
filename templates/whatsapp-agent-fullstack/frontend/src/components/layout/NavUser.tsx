import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import useAuthStore from '@/lib/stores/useAuthStore';
import { isMockAuth } from '@/lib/auth/session';

function initialsOf(name?: string, username?: string): string {
  const parts = (name ?? username ?? '').trim().split(/\s+/).filter(Boolean);
  const first = parts.at(0);
  const last = parts.at(-1);
  if (!first || !last) return '?';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export function NavUser() {
  const navigate = useNavigate();
  const { user, signOut } = useAuthStore();
  const [signingOut, setSigningOut] = useState(false);

  const displayName = user?.name ?? user?.username ?? 'User';
  const initials = initialsOf(user?.name, user?.username);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate({ to: '/login' });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className='flex items-center gap-2 rounded-lg px-2 py-1.5 text-foreground hover:bg-muted transition-colors'>
        <Avatar className='h-7 w-7 rounded-lg'>
          <AvatarFallback className='rounded-lg bg-primary text-primary-foreground text-xs font-bold'>
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className='hidden sm:inline text-sm max-w-[10rem] truncate'>{displayName}</span>
        <ChevronDown className='h-4 w-4 opacity-70' />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align='end'
        className='w-56 rounded-xl border border-border shadow-lg bg-popover p-1'
      >
        <div className='flex items-center gap-2 p-2'>
          <Avatar className='h-8 w-8 rounded-lg'>
            <AvatarFallback className='rounded-lg bg-primary text-primary-foreground text-xs font-bold'>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className='flex flex-col min-w-0'>
            <span className='text-sm font-semibold text-foreground truncate'>{displayName}</span>
            <span className='text-xs text-muted-foreground truncate'>{user?.email ?? ''}</span>
          </div>
        </div>

        {isMockAuth && (
          <div className='px-2 pb-2'>
            <span className='inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'>
              Auth simulada
            </span>
          </div>
        )}

        <DropdownMenuSeparator className='bg-muted' />

        <DropdownMenuItem
          onClick={handleSignOut}
          disabled={signingOut}
          className='cursor-pointer text-sm'
        >
          <LogOut className='mr-2 h-4 w-4' />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
