import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ cacheLife: vi.fn(), client: null as unknown, stats: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.client }));
vi.mock('@/lib/seo/national-data', async (orig) => ({
  ...(await orig<typeof import('@/lib/seo/national-data')>()),
  loadNationalStats: async () => h.stats,
}));

import {
  NO_LIVE,
  WEATHER_EXAMPLE_SCAN,
  buildWeatherExample,
  feedCount,
  fixtureMapRows,
  homeLivePreviewFixture,
  loadHomeLive,
  pickWeather,
  previewFixturesEnabled,
  proofFrom,
  shortTitle,
} from '@/lib/seo/home-live';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { unavailableStats, type NationalStats } from '@/lib/seo/national-data';
import { fakeClient } from '../home/fake-query';
import { HOME_TZ, shortDay } from '@/lib/seo/home-map';

const NOW = new Date('2026-11-17T12:00:00.000Z');
const HOUR = 3_600_000;
const at = (hoursAgo: number, base = NOW) => new Date(base.getTime() - hoursAgo * HOUR).toISOString();

const GOOD_STATS: NationalStats = { ...unavailableStats(NOW.toISOString()), ok: true, total7: 1234, total30: 5000, citiesActive30: 88, sourcesSeen: 14 };

beforeEach(() => {
  h.cacheLife.mockReset();
  h.client = null;
  h.stats = GOOD_STATS;
});

describe('proof strip figures', () => {
  it('feeds: city and county open data adapters plus weather, keys set, counted exactly from the registry', () => {
    const n = feedCount(ALL_ADAPTERS, {});
    const expected = ALL_ADAPTERS.filter(
      (a) => (/^(socrata|arcgis)-/.test(a.id) || a.kind === 'alert' || a.kind === 'report') && !(a.requiresEnv ?? []).length && !a.probation,
    ).length;
    expect(n).toBe(expected);
    expect(n).toBeGreaterThan(0);
    // Keyed sources, FEMA, USGS, FAA and USAspending are not city, county or weather feeds and are never counted.
    const fake = [
      { id: 'socrata-x-permits', kind: 'permit' as const },
      { id: 'arcgis-y-permits', kind: 'permit' as const },
      { id: 'nws', kind: 'alert' as const },
      { id: 'spc', kind: 'report' as const },
      { id: 'fema', kind: 'disaster' as const },
      { id: 'usgs', kind: 'quake' as const },
      { id: 'usaspending', kind: 'contract' as const },
      { id: 'socrata-z', kind: 'civic' as const, requiresEnv: ['SOME_KEY'] },
    ];
    expect(feedCount(fake, {})).toBe(4);
    expect(feedCount(fake, { SOME_KEY: 'x' })).toBe(5);
  });

  it('shows only with real numbers: unavailable stats, zero records or zero feeds give null', () => {
    expect(proofFrom(GOOD_STATS, 49)).toEqual({ total7: 1234, feeds: 49, asOf: NOW.toISOString() });
    expect(proofFrom(unavailableStats(NOW.toISOString()), 49)).toBeNull();
    expect(proofFrom({ ...GOOD_STATS, total7: 0 }, 49)).toBeNull();
    expect(proofFrom(GOOD_STATS, 0)).toBeNull();
  });
});

describe('weather example for the ledger (one bounded query)', () => {
  it('storm reports first, then severity, then newest; never a request, expired, future or old row', async () => {
    const rows = [
      { source: 'nws', kind: 'alert', title: 'Severe Thunderstorm Warning: Tulsa County', severity: 3, occurred_at: at(1), expires_at: null },
      { source: 'spc', kind: 'report', title: '1.00 inch hail reported near Hollywood, FL', state: 'FL', severity: 2, occurred_at: at(5), expires_at: null },
      { source: 'spc', kind: 'report', title: 'Old hail', severity: 3, occurred_at: at(24 * 8), expires_at: null },
      { source: 'spc', kind: 'report', title: 'Future hail', severity: 3, occurred_at: at(-2), expires_at: null },
      { source: 'spc', kind: 'report', title: 'Expired hail', severity: 3, occurred_at: at(2), expires_at: at(1) },
      { source: 'holler-request', kind: 'report', title: 'Not weather', severity: 3, occurred_at: at(1), expires_at: null },
    ];
    const { client, calls } = fakeClient(rows);
    const w = await buildWeatherExample(client, NOW);
    // The date is shown in the record's own state zone (FL: America/New_York), not in Chicago time.
    expect(w).toEqual({ title: '1.00 inch hail reported near Hollywood, FL', occurredAt: at(5), mi: null, tz: 'America/New_York' });
    expect(calls[0]).toContain('select:source,kind,title,state,severity,occurred_at,expires_at');
    expect(calls[0]).toContain('in:kind=report,alert');
    expect(calls[0]).toContain('neq:source=holler-request');
    expect(calls[0]).toContain(`limit:${WEATHER_EXAMPLE_SCAN}`);
    expect(pickWeather([], NOW.getTime())).toBeNull();
  });

  it('the weather date uses the record state zone; with no known state it stays in HOME_TZ', () => {
    const base = { source: 'spc', kind: 'report', title: 'Hail', severity: 2, occurred_at: at(1), expires_at: null };
    expect(pickWeather([{ ...base, state: 'CA' }], NOW.getTime())!.tz).toBe('America/Los_Angeles');
    expect(pickWeather([{ ...base, state: 'ny' }], NOW.getTime())!.tz).toBe('America/New_York');
    expect(pickWeather([{ ...base, state: null }], NOW.getTime())!.tz).toBe(HOME_TZ);
    expect(pickWeather([{ ...base, state: 'GM' }], NOW.getTime())!.tz).toBe(HOME_TZ);
    // 05:30 UTC on Nov 19 is 00:30 in New York (Nov 19) and 23:30 in Chicago (Nov 18).
    expect(shortDay('2026-11-19T05:30:00.000Z', 'America/New_York')).toBe('Nov 19');
    expect(shortDay('2026-11-19T05:30:00.000Z')).toBe('Nov 18');
    expect(shortDay('2026-11-19T07:30:00.000Z', 'America/Los_Angeles')).toBe('Nov 18');
  });

  it('never throws', async () => {
    expect(await buildWeatherExample(fakeClient([], { fail: 'error' }).client, NOW)).toBeNull();
    expect(await buildWeatherExample(fakeClient([], { fail: 'throw' }).client, NOW)).toBeNull();
    expect(await buildWeatherExample(null, NOW)).toBeNull();
  });

  it('long titles are cut at a word', () => {
    const t = shortTitle('Special Weather Statement issued November 17 at 4:05AM CST until November 17 at 9:00AM CST by NWS', 48);
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('loadHomeLive', () => {
  it('with no database every part is null (the page shows the example map and leaves the rest out)', async () => {
    h.stats = unavailableStats(NOW.toISOString());
    expect(await loadHomeLive({})).toEqual(NO_LIVE);
  });

  it('with a working database it returns real parts, not the fixture', async () => {
    const now = new Date();
    const rows = [
      ...fixtureMapRows(now).map((r) => ({ ...r, title: r.title!.replace(' (fixture)', '') })),
      { source: 'spc', kind: 'report', title: '1.75 inch hail reported near Amarillo, TX', severity: 2, occurred_at: at(2, now), expires_at: null },
    ];
    h.client = fakeClient(rows as never).client;
    const live = await loadHomeLive({});
    expect(live.proof!.total7).toBe(1234);
    expect(live.proof!.feeds).toBe(feedCount(ALL_ADAPTERS, {}));
    expect(live.map!.live).toBe(true);
    expect(live.map!.records.every((r) => !r.title.includes('fixture'))).toBe(true);
    expect(live.weather!.title).toBe('1.75 inch hail reported near Amarillo, TX');
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
    expect(await loadHomeLive({ HOLLER_PREVIEW_FIXTURES: '1', VERCEL: '1' })).toEqual(NO_LIVE);
    expect(await loadHomeLive({ VERCEL: '1' })).toEqual(NO_LIVE);
    const fx = await loadHomeLive({ HOLLER_PREVIEW_FIXTURES: '1' });
    expect(fx.map!.live).toBe(true);
    expect(fx.map!.records.every((r) => r.title.endsWith('(fixture)'))).toBe(true);
  });

  it('every fixture record says it is a fixture, and the fixture goes through the real picking code', () => {
    const fx = homeLivePreviewFixture(NOW);
    expect(fx.weather!.title).toContain('(fixture)');
    for (const r of fixtureMapRows(NOW)) expect(r.title).toContain('(fixture)');
    expect(fx.map!.records.length).toBeGreaterThanOrEqual(4);
    // Rows the rules exclude (too far, too old, an ask, no trade) are in the fixture and never picked.
    expect(fx.map!.records.map((r) => r.title).join(' ')).not.toMatch(/Evanston|Sign permit|Anyone|Pothole/);
  });
});
