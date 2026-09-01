import { AlertTriangle } from 'lucide-react';

/**
 * Shown instead of the app when required environment variables are missing.
 *
 * Worth a real screen rather than a console warning: the failure is a
 * five-second `.env` fix, but without this it surfaces as an Amplify exception
 * from whichever component touched auth first, which reads like a code bug.
 */
export function ConfigError({ missing }: { missing: string[] }) {
  return (
    <div className='min-h-screen flex items-center justify-center bg-background p-6'>
      <div className='max-w-lg w-full rounded-2xl border border-border bg-card p-6'>
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100'>
            <AlertTriangle className='h-5 w-5 text-amber-600' aria-hidden />
          </div>
          <h1 className='text-lg font-semibold text-foreground'>Falta configuración</h1>
        </div>

        <p className='mt-4 text-sm text-muted-foreground'>
          Esta compilación usa Cognito, pero estas variables no están definidas:
        </p>

        <ul className='mt-3 space-y-1'>
          {missing.map(key => (
            <li key={key}>
              <code className='rounded bg-muted px-1.5 py-0.5 text-sm text-foreground'>{key}</code>
            </li>
          ))}
        </ul>

        <p className='mt-4 text-sm text-muted-foreground'>
          Defínelas en <code className='rounded bg-muted px-1'>.env</code> y reinicia el servidor de
          desarrollo. Para trabajar sin un user pool, usa{' '}
          <code className='rounded bg-muted px-1'>VITE_AUTH_PROVIDER=mock</code>.
        </p>
      </div>
    </div>
  );
}
