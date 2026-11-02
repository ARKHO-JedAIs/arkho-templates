import { useState, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { GoogleIcon } from '@/components/brand/GoogleIcon';
import { MicrosoftIcon } from '@/components/brand/MicrosoftIcon';
import { signInWithSso, ssoProviders, type SsoProvider } from '@/lib/auth/session';

const PROVIDERS: Record<
  SsoProvider,
  { label: string; name: string; Icon: ComponentType<{ className?: string }> }
> = {
  microsoft: { label: 'Iniciar sesión con Microsoft', name: 'Microsoft', Icon: MicrosoftIcon },
  google: { label: 'Continuar con Google', name: 'Google', Icon: GoogleIcon },
};

/**
 * "o" and one button per provider in VITE_AUTH_SSO_PROVIDERS, under the
 * password form. Renders nothing when none is configured. Shown in mock too,
 * as a preview; there a click explains what is still missing instead of
 * redirecting.
 */
export function SsoButtons() {
  const [pending, setPending] = useState<SsoProvider | null>(null);

  if (ssoProviders.length === 0) return null;

  const start = async (provider: SsoProvider) => {
    setPending(provider);
    try {
      // On success the browser leaves for the provider, so nothing after this runs.
      await signInWithSso(provider);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : `No se pudo abrir el inicio de sesión con ${PROVIDERS[provider].name}.`
      );
      setPending(null);
    }
  };

  return (
    <div className='mt-5'>
      <div className='flex items-center gap-3'>
        <Separator className='flex-1' />
        <span className='text-xs text-muted-foreground'>o</span>
        <Separator className='flex-1' />
      </div>
      <div className='mt-5 space-y-3'>
        {ssoProviders.map(provider => {
          const { label, Icon } = PROVIDERS[provider];
          return (
            <Button
              key={provider}
              type='button'
              variant='outline'
              disabled={pending !== null}
              onClick={() => void start(provider)}
              className='w-full h-11 gap-3 rounded-xl border-border bg-background font-medium text-foreground'
            >
              {pending === provider ? (
                <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' />
              ) : (
                <Icon className='h-4 w-4' />
              )}
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
