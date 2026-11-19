// Native push through Firebase Cloud Messaging (@capacitor-firebase/messaging 8.x), which hands back
// an FCM token on iOS as well as Android, so the server sends through one API for both.
//
// Order of things, by design:
//   * Nothing is asked at first launch. After onboarding (or at the first sign-in of an existing
//     member) the member sees a plain screen saying what they will get, and only a tap on "Turn on
//     alerts" shows the system prompt.
//   * Everything is kept per account on this phone: the pre-prompt flag, the account's consent and
//     its registered token. A second account on a shared phone is asked again, and no token is ever
//     registered for an account that did not agree, even when the phone already allows notifications.
//   * The token is registered with POST /api/m/push/register, re-registered when FCM rotates it,
//     and removed (DELETE) on sign-out BEFORE the session goes away.
//   * Without GoogleService-Info.plist / google-services.json (or with VITE_PUSH_ENABLED unset) the
//     plugin cannot make a token: every step here reports "unavailable" and the app runs with push off.
//   * Loaders return a box ({ FirebaseMessaging }), never the plugin: a plugin is a thenable Proxy.
import type { DevicePlatform } from '../contract';
import { PUSH_CHANNEL_ID } from '../contract';
import { withTimeout } from '../lib/timeout';
import { pushTarget, type PushTarget } from './route';

export interface MessagingLike {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  getToken(options?: unknown): Promise<{ token: string }>;
  deleteToken(): Promise<void>;
  createChannel?(options: Record<string, unknown>): Promise<void>;
  addListener(event: string, cb: (payload: any) => void): Promise<{ remove: () => Promise<void> | void }>;
}

export interface PushApi {
  registerPush(input: { token: string; platform: DevicePlatform; appVersion?: string }): Promise<unknown>;
  unregisterPush(token: string): Promise<unknown>;
}

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unavailable';
export type EnableResult = 'enabled' | 'denied' | 'unavailable' | 'error';

export interface PushDeps {
  enabled: boolean;
  platform: DevicePlatform | null;
  appVersion: string;
  load: () => Promise<{ FirebaseMessaging: MessagingLike | null }>;
  store: KeyValueStore;
  timeoutMs?: number;
}

/** Before per-account keys; removed on sign-out. */
export const LEGACY_TOKEN_KEY = 'holler-push-token';
export const tokenKeyFor = (userId: string) => `holler-push-token:${userId}`;
export const promptSeenKeyFor = (userId: string) => `holler-push-prompt-seen:${userId}`;
export const consentKeyFor = (userId: string) => `holler-push-consent:${userId}`;

export function createPush(deps: PushDeps) {
  const timeout = deps.timeoutMs ?? 10000;
  let api: PushApi | null = null;
  let userId: string | null = null;
  let listening = false;

  async function plugin(): Promise<{ FirebaseMessaging: MessagingLike | null }> {
    if (!deps.enabled || !deps.platform) return { FirebaseMessaging: null };
    try {
      return await deps.load();
    } catch {
      return { FirebaseMessaging: null };
    }
  }

  async function register(token: string): Promise<boolean> {
    if (!api || !deps.platform || !userId) return false;
    const owner = userId;
    try {
      await api.registerPush({ token, platform: deps.platform, appVersion: deps.appVersion });
      await deps.store.set(tokenKeyFor(owner), token);
      await deps.store.set(consentKeyFor(owner), '1');
      return true;
    } catch {
      return false;
    }
  }

  return {
    available(): boolean {
      return deps.enabled && deps.platform !== null;
    },

    /** The API and the account to register tokens for, set after sign-in. attach(null) keeps the account. */
    attach(next: PushApi | null, forUser?: string | null): void {
      api = next;
      if (forUser !== undefined) userId = forUser;
    },

    /** Listen for token rotation and taps. Call once, as early as possible (a tap may have launched the app). */
    async listen(onOpen: (target: PushTarget) => void): Promise<void> {
      if (listening) return;
      const { FirebaseMessaging } = await plugin();
      if (!FirebaseMessaging) return;
      listening = true;
      try {
        await FirebaseMessaging.addListener('notificationActionPerformed', (event: { notification?: { data?: unknown } }) => {
          const target = pushTarget(event?.notification?.data);
          if (target) onOpen(target);
        });
        await FirebaseMessaging.addListener('tokenReceived', async (event: { token?: string }) => {
          const fresh = typeof event?.token === 'string' ? event.token : '';
          if (!userId) return;
          const old = await deps.store.get(tokenKeyFor(userId));
          if (!fresh || !old || fresh === old || !api) return; // only rotate a token this member registered
          if (await register(fresh)) {
            try {
              await api.unregisterPush(old);
            } catch {
              /* the server disables stale tokens on its own when FCM rejects them */
            }
          }
        });
      } catch {
        listening = false;
      }
    },

    async permission(): Promise<PushPermission> {
      const { FirebaseMessaging } = await plugin();
      if (!FirebaseMessaging) return 'unavailable';
      try {
        const { receive } = await withTimeout(FirebaseMessaging.checkPermissions(), timeout, 'checkPermissions');
        return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
      } catch {
        return 'unavailable';
      }
    },

    /** The member tapped "Turn on alerts": channel, system prompt, token, register. */
    async enable(): Promise<EnableResult> {
      const { FirebaseMessaging } = await plugin();
      if (!FirebaseMessaging || !api || !userId) return 'unavailable';
      try {
        if (deps.platform === 'android' && typeof FirebaseMessaging.createChannel === 'function') {
          // Android 8+: the server sends to this channel id. Made before the prompt, as the contract asks.
          await FirebaseMessaging.createChannel({
            id: PUSH_CHANNEL_ID,
            name: 'New alerts',
            description: 'A note when new jobs or demand show up in your area.',
            importance: 4,
            visibility: 1,
          }).catch(() => undefined);
        }
        // Not timed out: the system prompt waits for the person.
        const { receive } = await FirebaseMessaging.requestPermissions();
        if (receive !== 'granted') return 'denied';
        const { token } = await withTimeout(FirebaseMessaging.getToken(), timeout, 'getToken');
        if (!token) return 'unavailable';
        return (await register(token)) ? 'enabled' : 'error';
      } catch {
        // No Firebase config in the build: getToken rejects. Push simply stays off.
        return 'unavailable';
      }
    },

    /**
     * On sign-in: only when THIS account agreed on this phone before (and the phone still allows it),
     * make sure the server has the current token. A phone-wide permission alone is not consent.
     */
    async refreshIfGranted(): Promise<boolean> {
      if (!userId || (await deps.store.get(consentKeyFor(userId)).catch(() => null)) !== '1') return false;
      if ((await this.permission()) !== 'granted') return false;
      const { FirebaseMessaging } = await plugin();
      if (!FirebaseMessaging || !api) return false;
      try {
        const { token } = await withTimeout(FirebaseMessaging.getToken(), timeout, 'getToken');
        if (!token || !userId) return false;
        const old = await deps.store.get(tokenKeyFor(userId));
        const ok = await register(token);
        if (ok && old && old !== token) await api.unregisterPush(old).catch(() => undefined);
        return ok;
      } catch {
        return false;
      }
    },

    /** Sign-out and account delete: remove this phone's token from the server, then from FCM. Never throws. */
    async unregister(): Promise<void> {
      const keys = [LEGACY_TOKEN_KEY, ...(userId ? [tokenKeyFor(userId)] : [])];
      for (const key of keys) {
        const token = await deps.store.get(key).catch(() => null);
        if (token && api) {
          try {
            await api.unregisterPush(token);
          } catch {
            /* best effort; the server also drops tokens FCM reports as dead */
          }
        }
        await deps.store.remove(key).catch(() => undefined);
      }
      const { FirebaseMessaging } = await plugin();
      if (FirebaseMessaging) {
        try {
          await withTimeout(FirebaseMessaging.deleteToken(), timeout, 'deleteToken');
        } catch {
          /* nothing to delete */
        }
      }
      api = null;
      userId = null;
    },

    /** Settings switched push off: remove this account's token from the server and forget its consent. */
    async disable(): Promise<void> {
      if (!userId) return;
      const owner = userId;
      const token = await deps.store.get(tokenKeyFor(owner)).catch(() => null);
      if (token && api) await api.unregisterPush(token).catch(() => undefined);
      await deps.store.remove(tokenKeyFor(owner)).catch(() => undefined);
      await deps.store.remove(consentKeyFor(owner)).catch(() => undefined);
    },

    /** Has this phone registered a token for the signed-in account? */
    async isRegistered(): Promise<boolean> {
      if (!userId) return false;
      return Boolean(await deps.store.get(tokenKeyFor(userId)).catch(() => null));
    },

    /** Was the pre-prompt shown to the signed-in account on this phone? True with no account (never ask then). */
    async promptSeen(): Promise<boolean> {
      if (!userId) return true;
      return (await deps.store.get(promptSeenKeyFor(userId)).catch(() => null)) === '1';
    },

    async markPromptSeen(): Promise<void> {
      if (!userId) return;
      await deps.store.set(promptSeenKeyFor(userId), '1').catch(() => undefined);
    },
  };
}

export type PushController = ReturnType<typeof createPush>;
