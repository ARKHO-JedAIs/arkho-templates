import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { isMockAuth } from '@/lib/auth/session';

/**
 * The backend's realtime channel (AWS AppSync) for the WhatsApp conversations.
 *
 * The one module outside `src/lib/auth` that imports `aws-amplify`: everything
 * realtime goes through here, and it reuses the Cognito session the auth seam
 * already configured (AppSync accepts the user pool token).
 *
 * Channels: a contact's phone carries its conversation (`MESSAGE_RECEIVED`,
 * `MESSAGE_SENT`, `TEMPLATE_SENT`, `CONTROL_CHANGED`) and `inbox` carries the
 * conversation list (`CONVERSATION_UPDATED`). The payload is the stored item.
 *
 * Under mock auth the demo data publishes on an in-memory bus instead, so the
 * page behaves the same with no backend.
 */

export interface RealtimeEvent {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
}

type Listener = (event: RealtimeEvent) => void;

export const INBOX_CHANNEL = 'inbox';

const ON_EVENT = /* GraphQL */ `
  subscription OnEvent($id: ID!) {
    onEvent(id: $id) {
      id
      type
      message
      payload
      timestamp
    }
  }
`;

/** `live`: listening. `offline`: no realtime in this environment. `error`: it dropped. */
export type LiveState = 'connecting' | 'live' | 'offline' | 'error';

const demoListeners = new Map<string, Set<Listener>>();

/** Used by the demo data only: delivers an event to this tab's subscribers. */
export function publishDemoEvent(channel: string, type: string, payload: Record<string, unknown>) {
  for (const listener of demoListeners.get(channel) ?? []) listener({ id: channel, type, payload });
}

export function realtimeUrl(): string | null {
  const url = import.meta.env.VITE_APPSYNC_URL?.trim();
  return url && !isMockAuth ? url : null;
}

/** Whether this environment gets live updates at all (AppSync, or the demo bus). */
export const hasRealtime = () => isMockAuth || realtimeUrl() !== null;

/** `https://xxx.appsync-api.us-east-1.amazonaws.com/graphql` -> `us-east-1`. */
export function regionOf(url: string): string {
  return /appsync-api\.([a-z0-9-]+)\.amazonaws\.com/.exec(url)?.[1] ?? 'us-east-1';
}

// Amplify types graphql() against generated models this app does not have, so
// the subscription is typed by hand and its events are checked on arrival.
interface Subscribable {
  subscribe: (observer: {
    next: (value: { data?: { onEvent?: Record<string, unknown> } }) => void;
    error: (error: unknown) => void;
  }) => { unsubscribe: () => void };
}
interface GraphQLClient {
  graphql: (options: { query: string; variables: Record<string, unknown> }) => unknown;
}

let client: GraphQLClient | null = null;

function ensureClient(url: string): GraphQLClient {
  if (!client) {
    Amplify.configure({
      ...Amplify.getConfig(),
      API: { GraphQL: { endpoint: url, region: regionOf(url), defaultAuthMode: 'userPool' } },
    });
    client = generateClient() as unknown as GraphQLClient;
  }
  return client;
}

function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** Listens to one channel. Returns the function that stops it; `null` without realtime. */
export function subscribe(
  channel: string,
  onEvent: Listener,
  onError?: (error: unknown) => void
): (() => void) | null {
  if (isMockAuth) {
    const listeners = demoListeners.get(channel) ?? new Set<Listener>();
    listeners.add(onEvent);
    demoListeners.set(channel, listeners);
    return () => listeners.delete(onEvent);
  }

  const url = realtimeUrl();
  if (!url) return null;
  const observable = ensureClient(url).graphql({
    query: ON_EVENT,
    variables: { id: channel },
  }) as Subscribable;
  const subscription = observable.subscribe({
    next: value => {
      const raw = value.data?.onEvent;
      if (!raw || typeof raw.type !== 'string') return;
      onEvent({
        id: String(raw.id ?? channel),
        type: raw.type,
        payload: parsePayload(raw.payload),
      });
    },
    error: error => onError?.(error),
  });
  return () => subscription.unsubscribe();
}
