/**
 * Runtime configuration for the chat section.
 *
 * The generator pre-fills `VITE_CHAT_CAPABILITIES` from the capabilities picked
 * at generation time, but these stay runtime flags on purpose: voice and images
 * share `ChatInput.tsx`, and a team that skipped one can turn it on later -
 * once the matching backend endpoint exists - without regenerating the project.
 * See README "Chat backend contract".
 */
/**
 * Parses the comma-separated capability list.
 *
 * Exported and taking its input as an argument rather than reading the
 * environment itself, so it can be tested with plain assertions instead of
 * module-registry gymnastics.
 *
 * Tolerant on purpose: whitespace and casing vary by hand-edited `.env`, and an
 * empty list is a valid answer - it means a text-only chat.
 */
export function parseCapabilities(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

const enabled = parseCapabilities(import.meta.env.VITE_CHAT_CAPABILITIES);

export const chatConfig = {
  /** POST {apiUrl}/chat -> SSE stream. Required for the chat section to work at all. */
  apiUrl: import.meta.env.VITE_AGENT_CHAT_API_URL ?? '',
  /** POST {imagesUploadUrl} -> presigned S3 PUT targets. Only needed when images are on. */
  imagesUploadUrl: import.meta.env.VITE_CHAT_IMAGES_UPLOAD_URL ?? '',
  /** Push-to-talk dictation via Amazon Transcribe streaming. Needs a Cognito identity pool. */
  voiceEnabled: enabled.has('voice'),
  /** Image attachments uploaded straight to S3 with a presigned URL. */
  imagesEnabled: enabled.has('images'),
} as const;
