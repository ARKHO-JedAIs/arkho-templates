import { ShieldAlert } from 'lucide-react';
import { sections } from '@/app/sections';
import useAuthStore, { selectIsAdmin } from '@/lib/stores/useAuthStore';
import { isMockAuth } from '@/lib/auth/session';
import { HomeIntro } from './HomeIntro';

/** The inbox, when this build has it: the home screen's call to action. */
const CONVERSATIONS_PATH = '/whatsapp';

export default function HomePage() {
  const user = useAuthStore(state => state.user);
  const isAdmin = useAuthStore(selectIsAdmin);
  const inbox = sections.find(
    section => section.path === CONVERSATIONS_PATH && (!section.requiresAdmin || isAdmin)
  );

  return (
    <div className='flex flex-col gap-6'>
      <HomeIntro name={user?.name} conversationsPath={inbox?.path} />

      {isMockAuth && (
        <div className='flex items-start gap-3 rounded-xl border border-warning bg-warning-light p-4'>
          <ShieldAlert className='h-5 w-5 shrink-0 text-warning-strong' aria-hidden />
          <div className='text-sm text-foreground'>
            <p className='font-semibold text-warning-strong'>Autenticación simulada</p>
            <p className='mt-0.5'>
              Se acepta cualquier credencial y no hay ningún user pool real. Define{' '}
              <code className='rounded bg-card px-1'>VITE_AUTH_PROVIDER=cognito</code> en{' '}
              <code className='rounded bg-card px-1'>.env</code> cuando tengas tu user pool de
              Cognito. Revisa el README.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
