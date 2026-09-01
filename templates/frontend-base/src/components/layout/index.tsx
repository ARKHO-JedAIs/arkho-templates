import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Outlet } from '@tanstack/react-router';
import Header from './Header';

function LayoutContent() {
  return (
    <div className='h-screen w-full flex flex-col overflow-hidden'>
      <Header />
      <div className='flex-1 w-full flex overflow-hidden'>
        <AppSidebar />
        <div className='flex-1 min-w-0 h-full overflow-hidden'>
          {/* Two paddings, two jobs, deliberately on separate elements. The
              outer `pt-14` exists only to clear the fixed header; the inner one
              is the content rhythm. Collapsing them onto one element is what
              left the page title flush against the header: `!pt-14` overrode the
              `py-*` and the top gap became exactly zero. */}
          <SidebarInset className='!h-full !min-h-0 !relative overflow-auto !pt-14'>
            <div className='h-full px-3 sm:px-4 md:px-6 lg:px-8 py-5 sm:py-6 md:py-8'>
              <Outlet />
            </div>
          </SidebarInset>
        </div>
      </div>
    </div>
  );
}

// The session is already resolved by `requireAuth` in src/router/routes.tsx,
// which runs before this component mounts - re-checking here would double every
// call to the auth provider on a cold load. The Toaster lives in App.tsx; a
// second one here would render every toast twice.
export default function Page() {
  return (
    <SidebarProvider>
      <LayoutContent />
    </SidebarProvider>
  );
}
