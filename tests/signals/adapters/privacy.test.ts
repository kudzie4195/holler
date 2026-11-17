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
import { parseSocrata, buildSocrataQuery } from '@/lib/signals/adapters/socrata';
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

  it('violation summaries keep the property address but never owner, inspector or comment text', () => {
    const items = parseSocrata(fx('socrata-chicago-violations-people.json'), ds('socrata-chicago-violations'));
    expect(items[0].summary).toContain('2318 W 47TH ST');
    expectNoNames(items, 'violations');
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
