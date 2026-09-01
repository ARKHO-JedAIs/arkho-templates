import { useEffect, useRef } from 'react';
import { MessageSquare } from 'lucide-react';
import { ChatMessageBubble } from './ChatMessageBubble';
import type { ChatMessage } from '../types/chat.types';

interface ChatMessageListProps {
  messages: ChatMessage[];
}

function WelcomeScreen() {
  return (
    <div className='flex flex-col items-center justify-center h-full text-center px-4 py-8'>
      <div className='w-12 h-12 rounded-full bg-muted border border-border flex items-center justify-center mb-3'>
        <MessageSquare className='w-5 h-5 text-primary' />
      </div>
      <p className='text-foreground font-medium'>Pregúntale al asistente</p>
      <p className='text-muted-foreground text-sm mt-1 max-w-xs'>
        Cuéntale qué necesitas y te irá guiando.
      </p>
    </div>
  );
}

export function ChatMessageList({ messages }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return <WelcomeScreen />;
  }

  return (
    <div className='flex flex-col gap-3 py-4'>
      {messages.map(message => (
        <ChatMessageBubble key={message.id} message={message} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
