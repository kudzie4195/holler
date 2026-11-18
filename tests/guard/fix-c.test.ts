/**
 * Round 5 FIX-C public text guards, re-pinned by FIX-E: the USAspending description is never published (review2 P1-2 rows, review3 P0-3),
 * empty inspection names (P2-3), the block address (P2-4), and the review's P0-1 repros through the adapters. FIX-E: every inspection row
 * is generic and every USAspending title is "<trade label> (NAICS <code>)", so the old fallback helpers are gone.
 */
import { describe, expect, it } from 'vitest';
import { inspectionBlockAddress, parseSocrata, publicAddress } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import type { ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

const chicago = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-inspections')!;
const chiRow = (over: Record<string, string>) => ({
  inspection_id: '2799101', dba_name: 'ACME TACOS', facility_type: 'Restaurant', risk: 'Risk 1 (High)', address: '5521 S KOMENSKY AVE',
  city: 'CHICAGO', state: 'IL', zip: '60629', inspection_date: '2026-11-10T00:00:00.000', inspection_type: 'Canvass', results: 'Fail',
  violations: '38. INSECT, RODENT, ANIMAL OR ANY OTHER PEST PRESENCE', latitude: '41.792949', longitude: '-87.726751', ...over,
});
const chi = (over: Record<string, string>) => parseSocrata([chiRow(over)], chicago)[0];
const pub = (s: SignalInput) => `${s.title} | ${s.summary ?? ''} | ${JSON.stringify(s.data)}`.toLowerCase();

const award = (desc: string, recipient = 'GREEN ACRES LANDSCAPE INC') => parseUsaSpending({
  results: [{
    'Award ID': 'W1', generated_internal_id: 'CONT_AWD_1', 'Recipient Name': recipient, 'Award Amount': 84000, Description: desc,
    NAICS: { code: '561730', description: 'Landscaping' }, 'Awarding Agency': 'General Services Administration',
    'Primary Place of Performance': { city_name: 'AUSTIN', state_code: 'TX', zip5: '78701' }, 'Last Modified Date': '2026-11-01',
  }],
})[0];

describe('P1-2: no row of the review table reaches the title (FIX-E: the description is never printed)', () => {
  const TITLE = 'Federal contract ($84K) in Austin, TX: Landscaping (NAICS 561730)';
  const rows: [string, string][] = [
    ['JANITORIAL SERVICES POC JOHN SMITH', 'role or rank word'],
    ['JANITORIAL SERVICES FOR JOHN SMITH', 'given name'],
    ['JANITORIAL SERVICES (JOHN SMITH)', 'given name'],
    ['JANITORIAL SERVICES/JOHN SMITH', 'given name'],
    ['JANITORIAL SERVICES /JOHN SMITH', 'given name'],
    ['JANITORIAL SERVICES: JOHN SMITH', 'given name'],
    ['JANITORIAL SERVICES-JOHN SMITH', 'given name'],
    ['JANITORIAL SERVICES -JOHN SMITH', 'given name'],
    ['JANITORIAL SVCS - ZENDAYA OKONJO', 'person-shaped part'],
    ['JANITORIAL SVCS - RIVER BEACH', 'given name'],
    ['JANITORIAL SVCS - ADAM DRIVER', 'given name'],
    ['JANITORIAL SVCS - SMITH, JOHN A', 'given name'],
    ['SNOW REMOVAL FOR MRS JONES 12 OAK ST', 'street address'],
    ['ROOF REPAIR AT 4412 MAPLE AVE HOME OF SGT JOHN SMITH', 'street address'],
    ['PEST CONTROL TEL: 512/555/0100', 'phone'],
    ['PEST CONTROL (512) 555 \u2013 0100', 'phone'],
    ['PEST CONTROL 512_555_0100', 'phone'],
    ['PEST CONTROL +44 20 7946 0958', 'seven or more digits'],
    ['PEST CONTROL EMAIL JOHN.SMITH AT EXAMPLE.COM', 'email or link'],
  ];
  for (const [d, reason] of rows) {
    it(`${JSON.stringify(d)} -> label title (was: ${reason})`, () => {
      const s = award(d);
      expect(s.title).toBe(TITLE);
      expect(pub(s)).not.toMatch(/john|smith|zendaya|okonjo|river beach|adam|driver|jones|0100|0958|example/);
    });
  }
  it('each old trigger on its own', () => {
    const one: [string, string][] = [
      ['MOWING J SMITH', 'initial and a word'],
      ['MOWING J. SMITH', 'initial and a word'],
      ['MOWING FOR MR JONES', 'role or rank word'],
      ['MOWING ATTN BILLING', 'role or rank word'],
      ['MOWING C/O BILLING', 'role or rank word'],
      ['MOWING HOME OF THE BRAVE', 'role or rank word'],
      ['MOWING CPT JONES', 'role or rank word'],
      ['MOWING CALL 555-0100', 'phone'],
      ['MOWING CALL 555.0100', 'phone'],
      ['MOWING CONTRACT 1234567', 'seven or more digits'],
      ['MOWING JSMITH@AGENCY.GOV', 'email or link'],
      ['MOWING SEE AGENCY.GOV', 'email or link'],
      ['MOWING SEE WWW.AGENCY', 'email or link'],
      ['MOWING JSMITH AT AGENCY DOT GOV', 'email or link'],
      ['MOWING AT 12 OAK ST', 'street address'],
      ['MOWING - SMITH', 'person-shaped part'],
      ['MOWING - OKONJO ZELENSKYY', 'person-shaped part'],
    ];
    for (const [d] of one) expect(award(d).title, d).toBe(TITLE);
  });
  it('FIX-E: a description with nothing personal is not printed either', () => {
    for (const d of ['JANITORIAL SERVICES FOR FEDERAL BUILDING', 'GROUNDS MAINTENANCE - FORT HOOD', 'ROOF REPAIR, BLDG 12', 'IGF::OT::IGF CUSTODIAL',
      'PROVIDE A NEW ROOF', 'SNOW REMOVAL - PHASE TWO', 'GRASS CUTTING AND MOWING SERVICES']) {
      expect(award(d).title, d).toBe(TITLE);
    }
  });
});

describe('P2-3: an inspection row with an empty or whitespace name is generic (FIX-E: every row is)', () => {
  for (const name of ['', '   ']) {
    it(`Socrata: dba_name ${JSON.stringify(name)} with the person in the facility type`, () => {
      const s = chi({ dba_name: name, facility_type: 'Daycare (2 - 6 Years) - LOPEZ HOME' });
      expect(s.title).toBe('Failed inspection in Chicago: food establishment');
      expect(s.summary).toBe('Fail | Canvass | 5500 block of S KOMENSKY AVE'); // the facility type is not a listed value: dropped
      expect([s.lat, s.lon]).toEqual([41.793, -87.727]);
      expect(pub(s)).not.toMatch(/lopez|5521/);
      expect(s.contacts).toBeUndefined();
    });
  }
  it('ArcGIS: an empty name is hidden too', () => {
    const layer: ArcgisDataset = {
      id: 'arcgis-test-inspections', city: 'Testville', state: 'GA', tz: 'America/New_York', layerUrl: 'https://example.test/FeatureServer/0',
      kind: 'civic', subtype: 'inspection', idField: 'oid', dateField: 'insp_date', dateType: 'date', latField: 'lat', lonField: 'lon',
      titleFields: ['est_name'], textFields: ['est_name', 'findings'], summaryFields: ['findings', 'score'], addressFields: ['street'],
      nameField: 'est_name', zipField: 'zip', inspectionSummary: [{ field: 'score', kind: 'score' }], cadenceMinutes: 720, verified: false, verifiedUrl: 'https://example.test', checkedOn: '2026-11-18',
      fieldSource: 'assumed',
    };
    const [s] = parseArcgis({ features: [{ attributes: { oid: '1', est_name: ' ', findings: 'Rodent droppings at LOPEZ HOME', score: 55, street: '5521 S KOMENSKY AVE 2B', zip: '30303', insp_date: Date.UTC(2026, 10, 10), lat: 33.7512345, lon: -84.3912345 } }] }, layer);
    expect(s.title).toBe('Failed inspection in Testville: food establishment');
    expect(s.summary).toBe('55 | 5500 block of S KOMENSKY AVE');
    expect([s.lat, s.lon]).toEqual([33.751, -84.391]);
  });
});

describe('P2-4: the block address is cut at the street suffix (FIX-E: no suffix, no address)', () => {
  it('inspectionBlockAddress', () => {
    expect(inspectionBlockAddress('5521 S KOMENSKY AVE 2B')).toBe('5500 block of S KOMENSKY AVE');
    expect(inspectionBlockAddress('5521 S KOMENSKY AVE 1ST FLR REAR')).toBe('5500 block of S KOMENSKY AVE');
    expect(inspectionBlockAddress('5521 S KOMENSKY AVE APT 2')).toBe('5500 block of S KOMENSKY AVE');
    expect(inspectionBlockAddress('4012 MAIN ST Queens')).toBe('4000 block of MAIN ST');
    expect(inspectionBlockAddress('2318 W 47TH ST BSMT')).toBe('2300 block of W 47TH ST');
    expect(inspectionBlockAddress('4812 AVENUE H')).toBe(''); // type-first street: no street word before the suffix
    expect(inspectionBlockAddress('123 BROADWAY 2B REAR')).toBe(''); // no suffix word
    expect(inspectionBlockAddress('LOT 5 MAIN ST')).toBe('');
    expect(inspectionBlockAddress('')).toBe('');
  });
  it('through the adapter; violation rows keep their own rule (not part of this finding)', () => {
    expect(chi({ dba_name: 'MARIA LOPEZ', address: '5521 S KOMENSKY AVE 2B' }).summary).toBe('Restaurant | Fail | Canvass | 5500 block of S KOMENSKY AVE');
    expect(chi({ dba_name: 'ACME TACOS', address: '5521 S KOMENSKY AVE 1ST FLR REAR' }).summary).toBe('Restaurant | Fail | Canvass | 5500 block of S KOMENSKY AVE');
    expect(publicAddress('violation', '5521 S KOMENSKY AVE 2B')).toBe('5500 block of S KOMENSKY AVE 2B');
  });
});

describe('P0-1 repros through the adapters', () => {
  for (const name of ['MARIA LOPEZ @ SUNNY DAYCARE', 'MARIA LOPEZ 5521 CENTER ST', 'MARIA LOPEZ & SUNNY DAYCARE LLC', 'MARIA LOPEZ HOME DAYCARE', 'BRENT KOWALSKI APEX ROOFING LLC']) {
    it(`Chicago inspection ${JSON.stringify(name)}: generic title, block address, rounded position, no contact`, () => {
      const s = chi({ dba_name: name });
      expect(s.title).toBe('Failed inspection in Chicago: food establishment');
      expect(s.summary).toContain('5500 block of S KOMENSKY AVE');
      expect([s.lat, s.lon]).toEqual([41.793, -87.727]);
      expect(pub(s)).not.toMatch(/maria|lopez|kowalski|brent|5521/);
      expect(s.contacts).toBeUndefined();
    });
  }
  it('USAspending recipient: never printed; a person in front of a company is never stored', () => {
    const a = award('GROUNDS MAINTENANCE', 'JOHN SMITH @ APEX CLEANING LLC');
    expect(a.summary).toBe('by General Services Administration, NAICS 561730');
    expect(a.contacts?.map((c) => c.name)).toEqual(['APEX CLEANING LLC']);
    const b = award('GROUNDS MAINTENANCE', 'JOHN SMITH 123 CENTER ST');
    expect(b.summary).toBe('by General Services Administration, NAICS 561730');
    expect(b.contacts).toBeUndefined();
    for (const s of [a, b]) expect(JSON.stringify(s)).not.toMatch(/john|smith|center st/i);
    expect(JSON.stringify({ ...a, contacts: undefined })).not.toMatch(/apex/i);
  });
});
