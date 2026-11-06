import { useEffect, useRef, useState } from 'react';
import { confirmOtp } from '@/lib/auth/session';
import type { OtpMethod, SignInResult } from '@/lib/auth/types';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CODE_LENGTH = 6;
/** Debounce for the resend button, not a Cognito/SES limit - it only avoids a
 * user firing several fresh codes in a row while the previous email is still
 * in flight. */
const RESEND_COOLDOWN_SECONDS = 30;

const METHOD_COPY: Record<OtpMethod, string> = {
  sms: 'Ingresa el código de 6 dígitos que enviamos por SMS',
  email: 'Ingresa el código de 6 dígitos que enviamos a tu correo',
  totp: 'Ingresa el código de 6 dígitos de tu app autenticadora',
};

interface OtpFormProps {
  method: OtpMethod;
  /** Masked phone/email from Cognito's codeDeliveryDetails - not present for
   * `totp`, which never sends anything to deliver. */
  destination?: string;
  /** Any further challenge (e.g. a second factor) funnels through the same
   * result-handling the credentials/new-password steps already use. */
  onResult: (result: SignInResult) => void;
  /** Restarts the challenge to get a fresh code - Cognito has no "resend" call
   * for a sign-in MFA step, only a new InitiateAuth. */
  onResend: () => Promise<void>;
  onCancel: () => void;
}

/** Third step of the sign-in flow: the MFA challenge Cognito raises after a
 * correct password (or right after a first-login password reset - see
 * NewPasswordForm, which can land here too). */
export function OtpForm({ method, destination, onResult, onResend, onCancel }: OtpFormProps) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown(seconds => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const code = digits.join('');
  const canSubmit = code.length === CODE_LENGTH && !loading;

  function setDigitAt(index: number, value: string) {
    setDigits(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleChange(index: number, raw: string) {
    const value = raw.replace(/\D/g, '');
    if (!value) {
      setDigitAt(index, '');
      return;
    }
    // A fast typist (or an autofill) can land more than one digit in a single
    // box - spill the rest into the following ones instead of dropping them.
    const chars = value.split('');
    setDigits(prev => {
      const next = [...prev];
      chars.forEach((char, offset) => {
        if (index + offset < CODE_LENGTH) next[index + offset] = char;
      });
      return next;
    });
    const nextIndex = Math.min(index + chars.length, CODE_LENGTH - 1);
    inputRefs.current[nextIndex]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setDigitAt(index - 1, '');
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    setDigits(prev => {
      const next = [...prev];
      pasted.split('').forEach((char, i) => {
        next[i] = char;
      });
      return next;
    });
    inputRefs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    try {
      const result = await confirmOtp(code);
      onResult(result);
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (message.includes('Invalid code') || message.includes('CodeMismatch')) {
        setError('El código no es válido. Intenta nuevamente.');
      } else if (message.includes('expired') || message.includes('ExpiredCode')) {
        setError('El código expiró. Vuelve a iniciar sesión para recibir uno nuevo.');
      } else {
        setError('No se pudo verificar el código. Intenta nuevamente.');
      }
      setDigits(Array(CODE_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resending || resendCooldown > 0) return;
    setResending(true);
    setError(null);

    try {
      await onResend();
      setDigits(Array(CODE_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      if (message.includes('LimitExceeded') || message.includes('TooManyRequests')) {
        setError('Demasiados intentos. Espera unos minutos e intenta nuevamente.');
      } else {
        setError('No se pudo reenviar el código. Intenta nuevamente.');
      }
    } finally {
      setResending(false);
    }
  }

  return (
    <div>
      <div className='mb-7 flex items-start gap-3'>
        <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary'>
          <ShieldCheck className='h-5 w-5' aria-hidden />
        </div>
        <div>
          <h2 className='text-2xl font-bold text-foreground leading-tight'>
            Verifica tu identidad
          </h2>
          <p className='text-muted-foreground text-sm mt-1.5'>
            {METHOD_COPY[method]}
            {destination ? (
              <>
                {' '}
                a <span className='font-medium text-foreground'>{destination}</span>
              </>
            ) : (
              '.'
            )}
          </p>
        </div>
      </div>

      {error && (
        <div className='mb-5 flex items-start gap-2.5 p-3.5 rounded-xl bg-destructive/10 border border-destructive/20'>
          <AlertCircle className='w-4 h-4 text-destructive mt-0.5 shrink-0' />
          <p className='text-sm text-destructive leading-snug'>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className='space-y-6'>
        <div className='flex justify-center gap-2.5 sm:gap-3.5' onPaste={handlePaste}>
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={el => {
                inputRefs.current[index] = el;
              }}
              type='text'
              inputMode='numeric'
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              maxLength={CODE_LENGTH}
              value={digit}
              onChange={e => handleChange(index, e.target.value)}
              onKeyDown={e => handleKeyDown(index, e)}
              aria-label={`Dígito ${index + 1} de ${CODE_LENGTH}`}
              className='h-12 w-11 sm:h-14 sm:w-12 shrink-0 rounded-xl border border-border bg-muted/50 text-center text-lg
                         font-semibold text-foreground focus:bg-background focus:border-primary
                         focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200'
            />
          ))}
        </div>

        <Button
          type='submit'
          disabled={!canSubmit}
          className='w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-xl
                     shadow-md shadow-foreground/20 transition-all duration-200
                     disabled:opacity-60 disabled:cursor-not-allowed'
        >
          {loading ? (
            <span className='flex items-center gap-2'>
              <Loader2 className='w-4 h-4 animate-spin' />
              Verificando...
            </span>
          ) : (
            'Verificar'
          )}
        </Button>
      </form>

      {method !== 'totp' && (
        <div className='mt-5 text-center text-xs text-muted-foreground'>
          {resendCooldown > 0 ? (
            <span>Podrás reenviar el código en {resendCooldown}s</span>
          ) : (
            <>
              ¿No recibiste el código?{' '}
              <button
                type='button'
                onClick={handleResend}
                disabled={resending}
                className='font-medium text-primary hover:underline disabled:opacity-60 disabled:no-underline'
              >
                {resending ? 'Reenviando...' : 'Reenviar código'}
              </button>
            </>
          )}
        </div>
      )}

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

export default OtpForm;
