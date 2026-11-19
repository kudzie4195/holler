// The app's long-lived services, made once.
import { createApiClient } from './api/client';
import { accessToken, refreshedToken } from './auth/session';
import { supabase } from './auth/supabase';
import { config } from './lib/env';
import { defaultHttp } from './lib/http';
import { isNative, platform } from './lib/platform';
import { keyValueStore } from './lib/store';
import { createPush, type MessagingLike } from './push/push';

export const http = defaultHttp();

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export const api = createApiClient({
  baseUrl: config.apiBase,
  http,
  // Offline (or Supabase Auth answering 429 / 5xx) throws a network error; it never signs out.
  getToken: () => accessToken(supabase().auth),
  refresh: () => refreshedToken(supabase().auth),
  onUnauthorized: () => onUnauthorized(),
});

const p = platform();

export const push = createPush({
  enabled: config.flags.push && isNative(),
  platform: p === 'web' ? null : p,
  appVersion: config.appVersion,
  store: keyValueStore,
  load: async () => {
    const mod = await import('@capacitor-firebase/messaging');
    // A box, never the plugin itself (see push/push.ts).
    return { FirebaseMessaging: mod.FirebaseMessaging as unknown as MessagingLike };
  },
});
