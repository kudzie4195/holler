/**
 * Backfill location scope. Review P1-1 (backfill read the newest 1000 national rows) and P2-1 (corner starvation: a Trenton NJ profile at
 * 50 miles has a bounding box that reaches Manhattan, 54.8 miles away and outside the circle, so 1500 NYC rows used up the 1000-row limit
 * and 10 local rows were never read).
 * The fix reads through holler_signals_near, which applies the great-circle distance in SQL before the limit, plus a separate
 * state-level query. The fake (tests/fixtures/fake-signals-db.ts) honours that function's semantics and PostgREST's 1000-row cap; the
 * function itself is tested against a real Postgres in /home/claude/gates/pg/migtest.mjs.
 */
import { describe, expect, it } from 'vitest';
import { BACKFILL_CAP, BACKFILL_MAX_PAGES, BACKFILL_PAGE_LIMIT, BACKFILL_STATE_LIMIT, backfillMatches } from '@/lib/signals/backfill';
import { MAX_BUSINESS_PER_USER, type MatchProfile } from '@/lib/signals/match';
import { haversineMi } from '@/lib/geo';
import { fakeSignalsDb, type Row } from '../../fixtures/fake-signals-db';

const NOW = new Date('2026-11-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const NYC = { lat: 40.7128, lon: -74.006 };
let nextId = 1;
const sig = (over: Row): Row => ({ id: nextId++, categories: ['hvac'], lat: null, lon: null, state: null, severity: 2, occurred_at: hoursAgo(5), expires_at: null, data: {}, ...over });
const run = async (signals: Row[], profile: MatchProfile) => {
  const fake = fakeSignalsDb(signals, { now: NOW });
  const r = await backfillMatches(fake as never, profile, NOW);
  return { r, fake, matched: (fake.upserts[0] ?? []).map((x) => x.signal_id as number) };
};

describe('backfill location filter', () => {
  const atlantaHvac: MatchProfile = { user_id: 'u-atl', categories: ['hvac'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 };

  it('1200 newer NYC heat rows must not hide 10 Atlanta rows: all 10 are found (P1-1)', async () => {
    nextId = 1;
    const nyc = Array.from({ length: 1200 }, (_, i) => sig({ ...NYC, state: 'NY', occurred_at: hoursAgo(1 + (i % 9) / 10), categories: ['hvac', 'plumbing'] }));
    const atl = Array.from({ length: 10 }, (_, i) => sig({ lat: 33.75 + i * 0.005, lon: -84.39, state: 'GA', occurred_at: hoursAgo(48 + i) }));
    const { r, matched } = await run([...nyc, ...atl], atlantaHvac);
    expect(r.error).toBeUndefined();
    expect(r.matched).toBe(10);
    expect(matched.sort((a, b) => a - b)).toEqual(atl.map((x) => x.id));
  });

  it("P2-1: Trenton NJ at 50 miles, 1500 NYC rows in the old bounding box (Manhattan is 54.8 miles away) and 10 local rows: all 10 are found", async () => {
    nextId = 1;
    const trenton = { lat: 40.2171, lon: -74.7429 };
    expect(haversineMi(trenton.lat, trenton.lon, 40.75, -73.97)).toBeGreaterThan(50); // outside the circle ...
    // ... but inside the old latitude/longitude box of a 50 mile radius (the review's bug)
    const dLat = (50 / 69) * 1.02;
    const dLon = (50 / (69 * Math.cos(((trenton.lat + dLat) * Math.PI) / 180))) * 1.02;
    expect(40.75).toBeLessThanOrEqual(trenton.lat + dLat);
    expect(-73.97).toBeLessThanOrEqual(trenton.lon + dLon);
    const nyc = Array.from({ length: 1500 }, (_, i) => sig({ lat: 40.75 + (i % 30) * 0.003, lon: -73.97 + (i % 7) * 0.003, state: 'NY', occurred_at: hoursAgo(i / 150) }));
    const local = Array.from({ length: 10 }, (_, i) => sig({ lat: 40.22 + i * 0.01, lon: -74.76, state: 'NJ', occurred_at: hoursAgo(30 + i) }));
    const { r, matched } = await run([...nyc, ...local], { user_id: 'u-tren', categories: ['hvac'], ...trenton, state: 'NJ', radius_mi: 50 });
    expect(r.error).toBeUndefined();
    expect(r.matched).toBe(10);
    expect(r.considered).toBe(10);
    expect(matched.sort((a, b) => a - b)).toEqual(local.map((x) => x.id));
  });

  it('a record exactly outside the circle is never read, whatever the box would say', async () => {
    nextId = 1;
    const base = { lat: 40.2171, lon: -74.7429 };
    const inside = sig({ lat: base.lat + 49 / 69.09, lon: base.lon, state: 'NJ' });
    const outside = sig({ lat: base.lat + 51 / 69.09, lon: base.lon, state: 'NJ' });
    const { matched } = await run([inside, outside], { user_id: 'u', categories: ['hvac'], ...base, state: 'NJ', radius_mi: 50 });
    expect(matched).toEqual([inside.id]);
  });

  it('the radius sent to SQL is the profile radius, and the centre is the profile point', async () => {
    nextId = 1;
    const { fake } = await run([], { user_id: 'u', categories: ['hvac'], lat: 40.2171, lon: -74.7429, state: 'NJ', radius_mi: 50 });
    const rpc = fake.log.filter((l) => l.kind === 'rpc');
    expect(rpc).toHaveLength(2); // the main read and the separate severity 2+ read
    expect(rpc[0].args).toMatchObject({ p_lat: 40.2171, p_lon: -74.7429, p_radius_mi: 50, p_categories: ['hvac'], p_soonest_first: false, p_min_severity: 1 });
    expect(rpc[1].args).toMatchObject({ p_lat: 40.2171, p_lon: -74.7429, p_radius_mi: 50, p_soonest_first: false, p_min_severity: 2 });
  });

  it('pages back in time while a page is full: a dense metro still surfaces an older severe record, up to the page cap', async () => {
    nextId = 1;
    const many = Array.from({ length: BACKFILL_PAGE_LIMIT + 120 }, (_, i) => sig({ ...NYC, state: 'NY', severity: 1, occurred_at: hoursAgo(1 + i / 100) }));
    const severeOld = sig({ ...NYC, state: 'NY', severity: 3, occurred_at: hoursAgo(24 * 5) });
    const { r, fake, matched } = await run([...many, severeOld], { user_id: 'u', categories: ['hvac'], ...NYC, state: 'NY', radius_mi: 25 });
    const main = fake.log.filter((l) => l.kind === 'rpc' && l.args?.p_min_severity === 1);
    expect(main.length).toBeLessThanOrEqual(BACKFILL_MAX_PAGES);
    expect(main.length).toBe(2);
    expect(r.considered).toBe(BACKFILL_PAGE_LIMIT + 121); // the severe read returns the same old record again; it is counted once
    expect(matched[0]).toBe(severeOld.id); // most severe first, even though it is the oldest
  });

  it('also finds state-level rows (no coordinates, severity 2+) for the profile state, not other states or mild ones, with their own query', async () => {
    nextId = 1;
    const rows = [
      sig({ state: 'GA', severity: 2 }),
      sig({ state: 'GA', severity: 1 }),
      sig({ state: 'AL', severity: 3 }),
      ...Array.from({ length: 1100 }, () => sig({ ...NYC, state: 'NY', occurred_at: hoursAgo(1) })),
    ];
    const { matched, fake } = await run(rows, atlantaHvac);
    expect(matched).toEqual([rows[0].id]);
    const sel = fake.log.filter((l) => l.kind === 'select');
    expect(sel).toHaveLength(1);
    expect(sel[0].name).toContain('eq:state=GA');
    expect(BACKFILL_STATE_LIMIT).toBeGreaterThan(0);
  });

  it('a state-level row cannot be crowded out by the coordinate read (separate queries): 1500 local rows and one freeze warning', async () => {
    nextId = 1;
    const local = Array.from({ length: 1500 }, (_, i) => sig({ lat: 33.75, lon: -84.39, state: 'GA', severity: 1, occurred_at: hoursAgo(1 + i / 200) }));
    const freeze = sig({ state: 'GA', severity: 3, occurred_at: hoursAgo(200) });
    const { matched } = await run([...local, freeze], atlantaHvac);
    expect(matched[0]).toBe(freeze.id);
    expect(matched).toHaveLength(BACKFILL_CAP);
  });

  it('a profile with no coordinates still gets its state-level rows and runs no distance query; one with neither reads nothing', async () => {
    nextId = 1;
    const a = await run([sig({ state: 'GA' }), sig({ lat: 33.75, lon: -84.39, state: 'GA' })], { ...atlantaHvac, lat: null, lon: null });
    expect(a.fake.log.some((l) => l.kind === 'rpc')).toBe(false);
    expect(a.matched).toHaveLength(1);
    const b = await run([sig({ state: 'GA' })], { ...atlantaHvac, lat: null, lon: null, state: null });
    expect(b.fake.log).toHaveLength(0);
    expect(b.r).toEqual({ matched: 0, considered: 0 });
  });

  it('caps new-business rows at 5 per backfill, nearest first, without touching the other rows', async () => {
    nextId = 1;
    const cleaning: MatchProfile = { ...atlantaHvac, categories: ['cleaning'] };
    const biz = Array.from({ length: 12 }, (_, i) => sig({ categories: ['cleaning'], data: { subtype: 'business' }, lat: 33.749 + 0.01 * (12 - i), lon: -84.388, state: 'GA', severity: 1, occurred_at: hoursAgo(2 + i) }));
    const other = Array.from({ length: 3 }, (_, i) => sig({ categories: ['cleaning'], data: { subtype: '311' }, lat: 33.8 + i * 0.01, lon: -84.4, state: 'GA', severity: 1, occurred_at: hoursAgo(30 + i) }));
    const { r, matched } = await run([...biz, ...other], cleaning);
    expect(r.matched).toBe(MAX_BUSINESS_PER_USER + 3);
    const bizIds = matched.filter((id) => biz.some((b) => b.id === id));
    expect(bizIds).toHaveLength(5);
    expect(new Set(bizIds)).toEqual(new Set(biz.slice(7).map((b) => b.id)));
    expect(matched.filter((id) => other.some((o) => o.id === id))).toHaveLength(3);
  });

  it('still caps everything at 25', async () => {
    nextId = 1;
    const rows = Array.from({ length: 80 }, (_, i) => sig({ lat: 33.75, lon: -84.39, state: 'GA', occurred_at: hoursAgo(i + 1) }));
    const { r } = await run(rows, atlantaHvac);
    expect(r.matched).toBe(BACKFILL_CAP);
  });
});

describe('P2-2: dense feeds and tied timestamps', () => {
  const nyc: MatchProfile = { user_id: 'u', categories: ['hvac'], ...NYC, state: 'NY', radius_mi: 25 };

  it('a severity 3 report older than 1600 newer routine rows is still matched first (separate severity 2+ read)', async () => {
    nextId = 1;
    const dense = Array.from({ length: 1600 }, (_, i) => sig({ ...NYC, state: 'NY', severity: 1, occurred_at: hoursAgo(1 + i / 100) }));
    const hail = sig({ ...NYC, state: 'NY', severity: 3, occurred_at: hoursAgo(24 * 3) });
    const { matched, fake } = await run([...dense, hail], nyc);
    expect(matched[0]).toBe(hail.id);
    expect(fake.log.some((l) => l.kind === 'rpc' && l.args?.p_min_severity === 2 && l.returned === 1)).toBe(true);
  });

  it('1600 rows that share one occurred_at are paged in full with the keyset cursor, no repeats, and the older rows after them are reached', async () => {
    nextId = 1;
    const tie = hoursAgo(6);
    const tied = Array.from({ length: 1600 }, () => sig({ ...NYC, state: 'NY', severity: 1, occurred_at: tie }));
    const older = Array.from({ length: 10 }, (_, i) => sig({ ...NYC, state: 'NY', severity: 1, occurred_at: hoursAgo(30 + i) }));
    // a wide cap lets the test see every page; the production cap is BACKFILL_MAX_PAGES
    const fake = fakeSignalsDb([...tied, ...older], { now: NOW });
    const seen = new Set<number>();
    let until = new Date(NOW.getTime() + 7 * 86_400_000).toISOString();
    let before: number | null = null;
    for (let page = 0; page < 6; page++) {
      const res = await fake.rpc('holler_signals_near', { p_lat: NYC.lat, p_lon: NYC.lon, p_radius_mi: 25, p_categories: ['hvac'], p_since: hoursAgo(24 * 14), p_until: until, p_limit: BACKFILL_PAGE_LIMIT, p_soonest_first: false, p_min_severity: 1, p_before_id: before });
      const rows = res.data as Row[];
      for (const r of rows) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
      if (rows.length < BACKFILL_PAGE_LIMIT) break;
      until = rows[rows.length - 1].occurred_at;
      before = rows[rows.length - 1].id;
    }
    expect(seen.size).toBe(1610);
  });

  it('backfillMatches pages a tied feed with the cursor: the second page sends p_before_id and reads new rows', async () => {
    nextId = 1;
    const tie = hoursAgo(6);
    const tied = Array.from({ length: BACKFILL_PAGE_LIMIT + 50 }, () => sig({ ...NYC, state: 'NY', severity: 1, occurred_at: tie }));
    const { r, fake } = await run(tied, nyc);
    const main = fake.log.filter((l) => l.kind === 'rpc' && l.args?.p_min_severity === 1);
    expect(main).toHaveLength(2);
    expect(main[0].args?.p_before_id).toBeNull();
    expect(typeof main[1].args?.p_before_id).toBe('number');
    expect(r.considered).toBe(BACKFILL_PAGE_LIMIT + 50);
  });
});
