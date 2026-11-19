/**
 * verify-v1 finding 8 (P2), commander decision 7: a category or type value is printed only when no token looks like a person's name.
 * The verifier planted a name in every column of every violation and 311 config; "Roof leak - John Doe", "Roof leak Garcia residence"
 * and "Tree down, Doe, John" reached title and summary through category columns. Address residuals: no suffix, a "city" that is a name.
 */
import { describe, expect, it } from 'vitest';
import { categoryValueHasName, cutAfterStreetSuffix } from '@/lib/signals/adapters/permit-privacy';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { ARCGIS_DATASETS } from '@/lib/signals/adapters/arcgis-datasets';

const PLANTED = ['Roof leak - John Doe', 'Roof leak Garcia residence', 'Tree down, Doe, John', 'Roof leak John Doe'];
const NAME_RE = /\bjohn\b|\bdoe\b|\bgarcia\b/i;

describe('categoryValueHasName', () => {
  it("the verifier's values carry a name", () => {
    for (const v of PLANTED) expect(categoryValueHasName(v), v).toBe(true);
    expect(categoryValueHasName('Water leak for Maria Lopez')).toBe(true);
    expect(categoryValueHasName('Leak, call 404-555-1212')).toBe(true);
  });
  it('real category values do not', () => {
    for (const v of [
      'Rodent Baiting/Rat Complaint', 'HEAT/HOT WATER', 'PLUMBING', 'ENTIRE BUILDING', 'Tree Debris', 'Sewer Cave-In Inspection Request',
      'Graffiti Removal Request', 'ILLDUMP', 'Abandoned Vehicle Complaint', 'Residential Alteration', 'Single Family Residence',
      'Roof leak', 'Water On Street', 'Street Light Out', 'Building Violation', 'Structure Condition Violation(s)', 'Junk - Debris',
      'Weeds/Grass', 'Damaged Sidewalk', 'Sanitation - Missed Pickup', 'Two Family Home', 'New Construction',
    ]) expect(categoryValueHasName(v), v).toBe(false);
  });
});

describe('a planted name in a category column never reaches title, summary or data (every 311 and violation config)', () => {
  const civicSocrata = SOCRATA_DATASETS.filter((d) => d.subtype === '311' || d.subtype === 'violation');
  for (const ds of civicSocrata) {
    for (const planted of PLANTED) {
      it(`${ds.id}: "${planted}"`, () => {
        const row: Record<string, unknown> = {};
        for (const f of new Set([...ds.titleFields, ...ds.textFields, ...ds.summaryFields])) row[f] = planted;
        row[ds.idField] = 'X1';
        row[ds.dateField] = '2026-11-17T10:00:00.000';
        const d = ds as unknown as Record<string, string | undefined>;
        if (d.latField) row[d.latField] = '41.9';
        if (d.lonField) row[d.lonField] = '-87.6';
        const out = parseSocrata([row], ds);
        for (const s of out) expect(`${s.title}\n${s.summary ?? ''}\n${JSON.stringify(s.data)}`).not.toMatch(NAME_RE);
      });
    }
  }
  it('Chicago 311 sr_type: the row is kept, titled with fixed words', () => {
    const ds = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-311')!;
    const row: Record<string, unknown> = { [ds.idField]: 'X2', [ds.dateField]: '2026-11-17T10:00:00.000', latitude: '41.9', longitude: '-87.6' };
    for (const f of new Set([...ds.titleFields, ...ds.textFields, ...ds.summaryFields])) row[f] = 'Roof leak - John Doe';
    const [s] = parseSocrata([row], ds);
    expect(s).toBeDefined();
    expect(s.title).toMatch(/^311 request in Chicago: /);
    expect(s.title).not.toMatch(NAME_RE);
  });
  for (const ds of ARCGIS_DATASETS.filter((d) => d.subtype === 'violation')) {
    it(`${ds.id}: planted names stay out`, () => {
      const attrs: Record<string, unknown> = { [ds.idField]: 'A1', [ds.dateField]: Date.UTC(2026, 10, 17) };
      for (const f of new Set([...ds.titleFields, ...ds.textFields, ...ds.summaryFields])) attrs[f] = 'Roof leak - John Doe';
      const out = parseArcgis({ features: [{ attributes: attrs, geometry: { x: -84.29, y: 33.75 } }] }, ds);
      for (const s of out) expect(`${s.title}\n${s.summary ?? ''}\n${JSON.stringify(s.data)}`).not.toMatch(NAME_RE);
    });
  }
});

describe('address residuals', () => {
  it('no recognised suffix: an address that ends in a full name is dropped', () => {
    expect(cutAfterStreetSuffix('45 SMITH JOHN')).toBe('');
    expect(cutAfterStreetSuffix('9 BROADWAY MARIA LOPEZ')).toBe('');
    expect(cutAfterStreetSuffix('100 N STATE JOHN DOE')).toBe('');
    // real addresses without a suffix stay
    expect(cutAfterStreetSuffix('100 N STATE')).toBe('100 N STATE');
    expect(cutAfterStreetSuffix('4500 ETHEL NW, ATLANTA, GA 30318')).toBe('4500 ETHEL NW, ATLANTA, GA 30318');
    expect(cutAfterStreetSuffix('2300 NANCY CREEK NW, ATLANTA, GA 30327')).toBe('2300 NANCY CREEK NW, ATLANTA, GA 30327');
    expect(cutAfterStreetSuffix('5600 LA SALLE SW, ATLANTA, GA 30331')).toBe('5600 LA SALLE SW, ATLANTA, GA 30331');
  });
  it('a city tail that is a full name is cut', () => {
    expect(cutAfterStreetSuffix('77 PEACHTREE ST JOHN DOE GA 30303')).toBe('77 PEACHTREE ST');
    expect(cutAfterStreetSuffix('123 MAIN ST, JOHN DOE, GA')).toBe('123 MAIN ST');
    expect(cutAfterStreetSuffix('123 MAIN ST, ATLANTA, GA 30303')).toBe('123 MAIN ST, ATLANTA, GA 30303');
    expect(cutAfterStreetSuffix('1 MARKET ST, SAN FRANCISCO, CA 94105')).toBe('1 MARKET ST, SAN FRANCISCO, CA 94105');
  });
});
