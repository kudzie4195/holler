// Review r6 P1: being offline with an expired access token must not sign the member out.
// These tests drive a real supabase-js client with an expired session in memory storage.
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, createApiClient } from '../src/api/client';
import { BACKUP_SUFFIX, createGuardedClient } from '../src/auth/guard';
import { accessToken, isDefiniteAuthError, readSession, refreshedToken } from '../src/auth/session';
import type { HttpFn } from '../src/lib/http';
import { settlesWithin } from './helpers';

const KEY = 'holler-auth';

function expiredSession() {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: 'expired-access',
    refresh_token: 'refresh-1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now - 600,
    user: { id: 'user-1', aud: 'authenticated', email: 'a@b.co', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
}

function memoryStorage() {
  const data = new Map<string, string>([[KEY, JSON.stringify(expiredSession())]]);
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => void data.set(k, v),
    removeItem: async (k: string) => void data.delete(k),
  };
}

// The app's own client: the guarded storage and fetch of src/auth/guard.ts.
function sb(fetchImpl: typeof fetch) {
  const storage = memoryStorage();
  const { client, guard } = createGuardedClient('https://example.supabase.co', 'anon-key', { storage, storageKey: KEY, fetch: fetchImpl, autoRefreshToken: false });
  return { auth: client.auth, storage, guard, client };
}

const offlineFetch = (async () => {
  throw new TypeError('Failed to fetch');
}) as unknown as typeof fetch;

function jsonFetch(status: number, body: unknown) {
  return (async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}

function apiWith(getToken: () => Promise<string | null>, refresh: () => Promise<string | null>, responses: Array<{ status: number; data: unknown }> = []) {
  const http: HttpFn = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next;
  });
  const onUnauthorized = vi.fn();
  const api = createApiClient({ baseUrl: 'https://localholler.com', http, getToken, refresh, onUnauthorized });
  return { api, http, onUnauthorized };
}

describe('offline is not signed out (review r6 P1)', () => {
  it('an expired session with no network: network error, no sign-out, session kept, no 25 s wait', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { auth, storage } = sb(offlineFetch);
    const started = Date.now();
    expect(await settlesWithin(readSession(auth, 300), 2000)).toEqual({ kind: 'offline' });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(storage.data.has(KEY)).toBe(true);

    const { api, http, onUnauthorized } = apiWith(() => accessToken(auth, 300), () => refreshedToken(auth, 300));
    await expect(settlesWithin(api.me(), 2000)).rejects.toMatchObject({ code: 'network' });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    expect(storage.data.has(KEY)).toBe(true);
  });

  it('a 401 followed by a refresh that cannot reach Supabase is a network error, not a sign-out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { auth } = sb(offlineFetch);
    const { api, onUnauthorized } = apiWith(async () => 'still-valid-token', () => refreshedToken(auth, 300), [{ status: 401, data: { ok: false, error: 'unauthorized' } }]);
    await expect(settlesWithin(api.me(), 2000)).rejects.toMatchObject({ code: 'network' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('Supabase Auth answering 429 or 503 is never treated as signed out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const [status, body] of [
      [429, { code: 'over_request_rate_limit', message: 'Too many requests' }],
      [503, { message: 'unavailable' }],
    ] as const) {
      const { auth } = sb(jsonFetch(status, body));
      const { api, onUnauthorized } = apiWith(() => accessToken(auth, 1500), () => refreshedToken(auth, 1500));
      await expect(settlesWithin(api.me(), 3000)).rejects.toMatchObject({ code: 'network' });
      expect(onUnauthorized).not.toHaveBeenCalled();
    }
  });

  it('Supabase reporting the refresh token invalid signs out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { auth } = sb(jsonFetch(400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' }));
    const { api, onUnauthorized } = apiWith(() => accessToken(auth, 1500), () => refreshedToken(auth, 1500));
    await expect(settlesWithin(api.me(), 3000)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('nothing stored is signed out', async () => {
    const storage = { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined };
    const client = createClient('https://example.supabase.co', 'anon-key', {
      auth: { storage, storageKey: KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: offlineFetch },
    });
    expect(await readSession(client.auth, 300)).toEqual({ kind: 'none' });
  });

  it('a getSession that never answers is offline, not signed out', async () => {
    const never = { getSession: () => new Promise<never>(() => undefined), refreshSession: () => new Promise<never>(() => undefined) };
    expect(await settlesWithin(readSession(never, 30), 500)).toEqual({ kind: 'offline' });
    await expect(settlesWithin(refreshedToken(never, 30), 500)).rejects.toBeInstanceOf(ApiCallError);
  });

  it('classifies auth errors', () => {
    expect(isDefiniteAuthError(null)).toBe(false);
    expect(isDefiniteAuthError(new TypeError('x'))).toBe(false);
  });
});

// Review v3 P1: supabase-js 2.119.1 deletes the stored session itself on a 429, a 5xx outside
// 500-530 and a non-JSON 4xx. The guard puts it back; only a definite rejection signs out.
describe('a refresh answered with 429, 507 or a portal page never signs out (review v3 P1)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A fake Supabase Auth: answers each refresh from the queue and counts the calls. */
  function authServer(answers: Array<() => Response>) {
    let calls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('grant_type=refresh_token')) throw new Error(`unexpected ${url}`);
      calls += 1;
      const next = answers.shift();
      if (!next) throw new Error('no more answers');
      return next();
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  }

  const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const html = (status: number) => () => new Response('<html><body>Log in to the hotel Wi-Fi</body></html>', { status, headers: { 'Content-Type': 'text/html' } });
  const goodRefresh = () =>
    json(200, {
      access_token: 'fresh-access',
      refresh_token: 'refresh-2',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: expiredSession().user,
    })();

  /** One API call through the real client wiring; returns 'ok' or the ApiCallError code. */
  function memberApi(auth: Parameters<typeof accessToken>[0]) {
    const tokens: string[] = [];
    const http: HttpFn = vi.fn(async (req) => {
      tokens.push(String((req.headers as Record<string, string> | undefined)?.Authorization ?? ''));
      return { status: 200, data: { ok: true } };
    });
    const onUnauthorized = vi.fn();
    const api = createApiClient({ baseUrl: 'https://localholler.com', http, getToken: () => accessToken(auth, 1500), refresh: () => refreshedToken(auth, 1500), onUnauthorized });
    const call = () => settlesWithin(api.me(), 3000).then(
      () => 'ok',
      (e: unknown) => (e instanceof ApiCallError ? e.code : 'thrown'),
    );
    return { call, onUnauthorized, tokens };
  }

  /** Past supabase-js's 60 s refresh-failure cool-down, so the next read really calls Auth again. */
  const pastCooldown = () => vi.setSystemTime(Date.now() + 61_000);

  for (const [label, first, second] of [
    ['429 then 429', json(429, { code: 'over_request_rate_limit', message: 'Too many requests' }), json(429, { code: 'over_request_rate_limit', message: 'Too many requests' })],
    ['507 then 507', json(507, { message: 'Insufficient storage' }), json(507, { message: 'Insufficient storage' })],
    ['403 HTML then 403 HTML', html(403), html(403)],
  ] as const) {
    it(`${label}: both calls are a network error, the session stays stored, and a later good refresh works`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.useFakeTimers({ toFake: ['Date'] });
      const server = authServer([first, second, goodRefresh]);
      const { auth, storage, client } = sb(server.fetchImpl);
      const events: string[] = [];
      client.auth.onAuthStateChange((e) => void events.push(e));
      const { call, onUnauthorized, tokens } = memberApi(auth);

      expect(await call()).toBe('network');
      expect(storage.data.has(KEY)).toBe(true);
      expect(storage.data.has(KEY + BACKUP_SUFFIX)).toBe(true);

      pastCooldown();
      expect(await call()).toBe('network');
      expect(storage.data.has(KEY)).toBe(true);
      expect(server.calls()).toBe(2);
      expect(onUnauthorized).not.toHaveBeenCalled();
      expect(await readSession(auth, 1500)).toEqual({ kind: 'offline' });

      // Auth is back: the same stored refresh token works and the member carries on.
      pastCooldown();
      expect(await call()).toBe('ok');
      expect(server.calls()).toBe(3);
      expect(tokens).toEqual(['Bearer fresh-access']);
      expect(JSON.parse(storage.data.get(KEY)!).refresh_token).toBe('refresh-2');
      expect(JSON.parse(storage.data.get(KEY + BACKUP_SUFFIX)!).refresh_token).toBe('refresh-2');
      expect(onUnauthorized).not.toHaveBeenCalled();
      // supabase-js still announced SIGNED_OUT; the app asks the guard, which says the session was kept.
      expect(events).toContain('SIGNED_OUT');
    });
  }

  it('the app handler sees "kept" after a 429, so it does not sign out', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = authServer([json(429, { code: 'over_request_rate_limit', message: 'Too many requests' })]);
    const { auth, guard } = sb(server.fetchImpl);
    expect(await readSession(auth, 1500)).toEqual({ kind: 'offline' });
    expect(await guard.outcome()).toBe('kept');
  });

  for (const [label, answer] of [
    ['400 invalid_grant (OAuth style)', json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' })],
    ['400 refresh_token_already_used (GoTrue style)', json(400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' })],
    ['403 JSON auth error', json(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' })],
  ] as const) {
    it(`a real rejection still signs out and deletes the backup: ${label}`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const server = authServer([answer]);
      const { auth, storage, guard } = sb(server.fetchImpl);
      const { call, onUnauthorized } = memberApi(auth);
      expect(await call()).toBe('unauthorized');
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(storage.data.has(KEY)).toBe(false);
      expect(storage.data.has(KEY + BACKUP_SUFFIX)).toBe(false);
      expect(await guard.outcome()).toBe('signed-out');
    });
  }

  it('a 400 with an unknown, non-auth code is not a rejection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = authServer([json(400, { error_code: 'validation_failed', msg: 'bad request' })]);
    const { auth, storage } = sb(server.fetchImpl);
    expect(await readSession(auth, 1500)).toEqual({ kind: 'offline' });
    expect(storage.data.has(KEY)).toBe(true);
  });

  it('our own sign-out removes the session and the backup, even inside the 429 cool-down', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = authServer([json(429, { code: 'over_request_rate_limit', message: 'Too many requests' })]);
    const { auth, storage, guard } = sb(server.fetchImpl);
    expect(await readSession(auth, 1500)).toEqual({ kind: 'offline' });
    expect(storage.data.has(KEY)).toBe(true);
    // As AppContext.signOut does it.
    await guard.beginSignOut();
    expect(storage.data.has(KEY + BACKUP_SUFFIX)).toBe(false);
    await auth.signOut({ scope: 'local' });
    await guard.endSignOut();
    expect(storage.data.has(KEY)).toBe(false);
    expect(storage.data.has(KEY + BACKUP_SUFFIX)).toBe(false);
    expect(await readSession(auth, 1500)).toEqual({ kind: 'none' });
  });

  it('a session removed with no failed refresh before it (stored session invalid) is a real sign-out', async () => {
    const storage = memoryStorage();
    storage.data.set(KEY, JSON.stringify({ nonsense: true }));
    storage.data.set(KEY + BACKUP_SUFFIX, JSON.stringify(expiredSession()));
    const { client, guard } = createGuardedClient('https://example.supabase.co', 'anon-key', { storage, storageKey: KEY, fetch: offlineFetch, autoRefreshToken: false });
    expect(await readSession(client.auth, 1500)).toEqual({ kind: 'none' });
    expect(storage.data.has(KEY + BACKUP_SUFFIX)).toBe(false);
    expect(await guard.outcome()).toBe('signed-out');
  });
});
