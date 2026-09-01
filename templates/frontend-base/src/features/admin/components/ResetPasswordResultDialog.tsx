import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ResetPasswordResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username: string | null;
  temporaryPassword: string | null;
}

export function ResetPasswordResultDialog({
  open,
  onOpenChange,
  username,
  temporaryPassword,
}: ResetPasswordResultDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!temporaryPassword) return;
    await navigator.clipboard.writeText(temporaryPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contraseña temporal generada</DialogTitle>
        </DialogHeader>

        <div className='flex flex-col gap-3 py-2'>
          <p className='text-sm text-muted-foreground'>
            Comparte esta contraseña con{' '}
            <span className='font-medium text-foreground'>{username}</span> por un canal seguro.
            Deberá cambiarla en su próximo ingreso.
          </p>
          <div className='flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5'>
            <code className='flex-1 font-mono text-sm text-foreground break-all'>
              {temporaryPassword}
            </code>
            <button
              type='button'
              onClick={handleCopy}
              aria-label='Copiar contraseña'
              className='p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors'
            >
              {copied ? <Check className='w-4 h-4 text-green-600' /> : <Copy className='w-4 h-4' />}
            </button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Listo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ResetPasswordResultDialog;
