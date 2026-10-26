import { ArrowRight, ShieldAlert } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sections } from '@/app/sections';
import useAuthStore, { selectIsAdmin } from '@/lib/stores/useAuthStore';
import { isMockAuth } from '@/lib/auth/session';

export default function HomePage() {
  const user = useAuthStore(state => state.user);
  const isAdmin = useAuthStore(selectIsAdmin);
  const visible = sections.filter(section => !section.requiresAdmin || isAdmin);

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h1 className='text-2xl font-bold text-foreground leading-tight'>
          Bienvenido{user?.name ? `, ${user.name}` : ''}
        </h1>
        <p className='text-muted-foreground text-sm mt-1'>
          {visible.length > 0
            ? 'Elige una sección para comenzar.'
            : 'Esta compilación no tiene secciones opcionales habilitadas.'}
        </p>
      </div>

      {isMockAuth && (
        <div className='flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4'>
          <ShieldAlert className='h-5 w-5 shrink-0 text-amber-600' aria-hidden />
          <div className='text-sm text-amber-900'>
            <p className='font-medium'>Autenticación simulada</p>
            <p className='mt-0.5'>
              Se acepta cualquier credencial y no hay ningún user pool real. Define{' '}
              <code className='rounded bg-amber-100 px-1'>VITE_AUTH_PROVIDER=cognito</code> en{' '}
              <code className='rounded bg-amber-100 px-1'>.env</code> cuando tengas tu user pool de
              Cognito. Revisa el README.
            </p>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {visible.map(section => {
            const Icon = section.icon;
            return (
              <Link key={section.path} to={section.path} className='group'>
                <Card className='h-full transition-colors group-hover:border-primary/40'>
                  <CardHeader className='flex flex-row items-center gap-3 space-y-0'>
                    <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-muted'>
                      <Icon className='h-4 w-4 text-primary' aria-hidden />
                    </div>
                    <CardTitle className='text-base'>{section.label}</CardTitle>
                  </CardHeader>
                  <CardContent className='flex items-center gap-1 text-sm text-muted-foreground'>
                    Abrir
                    <ArrowRight className='h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5' />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
