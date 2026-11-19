import { describe, expect, it, vi } from 'vitest';
import { ApiCallError, createApiClient, NETWORK_MESSAGE, readResult } from '../src/api/client';
import type { HttpFn, HttpRequest } from '../src/lib/http';

function client(responses: Array<{ status: number; data: unknown } | Error>, opts: { token?: string | null; fresh?: string | null } = {}) {
  const calls: HttpRequest[] = [];
  const http: HttpFn = async (req) => {
    calls.push(req);
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  };
  const onUnauthorized = vi.fn();
  const refresh = vi.fn(async () => (opts.fresh === undefined ? 'fresh-token' : opts.fresh));
  const api = createApiClient({
    baseUrl: 'https://localholler.com/',
    http,
    getToken: async () => (opts.token === undefined ? 'access-token' : opts.token),
    refresh,
    onUnauthorized,
  });
  return { api, calls, onUnauthorized, refresh };
}

const meBody = { ok: true, user: { id: 'u1', email: 'a@b.co' }, needsOnboarding: true, profile: null, access: null, limits: { serviceAreas: 1, extraZips: 0, trades: 5, keywordWatches: 0 } };

describe('readResult', () => {
  it('returns the body on ok:true', () => {
    expect(readResult(200, { ok: true, x: 1 })).toEqual({ ok: true, x: 1 });
  });
  it('throws the server code, message and field errors', () => {
    try {
      readResult(400, { ok: false, error: 'invalid', message: 'Check the ZIP.', fieldErrors: { zip: 'Enter a 5-digit ZIP code.' } });
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiCallError);
      const err = e as ApiCallError;
      expect(err.code).toBe('invalid');
      expect(err.message).toBe('Check the ZIP.');
      expect(err.fieldErrors.zip).toBe('Enter a 5-digit ZIP code.');
      expect(err.status).toBe(400);
    }
  });
  it('maps a bare 5xx or a non-JSON body to server_error', () => {
    expect(() => readResult(502, null)).toThrowError(ApiCallError);
    try {
      readResult(502, '<html>');
    } catch (e) {
      expect((e as ApiCallError).code).toBe('server_error');
    }
  });
  it('a 503 unavailable (sign-in service busy) is a network-type error with the server message, never unauthorized', () => {
    try {
      readResult(503, { ok: false, error: 'unavailable', message: 'We could not check your sign-in just now. Try again in a moment.' });
      throw new Error('should throw');
    } catch (e) {
      const err = e as ApiCallError;
      expect(err.code).toBe('network');
      expect(err.status).toBe(503);
      expect(err.message).toBe('We could not check your sign-in just now. Try again in a moment.');
    }
  });
  it('never treats ok:true on a 4xx as success', () => {
    expect(() => readResult(404, { ok: true })).toThrowError(ApiCallError);
  });
});

describe('createApiClient', () => {
  it('sends the bearer token on member calls and none on public ones', async () => {
    const { api, calls } = client([{ status: 200, data: meBody }, { status: 200, data: { ok: true, apiVersion: 1 } }]);
    await api.me();
    await api.config();
    expect(calls[0].url).toBe('https://localholler.com/api/m/me');
    expect(calls[0].headers?.Authorization).toBe('Bearer access-token');
    expect(calls[1].url).toBe('https://localholler.com/api/m/config');
    expect(calls[1].headers?.Authorization).toBeUndefined();
  });

  it('sends JSON with a content type only when there is a body', async () => {
    const { api, calls } = client([{ status: 200, data: { ok: true, feedback: { verdict: 'useful', jobValueUsd: null } } }, { status: 200, data: { ok: true, items: [], nextCursor: null, locked: false } }]);
    await api.feedback({ signalId: 7, verdict: 'useful' });
    await api.feed(null);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://localholler.com/api/m/feedback', body: { signalId: 7, verdict: 'useful' } });
    expect(calls[0].headers?.['Content-Type']).toBe('application/json');
    expect(calls[1].headers?.['Content-Type']).toBeUndefined();
  });

  it('encodes the feed cursor and the check query', async () => {
    const { api, calls } = client([
      { status: 200, data: { ok: true, items: [], nextCursor: null, locked: false } },
      { status: 200, data: { ok: true, mode: 'results', groups: [] } },
    ]);
    await api.feed('2026-11-18T10:00:00Z|42');
    await api.check('30080', 'roofing & gutters');
    expect(calls[0].url).toBe('https://localholler.com/api/m/feed?cursor=2026-11-18T10%3A00%3A00Z%7C42');
    expect(calls[1].url).toBe('https://localholler.com/api/m/check?zip=30080&trade=roofing%20%26%20gutters');
  });

  it('DELETE push/register carries the token in the body', async () => {
    const { api, calls } = client([{ status: 200, data: { ok: true } }]);
    await api.unregisterPush('fcm-token');
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: 'https://localholler.com/api/m/push/register', body: { token: 'fcm-token' } });
  });

  it('account delete always sends confirm DELETE', async () => {
    const { api, calls } = client([{ status: 200, data: { ok: true, signOut: true, storeSubscription: null } }]);
    await api.deleteAccount();
    expect(calls[0].body).toEqual({ confirm: 'DELETE' });
  });

  it('on 401 refreshes once and retries with the new token', async () => {
    const { api, calls, refresh, onUnauthorized } = client([{ status: 401, data: { ok: false, error: 'unauthorized', message: 'x' } }, { status: 200, data: meBody }]);
    const me = await api.me();
    expect(me.user.id).toBe('u1');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls[1].headers?.Authorization).toBe('Bearer fresh-token');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out when the retry is still 401', async () => {
    const { api, onUnauthorized } = client([
      { status: 401, data: { ok: false, error: 'unauthorized', message: 'x' } },
      { status: 401, data: { ok: false, error: 'unauthorized', message: 'x' } },
    ]);
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('signs out when the refresh itself fails', async () => {
    const { api, onUnauthorized, calls } = client([{ status: 401, data: null }], { fresh: null });
    await expect(api.me()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls).toHaveLength(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('a member call with no session never reaches the network', async () => {
    const { api, calls, onUnauthorized } = client([], { token: null });
    await expect(api.feed()).rejects.toMatchObject({ code: 'unauthorized' });
    expect(calls).toHaveLength(0);
    expect(onUnauthorized).toHaveBeenCalled();
  });

  it('turns a transport failure into a network error with a plain message', async () => {
    const { api } = client([new Error('offline')]);
    await expect(api.config()).rejects.toMatchObject({ code: 'network', message: NETWORK_MESSAGE });
  });

  it('a member call answered 503 unavailable keeps the session: no refresh, no sign-out, and the next call works', async () => {
    const unavailable = { status: 503, data: { ok: false, error: 'unavailable', message: 'We could not check your sign-in just now. Try again in a moment.' } };
    const { api, onUnauthorized, refresh } = client([unavailable, { status: 200, data: meBody }]);
    await expect(api.me()).rejects.toMatchObject({ code: 'network', status: 503 });
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await expect(api.me()).resolves.toMatchObject({ ok: true });
  });
  it('passes needs_onboarding and not_found through', async () => {
    const { api } = client([
      { status: 409, data: { ok: false, error: 'needs_onboarding', message: 'Finish setting up first.' } },
      { status: 404, data: { ok: false, error: 'not_found', message: 'Not found.' } },
    ]);
    await expect(api.feed()).rejects.toMatchObject({ code: 'needs_onboarding' });
    await expect(api.alert(5)).rejects.toMatchObject({ code: 'not_found' });
  });
});
