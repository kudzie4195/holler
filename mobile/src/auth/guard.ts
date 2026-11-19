// Keeps a member signed in when Supabase Auth answers a token refresh with something other than a
// clear "this refresh token is no good".
//
// supabase-js 2.119.1 deletes its stored session itself on any refresh error it does not class as
// retryable. That includes a 429 (rate limit), a 5xx outside 500-530 (a 507, say) and a non-JSON 4xx
// such as a captive portal or a firewall page. Signing the member out for those is wrong.
//
// So the storage adapter given to supabase-js is wrapped here:
//   * every session supabase-js saves is also copied to a backup key;
//   * the fetch given to supabase-js is wrapped so the app sees how the last refresh ended;
//   * when supabase-js deletes the session and the app did not ask for it, the last refresh decides:
//       - a definite rejection of the refresh token (400 or 401 with an auth error code such as
//         invalid_grant or refresh_token_not_found, or 403 with a JSON auth error body): signed out
//         for real, and the backup is deleted;
//       - any other refresh failure (429, 5xx, an HTML page, a network error): the session is put
//         back from the backup at once, before supabase-js fires SIGNED_OUT, so the next read sees
//         it again and the app shows its offline or "try again" state.
//   * An app-initiated sign-out (and account deletion, which signs out) always deletes the backup.
//
// The session is put back during the removal itself, not later in a SIGNED_OUT listener: at app
// start supabase-js queues SIGNED_OUT until initialize() finishes, and a getSession in that gap would
// otherwise find nothing stored and send the member to Welcome.
import { createClient, isAuthApiError, isAuthSessionMissingError, type SupabaseClient } from '@supabase/supabase-js';

export interface AuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export const BACKUP_SUFFIX = '-backup';

/** A removal counts as "after a refresh" only if that refresh ended this recently. */
const RECENT_REFRESH_MS = 60_000;

/** Error codes Supabase Auth uses when the refresh token or its session is gone for good. */
const REJECTION_CODES = new Set([
  'invalid_grant',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'user_not_found',
  'user_banned',
]);

const REJECTION_MESSAGE = /invalid refresh token|refresh token (not found|already used)|invalid_grant/i;

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The error codes and message carried by a Supabase Auth JSON error body. */
function authFields(body: Record<string, unknown>): { codes: string[]; message: string; isAuthBody: boolean } {
  const codes = [str(body.error_code), str(body.code), str(body.error)].filter((c): c is string => c !== null).map((c) => c.toLowerCase());
  const message = [body.msg, body.message, body.error_description].map(str).filter(Boolean).join(' ');
  // GoTrue errors look like { code, error_code, msg } or the OAuth style { error, error_description }.
  const isAuthBody = Boolean(str(body.error_code) || str(body.msg) || (str(body.error) && str(body.error_description)) || str(body.code));
  return { codes, message, isAuthBody };
}

/** True only when Supabase Auth itself rejected the refresh token. */
export function isRefreshRejection(status: number, codes: string[], message: string, isAuthBody: boolean): boolean {
  if (status === 400 || status === 401) return codes.some((c) => REJECTION_CODES.has(c)) || REJECTION_MESSAGE.test(message);
  if (status === 403) return isAuthBody;
  return false;
}

/** The same rule, applied to a raw /token response. A non-JSON body is never a rejection. */
export function isRefreshRejectionResponse(status: number, bodyText: string): boolean {
  const body = parseJson(bodyText);
  if (!body) return false;
  const f = authFields(body);
  return isRefreshRejection(status, f.codes, f.message, f.isAuthBody);
}

/** The same rule, applied to an error supabase-js returned. 429, 5xx, HTML pages and the network are never a rejection. */
export function isRefreshRejectionError(err: unknown): boolean {
  if (!err) return false;
  if (isAuthSessionMissingError(err)) return true;
  if (!isAuthApiError(err)) return false;
  const e = err as { status?: number; code?: string; message?: string };
  const code = str(e.code);
  // An AuthApiError always came from a JSON body (a non-JSON body gives AuthUnknownError).
  return isRefreshRejection(Number(e.status), code ? [code.toLowerCase()] : [], e.message ?? '', true);
}

export type RefreshEnd = 'ok' | 'rejected' | 'transient';
export type SignedOutOutcome = 'kept' | 'signed-out';

export interface SessionGuard {
  /** The storage to give supabase-js. */
  storage: AuthStorage;
  /** Wrap the fetch given to supabase-js so refresh results are seen. */
  wrapFetch(base: typeof fetch): typeof fetch;
  /** How the last token refresh ended, or null before any. */
  lastRefresh(): { end: RefreshEnd; at: number } | null;
  /** Our own sign-out (or account deletion) is starting: the backup goes, and any removal is final. */
  beginSignOut(): Promise<void>;
  /** Our own sign-out is over: make sure nothing of the session is left on this phone. */
  endSignOut(): Promise<void>;
  /** For a SIGNED_OUT from supabase-js: 'kept' when the session was put back, else 'signed-out'. */
  outcome(): Promise<SignedOutOutcome>;
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return str((input as { url?: unknown } | null)?.url) ?? '';
}

const REFRESH_URL = /\/token\?(?:[^#]*&)?grant_type=refresh_token(?:&|$)/;

export function createSessionGuard(base: AuthStorage, storageKey: string, now: () => number = () => Date.now()): SessionGuard {
  const backupKey = storageKey + BACKUP_SUFFIX;
  let last: { end: RefreshEnd; at: number } | null = null;
  let signingOut = 0;
  /** What was decided at the latest removal of the session; cleared when a new session is saved. */
  let decision: 'restore' | 'sign-out' | null = null;

  function decide(): 'restore' | 'sign-out' {
    if (signingOut > 0) return 'sign-out';
    if (last && last.end === 'transient' && now() - last.at <= RECENT_REFRESH_MS) return 'restore';
    return 'sign-out';
  }

  /** The last session read or written, in memory, for when the backup key cannot be read. */
  let lastSeen: string | null = null;
  /** A session saved by an app version without the guard has no backup yet: copy it on first read. */
  let seeded = false;

  async function putBack(): Promise<boolean> {
    const backup = (await base.getItem(backupKey)) ?? lastSeen;
    if (!backup) return false;
    if ((await base.getItem(storageKey)) === null) await base.setItem(storageKey, backup);
    return true;
  }

  const storage: AuthStorage = {
    async getItem(key) {
      const v = await base.getItem(key);
      if (key !== storageKey) return v;
      if (v !== null) {
        if (signingOut === 0) lastSeen = v;
        if (!seeded && signingOut === 0) {
          seeded = true;
          if ((await base.getItem(backupKey)) === null) await base.setItem(backupKey, v);
        }
        return v;
      }
      // Belt and braces: if putting the session back failed during the removal, try again on read.
      if (decision === 'restore' && signingOut === 0 && (await putBack())) return base.getItem(key);
      return v;
    },
    async setItem(key, value) {
      await base.setItem(key, value);
      if (key === storageKey) {
        decision = null;
        if (signingOut === 0) {
          lastSeen = value;
          await base.setItem(backupKey, value);
        }
      }
    },
    async removeItem(key) {
      if (key !== storageKey) return base.removeItem(key);
      decision = decide();
      await base.removeItem(key);
      if (decision === 'restore') {
        try {
          if (!(await putBack())) decision = 'sign-out';
        } catch {
          /* getItem tries again */
        }
      } else {
        lastSeen = null;
        await base.removeItem(backupKey);
      }
    },
  };

  function wrapFetch(fetchImpl: typeof fetch): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (!REFRESH_URL.test(urlOf(input))) return fetchImpl(input, init);
      let res: Response;
      try {
        res = await fetchImpl(input, init);
      } catch (err) {
        last = { end: 'transient', at: now() };
        throw err;
      }
      if (res.ok) {
        last = { end: 'ok', at: now() };
        return res;
      }
      let text = '';
      try {
        text = await res.clone().text();
      } catch {
        /* unreadable body: not a rejection */
      }
      last = { end: isRefreshRejectionResponse(res.status, text) ? 'rejected' : 'transient', at: now() };
      return res;
    }) as typeof fetch;
  }

  return {
    storage,
    wrapFetch,
    lastRefresh: () => last,
    async beginSignOut() {
      signingOut += 1;
      decision = null;
      lastSeen = null;
      await base.removeItem(backupKey);
    },
    async endSignOut() {
      try {
        // supabase-js keeps the stored session when signOut itself fails to read it (a 429 inside its
        // cool-down, say). Our own sign-out must still leave nothing behind.
        await base.removeItem(storageKey);
        await base.removeItem(backupKey);
      } finally {
        signingOut = Math.max(0, signingOut - 1);
        decision = null;
        lastSeen = null;
      }
    },
    async outcome() {
      if (decision === 'restore') return (await base.getItem(storageKey)) !== null || (await putBack()) ? 'kept' : 'signed-out';
      if (decision === 'sign-out') return 'signed-out';
      // A new session was saved since the removal: still signed in.
      return (await base.getItem(storageKey)) !== null ? 'kept' : 'signed-out';
    },
  };
}

export interface GuardedClientOptions {
  storage: AuthStorage;
  storageKey: string;
  fetch?: typeof fetch;
  autoRefreshToken?: boolean;
  now?: () => number;
}

/** The app's Supabase client with the guard in place. Tests build theirs with the same function. */
export function createGuardedClient(url: string, anonKey: string, opts: GuardedClientOptions): { client: SupabaseClient; guard: SessionGuard } {
  const guard = createSessionGuard(opts.storage, opts.storageKey, opts.now);
  const baseFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const client = createClient(url, anonKey, {
    auth: {
      storage: guard.storage,
      storageKey: opts.storageKey,
      persistSession: true,
      autoRefreshToken: opts.autoRefreshToken ?? true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: { fetch: guard.wrapFetch(baseFetch as typeof fetch) },
  });
  return { client, guard };
}
