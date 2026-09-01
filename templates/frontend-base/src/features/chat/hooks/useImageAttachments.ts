import { useCallback, useRef, useState } from 'react';
import { requestChatImageUploadUrls } from '../services/agentChatService';
import type { ChatAttachment } from '../types/chat.types';

const MAX_FILES = 10;
// Generous for camera photos (HEIC/HEIF originals from a phone are often 5-10MB).
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

/**
 * Owns image attachments for one message being composed: instant local
 * previews, background upload straight to S3 via a presigned URL (starts the
 * moment a file is picked, not on send), and per-file progress/removal.
 * Only ever produces `{ s3Key, previewUrl }` pairs for the caller to send -
 * never touches the chat request itself.
 */
export function useImageAttachments(sessionId: string) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  attachmentsRef.current = attachments;
  const xhrByIdRef = useRef(new Map<string, XMLHttpRequest>());

  const exists = useCallback((id: string) => attachmentsRef.current.some(a => a.id === id), []);

  const updateAttachment = useCallback(
    (id: string, patch: Partial<ChatAttachment>) => {
      if (!exists(id)) return;
      setAttachments(prev => prev.map(a => (a.id === id ? { ...a, ...patch } : a)));
    },
    [exists]
  );

  const uploadFile = useCallback(
    (attachment: ChatAttachment, target: { s3Key: string; uploadUrl: string }) => {
      const xhr = new XMLHttpRequest();
      xhrByIdRef.current.set(attachment.id, xhr);

      xhr.upload.onprogress = event => {
        if (!event.lengthComputable) return;
        updateAttachment(attachment.id, {
          progress: Math.round((event.loaded / event.total) * 100),
        });
      };
      xhr.onload = () => {
        xhrByIdRef.current.delete(attachment.id);
        const ok = xhr.status >= 200 && xhr.status < 300;
        updateAttachment(
          attachment.id,
          ok ? { status: 'uploaded', progress: 100, s3Key: target.s3Key } : { status: 'error' }
        );
      };
      xhr.onerror = () => {
        xhrByIdRef.current.delete(attachment.id);
        updateAttachment(attachment.id, { status: 'error' });
      };
      xhr.onabort = () => {
        xhrByIdRef.current.delete(attachment.id);
      };

      xhr.open('PUT', target.uploadUrl);
      xhr.setRequestHeader('Content-Type', attachment.file.type);
      xhr.send(attachment.file);
    },
    [updateAttachment]
  );

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const room = MAX_FILES - attachmentsRef.current.length;
      if (room <= 0) return;
      const incoming = Array.from(fileList).slice(0, room);
      if (incoming.length === 0) return;

      const newAttachments: ChatAttachment[] = incoming.map(file => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: file.size > MAX_FILE_SIZE_BYTES ? 'error' : 'uploading',
        progress: 0,
      }));

      setAttachments(prev => [...prev, ...newAttachments]);

      const uploadable = newAttachments.filter(a => a.status === 'uploading');
      if (uploadable.length === 0) return;

      try {
        const targets = await requestChatImageUploadUrls(
          uploadable.map(a => ({ filename: a.file.name, contentType: a.file.type })),
          sessionId
        );
        uploadable.forEach((attachment, index) => {
          const target = targets[index];
          if (!exists(attachment.id)) return;
          if (target) {
            uploadFile(attachment, target);
          } else {
            updateAttachment(attachment.id, { status: 'error' });
          }
        });
      } catch {
        uploadable.forEach(attachment => updateAttachment(attachment.id, { status: 'error' }));
      }
    },
    [exists, sessionId, updateAttachment, uploadFile]
  );

  const removeAttachment = useCallback((id: string) => {
    const attachment = attachmentsRef.current.find(a => a.id === id);
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
    xhrByIdRef.current.get(id)?.abort();
    xhrByIdRef.current.delete(id);
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const reset = useCallback(() => {
    attachmentsRef.current.forEach(a => URL.revokeObjectURL(a.previewUrl));
    xhrByIdRef.current.forEach(xhr => xhr.abort());
    xhrByIdRef.current.clear();
    setAttachments([]);
  }, []);

  const isUploading = attachments.some(a => a.status === 'uploading');
  const uploadedTargets = attachments
    .filter((a): a is ChatAttachment & { s3Key: string } => a.status === 'uploaded' && !!a.s3Key)
    .map(a => ({ s3Key: a.s3Key, previewUrl: a.previewUrl }));

  return { attachments, addFiles, removeAttachment, reset, isUploading, uploadedTargets };
}
