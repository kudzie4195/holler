import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { FakeDb } from '../ops/fakedb';
import { buildKeywordVolumeReport, loadKeywordVolumeReport, type StoredVolumeRow } from '../../lib/admin/keyword-volume';
import { buildLocationPlan, storedKeywordFor, LOCATION_TRADES } from '../../lib/dataforseo/location-volume';

const NOW = new Date('2026-11-28T12:00:00Z');
const plan = buildLocationPlan();
const loc = (city: string) => plan.find((p) => p.city === city)!.locationName;
const kw = (trade: string, city: string) => storedKeywordFor(LOCATION_TRADES.find((t) => t.id === trade)!.term, loc(city));
const MONTHLY = (base: number) => Array.from({ length: 12 }, (_, i) => ({ year: i < 2 ? 2025 : 2026, month: i < 2 ? 11 + i : i - 1, search_volume: base + i }));
const row = (trade: string, city: string, volume: number | null, month = '2026-11-01', extra: Partial<StoredVolumeRow> = {}): StoredVolumeRow => ({ keyword: kw(trade, city), location_code: 1015254, month, volume, ...extra });

describe('keyword volume report', () => {
  it('per trade: top cities by monthly searches, biggest first, with the 12 month trend from Google', () => {
    const rows = [
      row('lawn-care', 'Marietta', 500, '2026-11-01', { monthly_searches: MONTHLY(400) }),
      row('lawn-care', 'Roswell', 900, '2026-11-01', { monthly_searches: MONTHLY(800) }),
      row('lawn-care', 'Smyrna', 90),
      row('lawn-care', 'Alpharetta', null),
      row('gutters', 'Cary', 40),
      { keyword: 'lawn care marietta', location_code: 2840, month: '2026-11-01', volume: 9999 }, // national row: ignored
      { keyword: 'lawn care @ nowhere,georgia,united states', location_code: 5, month: '2026-11-01', volume: 7 }, // not in the plan: ignored
    ];
    const rep = buildKeywordVolumeReport(rows, NOW, { limit: 2 });
    expect(rep.latestMonth).toBe('2026-11-01');
    expect(rep.rowsRead).toBe(5);
    expect(rep.trades.map((t) => t.trade)).toEqual(['landscaping', 'lawn-care', 'gutters', 'pressure-washing']);
    const lawn = rep.trades.find((t) => t.trade === 'lawn-care')!;
    expect(lawn.cities.map((c) => [c.city, c.monthlySearches])).toEqual([['Roswell', 900], ['Marietta', 500]]);
    expect(lawn.citiesWithData).toBe(3);
    expect(lawn.citiesAsked).toBe(4);
    expect(lawn.cities[0]).toMatchObject({ metro: 'atlanta', state: 'GA', core: false, trendSource: 'google_12_months' });
    expect(lawn.cities[0].trend).toHaveLength(12);
    expect(lawn.cities[0].trend[0]).toEqual({ month: '2025-11', searches: 800 });
    expect(lawn.cities[0].trend[11].month).toBe('2026-10');
    expect(lawn.cities[0].trendAverage).toBe(806);
    expect(rep.trades.find((t) => t.trade === 'gutters')!.cities[0]).toMatchObject({ city: 'Cary', metro: 'raleigh' });
    expect(rep.trades.find((t) => t.trade === 'landscaping')!.cities).toEqual([]);
  });

  it('without Google trend data (migration 0040 not applied) the trend is the months the job stored', () => {
    const rows = [row('lawn-care', 'Marietta', 300, '2026-09-01'), row('lawn-care', 'Marietta', 320, '2026-10-01'), row('lawn-care', 'Marietta', 350, '2026-11-01')];
    const c = buildKeywordVolumeReport(rows, NOW).trades.find((t) => t.trade === 'lawn-care')!.cities[0];
    expect(c).toMatchObject({ monthlySearches: 350, fetchedMonth: '2026-11-01', trendSource: 'stored_months' });
    expect(c.trend).toEqual([{ month: '2026-09', searches: 300 }, { month: '2026-10', searches: 320 }, { month: '2026-11', searches: 350 }]);
  });

  it('filters by trade and metro; limit is capped at 50', () => {
    const rows = [row('lawn-care', 'Marietta', 5), row('lawn-care', 'Cary', 6), row('gutters', 'Cary', 7)];
    const rep = buildKeywordVolumeReport(rows, NOW, { trade: 'lawn-care', metro: 'raleigh', limit: 500 });
    expect(rep.limit).toBe(50);
    expect(rep.trades.map((t) => t.trade)).toEqual(['lawn-care']);
    expect(rep.trades[0].cities.map((c) => c.city)).toEqual(['Cary']);
  });

  it('empty before the first run', () => {
    const rep = buildKeywordVolumeReport([], NOW);
    expect(rep.latestMonth).toBeNull();
    expect(rep.trades.every((t) => t.cities.length === 0)).toBe(true);
  });

  it('loadKeywordVolumeReport reads the table and retries without monthly_searches when that column is missing', async () => {
    const db = new FakeDb({ holler_keyword_volume: [{ ...row('lawn-care', 'Marietta', 12) }, { keyword: 'lawn care marietta', location_code: 2840, month: '2026-11-01', volume: 9 }] });
    const real = db.from.bind(db);
    let first = true;
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = real(t) as { select: (c: string) => unknown };
      const sel = b.select.bind(b);
      b.select = (cols: string) => {
        if (first && cols.includes('monthly_searches')) {
          first = false;
          const failing: Record<string, unknown> = {
            neq: () => failing,
            order: () => failing,
            range: () => failing,
            then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: '42703', message: 'column "monthly_searches" does not exist' } }).then(ok),
          };
          return failing;
        }
        return sel(cols);
      };
      return b;
    };
    const rep = await loadKeywordVolumeReport(db as never, NOW);
    expect(rep.rowsRead).toBe(1);
    expect(rep.trades.find((t) => t.trade === 'lawn-care')!.cities[0]).toMatchObject({ city: 'Marietta', monthlySearches: 12 });
  });
});

describe('GET /api/admin/keyword-volume', () => {
  const SECRET = 'right-secret-for-tests-0123456789';
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/supabase/admin');
  });
  const load = async (db: unknown) => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', SECRET);
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => db }));
    return (await import('@/app/api/admin/keyword-volume/route')).GET;
  };
  const url = 'https://localholler.com/api/admin/keyword-volume';
  const auth = { authorization: `Bearer ${SECRET}` };

  it('401 without the Bearer secret (also with ?key= or a wrong token); JSON with it, no store, noindex', async () => {
    const db = new FakeDb({ holler_keyword_volume: [row('lawn-care', 'Marietta', 12)] });
    const GET = await load(db);
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect((await GET(new NextRequest(`${url}?key=${SECRET}`))).status).toBe(401);
    expect((await GET(new NextRequest(url, { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    expect(db.calls).toEqual([]);
    const ok = await GET(new NextRequest(url, { headers: auth }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('x-robots-tag')).toContain('noindex');
    const body = (await ok.json()) as { trades: { trade: string; cities: { city: string }[] }[] };
    expect(body.trades.find((t) => t.trade === 'lawn-care')!.cities[0].city).toBe('Marietta');
  });

  it('401 when CRON_SECRET is unset, even with a header', async () => {
    vi.resetModules();
    vi.stubEnv('CRON_SECRET', '');
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => new FakeDb({}) }));
    const { GET } = await import('@/app/api/admin/keyword-volume/route');
    expect((await GET(new NextRequest(url, { headers: { authorization: 'Bearer ' } }))).status).toBe(401);
  });

  it('400 for an unknown trade, metro or limit; 503 without a database; 500 hides the error text', async () => {
    const GET = await load(new FakeDb({ holler_keyword_volume: [] }));
    expect((await GET(new NextRequest(`${url}?trade=roofing`, { headers: auth }))).status).toBe(400);
    expect((await GET(new NextRequest(`${url}?metro=nyc`, { headers: auth }))).status).toBe(400);
    expect((await GET(new NextRequest(`${url}?limit=0`, { headers: auth }))).status).toBe(400);
    expect((await GET(new NextRequest(`${url}?limit=51`, { headers: auth }))).status).toBe(400);
    expect((await GET(new NextRequest(`${url}?limit=3&trade=gutters&metro=raleigh`, { headers: auth }))).status).toBe(200);

    vi.resetModules();
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('missing env'); } }));
    expect((await (await import('@/app/api/admin/keyword-volume/route')).GET(new NextRequest(url, { headers: auth }))).status).toBe(503);

    const bad = new FakeDb({ holler_keyword_volume: [] });
    bad.failOn['holler_keyword_volume.select'] = 'relation secret_table_name exploded';
    const GET2 = await load(bad);
    const res = await GET2(new NextRequest(url, { headers: auth }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('exploded');
  });
});
