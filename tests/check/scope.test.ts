import { describe, expect, it, vi, beforeEach } from 'vitest';
import zipcodes from 'zipcodes';
import { lookupZip, nearestCity, haversineMi } from '@/lib/geo';
import { CHECK_RADIUS_MI, GRID_DEGREES, cellBox, deriveScope, scopeKey, withinRadius } from '@/lib/check/scope';
import { CATEGORIES } from '@/lib/signals/categories';

const sb = vi.hoisted(() => ({ calls: [] as { m: string; a: unknown[] }[], result: { data: [] as unknown[], error: null as null | { message: string; code?: string } } }));
vi.mock('next/cache', () => ({ cacheLife: vi.fn() }));
vi.mock('@/lib/seo/client', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'or', 'overlaps', 'gte', 'lte', 'gt', 'order', 'limit', 'abortSignal']) {
    chain[m] = (...a: unknown[]) => {
      sb.calls.push({ m, a });
      return chain;
    };
  }
  chain.then = (res: (v: unknown) => unknown) => res(sb.result);
  return { publicClient: () => ({ from: () => chain }) };
});
import { loadCheck } from '@/lib/check/load';

describe('check scope: the ZIP\'s own place, a coarse grid cell, never the raw ZIP', () => {
  it('two ZIPs in the same cell and state share a key; the raw ZIP is not in it', () => {
    const a = deriveScope(lookupZip('30303')!);
    const b = deriveScope(lookupZip('30308')!);
    expect(scopeKey(a, 'roofing')).toBe(scopeKey(b, 'roofing'));
    expect(scopeKey(a, 'roofing')).not.toContain('30303');
    expect(scopeKey(a, 'hvac')).not.toBe(scopeKey(a, 'roofing'));
  });
  it('snaps to the 0.25 degree grid', () => {
    const s = deriveScope({ lat: 33.7551, lon: -84.3902, state: 'ga' });
    expect(s).toEqual({ cellLat: 33.75, cellLon: -84.5, state: 'GA', covered: true });
    expect(GRID_DEGREES).toBe(0.25);
  });
  it('Staten Island (10301) takes its state from the ZIP, not from the nearest city (bayonne-nj)', () => {
    const z = lookupZip('10301')!;
    expect(nearestCity(z.lat, z.lon, 40)?.slug).toBe('bayonne-nj');
    expect(deriveScope(z).state).toBe('NY');
  });
  it('recomputed over every ZIP: 2,186 ZIPs have a nearest city in another state, and the scope uses their own state', () => {
    let mismatch = 0;
    let none = 0;
    let covered = 0;
    const cells = new Set<string>();
    for (const code of Object.keys((zipcodes as unknown as { codes: Record<string, unknown> }).codes)) {
      const z = lookupZip(code);
      if (!z) continue;
      const sc = deriveScope(z);
      expect(sc.state).toBe(z.state.toUpperCase());
      if (!sc.covered) continue;
      covered++;
      cells.add(`${sc.cellLat}:${sc.cellLon}|${sc.state}`);
      const c = nearestCity(z.lat, z.lon, 40);
      if (!c) none++;
      else if (c.state !== z.state.toUpperCase()) mismatch++;
    }
    expect(mismatch).toBe(2186);
    // 13,829 of 41,689 covered ZIPs (33%) have no tracked city within 40 miles. With the 866 uncovered ZIPs that is the review's 14,695 of 42,555.
    expect(none).toBe(13829);
    expect(covered + 866).toBe(42555);
    // Distinct (cell, state) pairs times 41 trades is the whole key space. It is bounded; it is larger than the old per-city design.
    expect(cells.size).toBe(10254);
    expect(cells.size * CATEGORIES.length).toBe(420414);
  });
  it('territories and military codes are not covered', () => {
    for (const zip of ['00901', '96799', '96910', '09001']) {
      const z = lookupZip(zip);
      if (z) expect(deriveScope(z).covered, `${zip} ${z.state}`).toBe(false);
    }
    expect(deriveScope({ lat: 18.4, lon: -66.1, state: 'PR' }).covered).toBe(false);
    expect(deriveScope({ lat: 33.7, lon: -84.4, state: 'GA' }).covered).toBe(true);
    expect(deriveScope({ lat: 38.9, lon: -77.0, state: 'DC' }).covered).toBe(true);
  });
});

describe('bounding box covers the whole radius for any ZIP in the cell', () => {
  for (const lat0 of [25, 45, 65]) {
    it(`walks the circle at latitude ${lat0}`, () => {
      const cellLat = Math.round(lat0 / GRID_DEGREES) * GRID_DEGREES;
      const cellLon = -100;
      const box = cellBox(cellLat, cellLon);
      const half = GRID_DEGREES / 2;
      for (const fy of [-1, 0, 1]) {
        for (const fx of [-1, 0, 1]) {
          const zlat = cellLat + fy * half;
          const zlon = cellLon + fx * half;
          for (let deg = 0; deg < 360; deg += 5) {
            const rad = (deg * Math.PI) / 180;
            const dLat = (CHECK_RADIUS_MI / 69) * Math.cos(rad);
            const dLon = ((CHECK_RADIUS_MI / 69) * Math.sin(rad)) / Math.cos((zlat * Math.PI) / 180);
            const plat = zlat + dLat;
            const plon = zlon + dLon;
            expect(haversineMi(zlat, zlon, plat, plon)).toBeLessThanOrEqual(CHECK_RADIUS_MI + 0.5);
            expect(plat).toBeGreaterThanOrEqual(box.latMin);
            expect(plat).toBeLessThanOrEqual(box.latMax);
            expect(plon).toBeGreaterThanOrEqual(box.lonMin);
            expect(plon).toBeLessThanOrEqual(box.lonMax);
          }
        }
      }
    });
  }
});

describe('rural ZIP: Absarokee, MT (59001) sees a hail report 10 miles away', () => {
  const z = lookupZip('59001')!;
  it('has no tracked city within 40 miles, so the old city scope saw state-level rows only', () => {
    expect(nearestCity(z.lat, z.lon, 40)).toBeNull();
  });
  it('the box around its cell contains a report 10 miles north, and the radius trim keeps it', () => {
    const sc = deriveScope(z);
    const box = cellBox(sc.cellLat, sc.cellLon);
    const hail = { lat: z.lat + 10 / 69, lon: z.lon };
    expect(hail.lat).toBeLessThanOrEqual(box.latMax);
    expect(hail.lat).toBeGreaterThanOrEqual(box.latMin);
    expect(withinRadius(z, hail)).toBe(true);
  });
  it('a report 30 miles away is inside the box but outside what a 25 mile subscription would send', () => {
    const far = { lat: z.lat + 30 / 69, lon: z.lon };
    expect(withinRadius(z, far)).toBe(false);
  });
  it('state-level rows (no coordinates) always pass the trim', () => {
    expect(withinRadius(z, { lat: null, lon: null })).toBe(true);
  });
});

describe('loadCheck query shape', () => {
  beforeEach(() => {
    sb.calls.length = 0;
    sb.result = { data: [], error: null };
  });
  const orArgs = () => sb.calls.filter((c) => c.m === 'or').map((c) => String(c.a[0]));

  it('queries a lat/lon box plus the ZIP\'s own state-level rows, not city slugs', async () => {
    const z = lookupZip('10301')!;
    const sc = deriveScope(z);
    await loadCheck(sc.cellLat, sc.cellLon, sc.state, 'roofing');
    const first = orArgs()[0];
    expect(first).toMatch(/^and\(lat\.gte\.[\d.-]+,lat\.lte\.[\d.-]+,lon\.gte\.[-\d.]+,lon\.lte\.[-\d.]+\),and\(lat\.is\.null,state\.eq\.NY,severity\.gte\.2\)$/);
    expect(first).not.toContain('place_slug');
    expect(first).not.toContain('NJ');
    expect(orArgs()[1]).toMatch(/^expires_at\.is\.null,expires_at\.gt\./);
  });
  it('refuses a malformed state or trade without querying', async () => {
    const r = await loadCheck(40.75, -74, "NY'),or(id.gt.0", 'roofing');
    expect(r.ok).toBe(false);
    const r2 = await loadCheck(40.75, -74, 'NY', "roofing'),or(id.gt.0");
    expect(r2.ok).toBe(false);
    const r3 = await loadCheck(Number.NaN, -74, 'NY', 'roofing');
    expect(r3.ok).toBe(false);
    expect(sb.calls).toHaveLength(0);
  });
  it('returns coordinates with each item so the page can trim to the ZIP\'s radius, and logs a failed read', async () => {
    sb.result = {
      data: [{ id: 1, source: 'spc', kind: 'report', title: 'Hail', url: null, city: null, state: 'MT', lat: 45.6, lon: -109.4, severity: 2, occurred_at: '2026-11-15T00:00:00Z' }],
      error: null,
    };
    const ok = await loadCheck(45.5, -109.5, 'MT', 'roofing');
    expect(ok.ok).toBe(true);
    expect(ok.items[0]).toMatchObject({ lat: 45.6, lon: -109.4 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sb.result = { data: [], error: { message: 'boom', code: 'XX' } };
    const bad = await loadCheck(45.5, -109.5, 'MT', 'roofing');
    expect(bad.ok).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
