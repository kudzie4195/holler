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
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { OpportunityChip } from '@/components/feed/opportunity-chip';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { alertHoldFor, shownHold } from '@/lib/signals/alert-gate';
import { storefrontKindOfName } from '@/lib/signals/lead-rules';
import { businessTagFixEnabled, businessTradesForType, naicsTypePhrase, retagStoredBusinessRow } from '@/lib/signals/mapping/business';

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
  it('SF and Orlando carry the fix too (Orlando contractor not stored)', () => {
    const orl = ds('socrata-orlando-business');
    const o = { case_number: 'o-1', license_type: 'Contractor', license_category: 'GENERAL', business_open_date: '2026-11-03T00:00:00.000' };
    expect(run([o], orl, false).items).toHaveLength(1);
    expect(run([o], orl, true).items).toHaveLength(0);
    const o2 = { case_number: 'o-2', license_type: 'RETAIL AUTO PARTS', license_category: 'RETAIL', business_open_date: '2026-11-03T00:00:00.000' };
    expect(run([o2], orl, true).items).toHaveLength(1);
  });
});

/** Review P1-1: live San Francisco rows carry only a NAICS code (tests/fixtures/socrata-sf-business-live-2026-11-16.json: 17 of 17). */
describe('San Francisco, live shape (NAICS code only, no type text)', () => {
  const sf = ds('socrata-sf-business');
  const live = (naics: string | undefined, id: string) => ({
    uniqueid: id,
    location_start_date: '2026-11-16T00:00:00.000',
    ...(naics ? { self_reported_naics_code: naics } : {}),
    business_zip: '94110',
    location: { type: 'Point', coordinates: [-122.4194, 37.7599] },
  });
  it('the real capture has no description column on any row', () => {
    const fx = JSON.parse(readFileSync(join(__dirname, '../fixtures/socrata-sf-business-live-2026-11-16.json'), 'utf8')) as Record<string, unknown>[];
    expect(fx.every((r) => !r.lic_code_description && !r.lic_code_descriptions_list)).toBe(true);
    expect(run(fx, sf, false).items.length).toBeGreaterThan(0);
    // none of its NAICS codes (518210, 812111, 811420) is a storefront: nothing stored with the switch on
    expect(run(fx, sf, true).items).toHaveLength(0);
  });
  it('retail and restaurant NAICS codes are tagged from the code; lodging, nonstore and others are not stored', () => {
    const rows = [
      live('448140', 'a'), live('445110', 'b'), live('4400-4599', 'c'), // retail
      live('722511', 'd'), live('7220-7229', 'e'), // food service
      live('721110', 'f'), // hotel
      live('454110', 'g'), // nonstore retail
      live('541511', 'h'), live(undefined, 'i'), // services, no code
    ];
    const on = run(rows, sf, true).items;
    const by = new Map(on.map((i) => [i.externalId, [...i.categories].sort()]));
    for (const id of ['a', 'b', 'c']) expect(by.get(id)).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
    for (const id of ['d', 'e']) expect(by.get(id)).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
    for (const id of ['f', 'g', 'h', 'i']) expect(by.has(id)).toBe(false);
    expect(run(rows, sf, false).items).toHaveLength(8); // the row with no code has no text: never stored
  });
  it('no premises: caterers, food service contractors and mobile food (7223), vending machine operators (445132) and fuel dealers (4572) get no trade', () => {
    const rows = [live('722330', 'm'), live('722320', 'n'), live('722310', 'o'), live('445132', 'p'), live('457210', 'q'), live('4572', 'r'), live('722410', 's'), live('445110', 't')];
    const by = new Map(run(rows, sf, true).items.map((i) => [i.externalId, [...i.categories].sort()]));
    for (const id of ['m', 'n', 'o', 'p', 'q', 'r']) expect(by.has(id), id).toBe(false);
    // a bar (722410) and a grocery (445110) are premises
    expect(by.get('s')).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
    expect(by.get('t')).toEqual(['janitorial-commercial', 'security', 'signs-printing']);
    expect(naicsTypePhrase('722330')).not.toBe('Food service and lodging');
    expect(businessTradesForType('socrata-sf-business', naicsTypePhrase('445132') ?? '')).toEqual([]);
  });
  it('a row with restaurant licence text is food too', () => {
    const r = { ...live('722511', 'j'), lic_code_description: 'RESTAURANT LESS THAN 1,000 SQFT', lic_code_descriptions_list: 'RESTAURANT LESS THAN 1,000 SQFT' };
    expect(tags([r], sf, true)[0]).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
  });
  it('naicsTypePhrase', () => {
    expect(naicsTypePhrase('448140')).toBe('Retail');
    expect(naicsTypePhrase('722511')).toBe('Food service and lodging');
    expect(naicsTypePhrase('721110')).toBe('Accommodation');
    expect(naicsTypePhrase('Retail')).toBeNull();
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
    // a broken longitude is decided by the ZIP (review P1-2): kept with an LA ZIP, cleared with a far one
    expect(retagStoredBusinessRow({ ...row('New business license in Los Angeles: Clothing stores', 34.06, 34.06), zip: '90004' })).toEqual(['signs-printing', 'janitorial-commercial', 'security']);
    expect(retagStoredBusinessRow({ ...row('New business license in Los Angeles: Clothing stores', 33.69, 33.69), zip: '92614' })).toEqual([]);
    // a New York row at the City Hall stand-in is cleared unless its ZIP is in the city (review P1-3)
    const ny = (zip: string | null) => ({ source: 'socrata-nyc-business', title: 'New business license in New York City: Pawnbroker', lat: 40.71, lon: -74.01, zip, data: { approxLocation: true }, categories: old });
    expect(retagStoredBusinessRow(ny('7102'))).toEqual([]);
    expect(retagStoredBusinessRow(ny(null))).toEqual([]);
    expect(retagStoredBusinessRow(ny('11762'))).toEqual([]);
    expect(retagStoredBusinessRow(ny('11226'))).toEqual(['signs-printing', 'janitorial-commercial', 'security']);
  });
});

/** Review P1-2: a longitude that is a copy of the latitude is no point; the row is decided by its ZIP. */
describe('lat = lon rows (32 of 175 stored LA rows)', () => {
  it('an LA ZIP with a broken longitude is kept, placed at the ZIP centroid and flagged approximate', () => {
    for (const zip of ['90004', '90731', '91367', '90036']) {
      const r = laRow('Clothing stores', { zip_code: zip, location_1: { latitude: '34.06', longitude: '34.06' } });
      const items = run([r], LA, true).items;
      expect(items, zip).toHaveLength(1);
      expect(items[0].data).toMatchObject({ approxLocation: true });
      expect(items[0].lon as number).toBeLessThan(-117); // not 34 E
      expect(items[0].lat as number).toBeGreaterThan(33.5);
    }
  });
  it('a far ZIP with a broken longitude is dropped (Irvine 92614, Lancaster-side 92377, Washington state 98290)', () => {
    for (const zip of ['92614', '92377', '98290', '33040']) {
      expect(run([laRow('Clothing stores', { zip_code: zip, location_1: { latitude: '33.69', longitude: '33.69' } })], LA, true).items, zip).toHaveLength(0);
    }
  });
  it('a broken longitude with no ZIP is kept with no point (it cannot match anyone)', () => {
    const items = run([laRow('Clothing stores', { zip_code: '-', location_1: { latitude: '34.06', longitude: '34.06' } })], LA, true).items;
    expect(items).toHaveLength(1);
    expect(items[0].lat).toBeNull();
  });
  it('switch off: the point is stored as the feed gave it', () => {
    const items = run([laRow('Clothing stores', { zip_code: '90004', location_1: { latitude: '34.06', longitude: '34.06' } })], LA, false).items;
    expect(items[0].lon).toBe(34.06);
  });
});

/** Review P1-3: a New York row with no usable coordinates is never placed at City Hall (the fallback centre). */
describe('New York rows without coordinates', () => {
  const nyc = ds('socrata-nyc-business');
  const noPoint = (zip: string | undefined) => ({
    license_nbr: `${(n += 1)}-DCA`, business_category: 'Pawnbroker', license_type: 'Business', license_status: 'Active',
    license_creation_date: '2026-10-28T00:00:00.000', ...(zip === undefined ? {} : { address_zip: zip }),
  });
  it('switch off: the City Hall stand-in is used as before', () => {
    const items = run([noPoint(undefined)], nyc, false).items;
    expect(items[0].lat).toBeCloseTo(40.71, 1);
    expect(items[0].data).toMatchObject({ approxLocation: true });
  });
  it('no ZIP, "7102" (Newark with the zero lost), "N/A": kept with no point', () => {
    for (const z of [undefined, '7102', 'N/A', '']) {
      const items = run([noPoint(z)], nyc, true).items;
      expect(items, String(z)).toHaveLength(1);
      expect(items[0].lat, String(z)).toBeNull();
      expect(items[0].lon, String(z)).toBeNull();
    }
  });
  it('an in-city ZIP places the row at the ZIP centroid, flagged approximate, not at City Hall', () => {
    const items = run([noPoint('11226')], nyc, true).items;
    expect(items).toHaveLength(1);
    expect(items[0].data).toMatchObject({ approxLocation: true });
    expect(items[0].lat as number).toBeCloseTo(40.65, 1); // Flatbush
  });
  it('Long Island 11762 (29.5 mi) and a New Jersey ZIP are dropped; Yonkers 10701 stays inside the radius', () => {
    expect(run([noPoint('11762')], nyc, true).items).toHaveLength(0);
    expect(run([noPoint('07102')], nyc, true).items).toHaveLength(0);
    expect(run([noPoint('10701')], nyc, true).items).toHaveLength(1);
  });
  it('a lat = lon point is no point either', () => {
    const r = { ...noPoint('11226'), latitude: '40.65', longitude: '40.65' };
    const items = run([r], nyc, true).items;
    expect(items[0].lon as number).toBeLessThan(-73);
  });
});

/** Review P2-3: the type gaps. Table of every stored LA type is in the report. */
describe('type list (switch on)', () => {
  const t = (type: string) => businessTradesForType('socrata-la-business', type);
  it('bakeries, eating places, markets and florists are premises; a bakery factory is not', () => {
    expect(t('Retail Bakeries')).toEqual(['signs-printing', 'janitorial-commercial', 'security', 'pest-control']);
    expect(t('Limited-service eating places')).toEqual(['signs-printing', 'janitorial-commercial', 'security', 'pest-control']);
    expect(t('Limited-Service Restaurants')).toContain('pest-control');
    expect(t('Meat markets')).toEqual(['signs-printing', 'janitorial-commercial', 'security']);
    expect(t('Florists')).toEqual(['signs-printing', 'janitorial-commercial', 'security']);
    expect(t('Bakeries & tortilla mfg.')).toEqual([]);
    expect(t('Apparel mfg.')).toEqual([]);
  });
  it('a marijuana collective, a nonstore seller and a mail-order seller get no trade', () => {
    expect(t('Medical Marijuana Collective')).toEqual([]);
    expect(t('Electronic shopping')).toEqual([]);
    expect(t('Cannabis retailers')).toEqual([]);
    expect(run([laRow('Medical Marijuana Collective')], LA, true).items).toHaveLength(0);
  });
  it('the label engine reads the same list: Retail Bakeries is a food premises only with the switch on', () => {
    expect(storefrontKindOfName('socrata-la-business', 'Retail Bakeries', true)).toBe('food');
    expect(storefrontKindOfName('socrata-la-business', 'Retail Bakeries', false)).toBeNull();
  });
});

/** Alerts: a licence is feed only unless the row names a business (same hold as a permit with no contact). */
describe('licence alerts are feed only without a business contact', () => {
  const sig = (contactPath: 'business' | 'site' | null | undefined) => ({ source: 'socrata-chicago-business', kind: 'civic', subtype: 'business', title: 'New business license in Chicago: Retail Food Establishment', contactPath });
  it('switch off: no hold, as before', () => {
    expect(alertHoldFor(sig(null), 'coming_soon', 'security', null)).toBeNull();
  });
  it('switch on: held ("background") with no contact or a site only; a named business sends; unknown contact state is never held', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    expect(alertHoldFor(sig(null), 'coming_soon', 'security', null)).toBe('background');
    expect(alertHoldFor(sig('site'), 'coming_soon', 'security', null)).toBe('background');
    expect(alertHoldFor(sig('business'), 'coming_soon', 'security', null)).toBeNull();
    expect(alertHoldFor(sig(undefined), 'coming_soon', 'security', null)).toBeNull();
    expect(alertHoldFor(sig(null), 'market_insight', 'security', null)).toBeNull();
    expect(alertHoldFor({ ...sig(null), subtype: 'violation' }, 'act_now', 'security', null)).toBeNull();
  });
});

describe('capabilities follow the switch', () => {
  it('off: a licence claims the blanket trades; on: only the type trades', async () => {
    vi.resetModules();
    const off = await import('@/lib/signals/capabilities');
    expect(off.SIGNAL_TRADES.business).toEqual(expect.arrayContaining(['locksmith', 'insurance', 'business-services', 'hvac']));
    vi.resetModules();
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const on = await import('@/lib/signals/capabilities');
    expect([...on.SIGNAL_TRADES.business].sort()).toEqual(['janitorial-commercial', 'pest-control', 'security', 'signs-printing']);
    for (const tr of ['locksmith', 'insurance', 'business-services', 'hvac', 'cleaning'] as const) expect(on.TRADE_SIGNALS[tr]).not.toContain('business');
  });
});

describe('the held licence card words itself for a licence (review 2, P2-2)', () => {
  it('a licence says licence, EN and ES, never permit; a permit keeps its own sentence', () => {
    const lic = renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: 'background', isLicense: true }));
    expect(lic).toContain('This license record names no business contact, so Holler shows it in your feed only.');
    expect(lic).not.toMatch(/permit/i);
    const licEs = renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: 'background', isLicense: true, lang: 'es' }));
    expect(licEs).toContain(es['hold.background.license.note']);
    expect(licEs).not.toMatch(/permiso/i);
    expect(renderToStaticMarkup(createElement(OpportunityChip, { label: 'coming_soon', hold: 'background' }))).toContain(en['hold.background.note']);
    for (const k of ['hold.background.license.note'] as const) expect(`${en[k]}${es[k]}`).not.toMatch(/\u2014|\blead/i);
  });
  it('a licence keeps its hold unless a named business is on file (a site address does not release it)', () => {
    vi.stubEnv('HOLLER_BUSINESS_TAG_FIX_ENABLED', '1');
    const site = [{ role: 'site', name: '', address: '2150 N DAMEN' }];
    const biz = [{ role: 'business', name: 'Lakeview Pantry LLC' }];
    expect(shownHold('background', site, 'Retail Food Establishment', undefined, { subtype: 'business' })).toBe('background');
    expect(shownHold('background', biz, 'Retail Food Establishment', undefined, { subtype: 'business' })).toBeNull();
    expect(shownHold('background', site, 'Retail Food Establishment', undefined, { subtype: 'permit' })).toBeNull();
  });
});
