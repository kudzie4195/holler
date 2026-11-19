import { describe, expect, it, vi } from 'vitest';
import { PUSH_CHANNEL_ID } from '../src/contract';
import { consentKeyFor, createPush, promptSeenKeyFor, tokenKeyFor, type KeyValueStore, type MessagingLike } from '../src/push/push';

const TOKEN_KEY = tokenKeyFor('user-1');
const PROMPT_SEEN_KEY = promptSeenKeyFor('user-1');
import { pathTarget, pushTarget } from '../src/push/route';
import { capacitorProxy, settlesWithin } from './helpers';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
}

function fakeMessaging(opts: { permission?: string; grant?: string; token?: string; tokenError?: boolean } = {}) {
  const listeners = new Map<string, (p: unknown) => void>();
  const calls: Array<[string, unknown]> = [];
  const impl = {
    checkPermissions: async () => ({ receive: opts.permission ?? 'prompt' }),
    requestPermissions: async () => {
      calls.push(['requestPermissions', null]);
      return { receive: opts.grant ?? 'granted' };
    },
    getToken: async () => {
      calls.push(['getToken', null]);
      if (opts.tokenError) throw new Error('Firebase is not configured: GoogleService-Info.plist is missing from the app bundle.');
      return { token: opts.token ?? 'tok-1' };
    },
    deleteToken: async () => void calls.push(['deleteToken', null]),
    createChannel: async (o: unknown) => void calls.push(['createChannel', o]),
    addListener: async (event: string, cb: (p: unknown) => void) => {
      listeners.set(event, cb);
      return { remove: async () => undefined };
    },
  };
  // Shaped like Capacitor: answers `then` too, so returning it from an async function would hang.
  const plugin = capacitorProxy(impl) as unknown as MessagingLike;
  return { plugin, listeners, calls };
}

function fakeApi() {
  return { registerPush: vi.fn(async () => ({ ok: true })), unregisterPush: vi.fn(async () => ({ ok: true })) };
}

function setup(o: { enabled?: boolean; platform?: 'ios' | 'android' | null; msg?: ReturnType<typeof fakeMessaging> } = {}) {
  const msg = o.msg ?? fakeMessaging();
  const store = memoryStore();
  const push = createPush({
    enabled: o.enabled ?? true,
    platform: o.platform === undefined ? 'ios' : o.platform,
    appVersion: '1.0.0',
    store,
    timeoutMs: 200,
    load: async () => ({ FirebaseMessaging: msg.plugin }),
  });
  const api = fakeApi();
  push.attach(api, 'user-1');
  return { push, msg, store, api };
}

describe('push registration flow', () => {
  it('is off when the build flag is off, or on the web', async () => {
    for (const o of [{ enabled: false }, { platform: null }] as const) {
      const { push, api, msg } = setup(o);
      expect(push.available()).toBe(false);
      expect(await push.enable()).toBe('unavailable');
      expect(await push.permission()).toBe('unavailable');
      expect(api.registerPush).not.toHaveBeenCalled();
      expect(msg.calls).toEqual([]);
    }
  });

  it('asks only when enable() is called, then registers the FCM token with the API', async () => {
    const { push, api, store, msg } = setup();
    expect(msg.calls).toEqual([]); // nothing asked at start
    expect(await settlesWithin(push.enable())).toBe('enabled');
    expect(msg.calls.map(([n]) => n)).toEqual(['requestPermissions', 'getToken']);
    expect(api.registerPush).toHaveBeenCalledWith({ token: 'tok-1', platform: 'ios', appVersion: '1.0.0' });
    expect(store.data.get(TOKEN_KEY)).toBe('tok-1');
  });

  it('creates the Android "alerts" channel before the prompt', async () => {
    const { push, msg, api } = setup({ platform: 'android' });
    expect(await push.enable()).toBe('enabled');
    expect(msg.calls[0][0]).toBe('createChannel');
    expect((msg.calls[0][1] as { id: string }).id).toBe(PUSH_CHANNEL_ID);
    expect(msg.calls[1][0]).toBe('requestPermissions');
    expect(api.registerPush).toHaveBeenCalledWith(expect.objectContaining({ platform: 'android' }));
  });

  it('a denied prompt registers nothing', async () => {
    const { push, api } = setup({ msg: fakeMessaging({ grant: 'denied' }) });
    expect(await push.enable()).toBe('denied');
    expect(api.registerPush).not.toHaveBeenCalled();
  });

  it('no Firebase config in the build: push is simply unavailable', async () => {
    const { push, api } = setup({ msg: fakeMessaging({ tokenError: true }) });
    expect(await settlesWithin(push.enable())).toBe('unavailable');
    expect(api.registerPush).not.toHaveBeenCalled();
  });

  it('an API failure while registering is reported, nothing stored', async () => {
    const { push, api, store } = setup();
    api.registerPush.mockRejectedValueOnce(new Error('503'));
    expect(await push.enable()).toBe('error');
    expect(store.data.has(TOKEN_KEY)).toBe(false);
  });

  it('re-registers when FCM rotates the token and removes the old one', async () => {
    const { push, api, store, msg } = setup();
    await push.listen(() => undefined);
    await push.enable();
    await msg.listeners.get('tokenReceived')!({ token: 'tok-2' });
    await new Promise((r) => setTimeout(r, 0));
    expect(api.registerPush).toHaveBeenLastCalledWith({ token: 'tok-2', platform: 'ios', appVersion: '1.0.0' });
    expect(api.unregisterPush).toHaveBeenCalledWith('tok-1');
    expect(store.data.get(TOKEN_KEY)).toBe('tok-2');
  });

  it('ignores a token event when this member never turned push on', async () => {
    const { push, api, msg } = setup();
    await push.listen(() => undefined);
    await msg.listeners.get('tokenReceived')!({ token: 'tok-9' });
    expect(api.registerPush).not.toHaveBeenCalled();
  });

  it('refreshIfGranted re-sends the current token on launch only when allowed', async () => {
    const granted = setup({ msg: fakeMessaging({ permission: 'granted', token: 'tok-new' }) });
    await granted.store.set(TOKEN_KEY, 'tok-old');
    await granted.store.set(consentKeyFor('user-1'), '1');
    expect(await granted.push.refreshIfGranted()).toBe(true);
    expect(granted.api.registerPush).toHaveBeenCalledWith(expect.objectContaining({ token: 'tok-new' }));
    expect(granted.api.unregisterPush).toHaveBeenCalledWith('tok-old');

    const prompt = setup({ msg: fakeMessaging({ permission: 'prompt' }) });
    expect(await prompt.push.refreshIfGranted()).toBe(false);
    expect(prompt.msg.calls).toEqual([]);
  });

  it('sign-out removes the token from the server first, then from FCM, and detaches the API', async () => {
    const { push, api, store, msg } = setup();
    await push.enable();
    await push.unregister();
    expect(api.unregisterPush).toHaveBeenCalledWith('tok-1');
    expect(store.data.has(TOKEN_KEY)).toBe(false);
    expect(msg.calls.at(-1)?.[0]).toBe('deleteToken');
    expect(await push.enable()).toBe('unavailable'); // no API attached any more
  });

  it('sign-out survives a server failure', async () => {
    const { push, api } = setup();
    await push.enable();
    api.unregisterPush.mockRejectedValueOnce(new Error('offline'));
    await expect(push.unregister()).resolves.toBeUndefined();
  });

  it('tapping a notification opens the alert it names', async () => {
    const { push, msg } = setup();
    const opened: unknown[] = [];
    await push.listen((t) => opened.push(t));
    msg.listeners.get('notificationActionPerformed')!({ actionId: 'tap', notification: { data: { type: 'alert', signalId: '123', path: '/alert/123' } } });
    msg.listeners.get('notificationActionPerformed')!({ actionId: 'tap', notification: { data: { type: 'feed', path: '/feed' } } });
    msg.listeners.get('notificationActionPerformed')!({ actionId: 'tap', notification: { data: { path: 'https://evil.example/' } } });
    expect(opened).toEqual([{ name: 'alert', signalId: 123 }, { name: 'feed' }]);
  });

  it('remembers that the pre-prompt was shown', async () => {
    const { push, store } = setup();
    expect(await push.promptSeen()).toBe(false);
    await push.markPromptSeen();
    expect(store.data.get(PROMPT_SEEN_KEY)).toBe('1');
    expect(await push.promptSeen()).toBe(true);
  });
});

describe('push consent is per account on a shared phone (review r6 P1 / P2)', () => {
  it('a second account on a phone that already allows notifications gets no token without agreeing', async () => {
    const msg = fakeMessaging({ permission: 'granted', token: 'tok-a' });
    const { push, api, store } = setup({ msg });
    expect(await push.enable()).toBe('enabled'); // account A agreed
    await push.markPromptSeen();
    await push.unregister(); // A signs out
    api.registerPush.mockClear();

    push.attach(api, 'user-2'); // B signs in on the same phone
    expect(await push.refreshIfGranted()).toBe(false);
    expect(api.registerPush).not.toHaveBeenCalled();
    expect(await push.isRegistered()).toBe(false);
    expect(await push.promptSeen()).toBe(false); // B is asked
    expect(store.data.get(tokenKeyFor('user-2'))).toBeUndefined();
  });

  it('the account that agreed is registered again at its next sign-in', async () => {
    const msg = fakeMessaging({ permission: 'granted', token: 'tok-a' });
    const { push, api } = setup({ msg });
    await push.enable();
    await push.unregister();
    push.attach(api, 'user-1');
    api.registerPush.mockClear();
    expect(await push.refreshIfGranted()).toBe(true);
    expect(api.registerPush).toHaveBeenCalledTimes(1);
    expect(await push.isRegistered()).toBe(true);
  });

  it('an existing member who was never asked has no registered token, so Settings shows push as off', async () => {
    const { push } = setup({ msg: fakeMessaging({ permission: 'prompt' }) });
    expect(await push.refreshIfGranted()).toBe(false);
    expect(await push.isRegistered()).toBe(false);
    expect(await push.promptSeen()).toBe(false);
  });

  it('turning push off removes the token from the server and the consent', async () => {
    const { push, api, store } = setup();
    await push.enable();
    await push.disable();
    expect(api.unregisterPush).toHaveBeenCalledWith('tok-1');
    expect(await push.isRegistered()).toBe(false);
    expect(store.data.has(consentKeyFor('user-1'))).toBe(false);
    expect(await push.enable()).toBe('enabled'); // still attached
  });
});

describe('push targets', () => {
  it('reads the contract payloads', () => {
    expect(pushTarget({ type: 'alert', signalId: '42', path: '/alert/42' })).toEqual({ name: 'alert', signalId: 42 });
    expect(pushTarget({ type: 'feed', path: '/feed' })).toEqual({ name: 'feed' });
    expect(pushTarget({ type: 'alert', signalId: 'x', path: '/alert/77' })).toEqual({ name: 'alert', signalId: 77 });
    expect(pushTarget({ type: 'alert', signalId: '-1' })).toEqual({ name: 'feed' });
    expect(pushTarget(null)).toBeNull();
    expect(pushTarget('x')).toBeNull();
  });
  it('follows only in-app paths', () => {
    expect(pathTarget('/alert/9')).toEqual({ name: 'alert', signalId: 9 });
    expect(pathTarget('/feed/')).toEqual({ name: 'feed' });
    expect(pathTarget('/alert/0')).toBeNull();
    expect(pathTarget('//evil.example/alert/9')).toBeNull();
    expect(pathTarget('/settings')).toBeNull();
  });
});
