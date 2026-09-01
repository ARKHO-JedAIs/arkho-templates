import { useState } from 'react';
import { Bot, Check, Copy, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '../types/chat.types';

function TypingDots() {
  return (
    <span
      className='inline-flex items-center gap-1 py-1'
      aria-label='El asistente está escribiendo'
    >
      <span className='w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.3s]' />
      <span className='w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce [animation-delay:-0.15s]' />
      <span className='w-1.5 h-1.5 rounded-full bg-primary/70 animate-bounce' />
    </span>
  );
}

function MessageAvatar({ isUser }: { isUser: boolean }) {
  return (
    <div
      className={cn(
        'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
        isUser ? 'bg-primary' : 'bg-muted border border-border'
      )}
    >
      {isUser ? <User className='w-4 h-4 text-white' /> : <Bot className='w-4 h-4 text-primary' />}
    </div>
  );
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.status === 'error';
  const isStreaming = message.status === 'streaming';
  const isEmptyWhileStreaming = isStreaming && message.content.length === 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success('Mensaje copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('No se pudo copiar el mensaje');
    }
  };

  return (
    <div
      className={cn(
        'flex w-full gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200 ease-out',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      {!isUser && <MessageAvatar isUser={false} />}

      <div className={cn('flex flex-col max-w-[85%] sm:max-w-[75%]', isUser && 'items-end')}>
        {!!message.attachments?.length && (
          <div className={cn('flex flex-wrap gap-1.5 mb-1.5', isUser && 'justify-end')}>
            {message.attachments.map((attachment, index) => (
              <img
                key={index}
                src={attachment.previewUrl}
                alt=''
                className='w-20 h-20 rounded-lg object-cover border border-border'
              />
            ))}
          </div>
        )}

        {(!!message.content || !message.attachments?.length) && (
          <div
            className={cn(
              'rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words shadow-sm',
              isUser && 'bg-primary text-primary-foreground rounded-br-sm',
              !isUser && !isError && 'bg-muted border border-border text-foreground rounded-bl-sm',
              isError && 'bg-muted border border-destructive text-destructive rounded-bl-sm'
            )}
          >
            {isEmptyWhileStreaming ? (
              <TypingDots />
            ) : isUser || isError ? (
              <p className='whitespace-pre-wrap'>{message.content}</p>
            ) : (
              <div
                className={cn(
                  isStreaming &&
                    'after:content-["▍"] after:ml-0.5 after:animate-pulse after:text-primary'
                )}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p className='mb-2 last:mb-0'>{children}</p>,
                    ul: ({ children }) => (
                      <ul className='mb-2 last:mb-0 list-disc pl-5 space-y-0.5'>{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className='mb-2 last:mb-0 list-decimal pl-5 space-y-0.5'>{children}</ol>
                    ),
                    strong: ({ children }) => (
                      <strong className='font-semibold text-foreground'>{children}</strong>
                    ),
                    a: ({ children, href }) => (
                      <a
                        href={href}
                        target='_blank'
                        rel='noreferrer'
                        className='text-primary underline underline-offset-2'
                      >
                        {children}
                      </a>
                    ),
                    code: ({ children }) => (
                      <code className='bg-muted rounded px-1 py-0.5 text-foreground text-xs'>
                        {children}
                      </code>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className='border-l-2 border-border pl-3 italic text-muted-foreground my-2'>
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <div className='overflow-x-auto my-2 rounded-lg border border-border'>
                        <table className='min-w-full divide-y divide-border text-xs'>
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className='bg-muted px-3 py-2 text-left font-semibold text-foreground'>
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className='px-3 py-2 border-t border-border'>{children}</td>
                    ),
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {!isEmptyWhileStreaming && (
          <div className='flex items-center gap-2 mt-1 px-1 h-5'>
            <span className='text-xs text-muted-foreground'>
              {formatTimestamp(message.timestamp)}
            </span>
            {!isUser && !isStreaming && (
              <button
                type='button'
                onClick={handleCopy}
                aria-label='Copiar mensaje'
                className={cn(
                  'w-5 h-5 flex items-center justify-center rounded transition-colors',
                  copied ? 'text-success' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {copied ? <Check className='w-3.5 h-3.5' /> : <Copy className='w-3.5 h-3.5' />}
              </button>
            )}
          </div>
        )}
      </div>

      {isUser && <MessageAvatar isUser />}
    </div>
  );
}
