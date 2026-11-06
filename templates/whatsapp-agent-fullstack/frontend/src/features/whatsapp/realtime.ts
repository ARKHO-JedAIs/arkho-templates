import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';
import { getIdToken, isMockAuth } from '@/lib/auth/session';

/**
 * The backend's realtime channel (AWS AppSync) for the WhatsApp conversations.
 *
 * The one module outside `src/lib/auth` that imports `aws-amplify`: everything
 * realtime goes through here. It subscribes in AppSync's Lambda mode with the
 * Cognito ID token: the backend's authorizer checks that a role of the user
 * has the inbox (`whatsapp` permission), so any role given it gets live updates.
 *
 * Channels: a contact's phone carries its conversation (`MESSAGE_RECEIVED`,
 * `MESSAGE_SENT`, `TEMPLATE_SENT`, `MESSAGE_STATUS`, `MESSAGE_UPDATED`,
 * `CONTROL_CHANGED`, `CONVERSATION_EVENT`) and `inbox` carries the
 * conversation list (`CONVERSATION_UPDATED`, with `unreadCount`). The payload
 * is the stored item.
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
  graphql: (options: {
    query: string;
    variables: Record<string, unknown>;
    authMode?: 'lambda' | 'userPool';
    authToken?: string;
  }) => unknown;
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

/** Waits before each new attempt after a dropped subscription: 1 s, 2 s, 4 s... up to 30 s. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export interface SubscribeOptions {
  /** The subscription dropped; it is retried on its own right after. */
  onError?: (error: unknown) => void;
  /**
   * Listening again after a drop: events published meanwhile were missed, so
   * the caller reloads what it shows.
   */
  onReconnect?: () => void;
}

/**
 * Listens to one channel and keeps listening: a dropped subscription (the
 * laptop slept, the network changed, the token was renewed) is retried with
 * a growing delay, and also at once when the tab becomes visible again or
 * the browser comes back online. Returns the function that stops it; `null`
 * without realtime.
 */
export function subscribe(
  channel: string,
  onEvent: Listener,
  options: SubscribeOptions = {}
): (() => void) | null {
  if (isMockAuth) {
    const listeners = demoListeners.get(channel) ?? new Set<Listener>();
    listeners.add(onEvent);
    demoListeners.set(channel, listeners);
    return () => listeners.delete(onEvent);
  }

  const url = realtimeUrl();
  if (!url) return null;

  let active: { unsubscribe: () => void } | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let dropped = false;
  let stopped = false;

  const connect = async () => {
    if (stopped) return;
    retryTimer = null;
    // A fresh token on every (re)connection: the previous one may have expired.
    const token = await getIdToken().catch(() => null);
    if (stopped) return;
    if (!token) {
      dropped = true;
      schedule(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30000);
      attempt += 1;
      return;
    }
    const observable = ensureClient(url).graphql({
      query: ON_EVENT,
      variables: { id: channel },
      authMode: 'lambda',
      authToken: token,
    }) as Subscribable;
    if (dropped) {
      // AppSync acknowledges a subscription without an event: by now it listens.
      dropped = false;
      attempt = 0;
      options.onReconnect?.();
    }
    active = observable.subscribe({
      next: value => {
        const raw = value.data?.onEvent;
        if (!raw || typeof raw.type !== 'string') return;
        onEvent({
          id: String(raw.id ?? channel),
          type: raw.type,
          payload: parsePayload(raw.payload),
        });
      },
      error: error => {
        options.onError?.(error);
        active = null;
        dropped = true;
        schedule(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] ?? 30000);
        attempt += 1;
      },
    });
  };

  const schedule = (delay: number) => {
    if (stopped || retryTimer !== null) return;
    retryTimer = setTimeout(() => void connect(), delay);
  };

  // Back on the tab or the network: retry a dropped subscription now.
  const retryNow = () => {
    if (!dropped || stopped || document.visibilityState === 'hidden') return;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    void connect();
  };
  document.addEventListener('visibilitychange', retryNow);
  window.addEventListener('online', retryNow);

  void connect();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    document.removeEventListener('visibilitychange', retryNow);
    window.removeEventListener('online', retryNow);
    active?.unsubscribe();
  };
}
