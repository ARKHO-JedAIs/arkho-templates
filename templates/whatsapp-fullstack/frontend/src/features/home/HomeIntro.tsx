import { Link } from '@tanstack/react-router';
import {
  ArrowRight,
  Bot,
  Database,
  FileText,
  MessageSquareText,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { WhatsAppIcon } from '@/components/brand/WhatsAppIcon';
import { cn } from '@/lib/utils';

/** How the agent works, in the order it happens. Generic on purpose: any business. */
const FLOW_STEPS = [
  {
    icon: MessageSquareText,
    title: 'El cliente escribe por WhatsApp',
    description: 'Desde su teléfono, a cualquier hora, como le escribiría a una persona.',
  },
  {
    icon: Bot,
    title: 'El agente responde con los datos de tu negocio',
    description: 'Contesta al momento con la información que tu empresa le entrega.',
  },
  {
    icon: ShieldCheck,
    title: 'Tu equipo supervisa y toma la conversación',
    description: 'Ve cada conversación en vivo y responde en persona cuando hace falta.',
  },
] as const;

/** The four spokes of the orbit, clockwise from the top. */
const SATELLITES = [
  {
    icon: Bot,
    label: 'Agente IA',
    position: 'top-1 left-1/2 -translate-x-1/2',
    labelSide: 'top',
    tone: 'bg-agent-light text-agent-strong',
  },
  {
    icon: Database,
    label: 'Datos',
    position: 'top-1/2 right-1 -translate-y-1/2',
    labelSide: 'bottom',
    tone: 'bg-card text-secondary',
  },
  {
    icon: UserRound,
    label: 'Equipo',
    position: 'bottom-1 left-1/2 -translate-x-1/2',
    labelSide: 'bottom',
    tone: 'bg-card text-secondary',
  },
  {
    icon: FileText,
    label: 'Plantillas',
    position: 'top-1/2 left-1 -translate-y-1/2',
    labelSide: 'bottom',
    tone: 'bg-card text-secondary',
  },
] as const;

/** The spokes between the satellites and the centre, each with a light running inward. */
const SPOKES = [
  { line: 'left-1/2 top-12 h-8 w-0.5 -translate-x-1/2', flow: 'home-flow-v', delay: '' },
  {
    line: 'top-1/2 right-12 h-0.5 w-8 -translate-y-1/2',
    flow: 'home-flow-h',
    delay: '[animation-delay:0.5s]',
  },
  {
    line: 'bottom-12 left-1/2 h-8 w-0.5 -translate-x-1/2',
    flow: 'home-flow-v',
    delay: '[animation-delay:1s]',
  },
  {
    line: 'left-12 top-1/2 h-0.5 w-8 -translate-y-1/2',
    flow: 'home-flow-h',
    delay: '[animation-delay:1.5s]',
  },
] as const;

interface HomeIntroProps {
  name?: string;
  /** Where the call to action goes; no button when this build has no inbox. */
  conversationsPath?: string;
}

/**
 * The first screen: what this product is - an AI agent that answers on
 * WhatsApp, with a team watching over it - and the way into the conversations.
 *
 * "Hola" rather than "Bienvenido": a greeting that does not guess anyone's gender.
 */
export function HomeIntro({ name, conversationsPath }: HomeIntroProps) {
  return (
    <section
      aria-labelledby='home-title'
      className='relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary-light via-card to-card p-5 sm:p-8'
    >
      <svg
        aria-hidden
        className='pointer-events-none absolute -bottom-8 -right-8 h-44 w-64 text-primary sm:h-56 sm:w-80'
        viewBox='0 0 200 140'
        fill='none'
      >
        <path
          d='M0 140 C30 90 50 70 70 85 C90 100 100 60 130 55 C160 50 175 90 200 40 L200 140 Z'
          fill='currentColor'
          opacity='0.06'
        />
        <path
          d='M35 140 C60 105 80 85 100 95 C120 105 130 75 155 70 C175 66 185 100 200 85 L200 140 Z'
          fill='currentColor'
          opacity='0.1'
        />
        <path
          d='M85 140 C105 115 120 100 135 105 C150 110 160 90 175 92 C185 93 192 110 200 100 L200 140 Z'
          fill='currentColor'
          opacity='0.16'
        />
      </svg>

      <div className='relative grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center'>
        <div className='flex min-w-0 flex-col gap-6'>
          <div>
            <p className='flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary-700'>
              <span className='h-1.5 w-1.5 rounded-full bg-primary' aria-hidden />
              Agente de IA · WhatsApp
            </p>
            <h1
              id='home-title'
              className='mt-3 break-words text-3xl font-bold leading-tight text-foreground sm:text-4xl'
            >
              Hola{name ? `, ${name}` : ''}
            </h1>
            <p className='mt-2 max-w-xl text-sm leading-relaxed text-foreground-secondary sm:text-base'>
              Un asistente conversacional con inteligencia artificial que atiende a tus clientes por
              WhatsApp, alimentado por los datos de tu negocio. Tu equipo supervisa cada
              conversación y puede tomarla cuando quiera.
            </p>
            {conversationsPath ? (
              <Link
                to={conversationsPath}
                className='mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
              >
                Ir a las conversaciones
                <ArrowRight className='h-4 w-4' aria-hidden />
              </Link>
            ) : null}
          </div>

          <ol className='grid gap-3 border-t border-border pt-6 sm:grid-cols-3'>
            {FLOW_STEPS.map((step, index) => {
              const Icon = step.icon;
              return (
                <li
                  key={step.title}
                  className='rounded-xl border border-border bg-card/90 p-4 shadow-sm'
                >
                  <div className='flex items-center justify-between'>
                    <span className='flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary-700'>
                      <Icon className='h-[18px] w-[18px]' aria-hidden />
                    </span>
                    <span className='text-xs font-semibold tabular-nums text-foreground-secondary'>
                      <span className='sr-only'>Paso </span>
                      {index + 1}
                    </span>
                  </div>
                  <p className='mt-3 text-sm font-semibold text-foreground'>{step.title}</p>
                  <p className='mt-1 text-xs leading-relaxed text-foreground-secondary'>
                    {step.description}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>

        <div className='relative mx-auto hidden lg:flex' aria-hidden>
          <div className='relative h-60 w-60 shrink-0'>
            <div className='absolute inset-6 rounded-full border-2 border-dashed border-secondary/40 motion-safe:animate-[spin_80s_linear_infinite]' />
            {SPOKES.map(spoke => (
              <div
                key={spoke.line}
                className={cn('absolute overflow-hidden bg-secondary/30', spoke.line)}
              >
                <span
                  className={cn(
                    'absolute from-transparent via-primary to-transparent',
                    spoke.flow === 'home-flow-v'
                      ? 'inset-x-0 h-1/2 bg-gradient-to-b'
                      : 'inset-y-0 w-1/2 bg-gradient-to-r',
                    spoke.flow,
                    spoke.delay
                  )}
                />
              </div>
            ))}

            <div className='absolute inset-0 flex items-center justify-center'>
              <div className='flex h-16 w-16 items-center justify-center rounded-full bg-whatsapp text-whatsapp-foreground shadow-lg ring-4 ring-card'>
                <WhatsAppIcon className='h-8 w-8' />
              </div>
            </div>
            {SATELLITES.map(({ icon: Icon, label, position, labelSide, tone }) => (
              <div key={label} className={cn('absolute h-11 w-11', position)}>
                <div
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-xl border border-border shadow-sm',
                    tone
                  )}
                >
                  <Icon className='h-5 w-5' />
                </div>
                <span
                  className={cn(
                    'absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-foreground-secondary',
                    labelSide === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
                  )}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
