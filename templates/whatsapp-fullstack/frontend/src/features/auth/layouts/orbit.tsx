import { MessageCircle, ShieldCheck, Users, Zap } from 'lucide-react';
import { BrandMark, brandLogo } from '@/components/brand/BrandMark';
import type { LoginLayoutProps } from './types';

/** Replace with your own words: where they sit is the design, not the text. */
const ORBIT_CALLOUTS = [
  { title: 'Mensajes', detail: 'en tiempo real', position: '-left-24 top-[22%]' },
  { title: 'Respuestas', detail: 'más rápidas', position: '-right-28 top-[43%]' },
  { title: 'Equipos', detail: 'más conectados', position: '-left-20 bottom-[12%]' },
] as const;

const STATS = [
  { icon: MessageCircle, label: 'Conversaciones en vivo' },
  { icon: Users, label: 'Atención humana' },
  { icon: Zap, label: 'Mayor eficiencia' },
  { icon: ShieldCheck, label: 'Acceso seguro' },
] as const;

/**
 * A greeting and the form on the left, and on the right three slow orbits
 * around a disc with the logo (or the app's initial), callouts and a row of
 * highlights - all in the brand colour. The right side only exists from `lg` up. The orbits
 * spin only for users who have not asked for reduced motion (`motion-safe`).
 */
export function LoginLayout({ appName, children }: LoginLayoutProps) {
  const initial = appName.trim().charAt(0).toUpperCase() || 'A';
  const logo = brandLogo(true);

  return (
    <main className='relative min-h-screen overflow-hidden bg-background lg:flex'>
      <section className='relative z-20 flex min-h-screen w-full items-center justify-center px-5 py-8 lg:w-[42%] lg:px-10'>
        <div className='flex min-h-[calc(100vh-4rem)] w-full max-w-[34rem] flex-col px-4 py-8 sm:px-8'>
          <header className='mt-6'>
            <BrandMark appName={appName} className='text-foreground' />
          </header>

          <div className='flex flex-1 flex-col justify-center pb-16'>
            <h1 className='text-[42px] font-black leading-[0.98] tracking-[-0.035em] text-foreground sm:text-[48px]'>
              Hola,
              <br />
              <span className='text-primary'>bienvenido(a)</span>
            </h1>
            <p className='mt-4 max-w-md text-[15px] leading-6 text-muted-foreground'>
              Todas tus conversaciones de WhatsApp, en un solo lugar.
            </p>
            <div className='mt-9 w-full'>{children}</div>
          </div>

          <footer className='border-t border-border pt-5 text-[11px] text-muted-foreground'>
            © {new Date().getFullYear()} {appName}. Todos los derechos reservados.
          </footer>
        </div>
      </section>

      <section
        aria-hidden
        className='relative hidden min-h-screen flex-1 flex-col overflow-hidden bg-gradient-to-br from-[hsl(var(--primary-light))] via-background to-[hsl(var(--primary-light))] lg:flex'
      >
        <div className='pointer-events-none absolute -top-28 left-[4%] select-none text-[620px] font-black leading-none text-primary/[0.04]'>
          {initial}
        </div>

        <div className='relative z-10 flex flex-1 items-center justify-center'>
          <div className='relative flex h-[520px] w-[520px] items-center justify-center xl:h-[610px] xl:w-[610px]'>
            {ORBIT_CALLOUTS.map(({ title, detail, position }) => (
              <div key={title} className={`absolute z-20 ${position}`}>
                <p className='text-[14px] font-bold text-foreground'>{title}</p>
                <p className='text-[13px] text-muted-foreground'>{detail}</p>
                <div className='mt-3 h-1 w-20 bg-gradient-to-r from-primary/80 to-transparent' />
              </div>
            ))}

            <div
              className='absolute inset-0 rounded-full border-[3px] border-dashed border-primary/50 motion-safe:animate-[spin_100s_linear_infinite]'
              style={{ animationDirection: 'reverse' }}
            >
              <span className='absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary' />
            </div>
            <div className='absolute inset-[52px] rounded-full border-[3px] border-dashed border-muted-foreground/50 motion-safe:animate-[spin_75s_linear_infinite]'>
              <span className='absolute left-1/2 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-md' />
            </div>
            <div className='absolute inset-[115px] rounded-full border-2 border-primary/25 motion-safe:animate-[spin_55s_linear_infinite]'>
              <span className='absolute right-[-5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-primary' />
            </div>

            <div
              className='relative z-10 flex h-[155px] w-[155px] items-center justify-center rounded-full shadow-2xl xl:h-[175px] xl:w-[175px]'
              style={{
                backgroundImage:
                  'linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--brand-accent-active)) 100%)',
              }}
            >
              {logo ? (
                <img src={logo} alt='' className='h-20 w-20 object-contain' />
              ) : (
                <span className='text-[60px] font-black text-primary-foreground'>{initial}</span>
              )}
            </div>
          </div>
        </div>

        <ul className='relative z-10 flex items-start justify-center px-10 pb-9 xl:px-16'>
          {STATS.map(({ icon: Icon, label }, index) => (
            <li
              key={label}
              className='relative flex min-w-[120px] flex-1 flex-col items-center px-4 text-center'
            >
              {index !== 0 && <span className='absolute left-0 top-4 h-12 w-px bg-border' />}
              <span className='flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary'>
                <Icon className='h-5 w-5' strokeWidth={2} />
              </span>
              <span className='mt-2 max-w-[95px] text-[11px] font-medium leading-[14px] text-muted-foreground'>
                {label}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
