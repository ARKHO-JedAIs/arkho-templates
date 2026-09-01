import { useCallback, useRef, useState } from 'react';
import { AgentChatAuthError, streamAgentChat } from '../services/agentChatService';
import { createTypewriter } from '../utils/createTypewriter';
import type { ChatMessage } from '../types/chat.types';

const GENERIC_ERROR_MESSAGE =
  'No se pudo conectar con el asistente. Verifica tu conexión e intenta de nuevo.';

/**
 * Owns one chat conversation: the message list, the persistent `sessionId` the
 * backend keys its conversational memory off of, and the SSE streaming
 * lifecycle (sending, in-progress chunks, completion, errors).
 *
 * The sessionId is per-conversation, not per-message, so it has to stay stable
 * across sends. It is state rather than a ref because the backend can close a
 * conversation mid-stream (`startNewSession`) and the replacement id has to
 * reach consumers - image uploads scope their S3 keys by it.
 */
export function useAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const abortRef = useRef<AbortController | null>(null);

  const updateMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages(prev =>
      prev.map(message => (message.id === id ? { ...message, ...patch } : message))
    );
  }, []);

  const sendMessage = useCallback(
    async (rawText: string, attachments?: { s3Key: string; previewUrl: string }[]) => {
      const text = rawText.trim();
      if ((!text && !attachments?.length) || isStreaming) return;

      setAuthError(false);

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: text,
        status: 'done',
        timestamp: Date.now(),
        attachments: attachments?.map(a => ({ previewUrl: a.previewUrl })),
      };
      const assistantId = crypto.randomUUID();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      // Reveals the assistant's text at a steady, readable pace - decoupled
      // from raw network chunk timing, which can otherwise finish a short reply
      // in well under a second and look like it never streamed at all.
      const typewriter = createTypewriter({
        onReveal: chunk => {
          setMessages(prev =>
            prev.map(message =>
              message.id === assistantId
                ? { ...message, content: message.content + chunk }
                : message
            )
          );
        },
      });

      try {
        await streamAgentChat({
          message: text,
          sessionId,
          imageKeys: attachments?.map(a => a.s3Key),
          signal: controller.signal,
          onEvent: event => {
            if ('chunk' in event) {
              typewriter.push(event.chunk);
            } else if ('error' in event) {
              typewriter.stop();
              updateMessage(assistantId, { content: event.error, status: 'error' });
            } else if ('done' in event) {
              if (event.startNewSession) {
                // The backend considers this conversation finished - drop back
                // to a blank chat rather than appending the next turn to a
                // thread the agent has already closed out.
                typewriter.stop();
                setMessages([]);
                setSessionId(crypto.randomUUID());
              } else {
                typewriter.finish().then(() => updateMessage(assistantId, { status: 'done' }));
              }
            }
          },
        });
        await typewriter.finish();
      } catch (error) {
        typewriter.stop();
        if (error instanceof AgentChatAuthError) {
          setAuthError(true);
          updateMessage(assistantId, { content: error.message, status: 'error' });
        } else if (error instanceof DOMException && error.name === 'AbortError') {
          // Cancelled on purpose (e.g. unmount) - nothing to show.
        } else {
          updateMessage(assistantId, { content: GENERIC_ERROR_MESSAGE, status: 'error' });
        }
      } finally {
        // Safety net: a stream that ended without an explicit done/error event
        // must not leave the bubble stuck mid-stream.
        setMessages(prev =>
          prev.map(message =>
            message.id === assistantId && message.status === 'streaming'
              ? { ...message, status: 'done' }
              : message
          )
        );
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, updateMessage, sessionId]
  );

  return { messages, isStreaming, authError, sendMessage, sessionId };
}
