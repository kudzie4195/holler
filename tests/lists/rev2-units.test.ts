/**
 * Round 18 unit LISTS, review 2 (redo 2): the reviewer's unit and street-name probe (logs/REV2-LISTS-probe-tests/rev2-units.probe.test.ts) as a
 * permanent regression test. The 421131e side-by-side table is left out (it needed a copy of the old file); the 34 street cases and the nine
 * named unit forms are asserted.
 */
import { describe, expect, it } from 'vitest';
import { buildingAddress, buildList, type PermitRow } from '@/lib/lists/core';


const SMYRNA = { lat: 33.8839, lon: -84.5144 };
let nid = 1;
const permit = (summary: string): PermitRow => ({
  id: nid++, source: 'arcgis-atlanta-permits', kind: 'permit', title: 'Roof permit in Smyrna', summary, url: null, ...SMYRNA, city: 'Smyrna', state: 'GA',
  zip: '30080', occurred_at: '2026-11-20T00:00:00Z', subtype: 'permit', approxLocation: null, loc: null, projectOf: null,
});
const addr = (a: string) => buildingAddress(`Re-roof | ${a}`);

// real street names: Atlanta, Chicago and general US names that start with Ste / Fl / Unit / Lot / Apt / Rm / Room
const STREETS = [
    '1584 STEWART AVE SW', '2318 FLAT SHOALS RD', '742 UNITED AVE SE', '90 STEPHENS ST', '415 FLORIDA AVE', '77 FLETCHER ST', '1201 LOTUS AVE',
    '3300 FLOWERS RD', '18 STERLING ST', '250 UNITY DR', '100 APTOS CREEK RD', '611 FLOYD ST', '5 STEELE AVE', '909 STEVENS CREEK BLVD',
    '14 STELLA CT', '320 LOTT AVE', '7500 S STEWART', '1640 W FLETCHER', '3300 W FLOURNOY', '88 N OLD STEWART RD', '2100 S LAKE STEVENS RD',
    '455 S SAINT STEPHENS RD', '1500 MOUNT STERLING RD', '640 E FLAGLER ST', '12 FLEETWOOD DR', '901 FLINT RIVER RD', '30 FLAMINGO DR',
    '66 UNITAS CT', '8 STEEPLECHASE LN', '412 FLORENCE ST', '19 RMS TITANIC WAY', '233 ROOMES RD', '1 SUITER RD', '700 APTHORP AVE',
  ];
const STREETS_COUNT = STREETS.length;

describe('REV2 task 7: unit forms at one building', () => {
  const forms: [string, string | null][] = [
    ['12 OAK ST', '12 OAK ST'],
    ['12 OAK ST APT 204', '12 OAK ST'],
    ['12 OAK ST #305', '12 OAK ST'],
    ['12 OAK ST UNIT 7', '12 OAK ST'],
    ['12 OAK ST STE 100', '12 OAK ST'],
    ['12 OAK ST Apt. 3-B', '12 OAK ST'],
    ['12 OAK ST Suite 1200', '12 OAK ST'],
    ['12 OAK ST Bldg 4 Unit 12', '12 OAK ST'],
    ['12 OAK ST Lot 12', '12 OAK ST'],
    ['12 OAK ST LOT 12', '12 OAK ST'],
    ['12 OAK ST Rear', '12 OAK ST'],
    ['12 OAK ST REAR', '12 OAK ST'],
    ['12 OAK ST (REAR)', '12 OAK ST'],
    ['12 OAK ST, REAR UNIT', '12 OAK ST'],
    ['12 REAR OAK ST', '12 OAK ST'],
    ['12 OAK ST APT4', '12 OAK ST'],
    ['12 OAK ST #3-B', '12 OAK ST'],
    ['12 OAK ST # 5', '12 OAK ST'],
    ['12 OAK ST 204', '12 OAK ST'],
    ['12 OAK ST FL 2', '12 OAK ST'],
    ['12 OAK ST 2ND FLOOR', '12 OAK ST'],
    ['12 OAK ST UPPER', '12 OAK ST'],
    ['12 OAK ST BSMT', '12 OAK ST'],
    ['12 OAK ST TRLR 5', '12 OAK ST'],
    ['12 OAK ST SPC 14', '12 OAK ST'],
    ['12 OAK ST PH 2', '12 OAK ST'],
    ['12 OAK ST, APT 4, SMYRNA, GA 30080', '12 OAK ST'],
    ['12 OAK ST APT 4 SMYRNA GA 30080', '12 OAK ST'],
    ['12 OAK ST UNIT A-12', '12 OAK ST'],
    ['12 OAK ST NW APT 9', '12 OAK ST NW'],
  ];
  it('each form (table)', () => {
    const lines = forms.map(([f, want]) => { const got = addr(f); return `${got === want ? 'ok     ' : got === null ? 'DROPPED' : 'DIFFERS'} | ${f} | -> ${JSON.stringify(got)} | want ${JSON.stringify(want)}`; });
    console.log(lines.join('\n'));
    const list = buildList(forms.map(([f]) => permit(`Re-roof | ${f}`)), { center: { ...SMYRNA, radiusMi: 2 } });
    console.log('one building, all forms ->', list.entries.map((e) => e.address));
  });
  it('the commander-named forms collapse to one line', () => {
    for (const f of ['12 OAK ST APT 204', '12 OAK ST #305', '12 OAK ST UNIT 7', '12 OAK ST STE 100', '12 OAK ST Apt. 3-B', '12 OAK ST Suite 1200', '12 OAK ST Bldg 4 Unit 12', '12 OAK ST Lot 12', '12 OAK ST Rear'])
      expect(addr(f), f).toBe('12 OAK ST');
  });
  it('1/2 addresses and 12A / 12 A', () => {
    const rows = ['123 1/2 MAIN ST', '123 MAIN ST', '123 1/2 MAIN ST APT 2', '123-1/2 MAIN ST', '123 ½ MAIN ST', '12A OAK ST', '12 A OAK ST', '12 OAK ST', '12-A OAK ST', '12 OAK ST A', '12 OAK ST APT A'];
    console.log(rows.map((f) => `${f} -> ${JSON.stringify(addr(f))}`).join('\n'));
    const list = buildList(['12A OAK ST', '12 A OAK ST', '12 OAK ST', '12 OAK ST APT A'].map((f) => permit(`Re-roof | ${f}`)), { center: { ...SMYRNA, radiusMi: 2 } });
    console.log('12A / 12 A / 12 / 12 APT A ->', list.entries.map((e) => e.address));
    // never mangled into another street: whatever is returned must still name MAIN ST / OAK ST
    for (const f of rows) { const a = addr(f); if (a) expect(a, f).toMatch(/(MAIN|OAK) ST$/); }
  });
});

describe('REV2: street names that START with a unit word (regression introduced by UNIT_ANY_RE at 3474446)', () => {
  // real street names: Atlanta (Stewart Ave, Flat Shoals Rd, United Ave, Stephens St, Florida Ave, Fletcher St, Lotus Ave, Flowers Rd, Sterling St),
  // Chicago (S Stewart, W Fletcher, W Flournoy, N Sterling), general US (Unity, Aptos, Floyd, Steele, Stevens, Stella, Lott, Roomes)
  const streets = STREETS;
  it('a street that starts with Ste / Fl / Unit / Lot / Apt is listed whole ', () => {
    const bad = streets.filter((s) => addr(s) !== s);
    expect(bad).toEqual([]);
  });
});

describe('redo 2: the 34 streets, the nine unit forms, half addresses and state tails', () => {
  it('there are 34 street cases and each is listed whole', () => {
    expect(STREETS_COUNT).toBe(34);
  });
  it('"88 N OLD STEWART RD" is never cut to "88 N OLD"; Stewart, Flat Shoals and United are listed', () => {
    expect(addr('88 N OLD STEWART RD')).toBe('88 N OLD STEWART RD');
    expect(addr('1584 STEWART AVE SW')).toBe('1584 STEWART AVE SW');
    expect(addr('2318 FLAT SHOALS RD')).toBe('2318 FLAT SHOALS RD');
    expect(addr('742 UNITED AVE SE')).toBe('742 UNITED AVE SE');
  });
  it('a unit word on a street with a unit-like name still collapses', () => {
    expect(addr('1584 STEWART AVE SW APT 4')).toBe('1584 STEWART AVE SW');
    expect(addr('2318 FLAT SHOALS RD STE 100')).toBe('2318 FLAT SHOALS RD');
    expect(addr('742 UNITED AVE SE UNIT 7')).toBe('742 UNITED AVE SE');
    expect(addr('12 OAK ST APT4')).toBe('12 OAK ST');
    expect(addr('12 OAK ST 2ND FLOOR')).toBe('12 OAK ST');
  });
  it('"123 1/2 MAIN ST" is listed at its building, not dropped; it collapses with 123 MAIN ST', () => {
    expect(addr('123 1/2 MAIN ST')).toBe('123 MAIN ST');
    expect(addr('123 1/2 MAIN ST APT 2')).toBe('123 MAIN ST');
    expect(addr('12 OAK ST (REAR)')).toBe('12 OAK ST');
    const list = buildList(['123 1/2 MAIN ST', '123 MAIN ST'].map((f) => permit(`Re-roof | ${f}`)), { center: { ...SMYRNA, radiusMi: 2 } });
    expect(list.entries.map((e) => e.address)).toEqual(['123 MAIN ST']);
  });
  it('a printed city and state tail is not read as a floor ("FL") and gives the street', () => {
    expect(addr('123 MAIN ST, MIAMI, FL 33101')).toBe('123 MAIN ST');
    expect(addr('123 MAIN ST, ATLANTA, GA 30303')).toBe('123 MAIN ST');
  });
});
