import { BrandMark } from '@/components/brand/BrandMark';
import type { LoginLayoutProps } from './types';

/**
 * A single centred card on a soft wash of the brand hues. The neutral choice:
 * no marketing copy to delete, and it follows the palette in light and dark.
 */
export function LoginLayout({ appName, children }: LoginLayoutProps) {
  return (
    <div className='relative min-h-screen flex flex-col items-center justify-center bg-background-secondary px-4 py-10'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 overflow-hidden'
        style={{
          backgroundImage:
            'radial-gradient(60rem 30rem at 15% -10%, hsl(var(--primary) / 0.07), transparent 60%), radial-gradient(45rem 28rem at 95% 110%, hsl(var(--secondary) / 0.06), transparent 60%)',
        }}
      />

      <main className='relative w-full max-w-[26rem]'>
        <div className='mb-7 flex justify-center'>
          <BrandMark appName={appName} className='text-foreground' />
        </div>

        <div className='rounded-2xl border border-border bg-card p-7 shadow-sm sm:p-8'>
          <h1 className='mb-6 text-2xl font-bold leading-tight text-foreground'>Inicia sesión</h1>
          {children}
        </div>

        <p className='mt-6 text-center text-xs text-muted-foreground'>&copy; {appName}</p>
      </main>
    </div>
  );
}
