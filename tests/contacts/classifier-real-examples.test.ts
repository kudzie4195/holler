/**
 * Company-versus-person classification on real contractor strings (round 15, Unit G, PLAN-2.0 1.2).
 *
 * The company strings below are copied from the contractor columns of two public permit feeds, read on 2026-11-21:
 *  - Dallas Building Permits (e7gq-4sah), https://www.dallasopendata.com/resource/e7gq-4sah.csv, the name part of the `contractor` string;
 *  - Orlando Right of Way permits (6sbc-v4b9), the `contractor` column, shaped "FIRST LAST (COMPANY)".
 * Companies are public business names. Person names in the "must not pass" lists are invented (the real sole-proprietor and
 * individual names of those feeds are deliberately NOT copied here), but their shapes are the shapes of the real values.
 *
 * The classifier (lib/contacts/org.ts) is strict on purpose: it passes a name only on clear company evidence and drops a name that could be a
 * person's, so some real companies are not named. The REJECTED_COMPANIES list records that cost; it is not a bug list.
 */
import { describe, expect, it } from 'vitest';
import { cleanOrgName, looksLikePersonName } from '@/lib/contacts/org';
import { splitRunTogether } from '@/lib/contacts/extract';

const ACCEPTED_REAL = [
  // Dallas
  'ACM PLUMBING CO.',
  'BERKEYS LLC',
  'SIGNS MANUFACTURING & MAINTENANCE CORPORATION',
  'OPTIONS REAL ESTATE',
  'URGENT RESTORATION',
  'WEB CITY PROPERTIES',
  'REPUBLIC HEATING & AIR CONDITIONING INC',
  'VELEX INC.',
  'MICROWAVE TRANSMISSION SYSTEM INC',
  'PRIORITY SIGNS AND GRAPHICS',
  'GUEL FAMILY BUILDERS INC',
  'MILESTONE ELECTRIC',
  'GRAND PRAIRIE CONSTRUCTION INC',
  // Orlando
  'SOUTHWEST COMMUNICATIONS SOLUTIONS INC',
  'TCS COMMUNICATIONS LLC',
  'PRIMORIS DISTRIBUTION SERVICES',
  'ADVANCED FACILITY CONTRACTING AND CONSULTING LLC',
  'APL SITE DEVELOPMENT LLC',
  'VETERAN CONSTRUCTION SOLUTIONS LLC',
  'PRESTO PROPERTY SERVICES INC',
  'SMG CONTRACTORS',
];

/** Real companies the strict rule leaves unnamed (an unknown word next to a trade word, one trade word alone, a listed surname word ...). */
const REJECTED_COMPANIES = [
  'ESPARZA UNDERGROUND INC',
  'AMBIENT TECHNOLOGIES INC',
  'GULF COAST CUSTOM CABLE INC',
  'KIMLEY HORN AND ASSOCIATES INC',
  'VERDANTAS LLC',
  'DUKE ENERGY',
  'ARRINGTON ROOFING CO INC.',
  'TEMPO MECHANICAL',
  'CONDOR FENCING',
  'ELSTONAIRE',
  'SERVICE 1ST',
  'A #1 AIR',
];

/** Invented person shapes of the Dallas and Orlando values: a full name, a name plus a trade word, LAST, FIRST, a bare name with an initial. */
const PERSONS = [
  'JAMES CARTER',
  'MARIA L GARCIA',
  'ROBERT JOHNSON PLUMBING',
  'LINDA MARTINEZ ELECTRIC',
  'CARTER, JAMES A',
  'DAVID WILSON',
  'PATRICIA MOORE ROOFING',
  'MICHAEL T BROWN',
  'JENNIFER DAVIS HVAC',
  'WILLIAM TAYLOR',
];

/** The Orlando shape: person first, company in brackets. Only the company may come out. */
const WRAPPED: [string, string | null][] = [
  ['MICHAEL T BROWN (SOUTHWEST COMMUNICATIONS SOLUTIONS INC)', 'SOUTHWEST COMMUNICATIONS SOLUTIONS INC'],
  ['JENNIFER DAVIS (TCS Communications LLC)', 'TCS Communications LLC'],
  ['JAMES CARTER (PRESTO PROPERTY SERVICES INC)', 'PRESTO PROPERTY SERVICES INC'],
  ['LINDA MARTINEZ (JAMES CARTER)', null],
  ['ROBERT JOHNSON (DAVID WILSON)', null],
];

describe('company versus person on real contractor strings', () => {
  it('has at least 40 real or real-shaped examples', () => {
    expect(ACCEPTED_REAL.length + REJECTED_COMPANIES.length + PERSONS.length + WRAPPED.length).toBeGreaterThanOrEqual(40);
  });
  it.each(ACCEPTED_REAL)('names the company %s unchanged', (v) => {
    expect(cleanOrgName(v)).toBe(v);
  });
  it.each(REJECTED_COMPANIES)('does not name %s (strict rule: when unsure, null)', (v) => {
    expect(cleanOrgName(v)).toBeNull();
  });
  it.each(PERSONS)('never names the person shape %s', (v) => {
    expect(cleanOrgName(v)).toBeNull();
  });
  it.each(WRAPPED)('splits %s', (v, want) => {
    expect(cleanOrgName(v)).toBe(want);
  });
  it('a person shape is also recognised as a person by the public-text guard', () => {
    for (const v of ['JAMES CARTER', 'MARIA L GARCIA', 'CARTER, JAMES A', 'DAVID WILSON']) expect(looksLikePersonName(v), v).toBe(true);
  });
  it('named share of the real company strings above (recorded so a classifier change shows up here)', () => {
    const all = [...ACCEPTED_REAL, ...REJECTED_COMPANIES];
    const named = all.filter((v) => cleanOrgName(v)).length;
    expect(named / all.length).toBeCloseTo(21 / 33, 5);
  });
});

describe('Dallas run-together contractor string', () => {
  it('splits the name from the street, city, state, zip and phone', () => {
    expect(splitRunTogether('ALL MASTERS PLUMBING 7501 US HWY 287, SuiteC4, ARLINGTON, TX 76001 (817) 969-5050')).toEqual({ name: 'ALL MASTERS PLUMBING', phone: '817-969-5050' });
    expect(splitRunTogether('MILESTONE ELECTRIC 2400 MAIN ST, DALLAS, TX 75201 469-360-6479')).toEqual({ name: 'MILESTONE ELECTRIC', phone: '469-360-6479' });
    expect(splitRunTogether('VELEX INC. \\1201 Main St, DALLAS, TX 75202 /9722431100')).toEqual({ name: 'VELEX INC.', phone: '972-243-1100' });
  });
  it('a value with no street gives no name, and a PO box ends the name', () => {
    expect(splitRunTogether('JUST A NAME').name).toBe('');
    expect(splitRunTogether('GRAND PRAIRIE CONSTRUCTION INC PO BOX 12, DALLAS, TX 75201')).toEqual({ name: 'GRAND PRAIRIE CONSTRUCTION INC', phone: null });
  });
  it('the cleaned name of a split value is still checked by the classifier', () => {
    expect(cleanOrgName(splitRunTogether('MILESTONE ELECTRIC 2400 MAIN ST, DALLAS, TX 75201 469-360-6479').name)).toBe('MILESTONE ELECTRIC');
    expect(cleanOrgName(splitRunTogether('JAMES CARTER 12 ELM ST, DALLAS, TX 75201 214-555-0101').name)).toBeNull();
  });
});
