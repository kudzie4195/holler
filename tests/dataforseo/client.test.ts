import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MONTHLY_CAP_USD, PRICE_TABLE, dfsCall, estimateUsd, monthKey, monthlyCapUsd } from '../../lib/dataforseo/client';
import { ENV, MONTH, deps, jsonRes, okBody } from './helpers';

const PATH = PRICE_TABLE.searchVolumeLive.path;
const call = (d: ReturnType<typeof deps>['d']) => dfsCall(PATH, { keywords: ['a'], location_code: 2840 }, { kind: 'searchVolumeLive', items: 1 }, d);

describe('not_configured', () => {
  it.each([
    ['no login', { DATAFORSEO_PASSWORD: 'x' }],
    ['no password', { DATAFORSEO_LOGIN: 'x' }],
    ['neither', {}],
    ['blank values', { DATAFORSEO_LOGIN: ' ', DATAFORSEO_PASSWORD: '' }],
  ])('%s: returns not_configured, no fetch, no database write, no throw', async (_n, env) => {
    const { d, db, fetch } = deps({ env });
    const r = await call(d);
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });
});

describe('cap', () => {
  it('default is 30 and a bad value falls back to it', () => {
    expect(DEFAULT_MONTHLY_CAP_USD).toBe(30);
    expect(monthlyCapUsd({})).toBe(30);
    expect(monthlyCapUsd({ DATAFORSEO_MONTHLY_CAP_USD: 'abc' })).toBe(30);
    expect(monthlyCapUsd({ DATAFORSEO_MONTHLY_CAP_USD: '-5' })).toBe(30);
    expect(monthlyCapUsd({ DATAFORSEO_MONTHLY_CAP_USD: '12.5' })).toBe(12.5);
  });

  it('refuses with cap_reached when the call would pass the cap, and does not call the API', async () => {
    const { d, db, fetch } = deps();
    db.tables.holler_dataforseo_spend.push({ id: 1, month: MONTH, cost_usd: 29.95, status: 'ok' });
    const r = await call(d);
    expect(r).toMatchObject({ ok: false, reason: 'cap_reached', capUsd: 30 });
    expect(fetch).not.toHaveBeenCalled();
    // the reservation is released: the refused row costs nothing
    const rows = db.tables.holler_dataforseo_spend;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: 'refused', cost_usd: 0 });
  });

  it('allows a call that lands exactly on the cap', async () => {
    const { d, db, fetch } = deps();
    db.tables.holler_dataforseo_spend.push({ id: 1, month: MONTH, cost_usd: 29.925, status: 'ok' });
    const r = await call(d);
    expect(r.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('only this month counts; last month spend does not block', async () => {
    const { d, db } = deps();
    db.tables.holler_dataforseo_spend.push({ id: 1, month: '2026-10-01', cost_usd: 500, status: 'ok' });
    expect((await call(d)).ok).toBe(true);
  });

  it('honours DATAFORSEO_MONTHLY_CAP_USD', async () => {
    const { d, db } = deps({ env: { ...ENV, DATAFORSEO_MONTHLY_CAP_USD: '1' } });
    db.tables.holler_dataforseo_spend.push({ id: 1, month: MONTH, cost_usd: 0.95, status: 'ok' });
    expect(await call(d)).toMatchObject({ ok: false, reason: 'cap_reached', capUsd: 1 });
  });

  it('fails closed when the spend table cannot be written or read', async () => {
    const a = deps();
    a.db.failOn['holler_dataforseo_spend.insert'] = 'relation does not exist';
    expect(await call(a.d)).toMatchObject({ ok: false, reason: 'spend_unavailable' });
    expect(a.fetch).not.toHaveBeenCalled();

    const b = deps();
    b.db.failOn['holler_dataforseo_spend.select'] = 'boom';
    expect(await call(b.d)).toMatchObject({ ok: false, reason: 'spend_unavailable' });
    expect(b.fetch).not.toHaveBeenCalled();

    const c = deps({ db: null });
    expect(await call(c.d)).toMatchObject({ ok: false, reason: 'spend_unavailable' });
    expect(c.fetch).not.toHaveBeenCalled();
  });
});

describe('cost recorded from the response', () => {
  it('stores the real cost, not the estimate', async () => {
    const f = vi.fn(async () => jsonRes(okBody([], 0.0613)));
    const { d, db } = deps({ fetch: f });
    const r = await call(d);
    expect(r).toMatchObject({ ok: true, cost: 0.0613 });
    const row = db.tables.holler_dataforseo_spend[0];
    expect(row).toMatchObject({ status: 'ok', cost_usd: 0.0613, estimated_usd: estimateUsd('searchVolumeLive', 1), month: MONTH, endpoint: PATH });
  });

  it('a task level cost is used when the top level has none', async () => {
    const body = okBody([], 0.2);
    delete (body as { cost?: number }).cost;
    const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(body)) });
    await call(d);
    expect(db.tables.holler_dataforseo_spend[0].cost_usd).toBe(0.2);
  });

  it('an ok response without any cost is booked at the estimate', async () => {
    const body = okBody([], 0);
    delete (body as { cost?: number }).cost;
    delete (body.tasks[0] as { cost?: number }).cost;
    const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(body)) });
    await call(d);
    expect(db.tables.holler_dataforseo_spend[0].cost_usd).toBe(estimateUsd('searchVolumeLive', 1));
  });

  it('a task level error is an api_error and books the reported cost (zero)', async () => {
    const body = okBody(null, 0);
    body.tasks[0].status_code = 40501;
    const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(body)) });
    expect(await call(d)).toMatchObject({ ok: false, reason: 'api_error' });
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ status: 'error', cost_usd: 0 });
  });

  it('a 200 with an unreadable body fails soft and is booked at the estimate', async () => {
    const { d, db } = deps({ fetch: vi.fn(async () => new Response('<html>oops</html>', { status: 200 })) });
    expect(await call(d)).toMatchObject({ ok: false, reason: 'bad_shape' });
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ status: 'unknown', cost_usd: estimateUsd('searchVolumeLive', 1) });
  });

  it('a timeout or network error is booked at the estimate and not retried', async () => {
    const f = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    const { d, db } = deps({ fetch: f });
    expect(await call(d)).toMatchObject({ ok: false, reason: 'network_error' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ status: 'unknown', cost_usd: estimateUsd('searchVolumeLive', 1) });
  });
});

describe('implausible cost (review P2-2)', () => {
  it.each([123456789, 1000.01, -3, 1e308])('a reported cost of %s is booked at the estimate and logs a warning', async (cost) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const body = okBody([], cost);
    const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(body)) });
    const r = await call(d);
    expect(r.ok).toBe(true);
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ status: 'ok', cost_usd: estimateUsd('searchVolumeLive', 1) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(ENV.DATAFORSEO_PASSWORD);
    warn.mockRestore();
  });
  it('0 and 1000 are believed', async () => {
    for (const cost of [0, 1000]) {
      const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(okBody([], cost))) });
      await call(d);
      expect(db.tables.holler_dataforseo_spend[0].cost_usd).toBe(cost);
    }
  });
});

describe('retry rule', () => {
  it('one retry on 5xx, then success', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(jsonRes(okBody([], 0.075)));
    const { d, db } = deps({ fetch: f });
    expect((await call(d)).ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    // the failed attempt is booked at what it reported (nothing), the retry has its own reservation and books its real cost
    const rows = db.tables.holler_dataforseo_spend;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: 'error', cost_usd: 0 });
    expect(rows[1]).toMatchObject({ status: 'ok', cost_usd: 0.075 });
  });

  it('a billed 5xx keeps its real cost in the books, and the retry adds its own (review P2-1)', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonRes(okBody([], 0.075), 500)).mockResolvedValueOnce(jsonRes(okBody([], 0.075)));
    const { d, db } = deps({ fetch: f });
    expect((await call(d)).ok).toBe(true);
    const rows = db.tables.holler_dataforseo_spend;
    expect(rows.map((r) => r.cost_usd)).toEqual([0.075, 0.075]);
    expect(rows.reduce((a, r) => a + Number(r.cost_usd), 0)).toBeCloseTo(0.15, 5);
  });

  it('the retry is reserved first: when the cap cannot hold a second call, no second request is made', async () => {
    const f = vi.fn().mockResolvedValueOnce(jsonRes(okBody([], 0.075), 500)).mockResolvedValueOnce(jsonRes(okBody([], 0.075)));
    const { d, db } = deps({ fetch: f, env: { ...ENV, DATAFORSEO_MONTHLY_CAP_USD: '0.1' } });
    const r = await call(d);
    expect(r).toMatchObject({ ok: false, reason: 'cap_reached' });
    expect(f).toHaveBeenCalledTimes(1);
    const rows = db.tables.holler_dataforseo_spend;
    expect(rows[0]).toMatchObject({ status: 'error', cost_usd: 0.075 });
    expect(rows[1]).toMatchObject({ status: 'refused', cost_usd: 0 });
  });

  it('5xx twice: exactly two requests, then http_error', async () => {
    const f = vi.fn(async () => new Response('', { status: 500 }));
    const { d, db } = deps({ fetch: f });
    expect(await call(d)).toMatchObject({ ok: false, reason: 'http_error', httpStatus: 500 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ status: 'error', cost_usd: 0 });
  });

  it.each([400, 401, 402, 404, 429])('%i: no retry', async (status) => {
    const f = vi.fn(async () => new Response('', { status }));
    const { d } = deps({ fetch: f });
    expect(await call(d)).toMatchObject({ ok: false, reason: 'http_error', httpStatus: status });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('request and secrets', () => {
  it('posts a one element array with Basic auth to the v3 path', async () => {
    const f = vi.fn(async () => jsonRes(okBody([], 0.075)));
    const { d } = deps({ fetch: f });
    await call(d);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual([{ keywords: ['a'], location_code: 2840 }]);
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toBe('Basic ' + Buffer.from(`${ENV.DATAFORSEO_LOGIN}:${ENV.DATAFORSEO_PASSWORD}`).toString('base64'));
  });

  it('credentials never reach the database, the result or the console', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    for (const f of [vi.fn(async () => new Response('', { status: 401 })), vi.fn(async () => { throw new Error(`bad ${ENV.DATAFORSEO_PASSWORD}`); })]) {
      const { d, db } = deps({ fetch: f });
      const r = await call(d);
      const all = JSON.stringify([r, db.tables]);
      expect(all).not.toContain(ENV.DATAFORSEO_PASSWORD);
      expect(all).not.toContain(ENV.DATAFORSEO_LOGIN);
      expect(all).not.toContain(Buffer.from(`${ENV.DATAFORSEO_LOGIN}:${ENV.DATAFORSEO_PASSWORD}`).toString('base64'));
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });

  it('prices: one table, live price verified', () => {
    expect(PRICE_TABLE.searchVolumeLive.perTaskUsd).toBe(0.075);
    expect(PRICE_TABLE.searchVolumeLive.verified).toBe(true);
    expect(estimateUsd('llmMentionsSearch', 25)).toBeCloseTo(0.125, 5);
    expect(monthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-01');
  });
});
