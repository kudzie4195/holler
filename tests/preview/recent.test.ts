import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ profile: null as unknown }));
vi.mock('@/lib/auth/session', () => ({ getProfile: async () => h.profile }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({}) }) }));

import { PREVIEW_COLUMNS, recentPreviewFor, typeLabel, type PreviewProfile } from '@/lib/preview/recent';
import { RECENT_EMPTY, RECENT_NOTE, RecentActivity, RecentActivityView } from '@/components/feed/recent-activity';

const NOW = new Date('2026-11-18T12:00:00.000Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

type Row = Record<string, unknown>;
const ATL = { lat: 33.749, lon: -84.388 };
let n = 1;
function row(over: Row): Row {
  return { id: n++, source: 'x', kind: 'report', title: 'Hail report', city: 'Atlanta', state: 'GA', ...ATL, categories: ['roofing'], severity: 2, occurred_at: day(3), subtype: null, ...over };
}

/** Records every call so tests can assert what was selected and filtered. Query A has a `not lat is null` filter, B has `is lat null`. */
function fakeDb(a: Row[], b: Row[] = [], err?: string, c: Row[] = []) {
  const calls: { cols: string; filters: string[] }[] = [];
  const db = {
    from: (t: string) => {
      const q = { cols: '', filters: [`from:${t}`] };
      calls.push(q);
      const chain: Record<string, unknown> = {};
      const add = (name: string) => (...args: unknown[]) => (q.filters.push(`${name}:${args.map(String).join(',')}`), chain);
      for (const m of ['neq', 'overlaps', 'gte', 'lte', 'order', 'limit', 'not', 'is', 'or', 'in']) chain[m] = add(m);
      chain.select = (c: string) => ((q.cols = c), chain);
      chain.then = (res: (v: unknown) => unknown) => {
        const isB = q.filters.some((f) => f.startsWith('is:lat'));
        // Query C (round 7, Cobb County): the approximate-location sources, filtered with in('source', ...).
        const isC = q.filters.some((f) => f.startsWith('in:source,'));
        return Promise.resolve(res(err ? { data: null, error: { message: err } } : { data: isC ? c : isB ? b : a, error: null }));
      };
      return chain;
    },
  };
  return { db: db as never, calls };
}

const profile: PreviewProfile = { categories: ['roofing'], ...ATL, state: 'GA', radius_mi: 25, plan: null, subscription_status: 'trialing', extra_areas: null, keywords: null };
const textOf = (el: unknown) => renderToStaticMarkup(el as never).replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

beforeEach(() => {
  n = 1;
  h.profile = null;
});

describe('recentPreviewFor', () => {
  // Round 7 (review r1 P1-6 follow-up): Cobb County rows sit at a stand-in point (the county seat). The scanner matches them within
  // radius + 15 miles of it, so the preview must too, or it counts fewer than the feed holds.
  describe('Cobb County (approximate location)', () => {
    const COBB = { lat: 33.95, lon: -84.55 };
    const cobb = (over: Row = {}) => row({ source: 'arcgis-cobb-residential-permits', kind: 'permit', subtype: 'permit', title: 'Residential permit', city: 'Cobb County', ...COBB, ...over });
    // A member 20 miles due south of the stand-in with a 10-mile radius: outside the plain box, inside radius + 15.
    const south20 = { ...profile, lat: COBB.lat - 20 / 69.09, lon: COBB.lon, radius_mi: 10 };
    it('counts a Cobb row 20 miles from the stand-in for a 10-mile member, as the scanner does', async () => {
      const { db, calls } = fakeDb([], [], undefined, [cobb()]);
      const p = await recentPreviewFor(south20, { db, now: NOW });
      expect(p?.total).toBe(1);
      expect(p?.examples[0]).toMatchObject({ city: 'Cobb County', state: 'GA' });
      const c = calls.find((x) => x.filters.some((f) => f.startsWith('in:source,')));
      expect(c?.filters).toContain('in:source,arcgis-cobb-residential-permits,arcgis-cobb-commercial-permits,arcgis-cobb-multiunit-permits');
      // The box is 25 miles (10 + 15) tall in each direction: about 0.365 degrees of latitude.
      const or = c?.filters.find((f) => f.startsWith('or:')) ?? '';
      const lo = Number(/lat\.gte\.([-\d.]+)/.exec(or)?.[1]);
      expect(south20.lat - lo).toBeCloseTo(25 / 68.5, 3);
    });
    it('a Cobb row 30 miles out is not counted for a 10-mile member; a non-Cobb row 20 miles out is not either', async () => {
      const far = { ...south20, lat: COBB.lat - 30 / 69.09 };
      expect((await recentPreviewFor(far, { db: fakeDb([], [], undefined, [cobb()]).db, now: NOW }))?.total).toBe(0);
      const plain = row({ source: 'arcgis-atlanta-permits', kind: 'permit', subtype: 'permit', ...COBB });
      expect((await recentPreviewFor(south20, { db: fakeDb([plain]).db, now: NOW }))?.total).toBe(0);
    });
    it('a Cobb row returned by both the plain box and the Cobb query counts once', async () => {
      const r = cobb({ id: 999 });
      const near = { ...profile, ...COBB, radius_mi: 10 };
      expect((await recentPreviewFor(near, { db: fakeDb([r], [], undefined, [r]).db, now: NOW }))?.total).toBe(1);
    });
  });

  it('counts come from the query result exactly, by type and intent', async () => {
    const rows = [
      ...Array.from({ length: 4 }, () => row({ kind: 'report' })),
      ...Array.from({ length: 12 }, () => row({ kind: 'permit', subtype: 'permit', title: 'Re-roof permit' })),
      row({ kind: 'alert', title: 'Severe thunderstorm warning' }),
    ];
    const { db } = fakeDb(rows);
    const p = await recentPreviewFor(profile, { db, now: NOW });
    expect(p?.total).toBe(17);
    expect(p?.byType).toEqual([
      { key: 'permit', count: 12 },
      { key: 'storm-report', count: 4 },
      { key: 'weather-alert', count: 1 },
    ]);
    expect(p?.byIntent.spending).toBe(12);
    expect(p?.byIntent.demand).toBe(5);
    expect(p?.capped).toBe(false);
  });

  it('counts sam-gov rows as open federal bids, usaspending as awards, and NWS as weather alerts (not warnings)', async () => {
    const rows = [
      row({ source: 'sam-gov', kind: 'contract', title: 'Federal bid in Atlanta' }),
      row({ source: 'sam-gov', kind: 'contract', title: 'Federal bid in Atlanta 2' }),
      row({ source: 'usaspending', kind: 'contract', title: 'Award' }),
      row({ source: 'nws', kind: 'alert', title: 'Wind advisory' }),
    ];
    const { db } = fakeDb(rows);
    const p = await recentPreviewFor(profile, { db, now: NOW });
    expect(p?.byType).toEqual([
      { key: 'federal-bid', count: 2 },
      { key: 'contract', count: 1 },
      { key: 'weather-alert', count: 1 },
    ]);
    expect(typeLabel('federal-bid', 2)).toBe('open federal bids');
    expect(typeLabel('federal-bid', 1)).toBe('open federal bid');
    expect(typeLabel('contract', 1)).toBe('federal contract award');
    expect(typeLabel('weather-alert', 1)).toBe('weather alert');
    expect(typeLabel('weather-alert', 3)).toBe('weather alerts');
  });

  it('drops rows that the matcher would not match (too far, wrong trade, state-level at severity 1)', async () => {
    const { db } = fakeDb(
      [row({}), row({ lat: 40.7, lon: -74 }), row({ categories: ['plumbing'] })],
      [row({ lat: null, lon: null, severity: 1 }), row({ lat: null, lon: null, severity: 2, kind: 'disaster' })],
    );
    const p = await recentPreviewFor(profile, { db, now: NOW });
    expect(p?.total).toBe(2);
  });

  it('picks up to 5 examples, newest first, with title, city, state and date only', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ title: `T${i}`, occurred_at: day(i + 1) }));
    const { db } = fakeDb(rows);
    const p = await recentPreviewFor(profile, { db, now: NOW });
    expect(p?.examples.map((e) => e.title)).toEqual(['T0', 'T1', 'T2', 'T3', 'T4']);
    expect(Object.keys(p!.examples[0]).sort()).toEqual(['city', 'date', 'source', 'state', 'title']);
    expect(p?.examples[0].date).toBe(day(1).slice(0, 10));
  });

  // Was "two queries" before round 7 integrate3: the third reads the approximate-location (Cobb County) sources at radius + 15 miles.
  it('uses three queries, the last 90 days, and no free-text, name, contact or link column', async () => {
    const { db, calls } = fakeDb([row({})]);
    await recentPreviewFor(profile, { db, now: NOW });
    expect(calls).toHaveLength(3);
    for (const c of calls) {
      expect(c.cols).toBe(PREVIEW_COLUMNS);
      const cols = c.cols.split(',').map((x) => x.split(':')[0]);
      for (const bad of ['summary', 'url', 'data', 'zip', 'county', 'contacts', 'name', 'business_name', '*']) expect(cols).not.toContain(bad);
      expect(c.filters).toContain(`gte:occurred_at,${day(90)}`);
      expect(c.filters).toContain('from:holler_signals');
      expect(c.filters).toContain('neq:source,holler-request');
      expect(c.filters).toContain('neq:kind,ask');
    }
  });

  it('marks counts as a floor when a query hits the row cap', async () => {
    const rows = Array.from({ length: 1000 }, () => row({}));
    const { db } = fakeDb(rows);
    expect((await recentPreviewFor(profile, { db, now: NOW }))?.capped).toBe(true);
  });

  it('returns null without an area, without trades, or when the read fails', async () => {
    const { db } = fakeDb([row({})]);
    expect(await recentPreviewFor({ ...profile, lat: null, lon: null }, { db, now: NOW })).toBeNull();
    expect(await recentPreviewFor({ ...profile, categories: [] }, { db, now: NOW })).toBeNull();
    const bad = fakeDb([], [], 'boom');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recentPreviewFor(profile, { db: bad.db, now: NOW })).toBeNull();
  });
});

describe('RecentActivityView', () => {
  const base = { byIntent: { demand: 0, spending: 0, asking: 0 }, examples: [], capped: false };

  it('draws one line per non-zero count and omits zero lines', () => {
    const t = textOf(
      createElement(RecentActivityView, {
        preview: { ...base, total: 16, byType: [{ key: 'permit', count: 12 }, { key: 'storm-report', count: 4 }, { key: 'quake', count: 0 }] },
      }),
    );
    expect(t).toContain('Near you in the last 90 days');
    expect(t).toContain('12 building permits');
    expect(t).toContain('4 storm reports');
    expect(t).not.toMatch(/earthquake/);
    expect(t).not.toMatch(/\b0 /);
    expect(t).toContain(RECENT_NOTE);
    expect(t).not.toMatch(/[–—]/);
  });

  it('uses the singular for one and says "At least" when capped', () => {
    expect(textOf(createElement(RecentActivityView, { preview: { ...base, total: 1, byType: [{ key: 'storm-report', count: 1 }] } }))).toContain('1 storm report');
    expect(textOf(createElement(RecentActivityView, { preview: { ...base, capped: true, total: 3, byType: [{ key: 'permit', count: 3 }] } }))).toContain('At least 3 building permits');
  });

  it('shows the honest empty line and a Settings link when every count is zero', () => {
    const html = renderToStaticMarkup(createElement(RecentActivityView, { preview: { ...base, total: 0, byType: [] } }));
    expect(html).toContain(RECENT_EMPTY);
    expect(html).toContain('href="/app/settings"');
    expect(html).not.toContain(RECENT_NOTE);
  });
});

describe('RecentActivity (server component)', () => {
  it('renders null for a member without a profile or without an area', async () => {
    h.profile = null;
    expect(await RecentActivity({ userId: 'u' })).toBeNull();
    h.profile = { ...profile, lat: null, lon: null, zip: null };
    expect(await RecentActivity({ userId: 'u' })).toBeNull();
  });
});
