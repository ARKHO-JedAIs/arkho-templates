import { useEffect, useState } from 'react';
import { signIn } from '@/lib/auth/session';
import type { OtpMethod, SignInResult } from '@/lib/auth/types';
import { useNavigate } from '@tanstack/react-router';
import useAuthStore from '@/lib/stores/useAuthStore';
import { toast } from 'sonner';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Lock,
  AlertCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { NewPasswordForm } from './NewPasswordForm';
import { OtpForm } from './OtpForm';
import { SsoButtons } from './SsoButtons';

const REMEMBERED_EMAIL_KEY = 'remembered-email';

/** Which of the sign-in flow's steps is on screen. Cognito can route through
 * these in more than one order - new-password-required can itself chain into
 * otp - so this is driven entirely by handleChallengeResult below, never by
 * hardcoding "step 2 is always X". */
type Step = 'credentials' | 'new-password' | 'otp';

export function LoginForm() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberEmail, setRememberEmail] = useState(false);
  const [step, setStep] = useState<Step>('credentials');
  /** Only meaningful once `step === 'otp'` - which channel to show copy for. */
  const [otpChallenge, setOtpChallenge] = useState<{
    method: OtpMethod;
    destination?: string;
  } | null>(null);

  // Only the email is remembered, and in plain localStorage. Storing the
  // password - even AES-encrypted - is not a real protection in a SPA: the key
  // ships inside the bundle, so anything it 'protects' is readable by whoever
  // can read the ciphertext.
  useEffect(() => {
    const storedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    if (storedEmail) {
      setEmail(storedEmail);
      setRememberEmail(true);
    }
  }, []);

  /** Landing spot once Cognito is fully satisfied: refresh the store (which
   * also resolves the user's role) and send them into the app. */
  const finishSignIn = async () => {
    await checkAuth();
    navigate({ to: '/' });
  };

  /** The one place that turns "what Cognito wants next" into "what's on
   * screen next" - shared by the initial sign-in, the new-password step and
   * the OTP step, since any of them can hand back any of these three. */
  const handleChallengeResult = (result: SignInResult) => {
    if (result.status === 'signed-in') {
      void finishSignIn();
    } else if (result.status === 'new-password-required') {
      setStep('new-password');
    } else {
      setOtpChallenge({ method: result.method, destination: result.destination });
      setStep('otp');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (rememberEmail) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      }

      // The result has to be inspected, not discarded: an admin-created user
      // signs in successfully but comes back with a challenge instead of a
      // session, so treating signIn as fire-and-forget leaves those accounts
      // unable to ever get in.
      const result = await signIn(email, password);
      handleChallengeResult(result);
    } catch (err) {
      const errorMessage = (err as Error)?.message;
      if (errorMessage?.includes('User does not exist')) {
        setError('El usuario no existe.');
      } else if (errorMessage?.includes('Incorrect username or password')) {
        setError('Las credenciales son incorrectas.');
      } else {
        setError('No se pudo iniciar sesión. Intenta nuevamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    setStep('credentials');
    setPassword('');
    setOtpChallenge(null);
  };

  /** Cognito has no dedicated "resend" call for a sign-in MFA challenge - the
   * only way to get a fresh code is to restart it, which InitiateAuth does by
   * re-running signIn with the same credentials. The password is still held
   * here (only backToCredentials clears it), so this can run without sending
   * the user back to the credentials screen. */
  const handleResend = async () => {
    const result = await signIn(email, password);
    handleChallengeResult(result);
  };

  if (step === 'new-password') {
    return (
      <NewPasswordForm
        email={email}
        onResult={handleChallengeResult}
        onCancel={backToCredentials}
      />
    );
  }

  if (step === 'otp' && otpChallenge) {
    return (
      <OtpForm
        method={otpChallenge.method}
        destination={otpChallenge.destination}
        onResult={handleChallengeResult}
        onResend={handleResend}
        onCancel={backToCredentials}
      />
    );
  }

  return (
    <div>
      {/* No heading here on purpose - the page itself carries the pitch
          (see LoginPage.tsx), and repeating "Iniciar sesión" right above
          the fields would be redundant with it. */}

      {/* Error */}
      {error && (
        <div className='mb-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20'>
          <AlertCircle className='w-4 h-4 text-destructive mt-0.5 shrink-0' />
          <p className='text-sm text-destructive leading-snug'>{error}</p>
        </div>
      )}

      <form onSubmit={handleLogin} className='space-y-5'>
        {/* Email */}
        <div className='space-y-1.5'>
          <Label htmlFor='email' className='text-foreground font-medium text-sm'>
            Correo electrónico
          </Label>
          <div className='relative'>
            <Mail className='absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
            <Input
              id='email'
              type='email'
              placeholder='tu@empresa.com'
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete='email'
              className='h-11 pl-10 pr-10 rounded-xl border-border bg-muted/50 text-foreground placeholder:text-muted-foreground/60
                         focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20
                         transition-all duration-200'
            />
            {email && (
              <button
                type='button'
                onClick={() => setEmail('')}
                className='absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-muted-foreground
                           hover:text-foreground hover:bg-muted transition-all duration-200'
                aria-label='Borrar correo'
              >
                <X className='h-4 w-4' />
              </button>
            )}
          </div>
        </div>

        {/* Password */}
        <div className='space-y-1.5'>
          <Label htmlFor='password' className='text-foreground font-medium text-sm'>
            Contraseña
          </Label>
          <div className='relative'>
            <Lock className='absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none' />
            <Input
              id='password'
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete='current-password'
              className='h-11 pl-10 pr-11 rounded-xl border-border bg-muted/50 text-foreground
                         focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20
                         transition-all duration-200'
            />
            <button
              type='button'
              onClick={() => setShowPassword(!showPassword)}
              className='absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-muted-foreground
                         hover:text-foreground hover:bg-muted transition-all duration-200'
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
            </button>
          </div>
        </div>

        {/* Recordar + olvidé mi contraseña */}
        <div className='flex items-center justify-between gap-2.5 pt-0.5'>
          <div className='flex items-center gap-2.5'>
            <Checkbox
              id='remember'
              checked={rememberEmail}
              onCheckedChange={checked => setRememberEmail(checked === true)}
              className='border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary'
            />
            <Label
              htmlFor='remember'
              className='text-muted-foreground text-sm cursor-pointer font-normal'
            >
              Recordar mi correo
            </Label>
          </div>
          <button
            type='button'
            onClick={() =>
              toast.info('Contacta a tu administrador para restablecer tu contraseña.')
            }
            className='text-sm font-medium text-primary hover:underline'
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        {/* Submit */}
        <Button
          type='submit'
          disabled={loading}
          className='w-full h-11 mt-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl
                     shadow-md shadow-foreground/20 transition-all duration-200
                     disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {loading ? (
            <span className='flex items-center gap-2'>
              <Loader2 className='w-4 h-4 animate-spin' />
              Ingresando...
            </span>
          ) : (
            <span className='flex items-center gap-2'>
              Iniciar sesión
              <ArrowRight className='h-4 w-4' />
            </span>
          )}
        </Button>
      </form>
      <SsoButtons />
      <div className='mt-6 flex items-start gap-3 rounded-xl  p-3.5'>
        <ShieldCheck className='mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--brand-accent))]' />
        <p className='text-xs leading-relaxed text-muted-foreground'>
          <span className='font-medium text-foreground'>Acceso seguro. </span>
          Tu información está protegida con los más altos estándares de seguridad.
        </p>
      </div>
    </div>
  );
}
