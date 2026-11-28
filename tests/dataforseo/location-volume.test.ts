import { describe, expect, it, vi } from 'vitest';
import {
  LOCATION_METROS,
  LOCATION_TRADES,
  buildLocationPlan,
  cleanMonthly,
  expectedLocationCostUsd,
  isMissingColumn,
  parseStoredKeyword,
  refreshLocationVolumes,
  storedKeywordFor,
  tradesMatchCategories,
} from '../../lib/dataforseo/location-volume';
import { expectedVolumeCostUsd, loadDoneKeywords } from '../../lib/dataforseo/volume';
import { QUERIES, QUERY_LIMIT } from '../../lib/dataforseo/llm-mentions';
import { estimateUsd } from '../../lib/dataforseo/client';
import { FakeDb } from '../ops/fakedb';
import { MONTH, deps, jsonRes, okBody } from './helpers';

const sentTasks = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body))[0] as Record<string, unknown>);
const MONTHLY = Array.from({ length: 12 }, (_, i) => ({ year: 2026 - (i >= 10 ? 1 : 0), month: ((10 - i + 11) % 12) + 1, search_volume: 100 + i }));

function echoCity(volumeFor: (k: string) => number | null = () => 50, withExtras = true) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const t = JSON.parse(String(init.body))[0] as { keywords: string[] };
    return jsonRes(
      okBody(
        t.keywords.map((keyword) => ({ keyword, search_volume: volumeFor(keyword), location_code: 1015254, ...(withExtras ? { monthly_searches: MONTHLY } : {}) })),
        0.075,
      ),
    );
  });
}

describe('location plan', () => {
  it('four launch metros, ten places each, only the marketed trades, plain trade words', () => {
    expect(LOCATION_METROS.map((m) => m.id)).toEqual(['atlanta', 'austin', 'charlotte', 'raleigh']);
    const plan = buildLocationPlan();
    expect(plan).toHaveLength(40);
    expect(plan.filter((p) => p.core).map((p) => p.city)).toEqual(['Atlanta', 'Austin', 'Charlotte', 'Raleigh']);
    expect(LOCATION_TRADES.map((t) => t.id)).toEqual(['landscaping', 'lawn-care', 'gutters', 'pressure-washing']);
    expect(tradesMatchCategories()).toBe(true);
    for (const p of plan) {
      expect(p.keywords).toEqual(['landscaping', 'lawn care', 'gutter installation', 'pressure washing']);
      expect(p.keywords.some((k) => p.city.toLowerCase().split(' ').some((w) => k.includes(w)))).toBe(false); // the city is the location, not in the keyword
    }
    expect(new Set(plan.map((p) => p.locationName)).size).toBe(40);
    expect(plan[1].locationName).toBe('Marietta,Georgia,United States');
  });

  it('stored keywords fit the 80 character column check and parse back; a national keyword does not parse', () => {
    for (const p of buildLocationPlan()) for (const k of p.storedKeywords) {
      expect(k.length).toBeLessThanOrEqual(80);
      expect(parseStoredKeyword(k)).toEqual({ term: expect.any(String), location: p.locationName.toLowerCase() });
    }
    expect(storedKeywordFor('Lawn care', 'Marietta,Georgia,United States')).toBe('lawn care @ marietta,georgia,united states');
    expect(parseStoredKeyword('lawn care marietta')).toBeNull();
  });

  it('cost: one task per city; the whole monthly job stays under 10 USD at the defaults', () => {
    const loc = expectedLocationCostUsd();
    expect(loc).toMatchObject({ cities: 40, tasks: 40, keywords: 160, usd: 3 });
    const llm = (QUERIES.length + 1) * estimateUsd('llmMentionsSearch', QUERY_LIMIT);
    const total = loc.usd + expectedVolumeCostUsd().usd + llm;
    expect(total).toBeLessThan(10);
  });
});

describe('refreshLocationVolumes', () => {
  it('request shape: plain trade words, location_name with the city, language en, no location_code, one request per city', async () => {
    const f = echoCity();
    const { d } = deps({ fetch: f });
    const plan = buildLocationPlan().slice(0, 2);
    await refreshLocationVolumes({ deps: d, plan });
    const tasks = sentTasks(f);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({ keywords: ['landscaping', 'lawn care', 'gutter installation', 'pressure washing'], location_name: 'Atlanta,Georgia,United States', language_code: 'en' });
    expect(tasks[1].location_name).toBe('Marietta,Georgia,United States');
    expect(tasks[0]).not.toHaveProperty('location_code');
    expect(String((f.mock.calls[0][0] as string))).toContain('/v3/keywords_data/google_ads/search_volume/live');
  });

  it('stores one row per trade word with the city encoded in the keyword, the echoed location code, and the 12 month trend', async () => {
    const { d, db } = deps({ fetch: echoCity((k) => (k === 'lawn care' ? null : 70)) });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(1, 2) });
    expect(r).toMatchObject({ status: 'complete', requests: 1, citiesDone: 1, citiesRemaining: 0, spentUsd: 0.075, extraColumns: true });
    const rows = db.tables.holler_keyword_volume;
    expect(rows).toHaveLength(4);
    expect(rows.every((x) => x.month === MONTH && x.location_code === 1015254)).toBe(true);
    expect(rows.find((x) => x.keyword === 'landscaping @ marietta,georgia,united states')).toMatchObject({ volume: 70, location_name: 'Marietta,Georgia,United States' });
    expect(rows.find((x) => x.keyword === 'lawn care @ marietta,georgia,united states')?.volume).toBeNull();
    expect(rows[0].monthly_searches).toHaveLength(12);
    expect(db.tables.holler_dataforseo_spend[0]).toMatchObject({ cost_usd: 0.075, units: 4 });
  });

  it('never touches the national rows: location_code is never 2840 and the national done list ignores these rows', async () => {
    const { d, db } = deps({ fetch: echoCity() });
    await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 1) });
    expect(db.tables.holler_keyword_volume.some((x) => x.location_code === 2840)).toBe(false);
    expect((await loadDoneKeywords(db as never, MONTH)).size).toBe(0);
  });

  it('a response without location_code stores 0, never 2840', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const t = JSON.parse(String(init.body))[0] as { keywords: string[] };
      return jsonRes(okBody(t.keywords.map((keyword) => ({ keyword, search_volume: 5, location_code: 2840 })), 0.075));
    });
    const { d, db } = deps({ fetch: f });
    await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 1) });
    expect(db.tables.holler_keyword_volume.every((x) => x.location_code === 0)).toBe(true);
  });

  it('works without migration 0040: the extra columns are dropped and the plain rows stored', async () => {
    const { d, db } = deps({ fetch: echoCity() });
    // Fake database that rejects a payload with the 0040 columns, like PostgREST does for a column that does not exist.
    const realFrom = db.from.bind(db);
    let attempts = 0;
    (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const b = realFrom(t) as { upsert: (rows: Record<string, unknown>[], o: unknown) => unknown };
      if (t !== 'holler_keyword_volume') return b;
      const up = b.upsert.bind(b);
      b.upsert = (rows, o) => {
        attempts++;
        if (rows.some((r) => 'monthly_searches' in r || 'location_name' in r)) {
          return Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'location_name' column of 'holler_keyword_volume' in the schema cache" } });
        }
        return up(rows, o);
      };
      return b;
    };
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 1) });
    expect(r).toMatchObject({ status: 'complete', requests: 1, extraColumns: false });
    expect(attempts).toBe(2);
    const rows = db.tables.holler_keyword_volume;
    expect(rows).toHaveLength(4);
    expect(Object.keys(rows[0]).sort()).toEqual(['fetched_at', 'id', 'keyword', 'location_code', 'month', 'volume']);
    expect(isMissingColumn({ code: '42703', message: 'x' })).toBe(true);
    expect(isMissingColumn({ message: 'duplicate key' })).toBe(false);
  });

  it('resume: a city already stored this month is not asked again; last month does not count', async () => {
    const plan = buildLocationPlan().slice(0, 3);
    const f = echoCity();
    const { d, db } = deps({ fetch: f });
    for (const k of plan[0].storedKeywords) db.tables.holler_keyword_volume.push({ keyword: k, location_code: 1, month: MONTH, volume: 1 });
    for (const k of plan[1].storedKeywords) db.tables.holler_keyword_volume.push({ keyword: k, location_code: 1, month: '2026-10-01', volume: 1 });
    const r = await refreshLocationVolumes({ deps: d, plan });
    expect(sentTasks(f).map((t) => t.location_name)).toEqual(['Marietta,Georgia,United States', 'Roswell,Georgia,United States']);
    expect(r).toMatchObject({ status: 'complete', citiesDone: 3, citiesRemaining: 0 });
    const again = await refreshLocationVolumes({ deps: d, plan });
    expect(again.requests).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('cap respected: stops with cap_reached before the call that would pass it, keeps what was stored', async () => {
    const f = echoCity();
    const { d, db } = deps({ fetch: f, env: { DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b', DATAFORSEO_MONTHLY_CAP_USD: '0.2' } });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan() });
    expect(r.status).toBe('cap_reached');
    expect(r.requests).toBe(2); // 0.15 spent; a third 0.075 would pass 0.20
    expect(f).toHaveBeenCalledTimes(2);
    expect(db.tables.holler_keyword_volume).toHaveLength(8);
    const refused = db.tables.holler_dataforseo_spend.filter((x) => x.status === 'refused');
    expect(refused).toHaveLength(1);
    expect(db.tables.holler_dataforseo_spend.reduce((n, x) => n + Number(x.cost_usd), 0)).toBeCloseTo(0.15, 5);
  });

  it('a zero cap makes no call at all', async () => {
    const f = echoCity();
    const { d } = deps({ fetch: f, env: { DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b', DATAFORSEO_MONTHLY_CAP_USD: '0' } });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan() });
    expect(r.status).toBe('cap_reached');
    expect(f).not.toHaveBeenCalled();
  });

  it('not_configured: no database access, no fetch', async () => {
    const { d, db, fetch } = deps({ env: {} });
    const r = await refreshLocationVolumes({ deps: d });
    expect(r.status).toBe('not_configured');
    expect(fetch).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it('spaces requests 5.1 s apart and stops on the time budget', async () => {
    let t = 0;
    const f = echoCity();
    const f2 = vi.fn(async (u: string, i: RequestInit) => { t += 1000; return f(u, i); });
    const { d } = deps({ fetch: f2, sleep: async (ms) => { t += ms; } });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan(), budgetMs: 25_000, clock: () => t });
    expect(r.status).toBe('time_budget');
    expect(r.requests).toBeGreaterThan(0);
    expect(r.requests).toBeLessThan(5);
    expect(r.citiesRemaining).toBe(40 - r.requests);
  });

  it('an unknown location (task error 40501) marks that city empty for the month and goes on', async () => {
    let n = 0;
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      n++;
      const t = JSON.parse(String(init.body))[0] as { keywords: string[] };
      if (n === 1) return jsonRes({ status_code: 20000, status_message: 'Ok.', cost: 0, tasks: [{ id: 't', status_code: 40501, status_message: "Invalid Field: 'location_name'.", cost: 0, result: null }] });
      return jsonRes(okBody(t.keywords.map((keyword) => ({ keyword, search_volume: 9 })), 0.075));
    });
    const { d, db } = deps({ fetch: f });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 2) });
    expect(r).toMatchObject({ status: 'complete', requests: 1, citiesDone: 2, unknownLocations: ['Atlanta,Georgia,United States'] });
    expect(db.tables.holler_keyword_volume.filter((x) => x.keyword.endsWith('atlanta,georgia,united states')).every((x) => x.volume === null)).toBe(true);
    // asked again next run? no
    const again = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 2) });
    expect(again.requests).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('any other API failure stops the run without storing', async () => {
    const f = vi.fn(async () => jsonRes({ status_code: 20000, status_message: 'Ok.', cost: 0, tasks: [{ id: 't', status_code: 40202, status_message: 'Rate limit', cost: 0 }] }));
    const { d, db } = deps({ fetch: f });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 3) });
    expect(r.status).toBe('error');
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.tables.holler_keyword_volume).toHaveLength(0);
  });

  it('a task without a result array stores nothing', async () => {
    const { d, db } = deps({ fetch: vi.fn(async () => jsonRes(okBody(null, 0.075))) });
    const r = await refreshLocationVolumes({ deps: d, plan: buildLocationPlan().slice(0, 1) });
    expect(r.status).toBe('error');
    expect(db.tables.holler_keyword_volume).toHaveLength(0);
  });

  it('cleanMonthly keeps 12 valid points, oldest first, null for a missing number', () => {
    expect(cleanMonthly(MONTHLY)).toHaveLength(12);
    expect(cleanMonthly(MONTHLY)![0]).toMatchObject({ year: 2025, month: 11 });
    expect(cleanMonthly([{ year: 2026, month: 13, search_volume: 1 }, { year: 2026, month: 1, search_volume: null }, 'x'])).toEqual([{ year: 2026, month: 1, search_volume: null }]);
    expect(cleanMonthly('nope')).toBeNull();
    expect(cleanMonthly([])).toBeNull();
  });

  it('FakeDb sanity: an empty database object is accepted', () => {
    expect(new FakeDb({}).tables).toEqual({});
  });
});
