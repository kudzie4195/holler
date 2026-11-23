/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 13 review P0-1: the signup backfill reads its radius rows through the holler_signals_near RPC. The RPC read must carry
// source, kind and title, or the opportunity label cannot tell city work (public graffiti, tree trims, sewer work) from an alert and
// the 25 first-feed slots fill with rows the feed then hides.
import { HEAT_MARK } from '@/lib/signals/carry';
import { describe, expect, it } from 'vitest';
import { backfillMatches, RPC_COLUMNS, BACKFILL_CAP } from '@/lib/signals/backfill';
import type { MatchProfile } from '@/lib/signals/match';
import { fakeTables } from '../match/fake-table';

const NOW = new Date('2026-11-21T12:00:00Z');
const H = 3_600_000;
const CHI = { lat: 41.88, lon: -87.63 };

type FullRow = Record<string, unknown> & { id: number };
const row = (id: number, over: Record<string, unknown>): FullRow => ({
  id, source: 'socrata-chicago-311', external_id: `e${id}`, kind: 'civic', title: '', summary: null, url: null, city: 'Chicago', state: 'IL',
  county: null, zip: null, categories: ['painting'], lat: CHI.lat, lon: CHI.lon, severity: 1, occurred_at: new Date(NOW.getTime() - (1 + id / 1000) * H).toISOString(),
  expires_at: null, data: { subtype: '311' }, ...over,
});

/** An RPC that behaves like PostgREST: the result holds ONLY the columns named in .select(...). */
function db(full: FullRow[]) {
  const d = fakeTables({ holler_signals: [], holler_matches: [] }) as any;
  d.rpc = () => ({
    select: (cols: string) => {
      const keys = cols.split(',').map((k) => k.trim());
      return Promise.resolve({ data: full.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]]))), error: null });
    },
  });
  return d;
}

const painter: MatchProfile = { user_id: 'u-painter', categories: ['painting'], lat: CHI.lat, lon: CHI.lon, state: null, radius_mi: 25 };

describe('backfill RPC read (P0-1)', () => {
  it('asks for source, kind and title', () => {
    const cols = RPC_COLUMNS.split(',');
    for (const c of ['id', 'source', 'kind', 'title', 'categories', 'lat', 'lon', 'severity', 'occurred_at', 'expires_at', 'data']) expect(cols).toContain(c);
  });

  it('city work never fills the cap: 60 newer public-graffiti rows, 1 private-graffiti request, 1 permit', async () => {
    const graffiti = Array.from({ length: 60 }, (_, i) => row(1000 + i, { title: '311 request in Chicago: Graffiti Removal Request' }));
    const priv = row(5, { source: 'socrata-sf-311', title: '311 request in San Francisco: Graffiti Private / not_offensive', occurred_at: new Date(NOW.getTime() - 60 * H).toISOString() });
    const permit = row(6, { source: 'socrata-chicago-permits', kind: 'permit', title: 'Painting permit in Chicago', data: { subtype: 'permit' }, occurred_at: new Date(NOW.getTime() - 61 * H).toISOString() });
    const d = db([...graffiti, priv, permit]);
    const r = await backfillMatches(d, painter, NOW);
    const stored = d.tables.holler_matches.map((m: { signal_id: number }) => m.signal_id).sort((a: number, b: number) => a - b);
    expect(r.error).toBeUndefined();
    expect(stored).toEqual([5, 6]); // the private-graffiti request (act_now) and the own-trade permit (market_insight, feed only)
    expect(stored.some((id: number) => id >= 1000)).toBe(false); // no city graffiti took a slot
    expect(stored.length).toBeLessThan(BACKFILL_CAP);
  });

  it('a painter with 80 city-graffiti rows and nothing else gets an honest empty backfill, not 25 hidden rows', async () => {
    const d = db(Array.from({ length: 80 }, (_, i) => row(2000 + i, { title: '311 request in Chicago: Graffiti Removal Request' })));
    const r = await backfillMatches(d, painter, NOW);
    expect(r.matched).toBe(0);
    expect(d.tables.holler_matches).toHaveLength(0);
  });

  it('a heat complaint keeps its act_now label through the RPC read (it is still stored and not dropped to the default)', async () => {
    const hvac: MatchProfile = { ...painter, user_id: 'u-hvac', categories: ['hvac'] };
    // round 19 RULES (owner call 1): the building's third complaint in 48 hours, as the scan marks it
    const heat = row(9, { source: 'socrata-nyc-311', city: 'New York', title: '311 request in New York City: HEAT/HOT WATER / ENTIRE BUILDING', summary: `HEAT/HOT WATER | ENTIRE BUILDING | BRONX | ${HEAT_MARK}`, categories: ['hvac'] });
    const tree = row(10, { title: '311 request in Chicago: Tree Trim Request', categories: ['hvac'] });
    const d = db([heat, tree]);
    await backfillMatches(d, hvac, NOW);
    expect(d.tables.holler_matches.map((m: { signal_id: number }) => m.signal_id)).toEqual([9]); // the heat complaint, not the city tree trim
  });
});
