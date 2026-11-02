import { Button } from '@/components/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { AlertCircle, Home } from 'lucide-react';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className='flex flex-col items-center justify-center h-full min-h-[60vh] p-4'>
      <div className='flex flex-col items-center text-center max-w-md'>
        <AlertCircle className='h-16 w-16 text-amber-500 mb-4' />
        <h1 className='text-3xl font-bold mb-2'>Página no encontrada</h1>
        <p className='text-muted-foreground mb-6'>La página que buscas no existe o fue movida.</p>
        <div className='flex gap-4'>
          <Button onClick={() => navigate({ to: '/' })} className='flex items-center gap-2'>
            <Home className='h-4 w-4' />
            Volver al inicio
          </Button>
          <Button variant='outline' onClick={() => window.history.back()}>
            Volver atrás
          </Button>
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;
