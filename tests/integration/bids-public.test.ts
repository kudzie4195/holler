// Round 14, review P2-13 and P2-14: city bid rows stored while HOLLER_BIDS_ENABLED was on must not show on public pages once it is off,
// and a closed bid (due date passed) never shows. One open bid, one closed bid and one ordinary row are fed to each public reader.
// Rows are hand-written (assumed); the fake applies the PostgREST filters the readers send, including `not like`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), client: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife, cacheTag: h.cacheTag }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.client }));

import { BIDS_FLAG, ERATE_FLAG, bidClosed, excludeBidsInQuery, withoutHiddenBids } from '@/lib/signals/bid-sources';
import { loadPlaceData } from '@/lib/seo/data';
import { loadWeekData } from '@/lib/seo/week-data';
import { loadTradeSignals } from '@/lib/seo/trade-data';
import { loadCheck } from '@/lib/check/load';
import { buildNationalStats } from '@/lib/seo/national-data';
import { evalTerm, fakeSignalsDb, splitTop } from '../fixtures/fake-signals-db';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function rows() {
  const base = {
    url: 'https://example.gov/x', categories: ['roofing'], severity: 2, place_slug: 'atlanta-ga', city: 'Atlanta', state: 'GA',
    lat: 33.75, lon: -84.39, summary: null, subtype: null,
  };
  return [
    { ...base, id: 1, source: 'bids-la', kind: 'contract', title: 'OPEN BID roof', data: { subtype: 'bid' }, subtype: 'bid', occurred_at: iso(-3 * HOUR), expires_at: iso(10 * 24 * HOUR) },
    { ...base, id: 2, source: 'bids-la', kind: 'contract', title: 'CLOSED BID roof', data: { subtype: 'bid' }, subtype: 'bid', occurred_at: iso(-5 * 24 * HOUR), expires_at: iso(-2 * HOUR) },
    { ...base, id: 3, source: 'spc', kind: 'report', title: 'Hail report', data: {}, occurred_at: iso(-2 * HOUR), expires_at: iso(-HOUR) },
  ];
}

/** Plain-select fake with `not like`; `ignoreNot` simulates a database that ignored the filter, so the row guard alone is tested. */
function selectFake(data: Record<string, unknown>[], opts: { ignoreNot?: boolean } = {}) {
  const nots: [string, string, string][] = [];
  return {
    nots,
    from() {
      const f: ((r: Record<string, unknown>) => boolean)[] = [];
      let lim = Infinity;
      let head = false;
      let wantCount = false;
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string; head?: boolean }) => ((head = !!o?.head), (wantCount = !!o?.count), q),
        eq: (c: string, v: unknown) => (f.push((r) => r[c] === v), q),
        gte: (c: string, v: string) => (f.push((r) => String(r[c]) >= v), q),
        lte: (c: string, v: string) => (f.push((r) => String(r[c]) <= v), q),
        gt: (c: string, v: string) => (f.push((r) => String(r[c]) > v), q),
        lt: (c: string, v: string) => (f.push((r) => String(r[c]) < v), q),
        contains: (c: string, v: string[]) => (f.push((r) => v.every((x) => (r[c] as string[]).includes(x))), q),
        or: (s: string) => (f.push((r) => splitTop(s).some((t) => evalTerm(t, r))), q),
        not: (c: string, op: string, v: string) => {
          nots.push([c, op, v]);
          if (!opts.ignoreNot && op === 'like') f.push((r) => !String(r[c]).startsWith(v.replace(/%$/, '')));
          if (!opts.ignoreNot && op === 'eq') f.push((r) => r[c] !== v);
          return q;
        },
        order: () => q,
        limit: (n: number) => ((lim = n), q),
        range: (a: number, b: number) => ((lim = b - a + 1), q),
        abortSignal: () => q,
        then: (res: (v: unknown) => unknown) => {
          const m = data.filter((r) => f.every((x) => x(r)));
          const total = m.length;
          return Promise.resolve(head ? { data: null, error: null, count: total } : { data: m.slice(0, lim), error: null, count: wantCount ? total : null }).then(res);
        },
      };
      return q;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.cacheLife.mockClear();
  h.cacheTag.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe('helpers', () => {
  it('bidClosed: due instant first, then the due day with a grace to the end of that day in every US zone; non-bids never', () => {
    const now = NOW.getTime();
    expect(bidClosed({ source: 'bids-la', expires_at: iso(-1) }, now)).toBe(true);
    expect(bidClosed({ source: 'bids-la', expires_at: iso(1) }, now)).toBe(false);
    expect(bidClosed({ source: 'bids-la', expires_at: null, dueDate: '2026-11-16' }, now)).toBe(true);
    // due today (Nov 17): still open at 12:00Z, closed after 10:00Z the next day
    expect(bidClosed({ source: 'bids-la', expires_at: null, dueDate: '2026-11-17' }, now)).toBe(false);
    expect(bidClosed({ source: 'bids-la', expires_at: null, dueDate: '2026-11-17' }, Date.parse('2026-11-18T10:00:01Z'))).toBe(true);
    expect(bidClosed({ source: 'bids-la', expires_at: null, data: { dueDate: '2026-11-16' } }, now)).toBe(true);
    // no due date at all: not closed
    expect(bidClosed({ source: 'bids-la', expires_at: null }, now)).toBe(false);
    expect(bidClosed({ source: 'nws', expires_at: iso(-HOUR) }, now)).toBe(false);
    expect(bidClosed(null, now)).toBe(false);
  });
  it('withoutHiddenBids: flag off drops every bid; flag on drops the closed one; other rows stay', () => {
    const now = NOW.getTime();
    expect(withoutHiddenBids(rows(), now, false).map((r) => r.id)).toEqual([3]);
    expect(withoutHiddenBids(rows(), now, true).map((r) => r.id)).toEqual([1, 3]);
  });
  it('excludeBidsInQuery adds `source not like bids-%` only while the flag is off, and leaves a builder without .not alone', () => {
    const calls: unknown[][] = [];
    const q = { not: (...a: unknown[]) => (calls.push(a), q) };
    // the third argument is the E-Rate switch (round 33); with it on, only the bids flag decides here
    excludeBidsInQuery(q, true, true);
    expect(calls).toEqual([]);
    excludeBidsInQuery(q, false, true);
    expect(calls).toEqual([['source', 'like', 'bids-%']]);
    const plain = {};
    expect(excludeBidsInQuery(plain, false)).toBe(plain);
  });
});

describe.each([{ ignoreNot: false }, { ignoreNot: true }])('public readers, database ignores the filter: $ignoreNot', ({ ignoreNot }) => {
  const titles = (d: unknown) => JSON.stringify(d);

  it('flag off: city, weekly, trade, /check and /data leave out every stored bid', async () => {
    vi.stubEnv(BIDS_FLAG, '');
    const fake = selectFake(rows(), { ignoreNot });
    h.client = fake;
    const place = titles(await loadPlaceData('atlanta-ga'));
    expect(place).not.toContain('OPEN BID');
    expect(place).not.toContain('CLOSED BID');
    expect(place).toContain('Hail report');
    expect(fake.nots).toContainEqual(['source', 'like', 'bids-%']);

    const week = titles(await loadWeekData('atlanta-ga', '2026-11-16'));
    expect(week).not.toContain('OPEN BID');
    expect(week).toContain('Hail report');

    const trade = (await loadTradeSignals('roofing')).items.map((i) => i.title);
    expect(trade).toContain('Hail report');
    expect(trade.some((t) => t.includes('BID'))).toBe(false);

    h.client = fakeSignalsDb(rows(), { now: NOW });
    const check = (await loadCheck(33.75, -84.39, 'GA', 'roofing')).items.map((i) => i.title);
    expect(check.some((t) => t.includes('BID'))).toBe(false);

    const stats = await buildNationalStats(selectFake(rows(), { ignoreNot }) as unknown as SupabaseClient, NOW);
    // counts are head queries, so only the query filter can keep bids out of them; the sample is guarded on its rows too
    if (!ignoreNot) expect(stats.total7).toBe(1);
    expect(stats.sampleSize).toBe(1);
  });

  it('flag on: the open bid shows, the closed bid never does', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    h.client = selectFake(rows(), { ignoreNot });
    const place = titles(await loadPlaceData('atlanta-ga'));
    expect(place).toContain('OPEN BID');
    expect(place).not.toContain('CLOSED BID');
    const week = titles(await loadWeekData('atlanta-ga', '2026-11-16'));
    expect(week).toContain('OPEN BID');
    expect(week).not.toContain('CLOSED BID');
    const trade = (await loadTradeSignals('roofing')).items.map((i) => i.title);
    expect(trade).toContain('OPEN BID roof');
    expect(trade).not.toContain('CLOSED BID roof');
    h.client = fakeSignalsDb(rows(), { now: NOW });
    const check = (await loadCheck(33.75, -84.39, 'GA', 'roofing')).items.map((i) => i.title);
    expect(check).toContain('OPEN BID roof');
    expect(check).not.toContain('CLOSED BID roof');
    const stats = await buildNationalStats(selectFake(rows(), { ignoreNot }) as unknown as SupabaseClient, NOW);
    expect(stats.sampleSize).toBe(2); // the open bid and the storm report
  });
});

describe.each([{ ignoreNot: false }, { ignoreNot: true }])('public readers hold an E-Rate row (round 33), database ignores the filter: $ignoreNot', ({ ignoreNot }) => {
  // Production has the bids switch on and the E-Rate switch empty: the stored E-Rate row must reach no public page, with the query filter or
  // with the row guard alone, while the other bid and the storm report stay.
  const withErate = () => [
    ...rows(),
    {
      id: 9, source: 'bids-erate', kind: 'contract', title: 'ERATE school cabling', summary: 'E-Rate request (FCC Form 470) | contract may be signed from 2026-12-01',
      url: 'https://publicdata.usac.org/x.pdf', categories: ['roofing'], severity: 2, place_slug: 'atlanta-ga', city: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39,
      data: { subtype: 'bid', contractFrom: '2026-12-01' }, subtype: 'bid', occurred_at: iso(-3 * HOUR), expires_at: iso(10 * 24 * HOUR),
    },
  ];
  const titles = (d: unknown) => JSON.stringify(d);

  it('bids on, E-Rate switch empty: no public reader shows it, the other bid stays', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    vi.stubEnv(ERATE_FLAG, '');
    const fake = selectFake(withErate(), { ignoreNot });
    h.client = fake;
    const place = titles(await loadPlaceData('atlanta-ga'));
    expect(place).not.toContain('ERATE school cabling');
    expect(place).toContain('OPEN BID');
    expect(fake.nots).toContainEqual(['source', 'eq', 'bids-erate']);
    const week = titles(await loadWeekData('atlanta-ga', '2026-11-16'));
    expect(week).not.toContain('ERATE school cabling');
    expect(week).toContain('OPEN BID');
    const trade = (await loadTradeSignals('roofing')).items.map((i) => i.title);
    expect(trade).not.toContain('ERATE school cabling');
    expect(trade).toContain('OPEN BID roof');
    h.client = fakeSignalsDb(withErate(), { now: NOW });
    const check = (await loadCheck(33.75, -84.39, 'GA', 'roofing')).items.map((i) => i.title);
    expect(check).not.toContain('ERATE school cabling');
    expect(check).toContain('OPEN BID roof');
    const stats = await buildNationalStats(selectFake(withErate(), { ignoreNot }) as unknown as SupabaseClient, NOW);
    expect(stats.sampleSize).toBe(2); // the open bid and the storm report, not the E-Rate row
  });

  it('both switches on: the E-Rate row shows', async () => {
    vi.stubEnv(BIDS_FLAG, '1');
    vi.stubEnv(ERATE_FLAG, '1');
    h.client = selectFake(withErate(), { ignoreNot });
    expect(titles(await loadPlaceData('atlanta-ga'))).toContain('ERATE school cabling');
    const trade = (await loadTradeSignals('roofing')).items.map((i) => i.title);
    expect(trade).toContain('ERATE school cabling');
  });
});
