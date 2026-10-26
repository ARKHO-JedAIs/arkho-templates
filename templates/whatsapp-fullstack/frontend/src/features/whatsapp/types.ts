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
}

export interface WhatsAppTemplate {
  name: string;
  language: string;
  category: string;
  /** The body text, with WhatsApp's numbered variables in double braces. */
  body: string;
  /** How many body variables must be filled in. */
  variables: number;
}

export interface SendTemplateInput {
  phone: string;
  templateName: string;
  language: string;
  parameters: string[];
}
