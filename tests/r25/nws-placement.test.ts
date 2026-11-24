// Round 25 part 5: why a severity-2 NWS alert stayed without coordinates, and the placement fix (lib/signals/adapters/nws.ts,
// lib/geo/county.ts countiesFromUgc). Fixtures: tests/fixtures/nws-r25-unplaced.json, features in the documented NWS shape built from
// export rows 139787, 139788, 20 and 6468 (gates/r19/data/signals-14d.json). No network.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTY_MIN_SEVERITY, parseNws, ruleFor } from '@/lib/signals/adapters/nws';
import { countiesFromSame, countiesFromUgc, countyFromUgc } from '@/lib/geo/county';
import { cityBySlug, haversineMi, lookupZip } from '@/lib/geo';
import { matchArea, type MatchProfile, type MatchSignal } from '@/lib/signals/match';
import type { SignalInput } from '@/lib/signals/types';
import { EXPORT, HAVE_EXPORT, exportRows } from './export-reads';

const FIX = JSON.parse(readFileSync(join(__dirname, '../fixtures/nws-r25-unplaced.json'), 'utf8')) as { features: Array<{ id: string; properties: Record<string, unknown> }> };
const one = (i: number) => parseNws({ features: [FIX.features[i]] });
const asSignal = (r: SignalInput, id = 1): MatchSignal => ({
  id, categories: r.categories, lat: r.lat ?? null, lon: r.lon ?? null, state: r.state ?? null, severity: r.severity, occurred_at: r.occurredAt,
  source: r.source, title: r.title, summary: r.summary ?? null, kind: r.kind, data: (r.data ?? null) as MatchSignal['data'],
});
const at = (zip: string, trade: string): MatchProfile => {
  const z = lookupZip(zip)!;
  return { user_id: 'm', categories: [trade], lat: z.lat, lon: z.lon, state: z.state, radius_mi: 25 };
};

describe('UGC county codes name counties directly', () => {
  it('"FLC099" is Palm Beach (12099), "SDC003" is Aurora, SD (46003); zone codes and marine codes give none', () => {
    expect(countyFromUgc('FLC099')).toMatchObject({ fips: '12099', state: 'FL' });
    expect(countyFromUgc('SDC003')).toMatchObject({ fips: '46003', state: 'SD' });
    expect(countyFromUgc('WYZ116')).toBeNull();
    expect(countyFromUgc('AMZ330')).toBeNull();
    expect(countyFromUgc('GUC010')).toBeNull(); // a territory: no state FIPS in the table, not served
    expect(countiesFromUgc(['FLC061', 'FLC061', 'FLZ054', 'FLC085']).map((c) => c.fips)).toEqual(['12061', '12085']);
    expect(countyFromUgc('FLC099')).toEqual(countiesFromSame(['012099'])[0]);
  });
});

describe('the unplaced shapes, before and after', () => {
  it('county-based Tornado Watch with UGC county codes and no SAME list: was one state-level row, now one row per county', () => {
    // Before: the county split read SAME only, and this payload has none.
    expect(countiesFromSame((FIX.features[0].properties.geocode as { SAME?: unknown }).SAME)).toEqual([]);
    const palm = one(0);
    expect(palm).toHaveLength(1);
    expect(palm[0]).toMatchObject({ state: 'FL', severity: 2, data: { loc: 'approx', countyFips: '12099', alertId: FIX.features[0].properties.id } });
    const wpb = cityBySlug('west-palm-beach-fl')!;
    expect(haversineMi(palm[0].lat!, palm[0].lon!, wpb.lat, wpb.lon)).toBeLessThan(30);
    const four = one(1);
    expect(four.map((r) => (r.data as { countyFips: string }).countyFips)).toEqual(['12061', '12085', '12093', '12111']);
    for (const r of four) expect(r.state).toBe('FL');
  });
  it('the same watch WITH its SAME list is placed the same way (SAME first; the UGC fallback agrees)', () => {
    const withSame = one(2);
    expect(withSame.map((r) => [r.lat, r.lon, (r.data as { countyFips: string }).countyFips])).toEqual(one(0).map((r) => [r.lat, r.lon, (r.data as { countyFips: string }).countyFips]));
  });
  it('a zone alert (High Wind Warning, Natrona County) is placed by its SAME county, as before', () => {
    const rows = one(3);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'WY', severity: 2, data: { countyFips: '56025', loc: 'approx' } });
    const casper = cityBySlug('casper-wy')!;
    expect(haversineMi(rows[0].lat!, rows[0].lon!, casper.lat, casper.lon)).toBeLessThan(30);
  });
  it('zone-only alerts with no SAME list (forecast or fire-weather zones) still cannot be placed: one state-level row, never delivered', () => {
    for (const i of [4, 5]) {
      const rows = one(i);
      expect(rows).toHaveLength(1);
      expect(rows[0].lat).toBeUndefined();
      expect(rows[0].severity).toBeGreaterThanOrEqual(COUNTY_MIN_SEVERITY);
    }
  });
  it('an advisory (severity 1) with county codes stays a state-level row: the severity floor is unchanged', () => {
    const f = JSON.parse(JSON.stringify(FIX.features[0]));
    f.properties.event = 'Wind Advisory';
    f.id = f.properties.id = f.properties['@id'] = `${f.id}-adv`;
    const rows = parseNws({ features: [f] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 1, state: 'FL' });
    expect(rows[0].lat).toBeUndefined();
  });
  it('which trades an alert reaches is unchanged: categories and severity are the rule table\'s, the same as the exported rows', () => {
    const exported: Record<number, string[]> = {
      0: ['roofing', 'restoration', 'tree-service', 'general-contractor', 'insurance', 'public-adjuster', 'auto-body', 'electrical', 'junk-removal'],
      3: ['tree-service', 'roofing', 'restoration', 'electrical'],
      5: ['restoration', 'tree-service', 'landscaping', 'insurance'],
    };
    for (const [i, cats] of Object.entries(exported)) {
      const ev = FIX.features[Number(i)].properties.event as string;
      for (const r of one(Number(i))) {
        expect(r.categories).toEqual(cats);
        expect(r.categories).toEqual(ruleFor(ev)!.categories);
      }
    }
  });
  it('delivery: the state-level row reaches no one; the placed county row passes the area test for a member 25 miles around West Palm Beach', () => {
    const member = at('33401', 'roofing');
    const placed = one(0)[0];
    const stateLevel = { ...placed, lat: undefined, lon: undefined, data: { ...(placed.data as object), loc: undefined, countyFips: undefined } } as SignalInput;
    expect(matchArea(asSignal(stateLevel), member)).toBeNull();
    expect(matchArea(asSignal(placed), member)).not.toBeNull();
  });
});

if (!HAVE_EXPORT) {
  describe('the 69 unplaced severity 2+ NWS rows of the export', () => {
    it.skip(`NEEDS the 14-day export at ${EXPORT} (not found, so NOT RUN)`, () => {});
  });
}
describe.skipIf(!HAVE_EXPORT)('the 69 unplaced severity 2+ NWS rows of the export', () => {
  const nws = () => exportRows().filter((r) => r.source === 'nws');
  it('none of the 521 NWS rows carries a county placement: the export predates the county split reaching main', () => {
    expect(nws()).toHaveLength(521);
    expect(nws().filter((r) => (r.data as { countyFips?: unknown } | null)?.countyFips != null)).toHaveLength(0);
    const un = nws().filter((r) => r.lat == null && r.severity >= 2);
    expect(un).toHaveLength(69);
  });
  it('2 of the 69 are county-based watches (areaDesc lists "County, ST"): placed by the UGC fallback even without SAME; 67 are zone alerts', () => {
    const un = nws().filter((r) => r.lat == null && r.severity >= 2);
    const countyList = un.filter((r) => /^([^;,]+, [A-Z]{2})(; [^;,]+, [A-Z]{2})*$/.test(String((r.data as { areaDesc?: string }).areaDesc)));
    expect(countyList.map((r) => r.id).sort()).toEqual([139787, 139788]);
    expect(un.length - countyList.length).toBe(67);
  });
});
