/**
 * Round 33: new-business licences are tagged by their own type, and rows outside the source's area are not placed in its city.
 * Switch HOLLER_BUSINESS_TAG_FIX_ENABLED (off by default). Rows are hand written in the live column shapes of
 * tests/fixtures/socrata-*-business.json; the LA values (NAICS descriptions, the Gilroy 95020 row, the lat = lon rows) are copied from
 * stored rows read on 2026-11-25.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSocrataReport, categorize, outsideAreaGuard } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { businessTagFixEnabled, businessTradesForType, retagStoredBusinessRow } from '@/lib/signals/mapping/business';

const ds = (id: string): SocrataDataset => SOCRATA_DATASETS.find((d) => d.id === id)!;
const LA = ds('socrata-la-business');
const BLANKET = ['signs-printing', 'business-services', 'insurance', 'janitorial-commercial', 'security', 'locksmith'];
const NEVER = ['locksmith', 'insurance', 'business-services', 'cleaning', 'hvac'];

let n = 0;
const laRow = (naics: string, over: Record<string, unknown> = {}) => ({
  location_account: `000${(n += 1)}-0001-0`,
  primary_naics_description: naics,
  location_start_date: '2026-11-10T00:00:00.000',
  zip_code: '90028',
  location_1: { latitude: '34.0983', longitude: '-118.3200' },
  ...over,
});
const run = (rows: unknown[], d: SocrataDataset, on: boolean) => parseSocrataReport(rows, d, { businessTagFix: on });
const tags = (rows: unknown[], d: SocrataDataset, on: boolean) => run(rows, d, on).items.map((i) => [...i.categories].sort());

afterEach(() => vi.unstubAllEnvs());

describe('switch', () => {
  it('is off unless 1, true, on or yes', () => {
    expect(businessTagFixEnabled(undefined)).toBe(false);
    expect(businessTagFixEnabled('')).toBe(false);
    expect(businessTagFixEnabled('0')).toBe(false);
    expect(businessTagFixEnabled('1')).toBe(true);
    expect(businessTagFixEnabled(' TRUE ')).toBe(true);
  });
  it('defaults to the environment at call time', () => {
    const rows = [laRow('Full-service restaurants', { zip_code: '95020', location_1: { latitude: '37.04', longitude: '-121.57' } })];
    expect(parseSocrataReport(rows, LA).items).toHaveLength(1);
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    expect(parseSocrataReport(rows, LA).items).toHaveLength(0);
  });
});

describe('switch off: nothing changes', () => {
  it('keeps the blanket set on every LA row, and the Gilroy row in Los Angeles', () => {
    const rows = [
      laRow('Roofing Contractors'),
      laRow('Landscaping services', { zip_code: '95020', location_1: { latitude: '37.04', longitude: '-121.57' } }),
      laRow('Full-service restaurants'),
    ];
    const t = tags(rows, LA, false);
    expect(t).toHaveLength(3);
    for (const c of t) for (const b of BLANKET) expect(c).toContain(b);
    expect(t[2]).toEqual(expect.arrayContaining(['pest-control', 'hvac']));
  });
});

describe('Los Angeles, switch on', () => {
  it('a licence whose type names no premises gets no trade and is not stored', () => {
    const rows = [
      laRow('Roofing Contractors'),
      laRow('Plumbing, Heating, and Air-Conditioning Contractors (1997 NAICS)'),
      laRow('Single Family Housing Construction (1997 NAICS)'),
      laRow('Engineering services'),
      laRow('General freight trucking, local'),
      laRow('Other consumer goods rental'),
    ];
    expect(run(rows, LA, true).items).toHaveLength(0);
  });

  it('no row carries a blanket trade', () => {
    const rows = [laRow('Full-service restaurants'), laRow('Clothing stores'), laRow('Parking lots & garages'), laRow('Roofing Contractors')];
    for (const c of tags(rows, LA, true)) for (const x of NEVER) expect(c).not.toContain(x);
  });

  it('a restaurant, a store and a parking garage get the storefront trades the label engine alerts on', () => {
    const t = tags([laRow('Full-service restaurants'), laRow('Clothing stores'), laRow('Parking lots & garages')], LA, true);
    expect(t[0]).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
    expect(t[1]).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
    expect(t[2]).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
  });

  it('a mobile food licence has no building: no trade', () => {
    expect(run([laRow('Mobile Food Services')], LA, true).items).toHaveLength(0);
    expect(businessTradesForType('socrata-la-business', 'Mobile Food Services')).toEqual([]);
  });

  it('the Gilroy ZIP (95020) and its coordinates are not placed in Los Angeles', () => {
    const gilroy = laRow('Full-service restaurants', { zip_code: '95020', location_1: { latitude: '37.04', longitude: '-121.57' } });
    expect(run([gilroy], LA, true).items).toHaveLength(0);
    expect(run([gilroy], LA, true).keptOut).toBe(1);
  });

  it('drops the other out-of-area shapes seen in stored rows', () => {
    const rows = [
      laRow('Full-service restaurants', { zip_code: '20036', location_1: { latitude: '38.9', longitude: '-77.04' } }), // Washington DC
      laRow('Full-service restaurants', { zip_code: '92614', location_1: { latitude: '33.69', longitude: '33.69' } }), // lat = lon, bad point
      laRow('Full-service restaurants', { zip_code: '92110', location_1: undefined }), // San Diego ZIP, no point
      laRow('Full-service restaurants', { zip_code: '89115', location_1: undefined }), // Nevada ZIP, no point
      laRow('Full-service restaurants', { zip_code: '90028', location_1: { latitude: '37.04', longitude: '-121.57' } }), // LA ZIP, Gilroy point
    ];
    expect(run(rows, LA, true).items).toHaveLength(0);
  });

  it('keeps an LA row with an LA ZIP and point, and one with only an LA ZIP', () => {
    const rows = [laRow('Full-service restaurants'), laRow('Clothing stores', { location_1: undefined, zip_code: '91401' })];
    expect(run(rows, LA, true).items).toHaveLength(2);
  });

  it('outsideAreaGuard is a no-op for a dataset without areaGuard', () => {
    expect(outsideAreaGuard({ zip_code: '95020' }, ds('socrata-sf-business'))).toBe(false);
  });

  it('the shipped fixture rows still parse (a pizza shop keeps its alert trades)', () => {
    const fx = JSON.parse(readFileSync(join(__dirname, '../fixtures/socrata-la-business.json'), 'utf8'));
    const on = run(fx, LA, true).items;
    expect(on).toHaveLength(1);
    expect(on[0].title).toMatch(/Full-service restaurants/);
    expect([...on[0].categories].sort()).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
    expect(run(fx, LA, false).items).toHaveLength(2);
  });
});

describe('the other four Socrata business feeds carry the same blanket today and get the same fix', () => {
  const nyc = ds('socrata-nyc-business');
  const nycRow = (cat: string, over: Record<string, unknown> = {}) => ({
    license_nbr: `${(n += 1)}-DCA`, business_category: cat, license_type: 'Business', license_status: 'Active',
    license_creation_date: '2026-10-28T00:00:00.000', address_zip: '11226', latitude: '40.6410', longitude: '-73.9570', ...over,
  });
  it('NYC: off keeps the blanket, on tags a pawnbroker and drops a locksmith or an Electronics row', () => {
    const rows = [nycRow('Pawnbroker'), nycRow('Locksmith'), nycRow('Electronics')];
    for (const c of tags(rows, nyc, false)) for (const b of BLANKET) expect(c).toContain(b);
    const on = run(rows, nyc, true).items;
    expect(on).toHaveLength(1);
    expect([...on[0].categories].sort()).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
  });
  it('NYC: a licence with an out-of-state address is not placed in New York', () => {
    const away = nycRow('Pawnbroker', { address_zip: '07102', latitude: '40.7357', longitude: '-74.1724' }); // Newark, 9 mi: inside 30 mi, in NJ by ZIP
    const far = nycRow('Pawnbroker', { address_zip: '90028', latitude: '34.0983', longitude: '-118.32' });
    expect(run([far], nyc, true).items).toHaveLength(0);
    expect(run([away], nyc, true).items).toHaveLength(0);
  });
  it('Chicago: a food establishment gets pest-control, a limited licence gets nothing', () => {
    const chi = ds('socrata-chicago-business');
    const base = { id: 'a-1', zip_code: '60622', application_type: 'ISSUE', date_issued: '2026-11-12T00:00:00.000', license_start_date: '2026-11-12T00:00:00.000', latitude: '41.9033', longitude: '-87.6741' };
    const rows = [{ ...base, id: 'a-1', license_description: 'Retail Food Establishment', business_activity: 'Retail sales of prepared food' }, { ...base, id: 'a-2', license_description: 'Limited Business License', business_activity: 'Consulting' }];
    for (const c of tags(rows, chi, false)) for (const b of BLANKET) expect(c).toContain(b);
    const on = run(rows, chi, true).items;
    expect(on).toHaveLength(1);
    expect([...on[0].categories].sort()).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
  });
  it('SF and Orlando carry the fix too', () => {
    const sf = ds('socrata-sf-business');
    const r = { uniqueid: 's-1', lic_code_description: 'Retail', lic_code_descriptions_list: 'Retail', business_zip: '94110', location_start_date: '2026-11-02T00:00:00.000', location: { type: 'Point', coordinates: ['-122.4194', '37.7599'] } };
    for (const c of tags([r], sf, false)) for (const b of BLANKET) expect(c).toContain(b);
    expect(tags([r], sf, true)[0]).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
    const orl = ds('socrata-orlando-business');
    const o = { case_number: 'o-1', license_type: 'Contractor', license_category: 'GENERAL', business_open_date: '2026-11-03T00:00:00.000' };
    expect(run([o], orl, false).items).toHaveLength(1);
    expect(run([o], orl, true).items).toHaveLength(0);
  });
});

describe('sources without a licence-type list are unchanged', () => {
  it('categorize keeps the blanket for a feed with no list, with the switch on', () => {
    const c = categorize({ subtype: 'business', id: 'socrata-unlisted-business' }, 'Anything', { businessTagFix: true });
    for (const b of BLANKET) expect(c.categories).toContain(b);
  });
});

describe('re-tag of a stored row (owner SQL and replay)', () => {
  it('removes the blanket, never adds a trade, and clears an out-of-area point', () => {
    const old = [...BLANKET, 'cleaning'];
    const row = (title: string, lat: number | null, lon: number | null, categories: string[] = old) => ({ source: 'socrata-la-business', title, lat, lon, categories });
    expect(retagStoredBusinessRow(row('New business license in Los Angeles: Clothing stores', 34.09, -118.32))).toEqual(['signs-printing', 'janitorial-commercial', 'security']);
    expect(retagStoredBusinessRow(row('New business license in Los Angeles: Roofing Contractors', 34.09, -118.32))).toEqual([]);
    expect(retagStoredBusinessRow(row('New business license in Los Angeles: Clothing stores', 37.04, -121.57))).toEqual([]);
    expect(retagStoredBusinessRow(row('New business license in Los Angeles: Full-service restaurants', 34.09, -118.32))).not.toContain('pest-control');
    expect(retagStoredBusinessRow({ source: 'carto-phl-business', title: 'x: y', categories: old })).toEqual(old);
  });
});
