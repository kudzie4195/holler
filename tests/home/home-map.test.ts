// The live radius map loader and picker (lib/seo/home-map.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ cacheLife: vi.fn() }));
vi.mock('next/cache', () => ({ cacheLife: h.cacheLife }));

import {
  CIVIC_SCAN,
  MAP_MIN,
  MAP_SHOWN,
  PERMIT_SCAN,
  WEATHER_SCAN,
  buildHomeMap,
  dayRange,
  exampleMap,
  pickMapRecords,
  shortDate,
  shortDay,
  type MapRow,
} from '@/lib/seo/home-map';
import { fixtureMapRows } from '@/lib/seo/home-live';
import { haversineMi, lookupZip } from '@/lib/geo';
import { fakeClient } from './fake-query';

const NOW = new Date('2026-11-19T15:00:00.000Z');
const C = lookupZip('60614')!;
const rows = () => fixtureMapRows(NOW);

beforeEach(() => h.cacheLife.mockReset());

describe('map centre', () => {
  it('comes from the repo ZIP lookup, in Chicago', () => {
    expect(C.city.toLowerCase()).toBe('chicago');
    expect(C.state).toBe('IL');
  });
});

describe('pickMapRecords', () => {
  it('picks range: at most six, one per label, permits first but not only permits, every family present, rings spread', () => {
    const out = pickMapRecords(rows(), C, NOW.getTime());
    expect(out.length).toBeGreaterThanOrEqual(MAP_MIN);
    expect(out.length).toBeLessThanOrEqual(MAP_SHOWN);
    expect(new Set(out.map((r) => r.label)).size).toBe(out.length);
    const permits = out.filter((r) => r.family === 'permit').length;
    expect(permits).toBeGreaterThanOrEqual(1);
    expect(permits).toBeLessThanOrEqual(3);
    expect(out.some((r) => r.family === 'civic')).toBe(true);
    const rings = new Set(out.map((r) => (r.mi <= 2 ? 0 : r.mi <= 4 ? 1 : 2)));
    expect(rings.size).toBe(3);
    // Nearest first, distances one decimal and true to the coordinates.
    expect(out.map((r) => r.mi)).toEqual([...out.map((r) => r.mi)].sort((a, b) => a - b));
    const byId = new Map(rows().map((r) => [String(r.id), r]));
    for (const r of out) {
      const src = byId.get(r.id)!;
      expect(r.mi).toBe(Math.round(haversineMi(C.lat, C.lon, src.lat!, src.lon!) * 10) / 10);
      expect(r.label.length).toBeLessThanOrEqual(16);
      expect(r.url).toMatch(/^https:\/\//);
      expect(r.occurredAt).toBe(src.occurred_at);
    }
  });

  it('leaves out what the rules forbid: too far, older than 7 days, an ask, a resident request, no trade, expired, future, no URL', () => {
    const base = rows()[0];
    const extra: MapRow[] = [
      { ...base, id: 'req', source: 'holler-request', kind: 'permit', title: 'Fence permit in Chicago' },
      { ...base, id: 'exp', title: 'Solar permit in Chicago', expires_at: new Date(NOW.getTime() - 1000).toISOString() },
      { ...base, id: 'fut', title: 'Pool permit in Chicago', occurred_at: new Date(NOW.getTime() + 3_600_000).toISOString() },
      { ...base, id: 'nourl', title: 'Deck permit in Chicago', url: null },
      { ...base, id: 'badurl', title: 'Sign permit in Chicago', url: 'javascript:alert(1)' },
      { ...base, id: 'insp', kind: 'civic', title: 'Failed inspection in Chicago: food establishment' },
    ];
    const out = pickMapRecords([...rows(), ...extra], C, NOW.getTime());
    const ids = out.map((r) => r.id);
    for (const bad of ['req', 'exp', 'fut', 'nourl', 'badurl', 'insp']) expect(ids).not.toContain(bad);
    const titles = out.map((r) => r.title).join(' | ');
    expect(titles).not.toMatch(/Evanston|Sign permit|Anyone|Pothole/);
  });

  it('fewer than four usable records gives fewer than four (the page then shows the example)', () => {
    const out = pickMapRecords(rows().slice(0, 3), C, NOW.getTime());
    expect(out.length).toBeLessThan(MAP_MIN);
  });
});

describe('buildHomeMap (three bounded reads)', () => {
  it('reads permits, city records and weather inside the box, last 7 days, not expired, never a request or an ask; bounded', async () => {
    const { client, calls } = fakeClient(rows() as never);
    const map = await buildHomeMap(client, NOW);
    expect(map).not.toBeNull();
    expect(map!.live).toBe(true);
    expect(map!.zip).toBe('60614');
    expect(map!.city).toBe('Chicago');
    expect(map!.placed).toHaveLength(map!.records.length);
    expect(calls).toHaveLength(3);
    const limits = calls.map((c) => c.find((x) => x.startsWith('limit:')));
    expect(limits).toEqual([`limit:${PERMIT_SCAN}`, `limit:${CIVIC_SCAN}`, `limit:${WEATHER_SCAN}`]);
    for (const c of calls) {
      expect(c).toContain('from:holler_signals');
      expect(c).toContain('neq:source=holler-request');
      expect(c).toContain('neq:kind=ask');
      for (const k of ['gte:lat', 'lte:lat', 'gte:lon', 'lte:lon', 'gte:occurred_at', 'lte:occurred_at']) expect(c).toContain(k);
      expect(c.some((x) => x.startsWith('or:expires_at.is.null,expires_at.gt.'))).toBe(true);
      expect(c.find((x) => x.startsWith('select:'))).not.toMatch(/summary|email|data|contact/);
    }
  });

  it('never throws: an error, a throw or no client gives null', async () => {
    expect(await buildHomeMap(fakeClient([], { fail: 'error' }).client, NOW)).toBeNull();
    expect(await buildHomeMap(fakeClient([], { fail: 'throw' }).client, NOW)).toBeNull();
    expect(await buildHomeMap(null, NOW)).toBeNull();
  });

  it('too few records near the ZIP gives null', async () => {
    expect(await buildHomeMap(fakeClient(rows().slice(0, 2) as never).client, NOW)).toBeNull();
    expect(await buildHomeMap(fakeClient([]).client, NOW)).toBeNull();
  });
});

describe('example map', () => {
  it('is the design six, not live, with no dates and no source links', () => {
    const m = exampleMap();
    expect(m.live).toBe(false);
    expect(m.records).toHaveLength(6);
    for (const r of m.records) {
      expect(r.occurredAt).toBeNull();
      expect(r.url).toBeNull();
    }
    expect(m.records.map((r) => `${r.label} ${r.mi}`)).toEqual([
      'LANDSCAPING 1.7',
      'GUTTER PERMIT 2.6',
      'FENCE PERMIT 3.5',
      'WEED REMOVAL 4.9',
      'GRAFFITI REMOVAL 5',
      'EXTERIOR PAINT 5.5',
    ]);
  });
});

describe('dates are Chicago dates, computed', () => {
  it('shortDay, shortDate and ranges', () => {
    expect(shortDay('2026-11-19T03:00:00Z')).toBe('Nov 18'); // 9 pm the day before in Chicago
    expect(shortDate('2026-11-19T15:00:00Z')).toBe('Nov 19, 2026');
    expect(dayRange(['2026-11-18T15:00:00Z', '2026-11-13T15:00:00Z', null])).toBe('Nov 13 to 18');
    expect(dayRange(['2026-10-30T15:00:00Z', '2026-11-02T15:00:00Z'])).toBe('Oct 30 to Nov 2');
    expect(dayRange(['2026-11-18T15:00:00Z'], 'long')).toBe('November 18');
    expect(dayRange([null])).toBe('');
  });
});
