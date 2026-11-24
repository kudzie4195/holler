// Round 24 FIX3 (review-FIX2 F3): a county storm report is placed by the towns its records name, never by the county's own name read
// as a town. Decatur County, GA is not Decatur (DeKalb County); Austin County, TX is not Austin.
import { describe, expect, it } from 'vitest';
import { stormReportCoverage } from '@/lib/storms/offer';
import { placeCoverage } from '@/lib/check/cells';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';

const zipCheck = (zip: string) => {
  const p = lookupZip(zip)!;
  expect(p, zip).toBeTruthy();
  return placeCoverage(p, isServedZip(p)).state;
};
const county = (state: string, name: string, places: string[]) =>
  stormReportCoverage({ kind: 'county', state, name, records: places.map((place) => ({ place })) } as never);

describe('F3: county storm reports', () => {
  it('Decatur County, GA answers what the ZIP check answers at its seat, Bainbridge 39817 (waitlist)', () => {
    expect(zipCheck('39817')).toBe('waitlist');
    expect(county('GA', 'Decatur County', ['Bainbridge, Decatur County'])).toBe(zipCheck('39817'));
    expect(county('GA', 'Decatur County', ['Decatur County'])).toBe('waitlist'); // a record with no town
  });
  it('Austin County, TX answers what the ZIP check answers at Bellville 77418 and Sealy 77474 (waitlist)', () => {
    expect(zipCheck('77418')).toBe('waitlist');
    expect(zipCheck('77474')).toBe('waitlist');
    expect(county('TX', 'Austin County', ['Bellville, Austin County', 'Sealy, Austin County'])).toBe('waitlist');
  });
  it('a county whose towns are live keeps the offer (Cook County, IL with Chicago)', () => {
    expect(zipCheck('60601')).toBe('live');
    expect(county('IL', 'Cook County', ['Chicago, Cook County', 'Cicero, Cook County'])).toBe('live');
  });
  it('a city report still uses its own name (Austin, TX)', () => {
    expect(stormReportCoverage({ kind: 'city', state: 'TX', name: 'Austin', records: [{ place: 'Austin' }] } as never)).toBe('live');
  });
});

describe('F3: a county report with no town in its records offers nothing', () => {
  it('Los Angeles County with no records is waitlist; with Los Angeles in a record it is live', () => {
    expect(county('CA', 'Los Angeles County', [])).toBe('waitlist');
    expect(county('CA', 'Los Angeles County', ['Los Angeles, Los Angeles County'])).toBe('live');
  });
});
