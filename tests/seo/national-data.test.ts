import { colOf } from '../fixtures/json-col';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), client: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.client }));

import { KIND_ROWS, SAMPLE_SIZE, buildNationalStats, loadNationalStats, summarizeSample, unavailableStats } from '@/lib/seo/national-data';
import { dataJsonLd } from '@/lib/seo/national-seo';
import { jsonLdString } from '@/lib/seo/jsonld';
import { evalTerm, splitTop } from '../fixtures/fake-signals-db';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

interface Row {
  source: string;
  kind: string;
  place_slug: string | null;
  categories: string[];
  occurred_at: string;
}

/** A small in-memory stand-in for the anonymous client. It answers select / head count / gte / lte / eq / order / limit / range. */
function fake(rows: Row[], view: { place_slug: string; signals_60d: number; latest_at: string | null }[], opts: { viewHasLatest?: boolean; fail?: 'error' | 'throw' } = {}) {
  const calls: { table: string; head: boolean; limit?: number }[] = [];
  const client = {
    from(table: string) {
      if (opts.fail === 'throw') throw new Error('network down');
      const call = { table, head: false, limit: undefined as number | undefined };
      calls.push(call);
      const filters: ((r: Row) => boolean)[] = [];
      let cols = '';
      let order: { col: string; asc: boolean } | null = null;
      let limit: number | null = null;
      let wantsCount = false;
      const q: Record<string, unknown> = {
        select(c: string, o?: { count?: string; head?: boolean }) {
          cols = c;
          call.head = !!o?.head;
          wantsCount = !!o?.count;
          return q;
        },
        gte(col: string, v: string) { filters.push((r) => (r as unknown as Record<string, string>)[col] >= v); return q; },
        lte(col: string, v: string) { filters.push((r) => (r as unknown as Record<string, string>)[col] <= v); return q; },
        is(col: string, v: null) { filters.push((r) => (colOf(r as unknown as Record<string, unknown>, col) == null) === (v === null)); return q; },
        eq(col: string, v: string) { filters.push((r) => (r as unknown as Record<string, string>)[col] === v); return q; },
        or(s: string) { filters.push((r) => splitTop(s).some((t) => evalTerm(t, r as unknown as Record<string, unknown>))); return q; },
        order(col: string, o: { ascending: boolean }) { order = { col, asc: o.ascending }; return q; },
        limit(n: number) { limit = n; call.limit = n; return q; },
        range(a: number, b: number) { limit = b - a + 1; call.limit = limit; return q; },
        abortSignal() { return q; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          let out: unknown;
          if (opts.fail === 'error') out = { data: null, error: { message: 'boom' }, count: null };
          else if (table === 'holler_place_counts') {
            if (cols.includes('latest_at') && opts.viewHasLatest === false) out = { data: null, error: { message: 'column latest_at does not exist' } };
            else out = { data: view.map((v) => (cols.includes('latest_at') ? v : { place_slug: v.place_slug, signals_60d: v.signals_60d })), error: null };
          } else {
            let m = rows.filter((r) => filters.every((f) => f(r)));
            if (order) m = [...m].sort((a, b) => (order!.asc ? 1 : -1) * String((a as never)[order!.col]).localeCompare(String((b as never)[order!.col])));
            const total = m.length;
            if (limit !== null) m = m.slice(0, limit);
            out = call.head ? { data: null, error: null, count: wantsCount ? total : null } : { data: m, error: null, count: wantsCount ? total : null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const R = (source: string, kind: string, place: string | null, cats: string[], days: number): Row => ({
  source, kind, place_slug: place, categories: cats, occurred_at: ago(days),
});

const ROWS: Row[] = [
  R('nws', 'alert', 'atlanta-ga', ['roofing', 'tree-service'], 0.1),
  R('nws', 'alert', 'atlanta-ga', ['roofing'], 2),
  R('spc', 'report', 'dallas-tx', ['roofing', 'auto-glass'], 3),
  R('socrata-chicago-permits', 'permit', 'chicago-il', ['general-contractor'], 5),
  R('socrata-chicago-permits', 'permit', 'chicago-il', ['general-contractor', 'roofing'], 20),
  R('socrata-chicago-311', 'civic', 'chicago-il', ['junk-removal'], 6),
  R('usaspending', 'contract', null, ['cleaning'], 10),
  R('fema', 'disaster', null, [], 29),
  R('nws', 'alert', 'atlanta-ga', ['roofing'], 45), // outside both windows
  { source: 'ticketmaster', kind: 'event', place_slug: 'atlanta-ga', categories: ['catering'], occurred_at: new Date(NOW.getTime() + 3 * DAY).toISOString() }, // future: never counted
];
const VIEW = [
  { place_slug: 'atlanta-ga', signals_60d: 4, latest_at: ago(0.1) },
  { place_slug: 'chicago-il', signals_60d: 3, latest_at: ago(5) },
  { place_slug: 'dallas-tx', signals_60d: 1, latest_at: ago(3) },
  { place_slug: 'old-town-xx', signals_60d: 9, latest_at: ago(50) }, // busy over 60 days but nothing in the last 30
];

describe('buildNationalStats: normal data', () => {
  it('counts only records dated inside the window and not in the future', async () => {
    const { client } = fake(ROWS, VIEW);
    const s = await buildNationalStats(client, NOW);
    expect(s.ok).toBe(true);
    expect(s.asOf).toBe(NOW.toISOString());
    expect(s.total7).toBe(5);
    expect(s.total30).toBe(8);
  });

  it('splits by kind for both windows and adds the rest as "Other records"', async () => {
    const { client } = fake(ROWS, VIEW);
    const s = await buildNationalStats(client, NOW);
    const by = Object.fromEntries(s.kinds.map((k) => [k.id, [k.last7, k.last30]]));
    expect(by).toEqual({ alert: [2, 2], report: [1, 1], permit: [1, 2], civic: [1, 1], other: [0, 2] });
    expect(s.kinds.map((k) => k.id)).toEqual([...KIND_ROWS.map((k) => k.id), 'other']);
    // The rows add up to the totals.
    expect(s.kinds.reduce((a, k) => a + k.last30, 0)).toBe(s.total30);
    expect(s.kinds.reduce((a, k) => a + k.last7, 0)).toBe(s.total7);
  });

  it('counts the cities with a record in 30 days from the view, and ranks the top cities by exact 30 day counts', async () => {
    const { client } = fake(ROWS, VIEW);
    const s = await buildNationalStats(client, NOW);
    expect(s.citiesActive30).toBe(3); // old-town-xx has nothing since 50 days ago
    expect(s.topCities.map((c) => [c.slug, c.last30])).toEqual([['chicago-il', 3], ['atlanta-ga', 2], ['dallas-tx', 1]]);
    expect(s.topCities[0]).toMatchObject({ name: 'Chicago', state: 'IL', path: '/local/illinois/chicago-il' });
  });

  it('lists matched trades and counts the sources seen, and takes the newest record time from the data', async () => {
    const { client } = fake(ROWS, VIEW);
    const s = await buildNationalStats(client, NOW);
    expect(s.topTrades[0]).toEqual({ id: 'roofing', label: 'Roofing', count: 4 });
    expect(s.topTrades[1]).toMatchObject({ id: 'general-contractor', count: 2 });
    expect(s.sourcesSeen).toBe(6);
    expect(s.sampleSize).toBe(8);
    expect(s.newestAt).toBe(ago(0.1));
  });

  it('stays cheap: at most 22 queries, head counts for totals, one small bounded sample, no full-table read', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ place_slug: `town-${i}-xx`, signals_60d: 100 - i, latest_at: ago(1) }));
    const { client, calls } = fake(ROWS, many);
    await buildNationalStats(client, NOW);
    expect(calls.length).toBeLessThanOrEqual(22);
    expect(calls.filter((c) => c.table === 'holler_signals' && c.head).length).toBe(2 + KIND_ROWS.length * 2 + 10);
    const reads = calls.filter((c) => !c.head);
    expect(reads.filter((c) => c.table === 'holler_signals').map((c) => c.limit)).toEqual([SAMPLE_SIZE]);
    for (const c of reads) expect(c.limit, c.table).toBeLessThanOrEqual(1000);
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(['holler_signals', 'holler_place_counts']));
  });

  it('without the view column latest_at it still works, and leaves the active city count out', async () => {
    const { client } = fake(ROWS, VIEW, { viewHasLatest: false });
    const s = await buildNationalStats(client, NOW);
    expect(s.ok).toBe(true);
    expect(s.citiesActive30).toBeNull();
    expect(s.topCities.length).toBeGreaterThan(0);
  });

  it('summarizeSample ignores empty categories and ties break by id', () => {
    const r = summarizeSample([{ source: 'a', categories: ['x', 'y'] }, { source: 'a', categories: null }, { source: 'b', categories: ['y'] }, { source: null, categories: [] }]);
    expect(r.sources).toBe(2);
    expect(r.trades.map((t) => [t.id, t.count])).toEqual([['y', 2], ['x', 1]]);
  });
});

describe('buildNationalStats: empty data', () => {
  it('returns ok with zeros, no kinds beyond the four, no cities, no trades and no newest time', async () => {
    const { client } = fake([], []);
    const s = await buildNationalStats(client, NOW);
    expect(s.ok).toBe(true);
    expect(s.total7).toBe(0);
    expect(s.total30).toBe(0);
    expect(s.kinds.every((k) => k.last7 === 0 && k.last30 === 0)).toBe(true);
    expect(s.kinds.some((k) => k.id === 'other')).toBe(false);
    expect(s.topCities).toEqual([]);
    expect(s.topTrades).toEqual([]);
    expect(s.sourcesSeen).toBe(0);
    expect(s.newestAt).toBeNull();
    expect(s.citiesActive30).toBe(0);
  });
});

describe('buildNationalStats: failing client', () => {
  it('a query error returns the unavailable state', async () => {
    const { client } = fake(ROWS, VIEW, { fail: 'error' });
    const s = await buildNationalStats(client, NOW);
    expect(s).toEqual(unavailableStats(NOW.toISOString()));
    expect(s.ok).toBe(false);
  });
  it('a thrown error returns the unavailable state', async () => {
    const { client } = fake(ROWS, VIEW, { fail: 'throw' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await buildNationalStats(client, NOW);
    expect(s.ok).toBe(false);
    err.mockRestore();
  });
  it('a missing client (no env) returns the unavailable state', async () => {
    expect((await buildNationalStats(null, NOW)).ok).toBe(false);
  });
});

describe('loadNationalStats: cache lifetime', () => {
  beforeEach(() => h.cacheLife.mockClear());
  it('a good read is cached for about an hour', async () => {
    h.client = fake(ROWS, VIEW).client;
    const s = await loadNationalStats();
    expect(s.ok).toBe(true);
    expect(h.cacheLife).toHaveBeenCalledWith({ stale: 300, revalidate: 3600, expire: 7200 });
  });
  it('a failed read is remembered for a minute only', async () => {
    h.client = fake(ROWS, VIEW, { fail: 'error' }).client;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = await loadNationalStats();
    expect(s.ok).toBe(false);
    expect(h.cacheLife).toHaveBeenCalledWith({ stale: 60, revalidate: 60, expire: 300 });
    err.mockRestore();
  });
});

describe('Dataset JSON-LD', () => {
  it('has the required fields, a 30 day interval ending at the computation day, and dateModified from the newest record', async () => {
    const { client } = fake(ROWS, VIEW);
    const s = await buildNationalStats(client, NOW);
    const parsed = JSON.parse(jsonLdString(dataJsonLd(s))) as Record<string, unknown>[];
    const ds = parsed.find((x) => x['@type'] === 'Dataset')!;
    expect(ds.name).toBeTruthy();
    expect(String(ds.description).length).toBeGreaterThan(50);
    expect(String(ds.url)).toMatch(/\/data$/);
    expect(ds.temporalCoverage).toBe('2026-10-18/2026-11-17');
    expect(ds.dateModified).toBe(s.newestAt);
    expect((ds.creator as { name: string }).name).toBe('Holler');
    expect(ds.isAccessibleForFree).toBe(true);
    expect(parsed.find((x) => x['@type'] === 'BreadcrumbList')).toBeDefined();
  });
  it('an unavailable page gets the breadcrumb only', () => {
    const parsed = dataJsonLd(unavailableStats(NOW.toISOString()));
    expect(parsed.map((x) => x['@type'])).toEqual(['BreadcrumbList']);
  });
  it('with no records at all, dateModified falls back to the computation time, not a made-up date', async () => {
    const s = await buildNationalStats(fake([], []).client, NOW);
    const ds = dataJsonLd(s).find((x) => x['@type'] === 'Dataset')!;
    expect(ds.dateModified).toBe(NOW.toISOString());
  });
});
