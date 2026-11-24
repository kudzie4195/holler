// R25 check fix, review R25CHECK P3-2: "at least" only when the count without any read limit could really be larger.
// A read counts as clipped when it returned exactly its limit, and only when no wider read already holds every row it could have
// returned: the close-to-home and severe reads are subsets of the recent read (same window and trades, smaller radius or higher severity),
// the routed close-to-home read a subset of the routed read. So "at least" comes from the recent, routed, upcoming and state-level reads.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import zipcodes from 'zipcodes';

vi.mock('server-only', () => ({}));

import { CHECK_READ_LIMITS, assembleCheck, type CheckReadName, type CheckRow } from '@/lib/check/load';
import { coverageFor, measuredCentres } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { CATEGORIES } from '@/lib/signals/categories';
import { haversineMi, lookupZip } from '@/lib/geo';
import { EXPORT, EXPORT_NOW, HAVE_EXPORT, checkFromExport, unlimitedEmailed } from '../r25/export-reads';

const row = (id: number): CheckRow => ({ id, source: 'x', kind: 'civic', title: 't', url: null, city: 'A', state: 'TX', lat: 30.27, lon: -97.74, severity: 1, occurred_at: '2026-11-20T00:00:00Z', categories: [], data: null, summary: null });
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => row(from + i + 1));

function reads(full: CheckReadName[]): Record<CheckReadName, [CheckRow[], number]> {
  const out = {} as Record<CheckReadName, [CheckRow[], number]>;
  let next = 0;
  for (const k of Object.keys(CHECK_READ_LIMITS) as CheckReadName[]) {
    const lim = CHECK_READ_LIMITS[k];
    const n = full.includes(k) ? lim : 1;
    out[k] = [rows(n, next), lim];
    next += n;
  }
  return out;
}

describe('assembleCheck: which reads at their limit make the count a lower bound', () => {
  const NOW = Date.parse('2026-11-23T00:00:00Z');
  it('subset reads at their limit alone do not: close-to-home, severe, routed close-to-home', () => {
    expect(assembleCheck(reads(['core']), 'lawn-care', NOW).clipped).toBe(false);
    expect(assembleCheck(reads(['severe']), 'lawn-care', NOW).clipped).toBe(false);
    expect(assembleCheck(reads(['routedCore']), 'lawn-care', NOW).clipped).toBe(false);
    expect(assembleCheck(reads(['core', 'severe', 'routedCore']), 'lawn-care', NOW).clipped).toBe(false);
  });
  it('the wide reads at their limit do: recent, routed, upcoming, state level', () => {
    for (const k of ['recent', 'routedRecent', 'upcoming', 'stateLevel'] as const) expect(assembleCheck(reads([k]), 'lawn-care', NOW).clipped, k).toBe(true);
  });
  it('a read below its limit, or one given no limit, is never clipped', () => {
    const r = reads([]);
    r.recent = [rows(499), 500];
    expect(assembleCheck(r, 'lawn-care', NOW).clipped).toBe(false);
    r.recent = [rows(600), Infinity];
    expect(assembleCheck(r, 'lawn-care', NOW).clipped).toBe(false);
  });
});

if (!HAVE_EXPORT) {
  describe('P3-2 on the 14-day export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('P3-2 on the 14-day export: the 22 centre ZIPs x 42 trades', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(EXPORT_NOW);
  });
  afterAll(() => vi.useRealTimers());

  it('never an exact count that is too small; "at least" only where a wide read stopped at its limit', () => {
    const all = Object.values((zipcodes as unknown as { codes: Record<string, { zip: string; latitude: number; longitude: number; country: string }> }).codes);
    const trades = [...CATEGORIES.map((c) => c.id as string), 'pressure-washing'];
    let answers = 0;
    let atLeast = 0;
    let needless = 0;
    for (const c of measuredCentres()) {
      let best = '';
      let bestD = Infinity;
      for (const z of all) {
        if (z.country !== 'US' || typeof z.latitude !== 'number' || Math.abs(z.latitude - c.lat) > 0.2) continue;
        const d = haversineMi(c.lat, c.lon, z.latitude, z.longitude);
        if (d < bestD && lookupZip(z.zip)) {
          bestD = d;
          best = z.zip;
        }
      }
      const place = lookupZip(best)!;
      const served = isServedZip(place);
      for (const trade of trades) {
        if (coverageFor(place, trade, served).state === 'waitlist') continue;
        answers++;
        const { totals } = checkFromExport(best, trade);
        const unlimited = unlimitedEmailed(best, trade).count;
        if (!totals.atLeast) expect(totals.count, `${c.id} ${best} ${trade}`).toBe(unlimited);
        else {
          atLeast++;
          expect(totals.count, `${c.id} ${best} ${trade}`).toBeLessThanOrEqual(unlimited);
          if (totals.count === unlimited) needless++;
        }
      }
    }
    console.log(`[P3-2] non-waitlist answers ${answers}, "at least" ${atLeast}, of which the unlimited count equals the count ${needless}`);
    expect(answers).toBeGreaterThan(150);
  }, 600_000);

  it('Austin 78701 pressure washing (the review case, 6 = 6): an exact count now', () => {
    const { totals } = checkFromExport('78701', 'pressure-washing');
    expect(totals.count).toBe(unlimitedEmailed('78701', 'pressure-washing').count);
    expect(totals.atLeast).toBe(false);
  });
});
