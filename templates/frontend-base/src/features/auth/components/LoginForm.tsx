import { useEffect, useState } from 'react';
import { signIn } from '@/lib/auth/session';
import { useNavigate } from '@tanstack/react-router';
import useAuthStore from '@/lib/stores/useAuthStore';
import { Eye, EyeOff, Loader2, Mail, Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { NewPasswordForm } from './NewPasswordForm';

const REMEMBERED_EMAIL_KEY = 'remembered-email';

export function LoginForm() {
  const navigate = useNavigate();
  const { checkAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberEmail, setRememberEmail] = useState(false);
  /** Set when Cognito answers sign-in with NEW_PASSWORD_REQUIRED, which puts
   * the flow into its second step instead of finishing here. */
  const [needsNewPassword, setNeedsNewPassword] = useState(false);

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

  /** Shared by both steps: refresh the store (which also resolves the user's
   * role) and land them on the app. */
  const finishSignIn = async () => {
    await checkAuth();
    navigate({ to: '/' });
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

      if (result.status === 'new-password-required') {
        setNeedsNewPassword(true);
        return;
      }

      await finishSignIn();
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

  if (needsNewPassword) {
    return (
      <NewPasswordForm
        email={email}
        onCompleted={async newPassword => {
          setPassword(newPassword);
          await finishSignIn();
        }}
        onCancel={() => {
          setNeedsNewPassword(false);
          setPassword('');
        }}
      />
    );
  }

  return (
    <div>
      {/* Heading */}
      <div className='mb-7'>
        <h2 className='text-2xl font-bold text-foreground leading-tight'>Iniciar sesión</h2>
        <p className='text-muted-foreground text-sm mt-1.5'>
          Ingresa tus credenciales para acceder
        </p>
      </div>

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
              className='h-11 pl-10 rounded-xl border-border bg-muted/50 text-foreground placeholder:text-muted-foreground/60
                         focus:bg-background focus:border-primary focus:ring-2 focus:ring-primary/20
                         transition-all duration-200'
            />
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

        {/* Recordar */}
        <div className='flex items-center gap-2.5 pt-0.5'>
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
            'Iniciar sesión'
          )}
        </Button>
      </form>

      {/* Footer del form */}
      <div className='mt-7 pt-5 border-t border-border'>
        <p className='text-center text-muted-foreground text-xs'>
          ¿Problemas para ingresar?{' '}
          <span className='text-primary font-medium'>Contacta a tu administrador</span>
        </p>
      </div>
    </div>
  );
}
