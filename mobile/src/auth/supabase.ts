// The Supabase client the app signs in with. Only the public URL and the anon (publishable) key.
//
// The session lives in @capacitor/preferences on a phone (UserDefaults / SharedPreferences), not in
// WebView localStorage, which iOS may clear when the device is short on space.
//
// The storage is wrapped by auth/guard.ts, which keeps a backup of the last good session so a 429, a
// 5xx or a captive portal page during a token refresh never signs the member out.
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../lib/env';
import { isNative } from '../lib/platform';
import { createGuardedClient, type AuthStorage, type SessionGuard } from './guard';

const STORAGE_KEY = 'holler-auth';

const preferencesStorage: AuthStorage = {
  async getItem(key: string): Promise<string | null> {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key });
    return value;
  },
  async setItem(key: string, value: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key, value });
  },
  async removeItem(key: string): Promise<void> {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key });
  },
};

/** In a browser: localStorage, or memory when storage is blocked. */
function webStorage(): AuthStorage {
  const memory = new Map<string, string>();
  const ls = (): Storage | null => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    async getItem(key) {
      try {
        const s = ls();
        if (s) return s.getItem(key);
      } catch {
        /* fall back to memory */
      }
      return memory.get(key) ?? null;
    },
    async setItem(key, value) {
      try {
        const s = ls();
        if (s) return s.setItem(key, value);
      } catch {
        /* fall back to memory */
      }
      memory.set(key, value);
    },
    async removeItem(key) {
      try {
        ls()?.removeItem(key);
      } catch {
        /* fall back to memory */
      }
      memory.delete(key);
    },
  };
}

let client: SupabaseClient | null = null;
let guard: SessionGuard | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

export function supabase(): SupabaseClient {
  if (client) return client;
  // A build with no Supabase settings still renders (welcome and area check work signed out); any
  // sign-in attempt then fails with a plain message instead of a crash.
  const made = createGuardedClient(config.supabaseUrl || 'https://not-configured.invalid', config.supabaseAnonKey || 'not-configured', {
    storage: isNative() ? preferencesStorage : webStorage(),
    storageKey: STORAGE_KEY,
    autoRefreshToken: true,
  });
  client = made.client;
  guard = made.guard;
  return client;
}

/** The session backup kept beside the Supabase client (see auth/guard.ts). */
export function sessionGuard(): SessionGuard {
  supabase();
  return guard as SessionGuard;
}
