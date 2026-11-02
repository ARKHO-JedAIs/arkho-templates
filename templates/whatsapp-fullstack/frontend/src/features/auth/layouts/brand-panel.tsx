import { MessageCircle, ShieldCheck, Zap, type LucideIcon } from 'lucide-react';
import { BrandMark } from '@/components/brand/BrandMark';
import type { LoginLayoutProps } from './types';

/** Replace with what your app does: one line each, true of this product. */
const HIGHLIGHTS: { icon: LucideIcon; text: string }[] = [
  { icon: MessageCircle, text: 'Conversaciones de WhatsApp en vivo' },
  { icon: Zap, text: 'Plantillas aprobadas y respuestas rápidas' },
  { icon: ShieldCheck, text: 'Tu equipo atiende cuando hace falta' },
];

/**
 * A brand panel (gradient of the brand colour, decorative circles, a headline
 * and highlights) next to the form card. The panel only exists from `lg` up:
 * on a phone the form is the page.
 */
export function LoginLayout({ appName, children }: LoginLayoutProps) {
  return (
    <div className='min-h-screen bg-background-secondary lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]'>
      <aside
        className='relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16'
        style={{
          backgroundImage:
            'linear-gradient(150deg, hsl(var(--primary)) 0%, hsl(var(--brand-accent-active)) 100%)',
        }}
      >
        <div aria-hidden className='pointer-events-none absolute inset-0'>
          <div className='absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary-foreground/10' />
          <div className='absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-primary-foreground/5' />
          <div className='absolute bottom-24 right-16 h-24 w-24 rounded-full bg-primary-foreground/10' />
        </div>

        <BrandMark appName={appName} onDark className='relative w-fit text-primary-foreground' />

        <div className='relative max-w-md'>
          <p className='text-sm font-semibold uppercase tracking-[0.14em] text-primary-foreground/70'>
            Atención por WhatsApp
          </p>
          <h1 className='mt-3 text-4xl font-bold leading-[1.1] text-primary-foreground xl:text-5xl'>
            Todas tus conversaciones, en un solo lugar
          </h1>
          <ul className='mt-10 space-y-3'>
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className='flex items-center gap-3 rounded-2xl bg-primary-foreground/10 px-4 py-3 text-[15px] text-primary-foreground backdrop-blur-sm'
              >
                <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15'>
                  <Icon className='h-[18px] w-[18px]' aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className='relative text-xs text-primary-foreground/60'>
          © {new Date().getFullYear()} {appName}
        </p>
      </aside>

      <main className='flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-8'>
        <div className='w-full max-w-[26rem]'>
          <div className='mb-8 flex justify-center lg:hidden'>
            <BrandMark appName={appName} className='text-foreground' />
          </div>
          <div className='rounded-2xl border border-border bg-card p-7 shadow-sm sm:p-9'>
            <h2 className='mb-6 text-2xl font-bold leading-tight text-foreground'>Inicia sesión</h2>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
