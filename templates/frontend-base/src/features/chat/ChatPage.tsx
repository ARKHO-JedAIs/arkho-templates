import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ChatInput } from './components/ChatInput';
import { ChatMessageList } from './components/ChatMessageList';
import { useAgentChat } from './hooks/useAgentChat';

export default function ChatPage() {
  const navigate = useNavigate();
  const { messages, isStreaming, authError, sendMessage, sessionId } = useAgentChat();

  useEffect(() => {
    if (!authError) return;
    toast.error('Tu sesión expiró. Vuelve a iniciar sesión.');
    navigate({ to: '/login' });
  }, [authError, navigate]);

  return (
    <div className='h-full flex flex-col bg-card border border-border rounded-2xl overflow-hidden'>
      <div className='flex-1 overflow-y-auto px-3 sm:px-4'>
        <ChatMessageList messages={messages} />
      </div>

      <div>
        <ChatInput disabled={isStreaming} sessionId={sessionId} onSend={sendMessage} />
        <p className='text-center text-xs text-muted-foreground py-2 px-3'>
          El asistente puede cometer errores. Verifica la información importante.
        </p>
      </div>
    </div>
  );
}
