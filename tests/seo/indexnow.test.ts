import { describe, expect, it, vi } from 'vitest';
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_MAX_URLS_PER_POST,
  INDEXNOW_RUN_CAP,
  buildPayload,
  indexNowConfig,
  isValidKey,
  pingNewSignals,
  postUrls,
  recentlyPinged,
  selectPingUrls,
  type IndexNowConfig,
} from '../../lib/seo/indexnow';
import { CITIES, cityPath } from '../../lib/geo';
import { FakeDb } from '../ops/fakedb';

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const SITE = 'https://holler.example';
const CFG: IndexNowConfig = { key: KEY, host: 'holler.example', origin: SITE, keyLocation: `${SITE}/indexnow-key.txt` };
const NOW = new Date('2026-11-17T12:00:00Z'); // Tuesday; Monday is 2026-11-16
const url = (p: string) => `${SITE}${p}`;

describe('key and config', () => {
  it('key format: 8 to 128 of letters, digits and dashes', () => {
    expect(isValidKey(KEY)).toBe(true);
    expect(isValidKey('abcd-EFG-1234')).toBe(true);
    expect(isValidKey('a'.repeat(8))).toBe(true);
    expect(isValidKey('a'.repeat(128))).toBe(true);
    expect(isValidKey('a'.repeat(7))).toBe(false);
    expect(isValidKey('a'.repeat(129))).toBe(false);
    expect(isValidKey('has space 12345')).toBe(false);
    expect(isValidKey('under_score_123')).toBe(false);
    expect(isValidKey('')).toBe(false);
    expect(isValidKey(undefined)).toBe(false);
  });
  it('builds the config from the key and the site URL', () => {
    expect(indexNowConfig({ INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'https://holler.example/' })).toEqual(CFG);
    expect(indexNowConfig({ INDEXNOW_KEY: ` ${KEY} `, NEXT_PUBLIC_SITE_URL: 'https://www.holler.example' })).toMatchObject({ host: 'www.holler.example', keyLocation: 'https://www.holler.example/indexnow-key.txt' });
  });
  it('is null (skip silently) with no key, a bad key, no site, a bad site or localhost', () => {
    for (const e of [
      {},
      { NEXT_PUBLIC_SITE_URL: SITE },
      { INDEXNOW_KEY: KEY },
      { INDEXNOW_KEY: 'short', NEXT_PUBLIC_SITE_URL: SITE },
      { INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'not a url' },
      { INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'ftp://holler.example' },
      { INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' },
      { INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000' },
      { INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'http://app.localhost' },
      { INDEXNOW_KEY: KEY, NEXT_PUBLIC_SITE_URL: 'http://[::1]:3000' },
    ]) {
      expect(indexNowConfig(e), JSON.stringify(e)).toBeNull();
    }
  });
});

describe('payload shape (IndexNow documentation)', () => {
  it('is host, key, keyLocation and urlList, and nothing else', () => {
    const p = buildPayload(CFG, [url('/local/georgia/atlanta-ga')]);
    expect(p).toEqual({ host: 'holler.example', key: KEY, keyLocation: `${SITE}/indexnow-key.txt`, urlList: [`${SITE}/local/georgia/atlanta-ga`] });
    expect(Object.keys(p)).toEqual(['host', 'key', 'keyLocation', 'urlList']);
  });
  it('POSTs JSON to the shared endpoint with the documented content type', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const out = await postUrls(CFG, [url('/a')], { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toEqual({ status: 'sent', urls: 1, httpStatus: 200 });
    const [endpoint, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe(INDEXNOW_ENDPOINT);
    expect(INDEXNOW_ENDPOINT).toBe('https://api.indexnow.org/indexnow');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json; charset=utf-8');
    expect(JSON.parse(init.body as string)).toEqual(buildPayload(CFG, [url('/a')]));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('202 counts as sent; 400, 403, 422 and 429 are failures with a reason', async () => {
    const log = vi.fn();
    const mk = (s: number) => vi.fn(async () => new Response('', { status: s })) as unknown as typeof fetch;
    expect(await postUrls(CFG, ['u'], { fetchImpl: mk(202), log })).toMatchObject({ status: 'sent', httpStatus: 202 });
    for (const s of [400, 403, 422, 429, 500]) {
      const o = await postUrls(CFG, ['u'], { fetchImpl: mk(s), log });
      expect(o.status).toBe('failed');
      expect((o as { error: string }).error).toContain(String(s));
    }
    expect(log).toHaveBeenCalledTimes(5);
  });
  it('never sends more than 10,000 URLs in one POST, and sends nothing for an empty list', async () => {
    expect(INDEXNOW_MAX_URLS_PER_POST).toBe(10_000);
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const many = Array.from({ length: 10_050 }, (_, i) => `${SITE}/p/${i}`);
    const out = await postUrls(CFG, many, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out).toMatchObject({ status: 'sent', urls: 10_000 });
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).urlList).toHaveLength(10_000);
    expect(await postUrls(CFG, [], { fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ status: 'skipped', reason: 'nothing-to-send' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('selectPingUrls', () => {
  const touched = (m: Record<string, boolean>) => new Map(Object.entries(m).map(([k, v]) => [k, { currentWeek: v }]));
  it('city page when the 60 day count is indexable, plus the current weekly page when that week has 10 records', () => {
    const urls = selectPingUrls({
      touched: touched({ 'atlanta-ga': true, 'raleigh-nc': true, 'dallas-tx': true, 'austin-tx': false }),
      counts60: { 'atlanta-ga': 40, 'raleigh-nc': 5, 'dallas-tx': 4, 'austin-tx': 99 },
      weekCounts: { 'atlanta-ga': 10, 'raleigh-nc': 9, 'dallas-tx': 50, 'austin-tx': 50 },
      nowMs: NOW.getTime(),
      url,
    });
    expect(urls).toEqual([
      // city pages first, in slug order
      `${SITE}/local/georgia/atlanta-ga`, // 40 >= 5
      `${SITE}/local/texas/austin-tx`, // indexable, but no new row this week so no weekly page
      `${SITE}/local/north-carolina/raleigh-nc`, // 5 >= 5 (its weekly page: 9 < 10, not sent)
      // then weekly pages
      `${SITE}/local/georgia/atlanta-ga/week/2026-11-16`, // 10 >= 10
      `${SITE}/local/texas/dallas-tx/week/2026-11-16`, // city page not sent (4 < 5), but the week has 50 records
    ]);
  });
  it('skips unknown slugs and places with no counts', () => {
    expect(selectPingUrls({ touched: touched({ 'nowhere-xx': true, 'atlanta-ga': true }), counts60: {}, weekCounts: {}, nowMs: NOW.getTime(), url })).toEqual([]);
  });
  it('caps at 200 by default, city pages first', () => {
    const cities = CITIES.slice(0, 300);
    const t = touched(Object.fromEntries(cities.map((c) => [c.slug, true])));
    const counts = Object.fromEntries(cities.map((c) => [c.slug, 50]));
    const urls = selectPingUrls({ touched: t, counts60: counts, weekCounts: counts, nowMs: NOW.getTime(), url });
    expect(INDEXNOW_RUN_CAP).toBe(200);
    expect(urls).toHaveLength(200);
    expect(urls.some((u) => u.includes('/week/'))).toBe(false); // 300 city pages fill the cap before any weekly page
    expect(new Set(urls).size).toBe(200);
    const small = selectPingUrls({ touched: t, counts60: counts, weekCounts: counts, nowMs: NOW.getTime(), url, cap: 3 });
    expect(small).toHaveLength(3);
    expect(small[0]).toBe(url(cityPath(cities.map((c) => c).sort((a, b) => a.slug.localeCompare(b.slug))[0])));
  });
});

describe('pingNewSignals', () => {
  const seed = () =>
    new FakeDb({
      holler_place_counts: [
        { place_slug: 'atlanta-ga', signals_60d: 40 },
        { place_slug: 'dallas-tx', signals_60d: 2 },
      ],
      holler_signals: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, place_slug: 'atlanta-ga', occurred_at: `2026-11-16T0${i % 9}:00:00Z` })),
    });
  const fresh = (over: Partial<Parameters<typeof pingNewSignals>[0]> = {}) => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 200 }));
    const log = vi.fn();
    return { fetchImpl, log, input: { db: seed(), inserted: [{ place_slug: 'atlanta-ga', occurred_at: '2026-11-17T10:00:00Z' }], now: NOW, config: CFG, fetchImpl: fetchImpl as unknown as typeof fetch, log, memory: new Map<string, number>(), ...over } };
  };

  it('sends one POST with the city page and the current weekly page of places that got new rows', async () => {
    const { fetchImpl, input } = fresh();
    const out = await pingNewSignals(input);
    expect(out).toMatchObject({ status: 'sent', urls: 2 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.urlList.map((u: string) => new URL(u).pathname)).toEqual(['/local/georgia/atlanta-ga', '/local/georgia/atlanta-ga/week/2026-11-16']);
    expect(body.host).toBe('holler.example');
    expect(body.keyLocation).toBe(`${SITE}/indexnow-key.txt`);
  });
  it('only indexable pages: a thin place sends nothing, and an old-only row sends no weekly page', async () => {
    const thin = fresh({ inserted: [{ place_slug: 'dallas-tx', occurred_at: '2026-11-17T10:00:00Z' }] });
    expect(await pingNewSignals(thin.input)).toEqual({ status: 'skipped', reason: 'nothing-to-send' });
    expect(thin.fetchImpl).not.toHaveBeenCalled();
    const old = fresh({ inserted: [{ place_slug: 'atlanta-ga', occurred_at: '2026-10-01T10:00:00Z' }] });
    expect(await pingNewSignals(old.input)).toMatchObject({ status: 'sent', urls: 1 });
  });
  it('ignores rows with no place and does no reads for them', async () => {
    const { fetchImpl, input } = fresh({ inserted: [{ place_slug: null, occurred_at: '2026-11-17T10:00:00Z' }, { occurred_at: '2026-11-17T10:00:00Z' }] });
    expect(await pingNewSignals(input)).toEqual({ status: 'skipped', reason: 'nothing-to-send' });
    expect((input.db as FakeDb).calls).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('skips silently without a key, or for localhost: no reads, no fetch, no log', async () => {
    const { fetchImpl, log, input } = fresh({ config: null });
    expect(await pingNewSignals(input)).toEqual({ status: 'skipped', reason: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect((input.db as FakeDb).calls).toEqual([]);
  });
  it('does not repeat a URL within the hour', async () => {
    const a = fresh();
    await pingNewSignals(a.input);
    const again = fresh({ memory: a.input.memory });
    expect(await pingNewSignals(again.input)).toEqual({ status: 'skipped', reason: 'nothing-to-send' });
    expect(again.fetchImpl).not.toHaveBeenCalled();
    expect(recentlyPinged(`${SITE}/local/georgia/atlanta-ga`, NOW.getTime(), a.input.memory)).toBe(true);
    expect(recentlyPinged(`${SITE}/local/georgia/atlanta-ga`, NOW.getTime() + 61 * 60_000, a.input.memory)).toBe(false);
  });
  it('a failed POST is logged, returned, and not remembered as sent', async () => {
    const { log, input } = fresh({ fetchImpl: vi.fn(async () => new Response('', { status: 429 })) as unknown as typeof fetch });
    const out = await pingNewSignals(input);
    expect(out.status).toBe('failed');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('429'));
    expect(input.memory!.size).toBe(0);
  });
});

describe('failure isolation', () => {
  it('a network error, a database error and a throwing log never throw out of pingNewSignals', async () => {
    const boom = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const db = new FakeDb({ holler_place_counts: [{ place_slug: 'atlanta-ga', signals_60d: 40 }] });
    const base = { inserted: [{ place_slug: 'atlanta-ga', occurred_at: '2026-11-17T10:00:00Z' }], now: NOW, config: CFG, memory: new Map<string, number>() };
    expect(await pingNewSignals({ ...base, db, fetchImpl: boom, log: () => {} })).toMatchObject({ status: 'failed', error: 'ECONNRESET' });
    db.failOn['holler_place_counts.select'] = 'view missing';
    expect(await pingNewSignals({ ...base, db, log: () => {} })).toMatchObject({ status: 'failed', error: 'view missing' });
  });
  it('gives up after the timeout when the database hangs', async () => {
    vi.useFakeTimers();
    try {
      const hang = { from: () => ({ select: () => ({ in: () => ({ abortSignal: () => new Promise(() => {}) }) }) }) };
      const log = vi.fn();
      const p = pingNewSignals({ db: hang, inserted: [{ place_slug: 'atlanta-ga', occurred_at: '2026-11-17T10:00:00Z' }], now: NOW, config: CFG, log, memory: new Map() });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await p).toEqual({ status: 'failed', urls: 0, error: 'timeout' });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('5 s'));
    } finally {
      vi.useRealTimers();
    }
  });
  it('postUrls aborts a hanging fetch at the timeout', async () => {
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    const out = await postUrls(CFG, ['u'], { fetchImpl: hang, timeoutMs: 20, log: () => {} });
    expect(out).toMatchObject({ status: 'failed', error: 'aborted' });
  });
});
