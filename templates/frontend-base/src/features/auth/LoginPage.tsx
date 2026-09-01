import { useCallback, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import useAuthStore, { selectIsAuthenticated } from '@/lib/stores/useAuthStore';
import { LoginForm } from './components/LoginForm';

/**
 * The product name, declared once.
 *
 * Keeping it in a constant rather than inline in the JSX is what stops the
 * generated file from failing its own Prettier check: substituting a longer or
 * shorter name into markup would change the line width and the wrapping with it.
 */
const APP_NAME = '{{ project_name }}';

/**
 * Sign-in screen.
 *
 * Deliberately a single centred card, not a split marketing panel. A scaffold
 * has no product to sell, and shipping placeholder value propositions means
 * every project starts by deleting copy that was never true. What is here is
 * the app name, the form, and a background that reads as considered without
 * asserting an identity - replace the wordmark with a logo and it is yours.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();

  const redirectIfSignedIn = useCallback(async () => {
    await checkAuth();
    if (selectIsAuthenticated(useAuthStore.getState())) {
      navigate({ to: '/' });
    }
  }, [checkAuth, navigate]);

  useEffect(() => {
    void redirectIfSignedIn();
  }, [redirectIfSignedIn]);

  return (
    <div className='relative min-h-screen flex flex-col items-center justify-center bg-background-secondary px-4 py-10'>
      {/* Two very low-opacity radial washes in the theme's own hues. Subtle
          enough to read as depth rather than decoration, and they follow the
          palette automatically in light and dark. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 overflow-hidden'
        style={{
          backgroundImage:
            'radial-gradient(60rem 30rem at 15% -10%, hsl(var(--primary) / 0.07), transparent 60%), radial-gradient(45rem 28rem at 95% 110%, hsl(var(--secondary) / 0.06), transparent 60%)',
        }}
      />

      <main className='relative w-full max-w-[26rem]'>
        <div className='mb-7 text-center'>
          <span className='text-xl font-semibold tracking-tight text-foreground'>{APP_NAME}</span>
        </div>

        <div className='rounded-2xl border border-border bg-card p-7 shadow-sm sm:p-8'>
          <LoginForm />
        </div>

        <p className='mt-6 text-center text-xs text-muted-foreground'>&copy; {APP_NAME}</p>
      </main>
    </div>
  );
}
