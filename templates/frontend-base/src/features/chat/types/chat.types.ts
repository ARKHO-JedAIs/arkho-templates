export type ChatMessageRole = 'user' | 'assistant';

export type ChatMessageStatus = 'streaming' | 'done' | 'error';

export type AttachmentStatus = 'uploading' | 'uploaded' | 'error';

/**
 * A single image attachment being (or already) uploaded directly to S3 via a
 * presigned URL - the chat request only ever carries its `s3Key`, never the
 * file itself.
 */
export interface ChatAttachment {
  id: string;
  file: File;
  previewUrl: string;
  status: AttachmentStatus;
  progress: number;
  s3Key?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  status: ChatMessageStatus;
  timestamp: number;
  /** Local object URLs only, purely to echo what was sent - never re-fetched from S3. */
  attachments?: { previewUrl: string }[];
}

/**
 * SSE event shapes the agent chat backend emits, one JSON object per
 * `data: ...` line. Only one of these keys is present per event.
 *
 * `startNewSession` lets the backend close out a conversation and ask the
 * frontend to mint a fresh sessionId instead of appending the next turn to a
 * thread the agent considers finished.
 */
export type AgentChatStreamEvent =
  | { chunk: string; sessionId: string }
  | { done: true; sessionId: string; startNewSession?: boolean }
  | { error: string; sessionId: string };
