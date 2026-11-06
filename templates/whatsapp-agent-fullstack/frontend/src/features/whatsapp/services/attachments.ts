import type { MediaKind } from '../types';

const MB = 1024 * 1024;

/**
 * What WhatsApp accepts per message type, mirrored from the backend
 * (`common/whatsapp/media.py`, OUTBOUND_LIMITS), which checks again: AWS End
 * User Messaging Social "Supported media file types and sizes" and Meta's
 * "Supported media types". Stickers can be received, not sent from here.
 */
export const ATTACHMENT_LIMITS: Record<
  Exclude<MediaKind, 'sticker'>,
  { maxBytes: number; mimeTypes: string[] }
> = {
  image: { maxBytes: 5 * MB, mimeTypes: ['image/jpeg', 'image/png'] },
  audio: {
    maxBytes: 16 * MB,
    mimeTypes: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
  },
  video: { maxBytes: 16 * MB, mimeTypes: ['video/mp4', 'video/3gpp'] },
  document: {
    maxBytes: 100 * MB,
    mimeTypes: [
      'text/plain',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  },
};

/** Browsers leave `File.type` empty for some formats (.amr, .3gp): the extension decides then. */
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  aac: 'audio/aac',
  amr: 'audio/amr',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  txt: 'text/plain',
  pdf: 'application/pdf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** The `accept` of the file picker: every type WhatsApp takes. */
export const ATTACHMENT_ACCEPT = [
  ...Object.values(ATTACHMENT_LIMITS).flatMap(limit => limit.mimeTypes),
  ...Object.keys(BY_EXTENSION).map(extension => `.${extension}`),
].join(',');

/** The MIME type a file is uploaded with: its own, or the one of its extension. */
export function attachmentMimeType(file: { name: string; type: string }): string {
  const own = file.type.split(';')[0]!.trim().toLowerCase();
  // Some systems label .3gp as video/3gp; WhatsApp's name is video/3gpp.
  if (own === 'video/3gp') return 'video/3gpp';
  if (own) return own;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? '';
}

export type AttachmentCheck =
  | { ok: true; kind: Exclude<MediaKind, 'sticker'>; mimeType: string }
  | { ok: false; error: string };

const KIND_LABEL: Record<Exclude<MediaKind, 'sticker'>, string> = {
  image: 'Una imagen',
  audio: 'Un audio',
  video: 'Un video',
  document: 'Un documento',
};

/** Whether WhatsApp takes the file, and as which message type. */
export function checkAttachment(file: {
  name: string;
  type: string;
  size: number;
}): AttachmentCheck {
  const mimeType = attachmentMimeType(file);
  const entry = (
    Object.entries(ATTACHMENT_LIMITS) as [
      Exclude<MediaKind, 'sticker'>,
      { maxBytes: number; mimeTypes: string[] },
    ][]
  ).find(([, limit]) => limit.mimeTypes.includes(mimeType));
  if (!entry) {
    return {
      ok: false,
      error: 'WhatsApp no acepta este tipo de archivo. Usa JPG, PNG, MP4, MP3, OGG, PDF u Office.',
    };
  }
  const [kind, limit] = entry;
  if (file.size <= 0) return { ok: false, error: 'El archivo está vacío.' };
  if (file.size > limit.maxBytes) {
    return {
      ok: false,
      error: `${KIND_LABEL[kind]} puede pesar como máximo ${limit.maxBytes / MB} MB.`,
    };
  }
  return { ok: true, kind, mimeType };
}
