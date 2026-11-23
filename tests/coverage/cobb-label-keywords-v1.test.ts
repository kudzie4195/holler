/**
 * verify-v1 finding 9 (P2) and finding 10 (P2), commander decision 4.
 *  - the Cobb label no longer says the location is unknown (the card prints the street address);
 *  - a keyword-only Pro member gets Cobb rows in the backfill by the same radius + 15 miles rule as the scan, with no distance stored.
 */
import { describe, expect, it } from 'vitest';
import { APPROX_LOCATION_REASON, COBB_APPROX_NOTE, approxLocationNote } from '@/lib/signals/approx-location';
import { placeLine } from '@/lib/check/group';
import { COBB_CENTER } from '@/lib/signals/adapters/arcgis-datasets';
import { backfillMatches } from '@/lib/signals/backfill';
import { matchSignals, type MatchProfile } from '@/lib/signals/match';

const NOW = new Date('2026-11-19T12:00:00Z');

describe('decision 4: Cobb label', () => {
  it('says the feed has a street address but no map point, never that the location is unknown', () => {
    expect(COBB_APPROX_NOTE).toBe("In Cobb County. The county's feed has a street address but no map point, so no distance is shown.");
    expect(approxLocationNote({ city: 'Cobb County' })).toBe(COBB_APPROX_NOTE);
    expect(approxLocationNote({ city: null })).toBe(`In the county. ${APPROX_LOCATION_REASON}`);
    expect(COBB_APPROX_NOTE).not.toMatch(/does not publish|unknown|somewhere/i);
    expect(COBB_APPROX_NOTE).not.toMatch(/[–—]/);
  });
  it('the check page line uses the same words', () => {
    expect(placeLine({ source: 'arcgis-cobb-residential-permits', place: 'Cobb County, GA' } as never)).toBe(COBB_APPROX_NOTE);
  });
});

/** A database stub: records the query chain and answers per table. Enough for backfillMatches. */
function stubDb(answer: (table: string, chain: unknown[][]) => unknown[]) {
  const upserts: Record<string, unknown>[][] = [];
  const query = (table: string) => {
    const chain: unknown[][] = [];
    const q: Record<string, unknown> = {};
    const handler: ProxyHandler<Record<string, unknown>> = {
      get: (_t, k) => {
        if (k === 'then') return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: answer(table, chain), error: null }).then(res, rej);
        return (...args: unknown[]) => {
          chain.push([k, ...args]);
          if (k === 'upsert') upserts.push(args[0] as Record<string, unknown>[]);
          return p;
        };
      },
    };
    const p: Record<string, unknown> = new Proxy(q, handler);
    return p;
  };
  return { db: { from: query, rpc: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }, upserts };
}

describe('decision 4: keyword-only Cobb backfill uses radius + 15 miles', () => {
  // A member 12 miles from the county seat with a 10 mile radius and no trades, only the keyword "pool".
  const member: MatchProfile = {
    user_id: 'kw', categories: [], lat: COBB_CENTER.lat + 12 / 69, lon: COBB_CENTER.lon, state: 'GA', radius_mi: 10,
    plan: 'pro', subscription_status: 'active', extra_areas: [], keywords: ['pool'],
  } as MatchProfile;
  const cobbRow = {
    id: 77, source: 'arcgis-cobb-residential-permits', categories: ['pool-spa', 'general-contractor'], lat: COBB_CENTER.lat, lon: COBB_CENTER.lon,
    state: 'GA', severity: 1, occurred_at: '2026-11-17T00:00:00.000Z', expires_at: null, title: 'Pool permit in Cobb County', summary: 'Pool | 1 MAIN ST | Cobb County', subtype: 'permit',
  };

  it('the scan matches it (control)', () => {
    expect(matchSignals([cobbRow], [member], 25, NOW).map((r) => [r.signal_id, r.distance_mi])).toEqual([[77, null]]);
  });
  it('the backfill reads the approximate-location sources for keywords and stores the row with no distance', async () => {
    const { db, upserts } = stubDb((table, chain) => {
      if (table !== 'holler_signals') return [];
      const bySource = chain.some(([k, c]) => k === 'in' && c === 'source');
      const byKeyword = chain.some(([k, v]) => k === 'or' && String(v).includes('ilike'));
      return bySource && byKeyword ? [cobbRow] : [];
    });
    const r = await backfillMatches(db as never, member, NOW);
    expect(r.error).toBeUndefined();
    expect(r.matched).toBe(1);
    expect(upserts.flat()).toEqual([{ user_id: 'kw', signal_id: 77, distance_mi: null, notified: true, pushed_at: NOW.toISOString() }]);
  });
  it('a member 60 miles out with a 25 mile radius gets nothing', async () => {
    const far = { ...member, lat: COBB_CENTER.lat + 60 / 69, radius_mi: 25 } as MatchProfile;
    const { db, upserts } = stubDb((table, chain) => (table === 'holler_signals' && chain.some(([k, c]) => k === 'in' && c === 'source') ? [cobbRow] : []));
    const r = await backfillMatches(db as never, far, NOW);
    expect(r.matched).toBe(0);
    expect(upserts).toEqual([]);
  });
});
