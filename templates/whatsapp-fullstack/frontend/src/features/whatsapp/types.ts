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
  | 'unsupported';

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
  parameters: string[];
}

/**
 * A new template as the creator submits it, in the shape `GET /whatsapp/templates`
 * returns, so the demo list can hold it as is. There is no create endpoint yet.
 */
export interface CreateTemplateInput {
  name: string;
  language: string;
  category: string;
  header: string | null;
  body: string;
  footer: string | null;
  buttons: TemplateButton[];
  variableNames: string[];
  parameterFormat: 'POSITIONAL' | 'NAMED';
}
