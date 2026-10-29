import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { completeSsoSignIn } from '@/lib/auth/session';
import useAuthStore from '@/lib/stores/useAuthStore';

type CallbackState = { status: 'pending' } | { status: 'failed'; detail: string };

/**
 * Where Cognito sends the browser back after "Iniciar sesión con Microsoft" or
 * "Continuar con Google" (VITE_AUTH_REDIRECT_SIGN_IN). Finishes the sign-in and
 * lands on the home screen, or explains that it failed.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();
  const [state, setState] = useState<CallbackState>({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;
    const finish = async () => {
      try {
        await completeSsoSignIn();
        await checkAuth();
        if (!cancelled) navigate({ to: '/', replace: true });
      } catch (error) {
        if (!cancelled) setState({ status: 'failed', detail: (error as Error)?.message ?? '' });
      }
    };
    void finish();
    return () => {
      cancelled = true;
    };
  }, [checkAuth, navigate]);

  if (state.status === 'pending') {
    return (
      <main className='flex min-h-screen items-center justify-center bg-background p-4'>
        <p className='flex items-center gap-2 text-sm text-muted-foreground' role='status'>
          <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
          Completando el inicio de sesión...
        </p>
      </main>
    );
  }

  return (
    <main className='flex min-h-screen items-center justify-center bg-background p-4'>
      <div className='w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-sm'>
        <AlertCircle className='mx-auto h-10 w-10 text-destructive' aria-hidden='true' />
        <h1 className='mt-4 text-lg font-semibold text-foreground'>No se pudo iniciar sesión</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          La cuenta de Microsoft o Google no completó el ingreso. Intenta nuevamente o usa tu correo
          y contraseña.
        </p>
        {state.detail && (
          <p className='mt-3 break-words text-xs text-muted-foreground'>Detalle: {state.detail}</p>
        )}
        <Button asChild className='mt-6 w-full'>
          <Link to='/login'>
            <ArrowLeft className='h-4 w-4' aria-hidden='true' />
            Volver al inicio de sesión
          </Link>
        </Button>
      </div>
    </main>
  );
}
