import { BarChart3, MessageCircle, Users } from 'lucide-react';
import type { LoginLayoutProps } from './types';

/** Replace with what your app does. */
const FEATURES = [
  { icon: MessageCircle, label: 'Conversaciones centralizadas' },
  { icon: Users, label: 'Atención humana cuando hace falta' },
  { icon: BarChart3, label: 'Historial de cada contacto' },
] as const;

/**
 * Lines, rings and a rising chart in the brand colour over the dark surface
 * hue. `currentColor` is the brand colour (set on the svg), so the drawing
 * follows VITE_BRAND_COLOR; the white strokes are the neutral texture.
 */
function Decoration() {
  return (
    <svg
      className='absolute inset-0 h-full w-full text-primary'
      viewBox='0 0 560 800'
      fill='none'
      preserveAspectRatio='xMidYMid slice'
      aria-hidden='true'
    >
      <circle cx='480' cy='100' r='220' stroke='white' strokeOpacity='0.04' />
      <circle cx='480' cy='100' r='140' stroke='white' strokeOpacity='0.06' />
      <circle cx='480' cy='100' r='60' fill='white' fillOpacity='0.03' />
      <circle cx='60' cy='720' r='160' stroke='white' strokeOpacity='0.04' />
      <circle cx='60' cy='720' r='80' stroke='currentColor' strokeOpacity='0.25' />
      <line x1='0' y1='400' x2='560' y2='400' stroke='white' strokeOpacity='0.03' />
      <line x1='280' y1='0' x2='280' y2='800' stroke='white' strokeOpacity='0.03' />
      <polyline
        points='50,620 130,540 220,575 320,460 410,420 500,340'
        stroke='currentColor'
        strokeOpacity='0.5'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <circle cx='130' cy='540' r='3.5' fill='currentColor' fillOpacity='0.7' />
      <circle cx='320' cy='460' r='3.5' fill='currentColor' fillOpacity='0.7' />
      <circle cx='500' cy='340' r='3.5' fill='currentColor' fillOpacity='0.7' />
      <rect x='100' y='650' width='22' height='55' rx='4' fill='white' fillOpacity='0.05' />
      <rect x='134' y='630' width='22' height='75' rx='4' fill='white' fillOpacity='0.07' />
      <rect x='168' y='660' width='22' height='45' rx='4' fill='white' fillOpacity='0.05' />
      <rect x='202' y='615' width='22' height='90' rx='4' fill='currentColor' fillOpacity='0.35' />
      <rect x='236' y='640' width='22' height='65' rx='4' fill='white' fillOpacity='0.06' />
    </svg>
  );
}

/**
 * A dark, decorated panel with a badge, a headline with an accent and feature
 * pills, next to the bare form. The panel only exists from `lg` up.
 */
export function LoginLayout({ appName, children }: LoginLayoutProps) {
  return (
    <div className='flex min-h-screen bg-background-secondary'>
      <div className='relative hidden flex-col overflow-hidden bg-gradient-to-br from-secondary to-[hsl(var(--brand-navy-hover))] lg:flex lg:w-[52%] xl:w-[55%]'>
        <Decoration />

        <div className='relative z-10 flex h-full flex-col px-12 py-12'>
          <span className='text-xl font-semibold tracking-tight text-secondary-foreground'>
            {appName}
          </span>

          <div className='flex max-w-sm flex-1 flex-col justify-center'>
            <div className='mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-secondary-foreground/10 bg-secondary-foreground/10 px-3 py-1.5'>
              <span className='h-1.5 w-1.5 animate-pulse rounded-full bg-primary' />
              <span className='text-xs font-medium text-secondary-foreground/70'>
                Plataforma de atención por WhatsApp
              </span>
            </div>

            <h1 className='mb-4 text-4xl font-bold leading-tight text-secondary-foreground xl:text-[2.75rem]'>
              Atiende a tus clientes <span className='text-primary'>de forma más simple</span>
            </h1>
            <p className='text-base leading-relaxed text-secondary-foreground/60'>
              Cada mensaje queda registrado y tu equipo responde desde un solo lugar, en vivo.
            </p>

            <div className='mt-10 space-y-2.5'>
              {FEATURES.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className='flex items-center gap-3 rounded-xl border border-secondary-foreground/10 bg-secondary-foreground/[0.07] px-4 py-3'
                >
                  <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15'>
                    <Icon className='h-4 w-4 text-primary' />
                  </div>
                  <span className='text-sm font-medium text-secondary-foreground/80'>{label}</span>
                </div>
              ))}
            </div>
          </div>

          <p className='text-xs text-secondary-foreground/30'>
            © {new Date().getFullYear()} {appName}
          </p>
        </div>
      </div>

      <div className='flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10'>
        <p className='mb-8 text-xl font-semibold tracking-tight text-foreground lg:hidden'>
          {appName}
        </p>
        <div className='w-full max-w-[420px]'>
          <h2 className='mb-6 text-2xl font-bold leading-tight text-foreground'>Inicia sesión</h2>
          {children}
        </div>
      </div>
    </div>
  );
}
