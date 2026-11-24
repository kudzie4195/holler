// R25 check fix, review R25CHECK P2-6: a member with pressure washing has both of its parts (cleaning AND siding-gutters), so gets every
// alert either part gets. Its cell may never answer below the best of its parts. In 8 centres the rollup was waitlist while siding-gutters
// was a storm cell; scripts/build-cells.mjs now stores 'storm' for such a composite (and lib/check/cells-data.ts is regenerated).
import { describe, expect, it } from 'vitest';
import { MEASURED_CENTRE_IDS } from '@/lib/check/cells-data';
import { coverageFor, measuredCell } from '@/lib/check/cells';
import { PRESSURE_WASHING_ID, PRESSURE_WASHING_PARTS } from '@/lib/plan/composite-trades';
import { lookupZip } from '@/lib/geo';

/** How far each stored value lets a member in: waitlist (nothing), storm and limited (sign-up, limited answer), live. */
const RANK: Record<string, number> = { waitlist: 0, storm: 1, limited: 1, live: 2 };

describe('composite cells never rank below their best part', () => {
  it('all 22 centres', () => {
    expect(MEASURED_CENTRE_IDS).toHaveLength(22);
    for (const c of MEASURED_CENTRE_IDS) {
      const comp = measuredCell(c, PRESSURE_WASHING_ID)!;
      const best = Math.max(...PRESSURE_WASHING_PARTS.map((p) => RANK[measuredCell(c, p)!]));
      expect(RANK[comp], `${c}: ${comp} vs parts ${PRESSURE_WASHING_PARTS.map((p) => measuredCell(c, p)).join(', ')}`).toBeGreaterThanOrEqual(best);
    }
  });
  it('the review case: Dallas 75201 pressure washing is a storm answer (limited, trial offered), like siding-gutters', () => {
    const place = lookupZip('75201')!;
    const pw = coverageFor(place, PRESSURE_WASHING_ID, true);
    const sg = coverageFor(place, 'siding-gutters', true);
    expect(sg).toMatchObject({ state: 'limited', storm: true });
    expect(pw).toMatchObject({ state: 'limited', storm: true, centre: 'dallas' });
  });
  it('the 8 centres the review named are storm now; the 14 others are unchanged', () => {
    const storm = ['dallas', 'houston', 'phoenix', 'miami', 'philadelphia', 'orlando', 'norfolk', 'kansas-city'];
    for (const c of storm) expect(measuredCell(c, PRESSURE_WASHING_ID), c).toBe('storm');
    const was: Record<string, string> = { chicago: 'live', atlanta: 'live', 'new-york': 'live', 'washington-dc': 'live', 'los-angeles': 'live', seattle: 'live', austin: 'limited', raleigh: 'live', cincinnati: 'live', 'baton-rouge': 'live', 'san-francisco': 'live', charlotte: 'live', 'new-orleans': 'live', buffalo: 'limited' };
    for (const [c, v] of Object.entries(was)) expect(measuredCell(c, PRESSURE_WASHING_ID), c).toBe(v);
  });
});
