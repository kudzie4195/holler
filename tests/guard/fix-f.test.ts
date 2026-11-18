/**
 * Round 5 FIX-F, public side hardening: review4 P2-4 (inspection externalId), P2-5 (block address), P2-6 (awarding agency).
 */
import { describe, expect, it } from 'vitest';
import { inspectionBlockAddress, parseSocrata } from '@/lib/signals/adapters/socrata';
import { parseArcgis } from '@/lib/signals/adapters/arcgis';
import { parseUsaSpending, publicAgency } from '@/lib/signals/adapters/usaspending';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import type { ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';

const chicago = SOCRATA_DATASETS.find((d) => d.id === 'socrata-chicago-inspections')!;
const row = (over: Record<string, string>) => ({
  inspection_id: '2612345', dba_name: 'X', facility_type: 'Restaurant', address: '5521 S KOMENSKY AVE', zip: '60629',
  inspection_date: '2026-11-10T00:00:00.000', inspection_type: 'Canvass', results: 'Fail', latitude: '41.79', longitude: '-87.72', ...over,
});

describe('P2-4: inspection externalId', () => {
  it('the date half is the parsed date, never raw text; a plain id is unchanged', () => {
    expect(parseSocrata([row({})], chicago)[0].externalId).toBe('2612345:2026-11-10');
    const odd = parseSocrata([row({ inspection_date: 'John Smith 11/01/2026' })], chicago);
    for (const s of odd) expect(s.externalId).not.toMatch(/john|smith/i);
  });
  it('an id that is not a plain id skips the row', () => {
    expect(parseSocrata([row({ inspection_id: 'MARIA LOPEZ 312-555-0199' })], chicago)).toEqual([]);
    expect(parseSocrata([row({ inspection_id: 'x'.repeat(65) })], chicago)).toEqual([]);
    expect(parseSocrata([row({ inspection_id: 'AB-12_3.4:5' })], chicago)).toHaveLength(1);
  });
  it('ArcGIS inspection layer: the same id rule', () => {
    const layer: ArcgisDataset = {
      id: 'arcgis-t-inspections', city: 'Testville', state: 'GA', tz: 'America/New_York', layerUrl: 'https://example.test/FeatureServer/0',
      kind: 'civic', subtype: 'inspection', idField: 'oid', dateField: 'd', dateType: 'date', titleFields: [], textFields: ['n'], summaryFields: [],
      cadenceMinutes: 720, verified: false, verifiedUrl: 'x', checkedOn: '2026-11-18', fieldSource: 'assumed',
    };
    const f = (oid: string) => ({ attributes: { oid, d: Date.UTC(2026, 10, 10), n: 'x' }, geometry: { x: -84.39, y: 33.75 } });
    expect(parseArcgis({ features: [f('MARIA LOPEZ')] }, layer)).toEqual([]);
    expect(parseArcgis({ features: [f('OID-7')] }, layer)[0].externalId).toBe('OID-7');
  });
});

describe('P2-5: inspectionBlockAddress', () => {
  it('the review reproductions give no address', () => {
    for (const a of ['5 JOHN SMITH OWNER HOME DAYCARE PL', '100 maria.lopez.gmail.com ST', '1 31 25 55 01 99 ST', '5521 S MARIA DE LOPEZ OWNER AVE'])
      expect(inspectionBlockAddress(a), a).toBe('');
  });
  it('up to three street words before the suffix (after a direction) still print', () => {
    expect(inspectionBlockAddress('5521 MARIA LOPEZ AVE')).toBe('5500 block of MARIA LOPEZ AVE'); // a street name, not refused (two words)
    expect(inspectionBlockAddress('100 S MARTIN LUTHER KING DR')).toBe('100 block of S MARTIN LUTHER KING DR');
    expect(inspectionBlockAddress('2318 W 47TH ST')).toBe('2300 block of W 47TH ST');
    expect(inspectionBlockAddress('42 N 1 31 ST')).toBe('');
  });
});

describe('P2-6: publicAgency', () => {
  it('no comma, no parenthesis, a public-body word', () => {
    for (const v of ['Department of Defense', 'General Services Administration', 'Department of Veterans Affairs', 'Army Corps of Engineers', 'Smithsonian Institution Office'])
      expect(publicAgency(v), v).toBe(v);
    for (const v of ['Smith, John A.', "Mary O'Brien (Contracting Officer)", 'John Smith', 'DOD 123', 'x']) expect(publicAgency(v), v).toBeNull();
  });
  it('an omitted agency drops the "by <agency>" part', () => {
    const [s] = parseUsaSpending({ results: [{ generated_internal_id: 'CONT_AWD_1', 'Award Amount': 84000, Description: 'x', NAICS: { code: '561730' },
      'Awarding Agency': 'Smith, John A.', 'Primary Place of Performance': { city_name: 'AUSTIN', state_code: 'TX', zip5: '78701' }, 'Last Modified Date': '2026-11-01' }] });
    expect(s.summary).toBe('NAICS 561730');
  });
});
