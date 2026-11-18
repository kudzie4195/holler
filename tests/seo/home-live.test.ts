import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), client: null as unknown, stats: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.client }));
vi.mock('@/lib/seo/national-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/national-data')>()),
  loadNationalStats: async () => h.stats,
}));

import {
  HOME_LIVE_PREVIEW_FIXTURE,
  RECENT_SCAN,
  RECENT_SHOWN,
  buildRecentRecords,
  homeLiveFrom,
  loadHomeLive,
  pickRecent,
  previewFixturesEnabled,
  shortTitle,
} from '@/lib/seo/home-live';
import { unavailableStats, type NationalStats } from '@/lib/seo/national-data';
import { evalTerm, splitTop } from '../fixtures/fake-signals-db';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const HOUR = 3_600_000;
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();

type Row = Record<string, unknown>;
const row = (o: Partial<Row>): Row => ({
  id: Math.random().toString(36).slice(2),
  source: 'nws',
  kind: 'alert',
  title: 'Severe Thunderstorm Warning',
  city: 'Tulsa',
  state: 'OK',
  place_slug: null,
  severity: 1,
  occurred_at: at(1),
  expires_at: null,
  subtype: null,
  ...o,
});

/** In-memory stand-in for the anon client: records every filter call and applies it. */
function fake(rows: Row[], opts: { fail?: 'error' | 'throw' } = {}) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      if (opts.fail === 'throw') throw new Error('network down');
      calls.push(`from:${table}`);
      const filters: ((r: Row) => boolean)[] = [];
      let limit = Infinity;
      let order: { col: string; asc: boolean } | null = null;
      const q: Record<string, unknown> = {
        select(c: string) { calls.push(`select:${c}`); return q; },
        neq(c: string, v: string) { calls.push(`neq:${c}=${v}`); filters.push((r) => r[c] != null && r[c] !== v); return q; },
        not(c: string, op: string, v: null) { calls.push(`not:${c}.${op}.${v}`); filters.push((r) => r[c] != null); return q; },
        gte(c: string, v: string) { calls.push(`gte:${c}`); filters.push((r) => String(r[c]) >= v); return q; },
        lte(c: string, v: string) { calls.push(`lte:${c}`); filters.push((r) => String(r[c]) <= v); return q; },
        or(s: string) { calls.push(`or:${s}`); filters.push((r) => splitTop(s).some((t) => evalTerm(t, r))); return q; },
        order(c: string, o: { ascending: boolean }) { order = { col: c, asc: o.ascending }; return q; },
        limit(n: number) { calls.push(`limit:${n}`); limit = n; return q; },
        abortSignal() { return q; },
        then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
          if (opts.fail === 'error') return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej);
          let m = rows.filter((r) => filters.every((f) => f(r)));
          if (order) m = [...m].sort((a, b) => (order!.asc ? 1 : -1) * String(a[order!.col]).localeCompare(String(b[order!.col])));
          return Promise.resolve({ data: m.slice(0, limit), error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const GOOD_STATS: NationalStats = {
  ...unavailableStats(NOW.toISOString()),
  ok: true,
  total7: 1234,
  total30: 5000,
  citiesActive30: 88,
  sourcesSeen: 14,
};

beforeEach(() => {
  h.cacheLife.mockReset();
  h.client = null;
  h.stats = GOOD_STATS;
});

describe('home live band: recent records (one bounded query)', () => {
  it('normal: one per source, most severe first, never a resident request, an ask, an expired, future, old or city-less row', async () => {
    const rows = [
      row({ id: 'nws-low', source: 'nws', severity: 1, occurred_at: at(0.5) }),
      row({ id: 'nws-high', source: 'nws', severity: 3, title: 'Tornado Warning', occurred_at: at(3) }),
      row({ id: 'spc', source: 'spc', kind: 'report', severity: 2, title: 'Hail 1.75 in', city: 'AMARILLO', state: 'tx', occurred_at: at(2) }),
      row({ id: 'chi', source: 'socrata:chicago-permits', kind: 'permit', subtype: 'permit', title: 'Roof permit', city: 'Chicago', state: 'IL', occurred_at: at(5) }),
      row({ id: 'req', source: 'holler-request', kind: 'ask', severity: 3, title: 'Need a plumber', expires_at: at(-48), occurred_at: at(0.2) }),
      row({ id: 'ask', source: 'bluesky', kind: 'ask', severity: 3, occurred_at: at(0.3) }),
      row({ id: 'expired', source: 'fema', kind: 'disaster', severity: 3, expires_at: at(1), occurred_at: at(4) }),
      row({ id: 'future', source: 'events', kind: 'event', severity: 3, occurred_at: at(-5) }),
      row({ id: 'old', source: 'usgs', kind: 'quake', severity: 3, occurred_at: at(24 * 8) }),
      row({ id: 'nocity', source: 'faa', kind: 'travel', severity: 3, city: null, occurred_at: at(1) }),
    ];
    const { client, calls } = fake(rows);
    const out = await buildRecentRecords(client, NOW);
    expect(out).not.toBeNull();
    expect(out!.map((r) => r.id)).toEqual(['nws-high', 'spc', 'chi']);
    expect(out!.length).toBeLessThanOrEqual(RECENT_SHOWN);
    expect(out![1].place).toBe('Amarillo, TX');
    expect(out![0].ago).toBe('3 hr ago');
    // The query itself excludes resident requests, asks, expired rows and rows without a city, and is bounded.
    expect(calls.filter((c) => c.startsWith('from:'))).toEqual(['from:holler_signals']);
    expect(calls).toContain('neq:source=holler-request');
    expect(calls).toContain('neq:kind=ask');
    expect(calls).toContain('not:city.is.null');
    expect(calls.some((c) => c.startsWith('or:expires_at.is.null,expires_at.gt.'))).toBe(true);
    expect(calls).toContain(`limit:${RECENT_SCAN}`);
    expect(calls.find((c) => c.startsWith('select:'))).not.toMatch(/summary|url|lat|lon|zip|email/);
  });

  it('re-checks the rules on the rows even if the database returned something it should not have', () => {
    const out = pickRecent(
      [
        row({ id: 'req', source: 'holler-request', kind: 'ask', expires_at: at(-10) }),
        row({ id: 'exp', source: 'fema', expires_at: at(0.1) }),
        row({ id: 'ok', source: 'usgs', kind: 'quake' }),
      ] as never,
      NOW.getTime(),
    );
    expect(out.map((r) => r.id)).toEqual(['ok']);
  });

  it('empty: no rows gives an empty list, and the band then shows numbers only', async () => {
    const { client } = fake([]);
    expect(await buildRecentRecords(client, NOW)).toEqual([]);
    expect(homeLiveFrom(GOOD_STATS, [])).toEqual({ total7: 1234, cities30: 88, sources: 14, recent: [] });
  });

  it('failing client: an error, a throw or no client gives null, never an exception', async () => {
    expect(await buildRecentRecords(fake([], { fail: 'error' }).client, NOW)).toBeNull();
    expect(await buildRecentRecords(fake([], { fail: 'throw' }).client, NOW)).toBeNull();
    expect(await buildRecentRecords(null, NOW)).toBeNull();
  });

  it('long titles are cut at a word', () => {
    const t = shortTitle('Special Weather Statement issued November 17 at 4:05AM CST until November 17 at 9:00AM CST by NWS', 48);
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('home live band: whole band', () => {
  it('hides when national stats are unavailable or there were no records in 7 days', () => {
    expect(homeLiveFrom(unavailableStats(NOW.toISOString()), [])).toBeNull();
    expect(homeLiveFrom({ ...GOOD_STATS, total7: 0 }, [])).toBeNull();
  });

  it('drops a figure it cannot state (cities unknown, no sources) instead of showing a placeholder', () => {
    const live = homeLiveFrom({ ...GOOD_STATS, citiesActive30: null, sourcesSeen: 0 }, null)!;
    expect(live.cities30).toBeNull();
    expect(live.sources).toBe(0);
    expect(live.recent).toEqual([]);
  });

  it('with no database the loader returns null (the page renders no band)', async () => {
    h.stats = unavailableStats(NOW.toISOString());
    expect(await loadHomeLive({})).toBeNull();
  });

  it('with a working database it returns real numbers and records, not the fixture', async () => {
    h.client = fake([row({ id: 'a', source: 'nws', occurred_at: new Date(Date.now() - HOUR).toISOString() })]).client;
    const live = await loadHomeLive({});
    expect(live).not.toBe(HOME_LIVE_PREVIEW_FIXTURE);
    expect(live!.total7).toBe(1234);
    expect(live!.recent.map((r) => r.id)).toEqual(['a']);
  });
});

describe('preview fixture guard', () => {
  it('only HOLLER_PREVIEW_FIXTURES=1 without VERCEL turns it on', () => {
    expect(previewFixturesEnabled({ HOLLER_PREVIEW_FIXTURES: '1' })).toBe(true);
    expect(previewFixturesEnabled({})).toBe(false);
    expect(previewFixturesEnabled({ HOLLER_PREVIEW_FIXTURES: 'true' })).toBe(false);
    expect(previewFixturesEnabled({ HOLLER_PREVIEW_FIXTURES: '0' })).toBe(false);
    expect(previewFixturesEnabled({ HOLLER_PREVIEW_FIXTURES: '1', VERCEL: '1' })).toBe(false);
    expect(previewFixturesEnabled({ HOLLER_PREVIEW_FIXTURES: '1', VERCEL: '' })).toBe(true);
  });

  it('the loader never returns the fixture when VERCEL is set or the variable is absent', async () => {
    h.stats = unavailableStats(NOW.toISOString());
    expect(await loadHomeLive({ HOLLER_PREVIEW_FIXTURES: '1', VERCEL: '1' })).toBeNull();
    expect(await loadHomeLive({ VERCEL: '1' })).toBeNull();
    expect(await loadHomeLive({})).toBeNull();
    h.stats = GOOD_STATS;
    expect(await loadHomeLive({ HOLLER_PREVIEW_FIXTURES: '1', VERCEL: '1' })).not.toBe(HOME_LIVE_PREVIEW_FIXTURE);
    expect(await loadHomeLive({ HOLLER_PREVIEW_FIXTURES: '1' })).toBe(HOME_LIVE_PREVIEW_FIXTURE);
  });

  it('every fixture record says it is a fixture', () => {
    for (const r of HOME_LIVE_PREVIEW_FIXTURE.recent) expect(r.title).toContain('(fixture)');
  });
});
