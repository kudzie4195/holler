// Integration round 3, item 2b: read-time defence in depth. Every public and member read of holler_signals / holler_matches leaves out
// resident requests (source 'holler-request') whose expires_at has passed, and a cached page listing a live request is kept 15 minutes
// at most. One expired request row and one live row are fed to each path; only the live one may come out.
import { colOf } from '../fixtures/json-col';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), cacheTag: vi.fn(), client: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife, cacheTag: h.cacheTag }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.client }));

import {
  HOLLER_REQUEST_SOURCE,
  REQUEST_PAGE_REVALIDATE_SECONDS,
  hasRequestRows,
  isEndedRequest,
  liveRequestsFilter,
  withoutEndedRequests,
} from '@/lib/signals/request-visibility';
import { REQUEST_SOURCE } from '@/lib/requests/constants';
import { loadPlaceData } from '@/lib/seo/data';
import { loadWeekData } from '@/lib/seo/week-data';
import { loadTradeSignals } from '@/lib/seo/trade-data';
import { loadCheck } from '@/lib/check/load';
import { buildNationalStats } from '@/lib/seo/national-data';
import { evalTerm, fakeSignalsDb, splitTop } from '../fixtures/fake-signals-db';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

/** Rows with every column any of the readers selects. */
function rows() {
  const base = {
    url: 'https://holler.test/request', categories: ['roofing'], severity: 2, place_slug: 'atlanta-ga', city: 'Atlanta', state: 'GA',
    lat: 33.75, lon: -84.39, summary: 'Leak over the kitchen', data: {}, subtype: null,
  };
  return [
    { ...base, id: 1, source: 'holler-request', kind: 'ask', title: 'ENDED request', occurred_at: iso(-20 * 24 * HOUR), expires_at: iso(-6 * 24 * HOUR) },
    { ...base, id: 2, source: 'holler-request', kind: 'ask', title: 'CLOSED request', occurred_at: iso(-2 * HOUR), expires_at: iso(-HOUR) },
    { ...base, id: 3, source: 'holler-request', kind: 'ask', title: 'LIVE request', occurred_at: iso(-HOUR), expires_at: iso(13 * 24 * HOUR) },
    // Another source, already expired: history stays on city pages (only requests are hidden).
    { ...base, id: 4, source: 'spc', kind: 'report', title: 'Hail report', occurred_at: iso(-3 * HOUR), expires_at: iso(-HOUR) },
  ];
}

/**
 * Plain-select fake that applies eq/gte/lte/gt/lt/contains/overlaps/or/order/limit and head counts the way PostgREST does, so
 * a reader that forgets the .or() filter gets the ended rows back (and the TypeScript guard is tested on its own below).
 */
function selectFake(data: Record<string, unknown>[], opts: { ignoreOr?: boolean } = {}) {
  const ors: string[] = [];
  const client = {
    ors,
    from() {
      const f: ((r: Record<string, unknown>) => boolean)[] = [];
      let lim = Infinity;
      let head = false;
      let wantCount = false;
      let ord: [string, boolean] | null = null;
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string; head?: boolean }) => ((head = !!o?.head), (wantCount = !!o?.count), q),
        eq: (c: string, v: unknown) => (f.push((r) => r[c] === v), q),
        is: (c: string, v: null) => (f.push((r) => (colOf(r, c) == null) === (v === null)), q),
        gte: (c: string, v: string) => (f.push((r) => String(r[c]) >= v), q),
        lte: (c: string, v: string) => (f.push((r) => String(r[c]) <= v), q),
        gt: (c: string, v: string) => (f.push((r) => String(r[c]) > v), q),
        lt: (c: string, v: string) => (f.push((r) => String(r[c]) < v), q),
        contains: (c: string, v: string[]) => (f.push((r) => v.every((x) => (r[c] as string[]).includes(x))), q),
        or: (s: string) => (ors.push(s), opts.ignoreOr || f.push((r) => splitTop(s).some((t) => evalTerm(t, r))), q),
        order: (c: string, o: { ascending: boolean }) => ((ord = [c, o.ascending]), q),
        limit: (n: number) => ((lim = n), q),
        range: (a: number, b: number) => ((lim = b - a + 1), q),
        abortSignal: () => q,
        then: (res: (v: unknown) => unknown) => {
          let m = data.filter((r) => f.every((x) => x(r)));
          if (ord) {
            const [c, asc] = ord;
            m = [...m].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (asc ? 1 : -1));
          }
          const total = m.length;
          m = m.slice(0, lim);
          return Promise.resolve(head ? { data: null, error: null, count: total } : { data: m, error: null, count: wantCount ? total : null }).then(res);
        },
      };
      return q;
    },
  };
  return client;
}

const lastCacheLife = () => h.cacheLife.mock.calls.at(-1)?.[0] as { revalidate: number; expire: number };
/** Review P1-2: an entry that lists a live request is never served older than 15 minutes, and is tagged for on-close expiry. */
function expectRequestCache() {
  const life = lastCacheLife();
  expect(life.revalidate).toBe(REQUEST_PAGE_REVALIDATE_SECONDS);
  expect(life.expire).toBeLessThanOrEqual(900);
  expect(life.expire).toBeGreaterThan(life.revalidate);
  expect(life.expire).toBeGreaterThanOrEqual(300);
  expect(h.cacheTag).toHaveBeenCalledWith('holler-requests');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.cacheLife.mockClear();
  h.cacheTag.mockClear();
});

describe('request-visibility helpers', () => {
  it('uses the same source id as lib/requests', () => {
    expect(HOLLER_REQUEST_SOURCE).toBe(REQUEST_SOURCE);
  });
  it('isEndedRequest: only resident requests at or past expiry (or with no expiry); other sources never', () => {
    const now = NOW.getTime();
    expect(isEndedRequest({ source: 'holler-request', expires_at: iso(-1) }, now)).toBe(true);
    expect(isEndedRequest({ source: 'holler-request', expires_at: iso(0) }, now)).toBe(true);
    expect(isEndedRequest({ source: 'holler-request', expires_at: null }, now)).toBe(true);
    expect(isEndedRequest({ source: 'holler-request', expires_at: 'garbage' }, now)).toBe(true);
    expect(isEndedRequest({ source: 'holler-request', expires_at: iso(1000) }, now)).toBe(false);
    expect(isEndedRequest({ source: 'nws', expires_at: iso(-HOUR) }, now)).toBe(false);
    expect(withoutEndedRequests(rows(), now).map((r) => r.id)).toEqual([3, 4]);
    expect(hasRequestRows([{ source: 'nws' }])).toBe(false);
    expect(hasRequestRows([{ source: 'holler-request' }])).toBe(true);
  });
  it('liveRequestsFilter keeps other sources and live requests only (PostgREST semantics)', () => {
    const s = liveRequestsFilter(NOW.toISOString());
    expect(s).toBe(`source.neq.holler-request,expires_at.gt.${NOW.toISOString()}`);
    const kept = rows().filter((r) => splitTop(s).some((t) => evalTerm(t, r)));
    expect(kept.map((r) => r.id)).toEqual([3, 4]);
  });
});

describe('city page (lib/seo/data.ts loadPlaceData)', () => {
  it('filters in the query and on the rows; a live request shortens the cache to 15 minutes', async () => {
    const fake = selectFake(rows());
    h.client = fake;
    const d = await loadPlaceData('atlanta-ga');
    const text = JSON.stringify(d);
    expect(text).not.toContain('ENDED request');
    expect(text).not.toContain('CLOSED request');
    expect(text).toContain('LIVE request');
    expect(fake.ors.every((s) => s === liveRequestsFilter(NOW.toISOString()))).toBe(true);
    expect(fake.ors.length).toBeGreaterThan(0);
    expectRequestCache();
  });
  it('the row guard alone drops ended requests even if the database ignored the filter', async () => {
    h.client = selectFake(rows(), { ignoreOr: true });
    const text = JSON.stringify(await loadPlaceData('atlanta-ga'));
    expect(text).not.toContain('ENDED request');
    expect(text).not.toContain('CLOSED request');
  });
  it('without any live request the 6 hour cache stays', async () => {
    h.client = selectFake(rows().filter((r) => r.id !== 3));
    await loadPlaceData('atlanta-ga');
    expect(lastCacheLife().revalidate).toBe(21600);
    expect(h.cacheTag).not.toHaveBeenCalled();
  });
});

describe('weekly page (lib/seo/week-data.ts loadWeekData)', () => {
  it('leaves out ended requests (query and rows) and caches a week with a live request 15 minutes', async () => {
    for (const ignoreOr of [false, true]) {
      h.client = selectFake(rows(), { ignoreOr });
      const d = await loadWeekData('atlanta-ga', '2026-11-16');
      const text = JSON.stringify(d);
      expect(text).not.toContain('CLOSED request');
      expect(text).toContain('LIVE request');
      expectRequestCache();
    }
  });
});

describe('trade page (lib/seo/trade-data.ts loadTradeSignals)', () => {
  it('leaves out ended requests (query and rows) and caches a list with a live request 15 minutes', async () => {
    for (const ignoreOr of [false, true]) {
      const fake = selectFake(rows(), { ignoreOr });
      h.client = fake;
      const d = await loadTradeSignals('roofing');
      const titles = d.items.map((i) => i.title);
      expect(titles).toContain('LIVE request');
      expect(titles).not.toContain('CLOSED request');
      expect(titles).not.toContain('ENDED request');
      expect(fake.ors).toContain(liveRequestsFilter(NOW.toISOString()));
      expectRequestCache();
    }
  });
});

describe('/check (lib/check/load.ts loadCheck)', () => {
  it('holler_signals_near and the row guard leave out ended requests; a live one shortens the cache', async () => {
    h.client = fakeSignalsDb(rows(), { now: NOW });
    const d = await loadCheck(33.75, -84.39, 'GA', 'roofing');
    expect(d.ok).toBe(true);
    const titles = d.items.map((i) => i.title);
    expect(titles).toContain('LIVE request');
    expect(titles).not.toContain('CLOSED request');
    expect(titles).not.toContain('ENDED request');
    expectRequestCache();
  });
});

describe('/data (lib/seo/national-data.ts buildNationalStats)', () => {
  it('counts and samples leave out ended requests', async () => {
    const data = rows().map((r) => ({ ...r }));
    const stats = await buildNationalStats(selectFake(data) as unknown as SupabaseClient, NOW);
    expect(stats.ok).toBe(true);
    // Rows 3 (live request) and 4 (storm report) are inside 7 days; 2 (closed request) is too but must not count; 1 is 20 days old.
    expect(stats.total7).toBe(2);
    expect(stats.total30).toBe(2);
    expect(stats.sampleSize).toBe(2);
  });
});
