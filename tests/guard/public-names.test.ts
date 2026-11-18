/**
 * Public text guard. holler_signals is public. Round 5 FIX-E: the public side no longer depends on any name classifier. EVERY inspection
 * row has the generic title "Failed inspection in <city>: food establishment", a summary built only from fixed-vocabulary categorical
 * values plus a block-level address, coordinates at 3 decimals and a 5-digit zip; no USAspending row prints the recipient or the free-text
 * description. The organization-named rows that used to show their name now read exactly like the person-named ones.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspectionBlockAddress, inspectionSummaryValue, parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { awardLabel, parseUsaSpending, publicAgency } from '@/lib/signals/adapters/usaspending';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import type { ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import type { SignalInput } from '@/lib/signals/types';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, '../contacts/fixtures', n), 'utf8'));
const ds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;

/** Every string in the public fields of a SignalInput (title, summary, url, data, recursively). Contacts are private and not walked. */
function publicStrings(s: SignalInput): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); walk(x); }
  };
  walk([s.title, s.summary, s.url, s.data, s.city, s.state, s.zip]);
  return out;
}
const hay = (s: SignalInput) => publicStrings(s).join(' | ').toLowerCase();
function expectNone(s: SignalInput, needles: string[]) {
  const h = hay(s);
  for (const n of needles) expect(h.includes(n.toLowerCase()), `"${n}" found in ${h}`).toBe(false);
}

describe('Socrata inspections: every row is generic, whatever the name column says', () => {
  const items = parseSocrata(fx('socrata-chicago-inspections-contacts.json'), ds('socrata-chicago-inspections'));
  const joes = items.find((i) => i.externalId.startsWith('2700001'))!;
  const org = items.find((i) => i.externalId.startsWith('2700003'))!;
  const person = items.find((i) => i.externalId.startsWith('2700002'))!;

  it('a person-named row: generic words, no name or street address anywhere public', () => {
    expect(person.title).toBe('Failed inspection in Chicago: food establishment');
    expectNone(person, ['MARIA', 'LOPEZ', '5521', '5521 S KOMENSKY AVE']);
    expect(person.summary).toContain('5500 block of S KOMENSKY AVE');
  });
  it('FIX-E: an organisation-named row is generic too (its name is private: contacts only)', () => {
    expect(org.title).toBe('Failed inspection in Chicago: food establishment');
    expect(org.summary).toBe('Restaurant | Fail | Canvass | 1500 block of N HALSTED ST');
    expectNone(org, ['HALSTED STREET PIZZERIA', 'PIZZERIA']);
  });
  it('"JOES TACO SHACK": generic', () => {
    expect(joes.title).toBe('Failed inspection in Chicago: food establishment');
    expectNone(joes, ['JOES', 'TACO', '4000 W MADISON']);
  });
  it('a name repeated in a free-text summary column never reaches the summary (the column is not read)', () => {
    const d = ds('socrata-nyc-inspections');
    const row = {
      camis: '50099999', dba: 'MARIA LOPEZ', cuisine_description: 'Other', boro: 'Queens', building: '4012', street: 'MAIN ST', zipcode: '11354',
      inspection_date: '2026-11-09T00:00:00.000', score: '41', grade: 'C', critical_flag: 'Critical',
      violation_description: 'Evidence of mice at the home of Maria Lopez, 4012 Main St Queens', latitude: '40.759', longitude: '-73.83',
    };
    const out = parseSocrata([row], d);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Failed inspection in New York City: food establishment');
    expectNone(out[0], ['MARIA', 'LOPEZ', '4012', '4012 MAIN', 'mice', 'Queens']);
    expect(out[0].summary).toBe('41 | C | 4000 block of MAIN ST');
  });
  it('Austin: every row reads the same, a person name or a restaurant name', () => {
    const d = ds('socrata-austin-inspections');
    const base = { restaurant_name: '', address: '2101 S Lamar Blvd', zip_code: '78704', inspection_date: '2026-10-30T00:00:00.000', process_description: 'Routine Inspection', score: '62', lat: '30.245', lng: '-97.769' };
    for (const [id, name] of [['a1', 'Tamika Johnson'], ['a2', 'Riverside Taqueria'], ['a3', 'Barton Creek Grill']]) {
      const [p] = parseSocrata([{ ...base, inspectionid: id, restaurant_name: name }], d);
      expect(p.title).toBe('Failed inspection in Austin: food establishment');
      expect(p.summary).toBe('Routine Inspection | 62 | 2100 block of S Lamar Blvd');
      expectNone(p, [name, '2101']);
    }
  });
});

describe('ArcGIS inspections (generic support; no live layer is configured)', () => {
  const layer: ArcgisDataset = {
    id: 'arcgis-test-inspections', city: 'Testville', state: 'GA', tz: 'America/New_York', layerUrl: 'https://example.test/FeatureServer/0',
    kind: 'civic', subtype: 'inspection', idField: 'oid', dateField: 'insp_date', dateType: 'date', latField: 'lat', lonField: 'lon',
    titleFields: ['est_name'], textFields: ['est_name', 'findings'], summaryFields: ['findings', 'score'], addressFields: ['street'],
    nameField: 'est_name', zipField: 'zip', inspectionSummary: [{ field: 'score', kind: 'score' }], cadenceMinutes: 720, verified: false,
    verifiedUrl: 'https://example.test', checkedOn: '2026-11-18', fieldSource: 'assumed',
  };
  const feat = (oid: string, name: string, findings: string) => ({
    attributes: { oid, est_name: name, findings, score: 55, street: '5521 S KOMENSKY AVE', zip: '30303', insp_date: Date.UTC(2026, 10, 10), lat: 33.7512345, lon: -84.3912345 },
  });
  const run = (f: ReturnType<typeof feat>) => parseArcgis({ features: [f] }, layer)[0];

  for (const name of ['MARIA LOPEZ', 'Peachtree Pizzeria', 'TACOS EL GUERO (MARIA LOPEZ)', 'ACME TACOS LLC DBA MARIA LOPEZ', '']) {
    it(`${JSON.stringify(name)}: generic title, score and block address only, 3-decimal position`, () => {
      const s = run(feat('1', name, 'Rodent droppings; Maria Lopez 5521 S KOMENSKY AVE'));
      expect(s.title).toBe('Failed inspection in Testville: food establishment');
      expect(s.summary).toBe('55 | 5500 block of S KOMENSKY AVE');
      expect([s.lat, s.lon]).toEqual([33.751, -84.391]);
      expectNone(s, ['MARIA', 'LOPEZ', '5521', 'Rodent', 'Peachtree', 'TACOS']);
    });
  }
});

// ---- Socrata, Chicago: the review shapes, now generic by construction ----

const chicago = ds('socrata-chicago-inspections');
const chiRow = (over: Record<string, string>) => ({
  inspection_id: '2799001', dba_name: 'ACME TACOS', facility_type: 'Restaurant', risk: 'Risk 1 (High)', address: '5521 S KOMENSKY AVE',
  city: 'CHICAGO', state: 'IL', zip: '60629', inspection_date: '2026-11-10T00:00:00.000', inspection_type: 'Canvass', results: 'Fail',
  violations: '38. INSECT, RODENT, ANIMAL OR ANY OTHER PEST PRESENCE', latitude: '41.792345678', longitude: '-87.723456789', ...over,
});
const chi = (over: Record<string, string>) => parseSocrata([chiRow(over)], chicago)[0];

describe('FIX-E: the public title never prints a name, cleaned or not', () => {
  const names = [
    'MARIA LOPEZ DBA LOPEZ FAMILY DAYCARE', 'LITTLE STARS DAYCARE (MARIA LOPEZ)', 'MARIA LOPEZ D/B/A TACOS EL GUERO', 'ACME TACOS LLC DBA MARIA LOPEZ',
    'HALSTED STREET PIZZERIA', 'CAROLINA LOPEZ DAYCARE', 'CANDY LOPEZ', 'JULIA LOPEZ LLC', 'DANNY SMITH LLC', '', '   ',
  ];
  for (const raw of names) {
    it(`Socrata ${JSON.stringify(raw)}: generic title, fixed summary, 3-decimal position`, () => {
      const s = chi({ dba_name: raw, facility_type: 'Daycare at the home of Maria' });
      expect(s.title).toBe('Failed inspection in Chicago: food establishment');
      expect(s.summary).toBe('Fail | Canvass | 5500 block of S KOMENSKY AVE');
      expect([s.lat, s.lon]).toEqual([41.792, -87.723]);
      expectNone(s, ['MARIA', 'LOPEZ', 'CAROLINA', 'CANDY', 'JULIA', 'DANNY', 'SMITH', 'PIZZERIA', 'home of', '5521']);
    });
  }
});

describe('review3 P2-4: categorical columns are matched against a fixed value list; zip is 5 digits', () => {
  it('an inspection type holding a person is dropped (not in the list)', () => {
    const s = chi({ dba_name: '', inspection_type: 'Complaint MARIA LOPEZ' });
    expect(s.summary).toBe('Restaurant | Fail | 5500 block of S KOMENSKY AVE');
  });
  it('"Fail; reinspect at M. Lopes home" in results is not a listed value (and is not a failure either)', () => {
    expect(inspectionSummaryValue({ field: 'results', kind: 'list', values: ['Fail'] }, 'Fail; reinspect at M. Lopes home')).toBeNull();
  });
  it('a known value prints in the list spelling', () => {
    expect(inspectionSummaryValue({ field: 'inspection_type', kind: 'list', values: ['Canvass Re-Inspection'] }, '  canvass   re-inspection ')).toBe('Canvass Re-Inspection');
  });
  it('score: 1 to 3 digits; grade: one letter', () => {
    expect(inspectionSummaryValue({ field: 'score', kind: 'score' }, '41')).toBe('41');
    expect(inspectionSummaryValue({ field: 'score', kind: 'score' }, '1000')).toBeNull();
    expect(inspectionSummaryValue({ field: 'score', kind: 'score' }, '41 LOPEZ')).toBeNull();
    expect(inspectionSummaryValue({ field: 'grade', kind: 'grade' }, 'c')).toBe('C');
    expect(inspectionSummaryValue({ field: 'grade', kind: 'grade' }, 'LOPEZ')).toBeNull();
  });
  it('an address with no street suffix gives no address at all', () => {
    const s = chi({ dba_name: '', address: '5521 S KOMENSKY MARIA LOPEZ' });
    expect(s.summary).toBe('Restaurant | Fail | Canvass');
    expect(inspectionBlockAddress('5521 S KOMENSKY MARIA LOPEZ')).toBe('');
  });
  it('words after the street suffix are cut; a house number ending in 00 still prints as "<n> block of" (accepted, not fixed)', () => {
    expect(inspectionBlockAddress('5521 S KOMENSKY AVE MARIA LOPEZ')).toBe('5500 block of S KOMENSKY AVE');
    expect(inspectionBlockAddress('900 CONGRESS AVE')).toBe('900 block of CONGRESS AVE');
    expect(inspectionBlockAddress('42 W 47TH ST APT 4')).toBe('0-99 block of W 47TH ST');
    expect(inspectionBlockAddress('JOHN SMITH 900 CONGRESS AVE')).toBe('');
  });
  it('zip "LOPEZ M" and "60629-1234" give null; "60629" stays', () => {
    expect(chi({ zip: 'LOPEZ M' }).zip).toBeNull();
    expect(chi({ zip: '60629-1234' }).zip).toBeNull();
    expect(chi({ zip: '60629' }).zip).toBe('60629');
  });
  it('the configured categorical columns of every inspection dataset', () => {
    const kept = SOCRATA_DATASETS.filter((d) => d.subtype === 'inspection').map((d) => [d.id, (d.inspectionSummary ?? []).map((f) => `${f.field}:${f.kind}`)]);
    expect(Object.fromEntries(kept)).toEqual({
      'socrata-chicago-inspections': ['facility_type:list', 'results:list', 'inspection_type:list'],
      'socrata-nyc-inspections': ['score:score', 'grade:grade'],
      'socrata-sf-inspections': ['inspection_score:score'],
      'socrata-austin-inspections': ['process_description:list', 'score:score'],
    });
  });
});

describe('USAspending: no recipient, no description (review3 P0-3, P2-7)', () => {
  const award = (recipient: string, desc = 'GROUNDS MAINTENANCE', over: Record<string, unknown> = {}) => parseUsaSpending({
    results: [{
      'Award ID': 'W1', generated_internal_id: 'CONT_AWD_1', 'Recipient Name': recipient, 'Award Amount': 84000, Description: desc,
      NAICS: { code: '561730', description: 'Landscaping' }, 'Awarding Agency': 'General Services Administration',
      'Primary Place of Performance': { city_name: 'AUSTIN', state_code: 'TX', zip5: '78701' }, 'Last Modified Date': '2026-11-01', ...over,
    }],
  })[0];
  it('a person recipient and a company recipient give the same summary', () => {
    for (const r of ['SMITH, JOHN A', 'GREEN ACRES LANDSCAPE INC', 'DANNY SMITH LLC', 'CANDY SMITH', 'JOHN SMITH DBA SMITH CLEANING']) {
      const s = award(r);
      expect(s.summary).toBe('by General Services Administration, NAICS 561730');
      expect(JSON.stringify({ ...s, contacts: undefined })).not.toMatch(/Awarded to|smith|john|danny|candy|green acres/i);
    }
  });
  it('the description never reaches the title: the trade label and NAICS code do', () => {
    for (const d of ['LAWN SERVICE DANNY KOWALSKI', 'RAMP INSTALL FOR VETERAN BETH OKONJO', 'JANITORIAL SERVICES - JOHN SMITH 512-555-0100', 'GROUNDS MAINTENANCE', '']) {
      const s = award('GREEN ACRES LANDSCAPE INC', d);
      expect(s.title).toBe('Federal contract ($84K) in Austin, TX: Landscaping (NAICS 561730)');
    }
  });
  it('label without category, and neither', () => {
    expect(awardLabel([], '999999')).toBe('NAICS 999999');
    expect(awardLabel([], '')).toBe('federal award');
    expect(awardLabel(['roofing'], '')).toBe('Roofing');
  });
  it('awarding agency only when it is plain words with no digit; place city only from the city list; zip 5 digits', () => {
    expect(publicAgency('Department of Defense')).toBe('Department of Defense');
    expect(publicAgency('DOD 123')).toBeNull();
    expect(publicAgency('x')).toBeNull();
    expect(award('ACME', 'X', { 'Awarding Agency': 'Agency 7 John' }).summary).toBe('NAICS 561730');
    const odd = award('ACME', 'X', { 'Primary Place of Performance': { city_name: 'JOHN SMITH', state_code: 'TX', zip5: 'LOPEZ' } });
    expect(odd.city).toBeNull();
    expect(odd.zip).toBeNull();
    expect(odd.title).toBe('Federal contract ($84K) in TX: Landscaping (NAICS 561730)');
  });
});
