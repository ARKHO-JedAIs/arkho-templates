import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { router } from '@/router/routes';
import { initializeAuth } from '@/lib/auth/session';
import { ConfigError } from '@/components/ConfigError';

// Runs once at module load, before the first render: a Cognito build with a
// missing user pool id has to fail as a readable screen, not as an exception
// thrown from whichever component happened to touch auth first.
const authInit = initializeAuth();

export default function App() {
  if (!authInit.ok) {
    return <ConfigError missing={authInit.missing} />;
  }

  return (
    <>
      <RouterProvider router={router} />
      <Toaster richColors closeButton position='top-right' />
    </>
  );
}
