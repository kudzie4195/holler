import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), client: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.client }));

import { GUIDE_DATA_SPECS, SAMPLE_ROWS, WINDOW_DAYS, buildGuideFact, guideFactText, loadGuideFact } from '@/lib/seo/guide-data';
import { GUIDE_SLUGS } from '@/lib/seo/guides';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();
const PERMITS = 'how-contractors-find-work-from-building-permits';

interface Row {
  source: string;
  occurred_at: string;
}

/** In-memory stand-in for the anon client: select (with exact count) / in / neq / gte / lte / order / limit / abortSignal. */
function fake(rows: Row[], opts: { fail?: 'error' | 'throw'; maxRows?: number } = {}) {
  const calls: { table: string; filters: string[] }[] = [];
  const client = {
    from(table: string) {
      if (opts.fail === 'throw') throw new Error('network down');
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const fs: ((r: Row) => boolean)[] = [];
      let limit = Infinity;
      let desc = false;
      const q: Record<string, unknown> = {
        select(_c: string, o?: { count?: string }) { call.filters.push(`count:${o?.count}`); return q; },
        in(col: string, v: string[]) { call.filters.push(`in:${col}`); fs.push((r) => v.includes((r as unknown as Record<string, string>)[col])); return q; },
        neq(col: string, v: string) { call.filters.push(`neq:${col}=${v}`); fs.push((r) => (r as unknown as Record<string, string>)[col] !== v); return q; },
        gte(col: string, v: string) { fs.push((r) => (r as unknown as Record<string, string>)[col] >= v); return q; },
        lte(col: string, v: string) { fs.push((r) => (r as unknown as Record<string, string>)[col] <= v); return q; },
        order(_c: string, o: { ascending: boolean }) { desc = !o.ascending; return q; },
        limit(n: number) { limit = n; return q; },
        abortSignal() { return q; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          if (opts.fail === 'error') return Promise.resolve({ data: null, error: { message: 'boom' }, count: null }).then(res, rej);
          const m = rows.filter((r) => fs.every((f) => f(r)));
          const sorted = [...m].sort((a, b) => (desc ? b.occurred_at.localeCompare(a.occurred_at) : a.occurred_at.localeCompare(b.occurred_at)));
          const data = sorted.slice(0, Math.min(limit, opts.maxRows ?? Infinity));
          return Promise.resolve({ data, error: null, count: m.length }).then(res, rej);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  h.cacheLife.mockReset();
  h.client = null;
});

describe('GUIDE_DATA_SPECS', () => {
  it('covers the five guides with public record data, every slug is a real guide, and no spec reads resident requests', () => {
    expect(Object.keys(GUIDE_DATA_SPECS).sort()).toEqual([
      'federal-contracts-for-small-local-businesses',
      'how-contractors-find-work-from-building-permits',
      'new-business-licenses-as-a-lead-source',
      'storm-damage-leads-from-weather-alerts-and-storm-reports',
      'what-311-requests-tell-local-service-businesses',
    ]);
    for (const [slug, spec] of Object.entries(GUIDE_DATA_SPECS)) {
      expect(GUIDE_SLUGS).toContain(slug);
      expect(spec.sources.length, slug).toBeGreaterThan(0);
      expect(spec.sources).not.toContain('holler-request');
      expect(`${spec.noun} ${spec.feedNoun ?? ''}`).not.toMatch(/demand|lead|job/i);
    }
    expect(GUIDE_DATA_SPECS[PERMITS].sources).toEqual(expect.arrayContaining(['socrata-chicago-permits', 'arcgis-dc-permits']));
    expect(GUIDE_DATA_SPECS['what-311-requests-tell-local-service-businesses'].sources).toContain('socrata-chicago-311');
    expect(GUIDE_DATA_SPECS['new-business-licenses-as-a-lead-source'].sources).toContain('socrata-chicago-business');
  });
});

describe('buildGuideFact', () => {
  it('counts the records of the spec sources dated in the last 30 days, with the newest date and the exact number of feeds', async () => {
    const rows: Row[] = [
      { source: 'socrata-chicago-permits', occurred_at: ago(1) },
      { source: 'socrata-chicago-permits', occurred_at: ago(3) },
      { source: 'arcgis-dc-permits', occurred_at: ago(29) },
      { source: 'arcgis-dc-permits', occurred_at: ago(31) }, // outside the window
      { source: 'socrata-chicago-311', occurred_at: ago(1) }, // another guide's source
      { source: 'socrata-chicago-permits', occurred_at: new Date(NOW.getTime() + DAY).toISOString() }, // future
    ];
    const { client, calls } = fake(rows);
    const f = await buildGuideFact(client, PERMITS, NOW);
    expect(f).toEqual({ count: 3, feeds: 2, feedsExact: true, newestAt: ago(1), asOf: NOW.toISOString() });
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('holler_signals');
    expect(calls[0].filters).toContain('count:exact');
    expect(calls[0].filters).toContain('neq:source=holler-request');
  });

  it('never counts resident requests, even if a request row slipped into a source list', async () => {
    const rows: Row[] = [
      { source: 'holler-request', occurred_at: ago(1) },
      { source: 'holler-request', occurred_at: ago(2) },
    ];
    const { client } = fake(rows);
    expect(await buildGuideFact(client, PERMITS, NOW)).toBeNull();
  });

  it('says "at least" for the feeds when more rows match than were read', async () => {
    const rows: Row[] = Array.from({ length: 30 }, (_, i) => ({ source: i < 25 ? 'socrata-chicago-permits' : 'socrata-austin-permits', occurred_at: ago(i % 28) }));
    const { client } = fake(rows, { maxRows: 10 });
    const f = await buildGuideFact(client, PERMITS, NOW);
    expect(f?.count).toBe(30);
    expect(f?.feedsExact).toBe(false);
    expect(guideFactText(PERMITS, f!)).toContain('from at least');
  });

  it('returns null for an empty window (zero records): the page shows nothing', async () => {
    const { client } = fake([{ source: 'socrata-chicago-permits', occurred_at: ago(45) }]);
    expect(await buildGuideFact(client, PERMITS, NOW)).toBeNull();
  });

  it('returns null, never throws, when the client is missing, errors or throws', async () => {
    expect(await buildGuideFact(null, PERMITS, NOW)).toBeNull();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await buildGuideFact(fake([], { fail: 'error' }).client, PERMITS, NOW)).toBeNull();
    expect(await buildGuideFact(fake([], { fail: 'throw' }).client, PERMITS, NOW)).toBeNull();
    spy.mockRestore();
  });

  it('returns null for a guide without a spec and makes no query', async () => {
    const { client, calls } = fake([{ source: 'socrata-chicago-permits', occurred_at: ago(1) }]);
    expect(await buildGuideFact(client, 'pay-per-lead-vs-flat-fee-alerts', NOW)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reads at most one bounded page of rows', () => {
    expect(SAMPLE_ROWS).toBeLessThanOrEqual(1000);
    expect(WINDOW_DAYS).toBe(30);
  });
});

describe('guideFactText', () => {
  it('prints real numbers with dates and calls them records, not demand or leads', () => {
    const t = guideFactText(PERMITS, { count: 3803, feeds: 18, feedsExact: true, newestAt: '2026-11-17T13:02:31.000Z', asOf: '2026-11-18T01:00:00.000Z' })!;
    expect(t).toBe(
      'In the 30 days to November 18, 2026, Holler read and stored 3,803 building permit records from 18 city and county permit feeds. The newest is dated November 17, 2026. These are public records, not jobs or requests for work.',
    );
    expect(t).not.toMatch(/demand|\blead/i);
  });
  it('leaves out the feeds for single-source guides and returns null for a zero count or unknown guide', () => {
    const t = guideFactText('federal-contracts-for-small-local-businesses', { count: 12, feeds: 1, feedsExact: true, newestAt: '2026-11-15T22:58:41.000Z', asOf: '2026-11-17T12:00:00.000Z' })!;
    expect(t).toContain('12 federal contract awards from USAspending.gov.');
    expect(t).not.toContain(' from 1 ');
    expect(guideFactText(PERMITS, { count: 0, feeds: 0, feedsExact: true, newestAt: NOW.toISOString(), asOf: NOW.toISOString() })).toBeNull();
    expect(guideFactText('nope', { count: 5, feeds: 1, feedsExact: true, newestAt: NOW.toISOString(), asOf: NOW.toISOString() })).toBeNull();
  });
});

describe('loadGuideFact cache lifetime', () => {
  it('keeps a fact about an hour and a miss for a minute', async () => {
    h.client = fake([{ source: 'socrata-chicago-permits', occurred_at: new Date(Date.now() - DAY).toISOString() }]).client;
    expect(await loadGuideFact(PERMITS)).not.toBeNull();
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 300, revalidate: 3600, expire: 7200 });
    h.client = null;
    expect(await loadGuideFact(PERMITS)).toBeNull();
    expect(h.cacheLife).toHaveBeenLastCalledWith({ stale: 60, revalidate: 60, expire: 300 });
  });
});
