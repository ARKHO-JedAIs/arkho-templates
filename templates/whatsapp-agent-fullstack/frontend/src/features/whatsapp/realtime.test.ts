import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One fake AppSync subscription per call to graphql(): the test drives each
// one's next/error by hand.
type Observer = {
  next: (value: { data?: { onEvent?: Record<string, unknown> } }) => void;
  error: (error: unknown) => void;
};
const subscriptions: { observer: Observer; unsubscribe: ReturnType<typeof vi.fn> }[] = [];
const requests: Record<string, unknown>[] = [];

vi.mock('@/lib/auth/session', () => ({
  isMockAuth: false,
  getIdToken: () => Promise.resolve('id-token'),
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn(), getConfig: () => ({}) } }));
vi.mock('aws-amplify/api', () => ({
  generateClient: () => ({
    graphql: (options: Record<string, unknown>) => {
      requests.push(options);
      return {
        subscribe: (observer: Observer) => {
          const unsubscribe = vi.fn();
          subscriptions.push({ observer, unsubscribe });
          return { unsubscribe };
        },
      };
    },
  }),
}));

// The subscription starts after the token is read (a promise): let it run.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('realtime subscribe', () => {
  beforeEach(() => {
    subscriptions.length = 0;
    requests.length = 0;
    vi.useFakeTimers();
    vi.stubEnv('VITE_APPSYNC_URL', 'https://x.appsync-api.us-east-1.amazonaws.com/graphql');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('delivers the payload of each event', async () => {
    const { subscribe } = await import('./realtime');
    const onEvent = vi.fn();
    subscribe('56911111111', onEvent);
    await flush();
    subscriptions[0]!.observer.next({
      data: {
        onEvent: { id: '56911111111', type: 'MESSAGE_RECEIVED', payload: '{"message":"hola"}' },
      },
    });
    expect(onEvent).toHaveBeenCalledWith({
      id: '56911111111',
      type: 'MESSAGE_RECEIVED',
      payload: { message: 'hola' },
    });
  });

  it('subscribes again after a drop, waiting longer each time, and asks for a reload', async () => {
    const { subscribe, RETRY_DELAYS_MS } = await import('./realtime');
    const onError = vi.fn();
    const onReconnect = vi.fn();
    subscribe('inbox', vi.fn(), { onError, onReconnect });
    await flush();

    subscriptions[0]!.observer.error(new Error('socket closed'));
    expect(onError).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]! - 1);
    expect(subscriptions).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(subscriptions).toHaveLength(2);
    expect(onReconnect).toHaveBeenCalledOnce();

    // A second drop right after waits the first delay again: the reconnect reset the count.
    subscriptions[1]!.observer.error(new Error('again'));
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0]!);
    expect(subscriptions).toHaveLength(3);
  });

  it('subscribes in Lambda mode with the Cognito ID token', async () => {
    const { subscribe } = await import('./realtime');
    subscribe('inbox', vi.fn());
    await flush();
    expect(requests[0]).toMatchObject({
      authMode: 'lambda',
      authToken: 'id-token',
      variables: { id: 'inbox' },
    });
  });

  it('retries at once when the browser comes back online', async () => {
    const { subscribe } = await import('./realtime');
    subscribe('inbox', vi.fn());
    await flush();
    subscriptions[0]!.observer.error(new Error('offline'));
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(subscriptions).toHaveLength(2);
  });

  it('stops for good: no retry after the caller unsubscribes', async () => {
    const { subscribe } = await import('./realtime');
    const stop = subscribe('inbox', vi.fn())!;
    await flush();
    subscriptions[0]!.observer.error(new Error('closed'));
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    window.dispatchEvent(new Event('online'));
    expect(subscriptions).toHaveLength(1);
  });
});
