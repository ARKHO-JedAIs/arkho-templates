import { Menu } from 'lucide-react';
import { useSidebar } from '@/components/ui/sidebar';
import { NavUser } from './NavUser';

/** App name shown in the header. Swap for an <img> logo when you have one. */
const APP_NAME = '{{ project_name }}';

function Header() {
  const { toggleSidebar } = useSidebar();

  return (
    <header className='flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6 fixed top-0 left-0 right-0 z-[100] bg-card'>
      <div className='flex items-center gap-3'>
        <span className='text-foreground font-semibold tracking-tight'>{APP_NAME}</span>
      </div>

      <div className='flex items-center gap-1'>
        <button
          onClick={toggleSidebar}
          className='md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all duration-200'
          aria-label='Abrir menú de navegación'
        >
          <Menu className='h-5 w-5' />
        </button>
        <NavUser />
      </div>
    </header>
  );
}

export default Header;
