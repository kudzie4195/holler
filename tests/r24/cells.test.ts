// Round 24 site unit: the cell table (lib/check/cells-data.ts, built by scripts/build-cells.mjs from the round 24 measurement) and the one
// answer every public surface asks (lib/check/cells.ts coverageFor).
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '@/lib/signals/categories';
import { CELL_TABLE, CELL_OVERRIDES, MEASURED_CENTRE_IDS, MEASURED_TRADE_IDS } from '@/lib/check/cells-data';
import {
  coverageFor,
  measuredCell,
  measuredCentres,
  nearestMeasuredCentre,
  signupClosedTrades,
  tradeHasStormCells,
  tradeLiveAnywhere,
  tradeSignupClosed,
} from '@/lib/check/cells';
import { haversineMi } from '@/lib/geo';

const TRADES = CATEGORIES.map((c) => c.id as string);

describe('the cell table', () => {
  it('measures all 41 trades in all 22 centres, including orlando, norfolk and kansas-city', () => {
    expect([...MEASURED_TRADE_IDS].sort()).toEqual([...TRADES].sort());
    expect(MEASURED_TRADE_IDS).toHaveLength(41);
    expect(MEASURED_CENTRE_IDS).toHaveLength(22);
    for (const id of ['orlando', 'norfolk', 'kansas-city']) expect(MEASURED_CENTRE_IDS).toContain(id);
    // Every centre resolves to a point (none is skipped).
    expect(measuredCentres().map((c) => c.id)).toEqual([...MEASURED_CENTRE_IDS]);
    for (const c of MEASURED_CENTRE_IDS) for (const t of TRADES) expect(['live', 'limited', 'waitlist', 'storm']).toContain(CELL_TABLE[c][t]);
  });

  it('holds the measured counts: 24 live, 76 limited, 135 storm, 667 waitlist (902 cells), with the 12 round 24 hand overrides and 16 round 31 downgrades', () => {
    const n: Record<string, number> = {};
    for (const c of MEASURED_CENTRE_IDS) for (const t of TRADES) n[CELL_TABLE[c][t]] = (n[CELL_TABLE[c][t]] ?? 0) + 1;
    expect(n).toEqual({ live: 24, limited: 76, storm: 135, waitlist: 667 });
    expect(CELL_OVERRIDES).toHaveLength(28);
    // The overrides are in the table: Atlanta cleaning is limited, Seattle moving is limited, LA roofing is not live.
    expect(measuredCell('atlanta', 'cleaning')).toBe('limited');
    expect(measuredCell('seattle', 'moving')).toBe('limited');
    expect(measuredCell('los-angeles', 'roofing')).not.toBe('live');
  });

  it('derives the closed trades from the table (live nowhere and no storm cell), never from a typed list', () => {
    const closed = signupClosedTrades();
    for (const t of TRADES) {
      const derived = !MEASURED_CENTRE_IDS.some((c) => CELL_TABLE[c][t] === 'live' || CELL_TABLE[c][t] === 'storm');
      expect(tradeSignupClosed(t), t).toBe(derived);
      expect(closed.includes(t)).toBe(derived);
      expect(tradeLiveAnywhere(t) || tradeHasStormCells(t)).toBe(!derived);
    }
    // The 20 the cells report lists, plus moving and real-estate (their only live cells were hand-overridden to limited).
    expect(closed).toHaveLength(22);
    for (const t of ['hvac', 'plumbing', 'electrical', 'pest-control', 'moving', 'real-estate', 'locksmith', 'business-services']) expect(closed).toContain(t);
    for (const t of ['landscaping', 'lawn-care', 'siding-gutters', 'cleaning', 'fencing', 'painting', 'roofing', 'tree-service']) expect(closed).not.toContain(t);
    expect(tradeSignupClosed('not-a-trade')).toBe(true);
  });
});

describe('no trade is ever live without a measured live cell (property over every trade and centre)', () => {
  // Points at each centre and on a ring of 8 points 5, 15 and 24 miles out, plus places outside every ring.
  const ring = (lat: number, lon: number, mi: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      return { lat: lat + (mi / 69) * Math.cos(a), lon: lon + (mi / (69 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a) };
    });
  const points = measuredCentres().flatMap((c) => [{ lat: c.lat, lon: c.lon }, ...[5, 15, 24].flatMap((mi) => ring(c.lat, c.lon, mi))]);
  const outside = [
    { lat: 30.83, lon: -83.28 }, // Valdosta, GA
    { lat: 42.36, lon: -71.06 }, // Boston, MA
    { lat: 46.87, lon: -96.79 }, // Fargo, ND
  ];

  it('at every probed point, every trade: live only where the nearest centre has the trade live', () => {
    let checked = 0;
    for (const p of points) {
      const centre = nearestMeasuredCentre(p.lat, p.lon);
      for (const t of TRADES) {
        for (const served of [true, false]) {
          const a = coverageFor(p, t, served);
          checked++;
          if (a.state === 'live') {
            expect(served).toBe(true);
            expect(centre).not.toBeNull();
            expect(CELL_TABLE[centre!.id][t], `${centre!.id}|${t}`).toBe('live');
            expect(a.measured && !a.storm && !a.closed).toBe(true);
          }
          // A storm cell is limited, never live, and says so.
          if (centre && CELL_TABLE[centre.id][t] === 'storm' && served) expect(a).toMatchObject({ state: 'limited', storm: true, measured: true });
          // A closed trade is waitlist everywhere.
          if (tradeSignupClosed(t)) expect(a.state).toBe('waitlist');
        }
      }
    }
    expect(checked).toBe(points.length * TRADES.length * 2);
  });

  it('outside every ring: never live; served gives limited and measured: false (closed trades waitlist), unserved gives waitlist', () => {
    for (const p of outside) {
      for (const c of measuredCentres()) expect(haversineMi(p.lat, p.lon, c.lat, c.lon)).toBeGreaterThan(25);
      for (const t of TRADES) {
        const served = coverageFor(p, t, true);
        expect(served.state).not.toBe('live');
        expect(served.measured).toBe(false);
        expect(served.state).toBe(tradeSignupClosed(t) ? 'waitlist' : 'limited');
        expect(coverageFor(p, t, false).state).toBe('waitlist');
      }
    }
  });
});
