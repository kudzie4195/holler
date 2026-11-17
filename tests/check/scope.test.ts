import { describe, expect, it, vi, beforeEach } from 'vitest';
import zipcodes from 'zipcodes';
import { lookupZip, nearestCity, haversineMi } from '@/lib/geo';
import {
  CHECK_CORE_RADIUS_MI,
  CHECK_RADIUS_LABEL,
  CHECK_RADIUS_MI,
  CHECK_SEARCH_RADIUS_MI,
  GRID_DEGREES,
  MAX_CELL_OFFSET_MI,
  deriveScope,
  scopeKey,
} from '@/lib/check/scope';
import { CATEGORIES } from '@/lib/signals/categories';
import { fakeSignalsDb, type Row } from '../fixtures/fake-signals-db';

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('@/lib/seo/client', () => ({ publicClient: () => h.db }));
import { loadCheck } from '@/lib/check/load';
import { groupItems } from '@/lib/check/group';

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

describe('the cell-centre radius covers a 25 mile circle around every ZIP in the cell', () => {
  it('MAX_CELL_OFFSET_MI is the real half-cell diagonal at the equator, where degrees are widest', () => {
    const half = GRID_DEGREES / 2;
    expect(haversineMi(0, 0, half, half)).toBeLessThanOrEqual(MAX_CELL_OFFSET_MI);
    expect(haversineMi(0, 0, half, half)).toBeGreaterThan(MAX_CELL_OFFSET_MI - 0.3);
  });
  it('CHECK_SEARCH_RADIUS_MI is at least 25 plus the largest ZIP offset, and the label says "about 25 to 50"', () => {
    expect(CHECK_SEARCH_RADIUS_MI).toBeGreaterThanOrEqual(CHECK_RADIUS_MI + MAX_CELL_OFFSET_MI);
    expect(CHECK_RADIUS_LABEL).toBe('about 25 to 50 miles');
    expect(CHECK_CORE_RADIUS_MI + MAX_CELL_OFFSET_MI).toBeLessThanOrEqual(CHECK_RADIUS_MI);
    // the farthest a shown record can be from a ZIP is the search radius plus the offset: about 50, and 38 from the cell centre
    expect(CHECK_SEARCH_RADIUS_MI + MAX_CELL_OFFSET_MI).toBeLessThan(51);
  });
  for (const lat0 of [0, 25, 45, 65]) {
    it(`walks the 25 mile circle of nine ZIP positions in a cell at latitude ${lat0}: every point is within ${CHECK_SEARCH_RADIUS_MI} miles of the centre`, () => {
      const cellLat = Math.round(lat0 / GRID_DEGREES) * GRID_DEGREES;
      const cellLon = -100;
      const half = GRID_DEGREES / 2;
      for (const fy of [-1, 0, 1]) {
        for (const fx of [-1, 0, 1]) {
          const zlat = cellLat + fy * half;
          const zlon = cellLon + fx * half;
          for (let deg = 0; deg < 360; deg += 5) {
            const rad = (deg * Math.PI) / 180;
            const plat = zlat + ((CHECK_RADIUS_MI / 69.09) * Math.cos(rad));
            const plon = zlon + ((CHECK_RADIUS_MI / 69.09) * Math.sin(rad)) / Math.cos((zlat * Math.PI) / 180);
            expect(haversineMi(cellLat, cellLon, plat, plon)).toBeLessThanOrEqual(CHECK_SEARCH_RADIUS_MI);
          }
        }
      }
    });
  }
});

const NOW = new Date('2026-11-17T12:00:00Z');
const hoursAgo = (hrs: number) => new Date(NOW.getTime() - hrs * 3_600_000).toISOString();
const daysAhead = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
let nid = 1;
const sig = (over: Row): Row => ({
  id: nid++, source: 'x', kind: 'civic', title: 't', url: null, city: null, state: null, lat: null, lon: null, categories: ['hvac'],
  severity: 1, occurred_at: hoursAgo(5), expires_at: null, data: {}, ...over,
});
/** The review's reproduction: 400 NYC heat rows in the last 10 hours fill any bounding-box read with a row limit. */
const nycFlood = () => Array.from({ length: 400 }, (_, i) => sig({ state: 'NY', title: 'nyc 311', lat: 40.7 + (i % 40) * 0.003, lon: -73.99 + (i % 9) * 0.004, occurred_at: hoursAgo((i * 10) / 400) }));

async function checkZip(zip: string, trade: string, signals: Row[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  try {
    const fake = fakeSignalsDb(signals, { now: NOW });
    h.db = fake;
    const z = lookupZip(zip)!;
    const sc = deriveScope(z);
    const r = await loadCheck(sc.cellLat, sc.cellLon, sc.state, trade);
    return { r, fake, z, sc };
  } finally {
    vi.useRealTimers();
  }
}

describe('N1: a dense feed 26 to 60 miles away must not empty the page (the review\'s three ZIPs)', () => {
  const cases: [string, string, number][] = [
    ['07960', 'Morristown, NJ', 26.4],
    ['06901', 'Stamford, CT', 32.5],
    ['10950', 'Monroe, NY', 42.6],
  ];
  for (const [zip, name, miles] of cases) {
    it(`${zip} ${name} (about ${miles} miles from Manhattan) returns rows and keeps the same-state freeze warning`, async () => {
      nid = 1;
      const z = lookupZip(zip)!;
      expect(haversineMi(z.lat, z.lon, 40.7, -73.99)).toBeGreaterThan(miles - 1.5);
      const state = z.state;
      const rows = [
        ...nycFlood(),
        sig({ state, title: 'Freeze Warning', kind: 'alert', severity: 2, lat: null, lon: null, occurred_at: hoursAgo(48) }),
        sig({ state, title: 'local row', lat: z.lat + 0.01, lon: z.lon, occurred_at: hoursAgo(0.001) }),
      ];
      const { r, fake, sc } = await checkZip(zip, 'hvac', rows);
      expect(r.ok).toBe(true);
      // The review's failure was "0 rows shown". Rows come back, the state-level warning is not crowded out, and the newest local row is there.
      expect(r.items.length).toBeGreaterThan(50);
      const titles = r.items.map((i) => i.title);
      expect(titles).toContain('Freeze Warning');
      expect(titles).toContain('local row');
      // Every record with coordinates is inside the stated search radius from the cell centre (the SQL distance test ran before the limit).
      for (const it of r.items) if (it.lat != null && it.lon != null) expect(haversineMi(sc.cellLat, sc.cellLon, it.lat, it.lon)).toBeLessThanOrEqual(CHECK_SEARCH_RADIUS_MI);
      const rpc = fake.log.filter((l) => l.kind === 'rpc');
      expect(rpc).toHaveLength(4); // newest in radius, close to home, severity 2+, upcoming
      expect(rpc[0].returned).toBeLessThanOrEqual(100);
    });
  }
  it('P2-1: 400 newer cluster rows 30 to 38 miles out do not hide the local rows or an 18 mile severity 3 warning at Morristown', async () => {
    nid = 1;
    const z = lookupZip('07960')!;
    const sc = deriveScope(z);
    const cluster = Array.from({ length: 400 }, (_, i) => sig({ title: `cluster${i}`, state: 'NY', lat: sc.cellLat, lon: sc.cellLon + (30 + (i % 70) / 10) / (69.09 * Math.cos((sc.cellLat * Math.PI) / 180)), occurred_at: hoursAgo(0.01 + i / 1000) }));
    const local = Array.from({ length: 5 }, (_, i) => sig({ title: `local${i}`, state: 'NJ', lat: z.lat + (i + 1) * 0.01, lon: z.lon, occurred_at: hoursAgo(48 + i) }));
    const warning = sig({ title: 'warning3', kind: 'report', severity: 3, state: 'NJ', lat: z.lat + 18 / 69.09, lon: z.lon, occurred_at: hoursAgo(24) });
    const { r } = await checkZip('07960', 'hvac', [...cluster, ...local, warning]);
    const titles = r.items.map((i) => i.title);
    for (let i = 0; i < 5; i++) expect(titles).toContain(`local${i}`);
    expect(titles).toContain('warning3');
    // and the page shows them: severe first, then the closest, then the newest
    const shown = groupItems(r.items, NOW.getTime(), { lat: z.lat, lon: z.lon }).flatMap((g) => g.items.map((i) => i.title));
    expect(shown).toContain('warning3');
    expect(shown.filter((t) => t.startsWith('local'))).toHaveLength(5);
    expect(shown[0]).toBe('warning3');
  });
  it('the limit is applied after the distance: 150 newer rows 45 miles out (inside the old bounding box) do not push out an older row at the ZIP', async () => {
    nid = 1;
    const z = lookupZip('06901')!;
    const sc = deriveScope(z);
    const outside = Array.from({ length: 150 }, (_, i) => sig({ title: 'outside', state: 'NY', lat: sc.cellLat - 45 / 69.09, lon: sc.cellLon + (i % 10) * 0.001, occurred_at: hoursAgo(0.5) }));
    const mine = sig({ title: 'mine', state: 'CT', lat: z.lat, lon: z.lon, occurred_at: hoursAgo(200) });
    const { r, fake } = await checkZip('06901', 'hvac', [...outside, mine]);
    expect(r.items.map((i) => i.title)).toEqual(['mine']);
    expect(fake.log.filter((l) => l.kind === 'rpc')[0].matched).toBe(1);
  });
  it('control: Princeton NJ (outside the dense feed) still gets both rows', async () => {
    nid = 1;
    const z = lookupZip('08540')!;
    const rows = [
      ...nycFlood(),
      sig({ state: 'NJ', title: 'Freeze Warning', kind: 'alert', severity: 2, occurred_at: hoursAgo(48) }),
      sig({ state: 'NJ', title: 'local row', lat: z.lat + 0.01, lon: z.lon, occurred_at: hoursAgo(72) }),
    ];
    const { r } = await checkZip('08540', 'hvac', rows);
    expect(r.items.map((i) => i.title).sort()).toEqual(['Freeze Warning', 'local row']);
  });
  it('a ZIP that sits inside the flood itself gets exactly the newest 100 inside the radius, never an empty page', async () => {
    nid = 1;
    const { r } = await checkZip('10001', 'hvac', nycFlood());
    expect(r.items).toHaveLength(100);
  });
  it('a record 45 to 50 miles from the cell centre is not read (the stated "about 40 miles" is not stretched)', async () => {
    nid = 1;
    const z = lookupZip('07960')!;
    const sc = deriveScope(z);
    const far = sig({ title: 'far', state: 'NJ', lat: sc.cellLat + 45 / 69.09, lon: sc.cellLon });
    const near = sig({ title: 'near', state: 'NJ', lat: sc.cellLat + 30 / 69.09, lon: sc.cellLon });
    const { r } = await checkZip('07960', 'hvac', [far, near]);
    expect(r.items.map((i) => i.title)).toEqual(['near']);
  });
  it('every record within 25 miles of the ZIP is read, whichever corner of its cell the ZIP sits in (hand-placed records at 24.9 miles in 8 directions)', async () => {
    nid = 1;
    for (const zip of ['07960', '59001', '99723', '33101', '10301']) {
      const z = lookupZip(zip)!;
      const rows: Row[] = [];
      for (let b = 0; b < 360; b += 45) {
        const br = (b * Math.PI) / 180;
        const d = 24.9 / 69.09;
        rows.push(sig({ title: `b${b}`, state: z.state, lat: z.lat + d * Math.cos(br), lon: z.lon + (d * Math.sin(br)) / Math.cos((z.lat * Math.PI) / 180) }));
      }
      const { r } = await checkZip(zip, 'hvac', rows);
      expect(r.items, zip).toHaveLength(8);
    }
  });
  it('upcoming events are their own bounded read, soonest first, and cannot crowd out recent rows', async () => {
    nid = 1;
    const z = lookupZip('30303')!;
    const events = Array.from({ length: 30 }, (_, i) => sig({ title: `ev${i}`, kind: 'event', state: 'GA', lat: z.lat, lon: z.lon, occurred_at: daysAhead(1 + i * 0.5) }));
    const recent = Array.from({ length: 5 }, (_, i) => sig({ title: `rec${i}`, state: 'GA', lat: z.lat, lon: z.lon, occurred_at: hoursAgo(i + 1) }));
    const { r } = await checkZip('30303', 'hvac', [...events, ...recent]);
    const ev = r.items.filter((i) => i.title.startsWith('ev'));
    expect(ev.length).toBeLessThanOrEqual(12);
    expect(ev[0].title).toBe('ev0'); // soonest first
    expect(r.items.filter((i) => i.title.startsWith('rec'))).toHaveLength(5);
  });
});

describe('loadCheck query shape', () => {
  beforeEach(() => {
    nid = 1;
  });
  it('calls holler_signals_near centred on the cell with the stated radius, the trade, a 30 day window; state rows are a separate indexed read', async () => {
    const { fake, sc } = await checkZip('10301', 'roofing', []);
    const rpc = fake.log.filter((l) => l.kind === 'rpc');
    expect(rpc).toHaveLength(4);
    expect(rpc[0].args).toMatchObject({ p_lat: sc.cellLat, p_lon: sc.cellLon, p_radius_mi: CHECK_SEARCH_RADIUS_MI, p_categories: ['roofing'], p_limit: 100, p_soonest_first: false, p_min_severity: 1 });
    expect(Date.parse(rpc[0].args!.p_until) - Date.parse(rpc[0].args!.p_since)).toBe(30 * 86_400_000);
    expect(rpc[1].args).toMatchObject({ p_radius_mi: CHECK_CORE_RADIUS_MI, p_limit: 30, p_min_severity: 1 });
    expect(rpc[2].args).toMatchObject({ p_radius_mi: CHECK_SEARCH_RADIUS_MI, p_limit: 20, p_min_severity: 2 });
    expect(rpc[3].args).toMatchObject({ p_limit: 12, p_soonest_first: true });
    const sel = fake.log.filter((l) => l.kind === 'select');
    expect(sel).toHaveLength(1);
    expect(sel[0].name).toContain('is:lat');
    expect(sel[0].name).toContain('eq:state=NY');
    expect(sel[0].name).toContain('gte:severity');
    expect(sel[0].name).not.toContain('place_slug');
  });
  it('refuses a malformed state or trade without querying', async () => {
    const fake = fakeSignalsDb([]);
    h.db = fake;
    expect((await loadCheck(40.75, -74, "NY'),or(id.gt.0", 'roofing')).ok).toBe(false);
    expect((await loadCheck(40.75, -74, 'NY', "roofing'),or(id.gt.0")).ok).toBe(false);
    expect((await loadCheck(Number.NaN, -74, 'NY', 'roofing')).ok).toBe(false);
    expect(fake.log).toHaveLength(0);
  });
  it('returns the records with their coordinates and logs a failed read', async () => {
    const ok = await checkZip('59001', 'roofing', [sig({ categories: ['roofing'], source: 'spc', kind: 'report', title: 'Hail', state: 'MT', lat: 45.6, lon: -109.4, severity: 2 })]);
    expect(ok.r.ok).toBe(true);
    expect(ok.r.items[0]).toMatchObject({ lat: 45.6, lon: -109.4 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.db = fakeSignalsDb([], { rpcError: 'boom' });
    const bad = await loadCheck(45.5, -109.5, 'MT', 'roofing');
    expect(bad.ok).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('a failed state-level read only drops those rows', async () => {
    const z = lookupZip('59001')!;
    const fake = fakeSignalsDb([sig({ categories: ['roofing'], state: 'MT', lat: z.lat, lon: z.lon })], { now: NOW });
    fake.from = () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'is', 'eq', 'gte', 'lte', 'overlaps', 'or', 'order', 'limit', 'abortSignal']) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) => res({ data: null, error: { message: 'down', code: 'XX' } });
      return q as ReturnType<typeof fake.from>;
    };
    h.db = fake;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await loadCheck(deriveScope(z).cellLat, deriveScope(z).cellLon, 'MT', 'roofing');
    spy.mockRestore();
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(1);
  });
});
