import { AlertTriangle, RotateCcw } from 'lucide-react';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

/**
 * Last line of defence for a render or loader failure.
 *
 * Without it React 19 unmounts the whole tree on an uncaught error and the user
 * is left staring at a blank page with no way back short of reloading. Wired as
 * the router's `defaultErrorComponent`, so it covers every route at once.
 *
 * The error detail is shown in development only: a stack trace on screen leaks
 * internal structure, and in production it tells the user nothing they can act on.
 */
export function AppError({ error, reset }: ErrorComponentProps) {
  return (
    <div className='min-h-screen flex items-center justify-center bg-background p-6'>
      <div className='max-w-lg w-full rounded-2xl border border-border bg-card p-6'>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10'>
            <AlertTriangle className='h-5 w-5 text-destructive' aria-hidden />
          </div>
          <h1 className='text-lg font-semibold text-foreground'>Algo salió mal</h1>
        </div>

        <p className='mt-4 text-sm text-muted-foreground'>
          Se produjo un error inesperado en esta pantalla. Puedes reintentar; si vuelve a ocurrir,
          avisa al equipo.
        </p>

        {import.meta.env.DEV && error instanceof Error && (
          <pre className='mt-4 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs text-foreground'>
            {error.message}
          </pre>
        )}

        <Button onClick={reset} className='mt-5'>
          <RotateCcw className='mr-2 h-4 w-4' aria-hidden />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
