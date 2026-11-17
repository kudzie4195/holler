/**
 * P0 privacy: no private person's name may reach a stored signal (title, summary, url, data, or any other field) for business,
 * violation and event-permit rows.
 *
 * Fixture provenance (tests/fixtures/socrata-*-people.json):
 * - Column NAMES: sourced from each portal's metadata (https://<domain>/api/views/<id>.json, 2026-11-17).
 * - The Orlando, Chicago and SF DBA/business-name VALUES (Olga Torres, REGINALD JACKSON JR, Charles von Weise, Kelly Lewis,
 *   Molly Barnett Psy.D, ALEXANDRA VANWAGNER/ADVENTHEALTH MEDICAL GROUP CRI, GARRETT MAYS, CHARLES JEFFREY LAX EC13014488) are live
 *   values the independent review pulled with the adapter's own $where on 2026-11-17 (sourced). Addresses, ids, coordinates, LA, NYC,
 *   violation and event rows are hand written (assumed) in the same shapes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrata, buildSocrataQuery, blockAddress } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import {
  NAME_COLUMN_OK,
  NAME_LIKE_COLUMN,
  PERSON_RISK_SUBTYPES,
  SOCRATA_DATASETS,
  type SocrataDataset,
} from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../../fixtures', n), 'utf8'));
const ds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;

/** Every distinct name-ish token that appears in the people fixtures. */
const NAMES = [
  'Olga Torres', 'TORRES', 'Olga', 'REGINALD JACKSON', 'JACKSON', 'Reginald', 'Charles von Weise', 'von Weise', 'VON WEISE',
  'Kelly Lewis', 'Molly Barnett', 'Barnett', 'Psy.D', 'ALEXANDRA', 'VANWAGNER', 'ADVENTHEALTH', 'GARRETT', 'MAYS', 'CHARLES JEFFREY', 'LAX EC',
  'Maria Gutierrez', 'GUTIERREZ', 'MARIA ELENA', 'DEVON', 'WASHINGTON', 'ANGELA', 'ROSSI', 'TYRONE', 'WILLIAMS', 'Dana Whitfield', 'Whitfield',
];

function everyString(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => everyString(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); everyString(x, out); }
  return out;
}

function expectNoNames(items: SignalInput[], label: string) {
  const hay = everyString(items).join('\n').toLowerCase();
  for (const n of NAMES) expect(hay.includes(n.toLowerCase()), `${label}: stored output contains "${n}"`).toBe(false);
}

const PEOPLE: { id: string; file: string; count: number; titleStart: RegExp }[] = [
  { id: 'socrata-chicago-business', file: 'socrata-chicago-business-people.json', count: 3, titleStart: /^New business license in Chicago: (Limited|Regulated|Shared Housing)/ },
  { id: 'socrata-sf-business', file: 'socrata-sf-business-people.json', count: 2, titleStart: /^New business license in San Francisco: (Professional Services|Multiple)/ },
  { id: 'socrata-la-business', file: 'socrata-la-business-people.json', count: 2, titleStart: /^New business license in Los Angeles: (Other personal services|Janitorial services)/ },
  { id: 'socrata-nyc-business', file: 'socrata-nyc-business-people.json', count: 2, titleStart: /^New business license in New York City: (Home Improvement Contractor|Locksmith)/ },
  { id: 'socrata-orlando-business', file: 'socrata-orlando-business-people.json', count: 3, titleStart: /^New business license in Orlando: (NURSE PRACTITIONER|SERVICE|CONTRACTOR DBPR)/ },
  { id: 'socrata-chicago-violations', file: 'socrata-chicago-violations-people.json', count: 2, titleStart: /^Code violation in Chicago: / },
  { id: 'socrata-austin-violations', file: 'socrata-austin-violations-people.json', count: 1, titleStart: /^Code violation in Austin: / },
  { id: 'socrata-nyc-events', file: 'socrata-nyc-events-people.json', count: 1, titleStart: /^Permitted event in New York City: Street Event/ },
  { id: 'socrata-chicago-events', file: 'socrata-chicago-events-people.json', count: 1, titleStart: /^Permitted event in Chicago: / },
];

describe('person-name rows: no name in any stored field', () => {
  for (const p of PEOPLE) {
    it(`${p.id}: parses ${p.count} rows, titles are record type and place only`, () => {
      const items = parseSocrata(fx(p.file), ds(p.id));
      expect(items.length).toBe(p.count);
      for (const s of items) expect(s.title, s.title).toMatch(p.titleStart);
      expectNoNames(items, p.id);
    });
  }

  it('business rows carry no street address (home addresses of sole proprietors) and a coarse point', () => {
    const rows: [string, string[]][] = [
      ['socrata-chicago-business', ['2318 W 47TH', '7710 S CHAPPEL', '1522 N DAMEN']],
      ['socrata-sf-business', ['Funston', 'Sacramento St']],
      ['socrata-la-business', ['HOBART', '1ST ST']],
      ['socrata-nyc-business', ['BAY RIDGE', '187TH']],
      ['socrata-orlando-business', ['ROLLINS', 'LAKE FRANCES', 'GREENE AVE']],
    ];
    for (const [id, streets] of rows) {
      const items = parseSocrata(fx(`${id}-people.json`), ds(id));
      expect(items.length).toBeGreaterThan(0);
      const hay = everyString(items).join('\n');
      for (const st of streets) expect(hay.includes(st), `${id} leaked ${st}`).toBe(false);
      for (const s of items) {
        expect(s.summary ?? '').not.toMatch(/\d{2,5}\s+[NSEW]\s/);
        // 2 decimals at most
        expect(Math.abs((s.lat as number) * 100 - Math.round((s.lat as number) * 100))).toBeLessThan(1e-6);
        expect(Math.abs((s.lon as number) * 100 - Math.round((s.lon as number) * 100))).toBeLessThan(1e-6);
      }
    }
  });

  it('violation summaries keep a block-level address, never the house number, owner, inspector or comment text', () => {
    const items = parseSocrata(fx('socrata-chicago-violations-people.json'), ds('socrata-chicago-violations'));
    expect(items[0].summary).toContain('2300 block of W 47TH ST');
    expect(items[1].summary).toContain('7700 block of S CHAPPEL AVE');
    const hay = everyString(items).join('\n');
    for (const exact of ['2318', '7710']) expect(hay.includes(exact), `exact house number ${exact} stored`).toBe(false);
    expectNoNames(items, 'violations');
  });

  it('violation coordinates are rounded to 3 decimals', () => {
    const items = parseSocrata(fx('socrata-chicago-violations-people.json'), ds('socrata-chicago-violations'));
    expect(items[0].lat).toBe(41.808);
    expect(items[0].lon).toBe(-87.684);
    for (const s of items) {
      expect(Math.abs((s.lat as number) * 1000 - Math.round((s.lat as number) * 1000))).toBeLessThan(1e-6);
      expect(Math.abs((s.lon as number) * 1000 - Math.round((s.lon as number) * 1000))).toBeLessThan(1e-6);
    }
  });
});

describe('violation addresses: block level only, Socrata and ArcGIS', () => {
  it('blockAddress rounds down, strips units and drops what it cannot parse', () => {
    expect(blockAddress('1234 W Main St')).toBe('1200 block of W Main St');
    expect(blockAddress('1200 W Main St')).toBe('1200 block of W Main St');
    expect(blockAddress('47 Oak Ave')).toBe('0-99 block of Oak Ave');
    expect(blockAddress('2318 W 47TH ST APT 3B')).toBe('2300 block of W 47TH ST');
    expect(blockAddress('2318 W 47TH ST #4')).toBe('2300 block of W 47TH ST');
    expect(blockAddress('2318 W 47TH ST, CHICAGO IL 60632')).toBe('2300 block of W 47TH ST');
    expect(blockAddress('MAIN ST & 5TH AVE')).toBe('');
    expect(blockAddress('PARCEL 14-20-300-001')).toBe('');
    expect(blockAddress('2318')).toBe('');
    expect(blockAddress('')).toBe('');
  });

  it("verify P2-6: lot, trailer and space numbers and a second joined address drop the whole address; APT4 and a fractional number are handled", () => {
    // dropped entirely (the review's leaks)
    for (const a of ['12 Main St Lot 34', '12 MAIN ST LOT #34', '12 Main St Trailer 24', '6411 MONTEREY ROAD TRAILER #24', '300 PARK RD SPC 7', '300 PARK RD SPACE 12B',
      '300 PARK RD TRLR 9',
      // P2-5: the same numbers written without a space or with a letter prefix and a dash (each names one mobile-home pad)
      '12 MAIN ST LOT34', '1200 MAIN ST SP34', '800 W ROOSEVELT RD TRLR24', '402 RIVER RD SPACE A-12', '9 ELM ST SPC 7', '12 Main St Lot#34', 'TRAILER #24 5 OAK ST',
      '123 MAIN ST & 45 ELM ST', '123 MAIN ST AND 45 ELM ST', '123 Main St and 45 Elm St', '123 MAIN ST&45 ELM ST']) {
      expect(blockAddress(a), a).toBe('');
    }
    // P2-5: street names that merely start with those letters are kept
    for (const a of ['99 Andover Rd', '10 Lotus Ln', '5 Spruce St', '300 Trail Ridge Dr', '42 SPC Way', '100 Spring St', '1200 Lottie Ave', '77 Sparrow Ct', '15 Tremont St']) {
      expect(blockAddress(a), a).not.toBe('');
    }
    // unit-style suffixes without a space are stripped like the spaced ones
    expect(blockAddress('123 MAIN ST APT4')).toBe('100 block of MAIN ST');
    expect(blockAddress('123 MAIN ST UNIT5')).toBe('100 block of MAIN ST');
    expect(blockAddress('123 MAIN ST STE100')).toBe('100 block of MAIN ST');
    // fractional house numbers
    expect(blockAddress('1915 1/4 APEX AVENUE')).toBe('1900 block of APEX AVENUE');
    expect(blockAddress('1200 1/2 MAIN ST')).toBe('1200 block of MAIN ST');
    // still fine: ranges, ordinals, plain streets, and street names that merely contain the words
    expect(blockAddress('1200-1210 MAIN ST')).toBe('1200 block of MAIN ST');
    expect(blockAddress('100 1st Ave')).toBe('100 block of 1st Ave');
    expect(blockAddress('500 SPACE CENTER BLVD')).toBe('500 block of SPACE CENTER BLVD');
    expect(blockAddress('900 LOTUS LN')).toBe('900 block of LOTUS LN');
    expect(blockAddress('45 TRAILWOOD DR')).toBe('0-99 block of TRAILWOOD DR');
    // nothing it returns holds a digit run that could be a lot, trailer or second house number
    for (const a of ['12 Main St Lot 34', '123 MAIN ST & 45 ELM ST', '300 PARK RD SPC 7']) expect(blockAddress(a)).not.toMatch(/\d/);
  });

  it('verify P2-7: the LA business exclusion list carries the near-duplicate spellings seen live', () => {
    const where = ds('socrata-la-business').extraWhere ?? '';
    for (const s of ['Other Personal Care Services', 'Musical Groups and Artists', 'Other Management Consulting Services']) expect(where).toContain(`'${s}'`);
  });

  it('no output of blockAddress contains the exact house number', () => {
    for (const n of [101, 199, 1234, 5678, 99999, 407, 2318]) {
      const out = blockAddress(`${n} Elm St`);
      expect(out.includes(String(n)), `${n} -> ${out}`).toBe(false);
    }
  });

  it('Socrata violation row with an exact number stores no exact number in any field; unparseable address is dropped', () => {
    const d = ds('socrata-chicago-violations');
    const base = {
      id: 'V1', violation_date: '2026-11-12T00:00:00.000', violation_description: 'RODENT INFESTATION IN REAR YARD', violation_status: 'OPEN',
      latitude: '41.808234', longitude: '-87.684177',
    };
    const [ok] = parseSocrata([{ ...base, address: '4471 N LINCOLN AVE' }], d);
    expect(JSON.stringify(ok)).not.toContain('4471');
    expect(ok.summary).toContain('4400 block of N LINCOLN AVE');
    expect(JSON.stringify(ok)).not.toContain('41.808234');
    const [bad] = parseSocrata([{ ...base, address: 'LOT 4471' }], d);
    expect(JSON.stringify(bad)).not.toContain('4471');
    expect(bad.summary).not.toMatch(/block of|LOT/);
  });

  it('ArcGIS violation row: block address and 3-decimal point', () => {
    const d: ArcgisDataset = {
      ...ARCGIS_DATASETS[0], id: 'arcgis-test-violations', subtype: 'violation', kind: 'civic', idField: 'ID', dateField: 'OPENED',
      titleFields: ['TYPE'], textFields: ['TYPE'], summaryFields: ['TYPE'], addressFields: ['ADDR'], latField: undefined, lonField: undefined, zipField: undefined,
    };
    const raw = {
      features: [{ attributes: { ID: 'A1', OPENED: Date.parse('2026-11-12T10:00:00Z'), TYPE: 'Overgrown weeds and trash', ADDR: '3355 Peachtree Rd NE' }, geometry: { x: -84.388123, y: 33.841987 } }],
    };
    const [it1] = parseArcgis(raw, d);
    expect(it1).toBeTruthy();
    expect(JSON.stringify(it1)).not.toContain('3355');
    expect(it1.summary).toContain('3300 block of Peachtree Rd NE');
    expect(it1.lat).toBe(33.842);
    expect(it1.lon).toBe(-84.388);
    const [none] = parseArcgis({ features: [{ attributes: { ID: 'A2', OPENED: Date.parse('2026-11-12T10:00:00Z'), TYPE: 'Overgrown weeds', ADDR: 'Peachtree at 14th' }, geometry: { x: -84.388, y: 33.84 } }] }, d);
    expect(none.summary).not.toMatch(/block of|Peachtree/);
  });
});

describe('individual license types are excluded server-side', () => {
  const where = (id: string) => buildSocrataQuery(ds(id), new Date('2026-11-17T18:00:00Z')).get('$where')!;
  it('Chicago: peddlers, pop-ups, pharma reps and shared housing hosts', () => {
    const w = where('socrata-chicago-business');
    for (const t of ['Pop-Up Retail User', 'Peddler License', 'Pharmaceutical Representative', 'Shared Housing Unit Operator']) expect(w).toContain(`'${t}'`);
    expect(w).toContain("application_type = 'ISSUE'");
  });
  it('Orlando: professional, peddler and massage categories', () => {
    const w = where('socrata-orlando-business');
    expect(w).toMatch(/license_category NOT IN \('PROFES','PEDDLE','MASSEU'\)/);
  });
  it('SF and LA keep rows whose type is empty (a bare NOT IN would silently drop NULLs)', () => {
    expect(where('socrata-sf-business')).toContain('lic_code_description IS NULL OR');
    expect(where('socrata-la-business')).toContain('primary_naics_description IS NULL OR');
  });
});

// ---- The generic guard --------------------------------------------------------------------------------------------

const PERSON = 'Zyxwvut Q Personname';
/** Every column name a portal could use for a person, on top of whatever the config itself names. */
const NAME_KEYS = [
  'dba_name', 'doing_business_as_name', 'legal_name', 'business_name', 'ownership_name', 'business_owner_name', 'owner_name', 'property_owner',
  'applicant', 'applicant_name', 'requestor_', 'requestor_name', 'organization', 'event_name', 'contact_name', 'licensee', 'dba_trade_name',
  'inspector', 'inspector_name', 'complainant', 'permittee_s_business_name', 'owner', 'host_name', 'full_name', 'first_name', 'last_name',
  'restaurant_name', 'violation_inspector_comments', 'event_description', 'comments',
];

const SAFE_TEXT: Record<string, string> = {
  business: 'Retail Food Establishment',
  violation: 'Overgrown weeds, trash and debris at property',
  'event-permit': 'Street Festival',
  permit: 'Re-roof',
  '311': 'Rodent complaint',
  inspection: 'Restaurant',
};

function socrataGuardRow(d: SocrataDataset): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const safe = SAFE_TEXT[d.subtype];
  for (const f of [...d.titleFields, ...d.textFields, ...d.summaryFields, ...(d.addressFields ?? [])]) row[f] = safe;
  row[d.idField] = 'ID-1';
  for (const f of d.idFields ?? []) row[f] = 'ID-1';
  row[d.dateField] = '2026-11-12T10:00:00.000';
  if (d.endDateField) row[d.endDateField] = '2026-11-12T18:00:00.000';
  if (d.latField) row[d.latField] = '33.7491';
  if (d.lonField) row[d.lonField] = '-84.3902';
  if (d.locationField) row[d.locationField] = { latitude: '33.7491', longitude: '-84.3902' };
  if (d.latLonTextField) row[d.latLonTextField] = '(33.7491, -84.3902)';
  if (d.zipField) row[d.zipField] = '30303';
  // The person goes in every name-like column the config names AND every generic name column; where the config's own text field is
  // a name column it is overwritten with the person, so a config that reads it fails below.
  for (const k of NAME_KEYS) row[k] = PERSON;
  for (const f of Object.keys(row)) if (NAME_LIKE_COLUMN.test(f) && !NAME_COLUMN_OK.includes(f)) row[f] = PERSON;
  return row;
}

function arcgisGuardRow(d: ArcgisDataset) {
  const a: Record<string, unknown> = {};
  const safe = SAFE_TEXT[d.subtype];
  for (const f of [...d.titleFields, ...d.textFields, ...d.summaryFields, ...(d.addressFields ?? [])]) a[f] = safe;
  a[d.idField] = 'ID-1';
  a[d.dateField] = Date.parse('2026-11-12T10:00:00Z');
  if (d.latField) a[d.latField] = 33.7491;
  if (d.lonField) a[d.lonField] = -84.3902;
  for (const k of NAME_KEYS) a[k] = PERSON;
  for (const f of Object.keys(a)) if (NAME_LIKE_COLUMN.test(f) && !NAME_COLUMN_OK.includes(f)) a[f] = PERSON;
  return { features: [{ attributes: a, geometry: { x: -84.3902, y: 33.7491 } }] };
}

describe('generic guard: every business, violation and event-permit dataset', () => {
  const socrataRisk = SOCRATA_DATASETS.filter((d) => PERSON_RISK_SUBTYPES.includes(d.subtype));
  const arcgisRisk = ARCGIS_DATASETS.filter((d) => PERSON_RISK_SUBTYPES.includes(d.subtype));

  it('covers all of them (enabled and disabled)', () => {
    expect(socrataRisk.filter((d) => d.verified).length).toBeGreaterThanOrEqual(9);
    expect(arcgisRisk.length).toBeGreaterThanOrEqual(1); // arcgis-atlanta-business, disabled until its feed refreshes
  });

  for (const d of [...socrataRisk, ...arcgisRisk]) {
    it(`${d.id}: config reads no name-like column into title, summary, address or classifier text`, () => {
      const fields = [...d.titleFields, ...d.summaryFields, ...d.textFields, ...(d.addressFields ?? [])];
      for (const f of fields) {
        const bad = NAME_LIKE_COLUMN.test(f) && !NAME_COLUMN_OK.includes(f);
        expect(bad, `${d.id} reads name-like column "${f}"`).toBe(false);
      }
      if (d.subtype === 'business') expect(d.titleFields, `${d.id}: business titles are license type and place only`).toEqual([]);
      if (d.subtype === 'business') expect(d.addressFields ?? [], `${d.id}: no street address for business rows`).toEqual([]);
    });
  }

  for (const d of socrataRisk) {
    it(`${d.id}: a person in every name-like column never reaches a stored field`, () => {
      const items = parseSocrata([socrataGuardRow(d)], d);
      expect(items.length, `${d.id} parsed nothing from the guard row`).toBe(1);
      const hay = everyString(items).join('\n');
      expect(hay).not.toMatch(/zyxwvut|personname/i);
      expect(JSON.stringify(items)).not.toContain('Zyxwvut');
    });
  }

  for (const d of arcgisRisk) {
    it(`${d.id}: (arcgis) a person in every name-like column never reaches a stored field`, () => {
      const items = parseArcgis(arcgisGuardRow(d), d);
      expect(items.length, `${d.id} parsed nothing from the guard row`).toBe(1);
      expect(JSON.stringify(items)).not.toMatch(/zyxwvut|personname/i);
    });
  }

  it('the guard itself catches a leak: a config that reads dba_name into the title fails the row check', () => {
    const leaky: SocrataDataset = { ...ds('socrata-chicago-business'), titleFields: ['doing_business_as_name'] };
    const items = parseSocrata([socrataGuardRow(leaky)], leaky);
    expect(JSON.stringify(items)).toContain('Zyxwvut');
    expect(NAME_LIKE_COLUMN.test('doing_business_as_name')).toBe(true);
  });
});
