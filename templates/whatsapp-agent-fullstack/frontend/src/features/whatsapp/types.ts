/** Who answers a conversation: the automatic replies, or a person from the web. */
export type ControlMode = 'assistant' | 'human';

/** One WhatsApp contact, as the inbox lists it (`GET /whatsapp/conversations`). */
export interface Conversation {
  /** E.164 digits without "+": the conversation's id and its realtime channel. */
  phone: string;
  /** The contact's WhatsApp profile name, when they have written. */
  name: string;
  lastMessage: string;
  lastMessageAt: string | null;
  lastDirection: 'inbound' | 'outbound' | null;
  /** When the contact last wrote: free-form replies are allowed for 24 hours after. */
  lastInboundAt: string | null;
  mode: ControlMode;
  takenByName: string | null;
  /** Customer messages nobody has read yet; reset when someone opens the conversation. */
  unreadCount: number;
}

/** Where a message we sent is, as WhatsApp reports it. */
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

/** What a message is, as the backend normalizes it (docs/WHATSAPP_EVENTS.md). */
export type MessageKind =
  | 'text'
  | 'template'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'button_reply'
  | 'list_reply'
  | 'nfm_reply'
  | 'button'
  | 'order'
  | 'system'
  | 'request_welcome'
  | 'unsupported'
  /** An internal notice of the inbox (a person took the conversation...). */
  | 'event';

/** What an internal notice (`kind: 'event'`) says happened. */
export interface InboxEvent {
  kind: 'human_takeover' | 'assistant_resumed' | (string & {});
  /** Who did it: a username or an email. */
  by: string;
}

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

/** The file of an image, audio, video, document or sticker message. */
export interface MessageMedia {
  /** Presigned and short-lived; `null` when the file could not be stored. */
  url: string | null;
  mimeType: string;
  /** Bytes. */
  size: number | null;
  filename: string | null;
  caption: string | null;
  /** Why there is no file (`download_failed`...). */
  error: string | null;
  /** An audio recorded as a voice note. */
  voice?: boolean;
}

export interface LocationPayload {
  latitude: number;
  longitude: number;
  name: string;
  address: string;
}

export interface ContactCard {
  name: string;
  phones: string[];
  emails: string[];
  org: string;
}

/** The option a contact picked from buttons, a list or a template quick reply. */
export interface ReplyPayload {
  id: string;
  title: string;
  description?: string;
}

/** What a contact submitted in a WhatsApp Flow. */
export interface FlowReply {
  body: string;
  fields: { key: string; value: string }[];
}

export interface OrderPayload {
  catalogId: string;
  text: string;
  items: { id: string; quantity: number; price: number | null; currency: string }[];
}

/** The ad or post a conversation started from. */
export interface Referral {
  sourceType: string;
  headline: string;
  sourceUrl: string;
}

/** One message of a conversation, as the thread draws it. */
export interface ChatMessage {
  /** Stable across reloads and realtime events: what de-duplicates them. */
  id: string;
  /** `in`: the contact. `out`: our side (automatic reply, a person, a template). */
  direction: 'in' | 'out';
  kind: MessageKind;
  /** The readable text: the body, a caption, a title, or the backend's placeholder. */
  text: string;
  media?: MessageMedia;
  location?: LocationPayload;
  contacts?: ContactCard[];
  reply?: ReplyPayload;
  flow?: FlowReply;
  order?: OrderPayload;
  /** `kind: 'event'` only. */
  event?: InboxEvent;
  /** The contact's reaction to this message. */
  reaction?: string;
  /** The id of the message this one answers or quotes. */
  replyTo?: string;
  referral?: Referral;
  forwarded?: boolean;
  /** The contact deleted it. */
  deleted?: boolean;
  /** ISO-8601. */
  timestamp: string;
  /** A person wrote it from the web: their name or email. */
  sentBy?: string;
  /** Our side only: the latest delivery status WhatsApp reported. */
  status?: MessageStatus;
  /** Why it failed, when `status` is `failed`. */
  error?: string;
  /** `kind: 'template'` only: which template was sent, for the bubble's badge. */
  templateName?: string;
  templateLanguage?: string;
}

/**
 * Where a template stands in Meta's review. Meta may add states; anything else
 * arrives as is and the UI shows it as unknown.
 */
export type TemplateStatus = 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';

/** Meta's quality rating, from the readers' reactions to the template. */
export type TemplateQuality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export interface TemplateButton {
  /** `QUICK_REPLY`, `URL`, `PHONE_NUMBER`... */
  type: string;
  text: string;
  /** URL buttons; may end with a variable filled when sending. */
  url?: string;
  /** Phone buttons. */
  phoneNumber?: string;
  /** Copy-code buttons: the sample code. */
  example?: string;
}

/** One message template of the WhatsApp Business account (`GET /whatsapp/templates`). */
export interface WhatsAppTemplate {
  name: string;
  language: string;
  /** `UTILITY`, `MARKETING` or `AUTHENTICATION`. */
  category: string;
  status: TemplateStatus | (string & {});
  qualityScore: TemplateQuality;
  metaTemplateId: string | null;
  header: string | null;
  /** The body text, with WhatsApp's variables in double braces (numbered or named). */
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  /** How many body variables must be filled in. */
  variables: number;
  /** The variables in the order their values are sent: `1`, `2`... or the names. */
  variableNames: string[];
  /** `POSITIONAL`: numbered variables, filled in order. `NAMED`: by name. */
  parameterFormat: 'POSITIONAL' | 'NAMED';
  /** `null` without header. */
  headerFormat: TemplateHeaderFormat | null;
  /** The variable of a text header (at most one). */
  headerVariableNames: string[];
  /** Meta's handle of the sample file of a media header, for editing. */
  headerHandle: string | null;
  /** The sample values Meta reviewed, keyed like `TemplateRequest.examples`. */
  examples: Record<string, string>;
}

/** A file uploaded to the media bucket, ready to send (`POST /whatsapp/messages`). */
export interface OutboundMedia {
  key: string;
  mimeType: string;
  filename?: string;
  caption?: string;
}

export interface SendTemplateInput {
  phone: string;
  templateName: string;
  language: string;
  /** The body variables, in order. */
  parameters: string[];
  /** The header variable, when the template's text header has one. */
  headerText?: string;
  /** The header file, when the template has an image, video or document header. */
  headerFile?: { file: File; mimeType: string };
  /** The suffix of each URL button whose address ends with a variable. */
  buttons?: { index: number; text: string }[];
}

/** The header kinds a template can have. */
export type TemplateHeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';

/**
 * A template as `POST /whatsapp/templates` and `PUT /whatsapp/templates/{id}`
 * take it (`common/whatsapp/templates.py`). `examples` are keyed
 * `header:<variable>`, `body:<variable>` and `button:<index>`.
 */
export interface TemplateRequest {
  name: string;
  language: string;
  /** Omitted on an edit that keeps the category. */
  category?: string;
  parameterFormat: 'POSITIONAL' | 'NAMED';
  header:
    | { format: 'TEXT'; text: string }
    | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; handle: string }
    | null;
  body: string;
  footer: string | null;
  buttons: { type: string; text: string; url?: string; phone?: string; code?: string }[];
  examples: Record<string, string>;
}
