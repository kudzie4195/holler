/**
 * Review P1-1: backfill read the newest 1000 rows for the whole country, so a user outside NYC got nothing.
 * The fake below behaves like PostgREST: it applies every filter the code sends (overlaps, gte, lte, and the AND of two or() groups),
 * orders by occurred_at desc and returns at most 1000 rows, so the test fails if the location filter is missing or wrong.
 */
import { describe, expect, it } from 'vitest';
import { BACKFILL_CAP, BACKFILL_ROW_LIMIT, backfillMatches, scopeFilter } from '@/lib/signals/backfill';
import { MAX_BUSINESS_PER_USER, type MatchProfile } from '@/lib/signals/match';
import { haversineMi } from '@/lib/geo';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
const NOW = new Date('2026-11-17T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
function evalTerm(term: string, r: Row): boolean {
  if (term.startsWith('and(')) return splitTop(term.slice(4, -1)).every((t) => evalTerm(t, r));
  if (term.startsWith('or(')) return splitTop(term.slice(3, -1)).some((t) => evalTerm(t, r));
  const m = /^([a-z_]+)\.([a-z]+)\.(.*)$/.exec(term);
  if (!m) throw new Error(`fake PostgREST cannot parse "${term}"`);
  const [, col, op, val] = m;
  const v = r[col];
  switch (op) {
    case 'is': return val === 'null' ? v === null || v === undefined : v !== null;
    case 'eq': return v === val;
    case 'gt': return v != null && (typeof v === 'number' ? v > Number(val) : String(v) > val);
    case 'gte': return v != null && (typeof v === 'number' ? v >= Number(val) : String(v) >= val);
    case 'lte': return v != null && (typeof v === 'number' ? v <= Number(val) : String(v) <= val);
    default: throw new Error(`fake PostgREST: unsupported operator ${op}`);
  }
}

function fakePostgrest(signals: Row[]) {
  const upserts: Row[][] = [];
  const queries: { orGroups: string[]; limit: number | null; returned: number }[] = [];
  const db = {
    from(table: string) {
      if (table === 'holler_matches') {
        return { upsert: (rows: Row[]) => (upserts.push(rows), Promise.resolve({ error: null })) };
      }
      const filters: ((r: Row) => boolean)[] = [];
      const orGroups: string[] = [];
      let limit: number | null = null;
      const q: any = {
        select: () => q,
        overlaps: (c: string, vs: string[]) => (filters.push((r) => (r[c] as string[]).some((x) => vs.includes(x))), q),
        gte: (c: string, v: string) => (filters.push((r) => r[c] >= v), q),
        lte: (c: string, v: string) => (filters.push((r) => r[c] <= v), q),
        or: (g: string) => (orGroups.push(g), filters.push((r) => splitTop(g).some((t) => evalTerm(t, r))), q),
        order: () => q,
        limit: (n: number) => {
          limit = n;
          const rows = signals
            .filter((r) => filters.every((f) => f(r)))
            .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
            .slice(0, Math.min(n, 1000)); // PostgREST max_rows
          queries.push({ orGroups, limit, returned: rows.length });
          return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
        },
      };
      return q;
    },
  };
  return { db: db as never, upserts, queries };
}

const NYC = { lat: 40.7128, lon: -74.006 };
let nextId = 1;
const sig = (over: Row): Row => ({ id: nextId++, categories: ['hvac'], lat: null, lon: null, state: null, severity: 2, occurred_at: hoursAgo(5), expires_at: null, subtype: null, ...over });

describe('backfill location filter (review P1-1 reproduction)', () => {
  const atlantaHvac: MatchProfile = { user_id: 'u-atl', categories: ['hvac'], lat: 33.749, lon: -84.388, state: 'GA', radius_mi: 25 };

  it('1200 newer NYC heat rows must not hide 10 Atlanta rows: all 10 are found', async () => {
    nextId = 1;
    const nyc = Array.from({ length: 1200 }, (_, i) => sig({ ...NYC, state: 'NY', occurred_at: hoursAgo(1 + (i % 9) / 10), categories: ['hvac', 'plumbing'] }));
    const atl = Array.from({ length: 10 }, (_, i) => sig({ lat: 33.75 + i * 0.005, lon: -84.39, state: 'GA', occurred_at: hoursAgo(48 + i) }));
    const f = fakePostgrest([...nyc, ...atl]);
    const r = await backfillMatches(f.db, atlantaHvac, NOW);
    expect(r.error).toBeUndefined();
    expect(r.matched).toBe(10);
    expect(f.upserts[0].map((x) => x.signal_id).sort((a, b) => a - b)).toEqual(atl.map((x) => x.id));
    expect(f.queries[0].limit).toBe(BACKFILL_ROW_LIMIT);
    expect(f.queries[0].orGroups).toHaveLength(2); // not-expired AND scope
  });

  it('without the filter this data gives 0 (proves the fake reproduces the review)', async () => {
    nextId = 1;
    const nyc = Array.from({ length: 1200 }, () => sig({ ...NYC, state: 'NY', occurred_at: hoursAgo(1) }));
    const atl = Array.from({ length: 10 }, () => sig({ lat: 33.75, lon: -84.39, state: 'GA', occurred_at: hoursAgo(48) }));
    const f = fakePostgrest([...nyc, ...atl]);
    // what the old query did: same filters minus the scope group
    const old = (f.db as any).from('holler_signals').select().overlaps('categories', ['hvac']).limit(1000);
    const rows = (await old).data as Row[];
    expect(rows).toHaveLength(1000);
    expect(rows.some((x) => x.state === 'GA')).toBe(false);
  });

  it('also finds state-level rows (no coordinates, severity 2+) for the profile state, not other states or mild ones', async () => {
    nextId = 1;
    const rows = [
      sig({ state: 'GA', severity: 2 }),
      sig({ state: 'GA', severity: 1 }),
      sig({ state: 'AL', severity: 3 }),
      ...Array.from({ length: 1100 }, () => sig({ ...NYC, state: 'NY', occurred_at: hoursAgo(1) })),
    ];
    const f = fakePostgrest(rows);
    await backfillMatches(f.db, atlantaHvac, NOW);
    expect(f.upserts[0].map((x) => x.signal_id)).toEqual([rows[0].id]);
  });

  it('a profile with no coordinates still gets its state-level rows', () => {
    expect(scopeFilter({ lat: null, lon: null, state: 'GA', radius_mi: 25 })).toBe('and(lat.is.null,state.eq.GA,severity.gte.2)');
    expect(scopeFilter({ lat: null, lon: null, state: null, radius_mi: 25 })).toBeNull();
  });

  it('keeps the whole circle inside the box at latitudes 25, 45 and 65 and radii 5, 25 and 100 (walk around the circle)', () => {
    for (const lat of [25, 45, 65]) {
      for (const radius of [5, 25, 100]) {
        const lon = -100;
        const f = scopeFilter({ lat, lon, state: null, radius_mi: radius })!;
        const num = (re: RegExp) => Number(re.exec(f)![1]);
        const latLo = num(/lat\.gte\.(-?[0-9.]+)/), latHi = num(/lat\.lte\.(-?[0-9.]+)/);
        const lonLo = num(/lon\.gte\.(-?[0-9.]+)/), lonHi = num(/lon\.lte\.(-?[0-9.]+)/);
        // a point on the radius circle, found by bisection along each bearing using the same haversine the matcher uses
        for (let b = 0; b < 360; b += 3) {
          const br = (b * Math.PI) / 180;
          let lo = 0, hi = 2 * radius / 69;
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            const p = { lat: lat + mid * Math.cos(br), lon: lon + (mid * Math.sin(br)) / Math.cos((lat * Math.PI) / 180) };
            if (haversineMi(lat, lon, p.lat, p.lon) <= radius) lo = mid; else hi = mid;
          }
          const p = { lat: lat + lo * Math.cos(br), lon: lon + (lo * Math.sin(br)) / Math.cos((lat * Math.PI) / 180) };
          expect(p.lat >= latLo && p.lat <= latHi && p.lon >= lonLo && p.lon <= lonHi, `lat ${lat} r ${radius} bearing ${b}`).toBe(true);
        }
      }
    }
  });

  it('caps new-business rows at 5 per backfill, nearest first, without touching the other rows', async () => {
    nextId = 1;
    const cleaning: MatchProfile = { ...atlantaHvac, categories: ['cleaning'] };
    const biz = Array.from({ length: 12 }, (_, i) => sig({ categories: ['cleaning'], subtype: 'business', lat: 33.749 + 0.01 * (12 - i), lon: -84.388, state: 'GA', severity: 1, occurred_at: hoursAgo(2 + i) }));
    const other = Array.from({ length: 3 }, (_, i) => sig({ categories: ['cleaning'], subtype: '311', lat: 33.8 + i * 0.01, lon: -84.4, state: 'GA', severity: 1, occurred_at: hoursAgo(30 + i) }));
    const f = fakePostgrest([...biz, ...other]);
    const r = await backfillMatches(f.db, cleaning, NOW);
    const ids = f.upserts[0].map((x) => x.signal_id);
    expect(r.matched).toBe(MAX_BUSINESS_PER_USER + 3);
    const bizIds = ids.filter((id) => biz.some((b) => b.id === id));
    expect(bizIds).toHaveLength(5);
    // nearest 5: the last five generated (smallest offset)
    expect(new Set(bizIds)).toEqual(new Set(biz.slice(7).map((b) => b.id)));
    expect(ids.filter((id) => other.some((o) => o.id === id))).toHaveLength(3);
  });

  it('still caps everything at 25', async () => {
    nextId = 1;
    const rows = Array.from({ length: 80 }, (_, i) => sig({ lat: 33.75, lon: -84.39, state: 'GA', occurred_at: hoursAgo(i + 1) }));
    const f = fakePostgrest(rows);
    const r = await backfillMatches(f.db, atlantaHvac, NOW);
    expect(r.matched).toBe(BACKFILL_CAP);
  });
});
