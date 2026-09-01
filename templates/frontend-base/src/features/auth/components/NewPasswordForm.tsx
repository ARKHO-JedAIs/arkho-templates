import { useState } from 'react';
import { completeNewPassword } from '@/lib/auth/session';
import { AlertCircle, Check, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PASSWORD_RULES, isPasswordValid } from '../utils/passwordPolicy';

interface NewPasswordFormProps {
  /** Shown as context so it's obvious which account is being set up. */
  email: string;
  /** Resolves once Cognito accepts the new password and the session is live. */
  onCompleted: (newPassword: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Second step of the sign-in flow when Cognito answers with the
 * NEW_PASSWORD_REQUIRED challenge - which is every first login of a user
 * created by an admin (admin-created accounts and admin password resets both
 * issue a temporary password). Without this step those users could
 * authenticate but never get a session.
 */
export function NewPasswordForm({ email, onCompleted, onCancel }: NewPasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const canSubmit = isPasswordValid(password) && password === confirmation && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await completeNewPassword(password);
      if (result.status !== 'signed-in') {
        // Any further challenge (MFA, etc.) isn't configured on this pool, so
        // reaching here means something changed server-side rather than a
        // case worth building a branch for.
        setError('No se pudo completar el ingreso. Contacta a tu administrador.');
        return;
      }
      await onCompleted(password);
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (message.includes('did not conform with policy') || message.includes('InvalidPassword')) {
        setError('La contraseña no cumple los requisitos.');
      } else if (message.includes('session is expired') || message.includes('Invalid session')) {
        setError('La sesión expiró. Ingresa tus credenciales otra vez.');
      } else {
        setError('No se pudo guardar la contraseña. Intenta nuevamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className='mb-7'>
        <h2 className='text-2xl font-bold text-foreground leading-tight'>Crea tu contraseña</h2>
        <p className='text-muted-foreground text-sm mt-1.5'>
          Es tu primer ingreso con <span className='font-medium text-foreground'>{email}</span>.
          Define una contraseña nueva para continuar.
        </p>
      </div>

      {error && (
        <div className='mb-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20'>
          <AlertCircle className='w-4 h-4 text-destructive mt-0.5 shrink-0' />
          <p className='text-sm text-destructive leading-snug'>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className='space-y-5'>
        <div className='space-y-1.5'>
          <Label htmlFor='new-password' className='text-foreground font-medium text-sm'>
            Nueva contraseña
          </Label>
          <div className='relative'>
            <Lock className='absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
            <Input
              id='new-password'
              type='password'
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete='new-password'
              className='h-11 pl-10 rounded-xl border-border bg-muted/50 text-foreground
                         focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20
                         transition-all duration-200'
            />
          </div>
        </div>

        <ul className='space-y-1.5'>
          {PASSWORD_RULES.map(rule => {
            const met = rule.isMet(password);
            return (
              <li key={rule.label} className='flex items-center gap-2 text-xs'>
                <Check className={`w-3.5 h-3.5 shrink-0 ${met ? 'text-success' : 'text-border'}`} />
                <span className={met ? 'text-foreground' : 'text-muted-foreground'}>
                  {rule.label}
                </span>
              </li>
            );
          })}
        </ul>

        <div className='space-y-1.5'>
          <Label htmlFor='confirm-password' className='text-foreground font-medium text-sm'>
            Repetir contraseña
          </Label>
          <div className='relative'>
            <Lock className='absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
            <Input
              id='confirm-password'
              type='password'
              required
              value={confirmation}
              onChange={e => setConfirmation(e.target.value)}
              autoComplete='new-password'
              className='h-11 pl-10 rounded-xl border-border bg-muted/50 text-foreground
                         focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20
                         transition-all duration-200'
            />
          </div>
          {mismatch && <p className='text-xs text-destructive'>Las contraseñas no coinciden.</p>}
        </div>

        <Button
          type='submit'
          disabled={!canSubmit}
          className='w-full h-11 mt-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl
                     shadow-md shadow-foreground/20 transition-all duration-200
                     disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {loading ? (
            <span className='flex items-center gap-2'>
              <Loader2 className='w-4 h-4 animate-spin' />
              Guardando...
            </span>
          ) : (
            'Guardar y continuar'
          )}
        </Button>
      </form>

      <div className='mt-7 pt-5 border-t border-border'>
        <button
          type='button'
          onClick={onCancel}
          className='w-full text-center text-muted-foreground text-xs hover:text-foreground transition-colors'
        >
          Volver al inicio de sesión
        </button>
      </div>
    </div>
  );
}

export default NewPasswordForm;
