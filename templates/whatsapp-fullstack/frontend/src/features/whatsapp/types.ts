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

/** One message of a conversation, as the thread draws it. */
export interface ChatMessage {
  /** Stable across reloads and realtime events: what de-duplicates them. */
  id: string;
  /** `in`: the contact. `out`: our side (automatic reply, a person, a template). */
  direction: 'in' | 'out';
  kind: 'text' | 'template' | 'other';
  text: string;
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
