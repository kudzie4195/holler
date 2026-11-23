/**
 * Round 20 NEXT: new-business feeds, the Houston permit report, certificates of occupancy, the shared 311 block-level rule and the Chicago
 * premises address. Fixtures are inline (no portal is reachable from the sandbox); every person name below is planted and must never reach a
 * stored field.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOCRATA_DATASETS, type SocrataDataset } from '@/lib/signals/adapters/socrata-datasets';
import { ARCGIS_DATASETS, type ArcgisDataset } from '@/lib/signals/adapters/arcgis-datasets';
import { buildSocrataQuery, parseSocrata, parseSocrataReport, socrataSelectColumns } from '@/lib/signals/adapters/socrata';
import { buildArcgisQuery, parseArcgis } from '@/lib/signals/adapters/arcgis';
import { NEXT_ARCGIS_DATASETS, NEXT_SOCRATA_DATASETS, NEXT_SOURCE_IDS, miamiNewBusiness, tabcKeep, txSalesKeep } from '@/lib/signals/adapters/next-datasets';
import { isCompanyForm, isFoodNaics, isStorefrontNaics } from '@/lib/signals/adapters/next-filters';
import { OCCUPANCY_TRADES, hashedId, occupancyTitle, occupancyTypeText } from '@/lib/signals/adapters/next-rules';
import { HOUSTON_PERMITS_ID, HOUSTON_REPORT_URL, buildHoustonPermitsAdapter, cellText, parseHoustonPermits, readPermitTable } from '@/lib/signals/adapters/houston-permits';
import { NEVER_SITE_311_RE, PROPERTY_CONDITION_311_RE, blockOfAddress, site311Block, site311Contact, site311TypeAllowed } from '@/lib/signals/site-311';
import { blockSiteAddress, sanitizeContact, sanitizeContacts } from '@/lib/contacts/sanitize';
import { contactsAllowedFor, isBlockSiteContact } from '@/lib/contacts/extract';
import { sanitizeSample } from '@/lib/signals/samples';
import { ALL_ADAPTERS } from '@/lib/signals/registry';
import { LABEL_PENDING_INTEGRATION, NEXT_R20_SOURCES, PROBATION_SOURCE_IDS, isProbationSource, probationOverview } from '@/lib/signals/probation';
import { coverageProbeSourceIds, runCoverageProbe } from '@/lib/signals/coverage-probe';
import { SOURCE_DEFAULTS } from '@/lib/signals/lead-rules';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { localizeTitle as titleLang } from '@/lib/signals/title-i18n';
import { sourcePlaces } from '@/lib/admin/metros';
import { PROPOSED_LABELS } from '@/lib/signals/proposed-labels';
import { contactPathOf, textShowsPlace } from '@/lib/signals/alert-gate';
import type { AdapterContext, SignalInput } from '@/lib/signals/types';

const NOW = new Date('2026-11-22T18:00:00Z');
const PERSON = /Zelda Quixmore|QUIXMORE|Zelda|Marisol Vantreek|VANTREEK/i;
const sd = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)!;
const ad = (id: string) => ARCGIS_DATASETS.find((d) => d.id === id)!;
/** Every string anywhere in the records (title, summary, data, contacts, ids). */
const hay = (items: readonly SignalInput[]) => JSON.stringify(items);

function ctx(answer: (url: string) => Response): { c: AdapterContext; logs: string[]; urls: string[] } {
  const logs: string[] = [];
  const urls: string[] = [];
  const c = {
    env: {},
    now: NOW,
    log: (m: string) => logs.push(m),
    fetch: (async (u: string | URL) => {
      urls.push(String(u));
      return answer(String(u));
    }) as typeof fetch,
  } as unknown as AdapterContext;
  return { c, logs, urls };
}

// ---- 1. Chicago business licences: the premises address, and nothing else changes -------------------------------------------------

describe('Chicago new business licences: premises address (LIVE source, one intended change)', () => {
  const d = sd('socrata-chicago-business');
  const off: SocrataDataset = { ...d, premises: undefined };
  const files = ['tests/fixtures/socrata-chicago-business.json', 'tests/fixtures/socrata-chicago-business-people.json', 'tests/contacts/fixtures/socrata-chicago-business-contacts.json'];

  it.each(files)('%s: every field but the summary is identical; the summary only gains the premises address of a business whose name passed', (f) => {
    const raw = JSON.parse(readFileSync(join(process.cwd(), f), 'utf8'));
    const on = parseSocrata(raw, d);
    const was = parseSocrata(raw, off);
    expect(on.length).toBe(was.length);
    on.forEach((s, i) => {
      const { summary: a, ...restOn } = s;
      const { summary: b, ...restWas } = was[i];
      expect(restOn).toEqual(restWas); // title, categories, lat/lon, zip, data, contacts, id, date
      const site = s.contacts?.find((c) => c.role === 'site')?.address;
      const named = s.contacts?.some((c) => c.role === 'business');
      expect(a).toBe(named && site ? `${b} | ${site}` : b);
    });
  });

  it('the query (where, order, limit) and the columns it reads are unchanged', () => {
    expect(buildSocrataQuery(d, NOW).toString()).toBe(buildSocrataQuery(off, NOW).toString());
    expect(d.addressFields ?? []).toEqual([]);
    expect(new Set(socrataSelectColumns(d))).toEqual(new Set(socrataSelectColumns(off)));
  });

  it('a person-named licence and a home-based activity print no address; a company prints one the live gate reads as a place', () => {
    const row = (dba: string, legal: string, activity: string) => ({ id: `C${dba.length}${activity.length}`, doing_business_as_name: dba, legal_name: legal, address: '2318 W 47TH ST', city: 'CHICAGO', state: 'IL', zip_code: '60609', license_description: 'Limited Business License', business_activity: activity, application_type: 'ISSUE', date_issued: '2026-11-12T00:00:00.000', latitude: '41.8', longitude: '-87.6' });
    const items = parseSocrata([row('Zelda Quixmore', 'QUIXMORE, ZELDA', 'Retail sales'), row('SUNSET ACADEMY', 'SUNSET ACADEMY', 'Home Day Care'), row('LAKEVIEW GOODS LLC', 'LAKEVIEW GOODS LLC', 'Retail sales')], d);
    expect(items[0].summary).not.toMatch(/47TH/);
    expect(items[1].summary).not.toMatch(/47TH/);
    expect(items[2].summary).toMatch(/\| 2318 W 47TH ST$/);
    expect(contactPathOf(null, items[2].summary)).toBe('site');
    expect(contactPathOf(null, items[0].summary)).toBeNull();
    expect(hay(items)).not.toMatch(PERSON);
  });
});

// ---- 2. The 311 block-level rule (all cities) ------------------------------------------------------------------------------------------

describe('311: at most a block-level site, never a house number, only for property-condition request types', () => {
  it('blocks: rounded to the hundred, units dropped, unsure input gives nothing', () => {
    expect(blockOfAddress('2318 W 47TH ST')).toBe('2300 block of W 47TH ST');
    expect(blockOfAddress('12 MAIN ST APT 4')).toBe('0-99 block of MAIN ST');
    expect(blockOfAddress('4521 ELM AVE #5B')).toBe('4500 block of ELM AVE');
    for (const bad of ['', 'MAIN ST & ELM ST', 'PO BOX 12', '0 MAIN ST', '8701 ZELDA QUIXMORE', 'call 214-555-0199', 'N/A']) expect(blockOfAddress(bad), bad).toBe('');
  });

  it('block form check: only "<hundred> block of <street>" with a street the shared address rule keeps', () => {
    expect(blockSiteAddress('2300 block of W 47TH ST')).toBe('2300 block of W 47TH ST');
    expect(blockSiteAddress('0-99 block of MAIN ST')).toBe('0-99 block of MAIN ST');
    for (const bad of ['2318 W 47TH ST', '2350 block of MAIN ST', '2300 block of MAIN ST APT 4', '2300 block of MAIN ST #4', '2300 block of', 'block of MAIN ST', '2300 block of 214-555-0199 MAIN ST']) {
      expect(blockSiteAddress(bad), bad).toBeNull();
    }
  });

  it('types: property conditions yes; anything about a home or unit from the inside never (NYC apartment-only heat stays without an address)', () => {
    const rule = { typeFields: ['t'], propertyTypes: PROPERTY_CONDITION_311_RE };
    const ok = (t: string) => site311TypeAllowed((f) => (f === 't' ? t : ''), rule);
    for (const t of ['High Weeds - CCS', 'Junk Motor Vehicle - CCS', 'Open and Vacant Structure - CCS', 'Illegal Dumping - CCS', 'Rodent Complaint', 'Substandard Structure']) expect(ok(t), t).toBe(true);
    for (const t of ['HEAT/HOT WATER / APARTMENT ONLY', 'HEAT/HOT WATER / ENTIRE BUILDING', 'Noise - Residential', 'Tenant complaint - rodents in apartment', 'Street Spillage/Debris in Right of Way - Hazardous - TPW', 'Pothole', 'Tree Down/Low Limbs - TPW', '']) expect(ok(t), t).toBe(false);
    expect(NEVER_SITE_311_RE.test('APARTMENT ONLY')).toBe(true);
  });

  it('the private contact is a nameless block site; the contact gate keeps exactly that on a 311 row', () => {
    const rule = { addressFields: ['address'], typeFields: ['t'], propertyTypes: PROPERTY_CONDITION_311_RE };
    const get = (row: Record<string, string>) => (f: string) => row[f] ?? '';
    const c = site311Contact(get({ t: 'High Weeds - CCS', address: '2318 W 47TH ST' }), rule, { city: 'Dallas', state: 'TX', zip: '75201' });
    expect(c).toEqual({ role: 'site', name: '', address: '2300 block of W 47TH ST', city: 'Dallas', state: 'TX', zip: '75201' });
    expect(site311Block(get({ t: 'HEAT/HOT WATER / APARTMENT ONLY', address: '2318 W 47TH ST' }), rule)).toBe('');
    const exact = { role: 'site' as const, name: '', address: '2318 W 47TH ST' };
    const named = { role: 'site' as const, name: 'ZELDA QUIXMORE', address: '2300 block of W 47TH ST' };
    const biz = { role: 'business' as const, name: 'ACME LLC', address: null };
    expect(contactsAllowedFor('311', [c!, exact, named, biz])).toEqual([c]);
    expect(isBlockSiteContact(exact)).toBe(false);
    // Kept as written by the sanitiser (cleanAddress alone would drop most block forms); the live gate reads it as a place.
    expect(sanitizeContact(c)?.address).toBe('2300 block of W 47TH ST');
    expect(sanitizeContacts([c]).map((x) => x.address)).toEqual(['2300 block of W 47TH ST']);
    expect(textShowsPlace('2300 block of W 47TH ST')).toBe(true);
  });

  it('Dallas 311 (LIVE): a property-condition row gains only the private block site; title, summary, data and position are unchanged', () => {
    const d = sd('socrata-dallas-311');
    const rows = [
      { unique_key: 'D1', created_date: '2026-11-20T10:00:00.000', service_request_type: 'Illegal Dumping - CCS', department: 'Code Compliance', status: 'Open', address: '2318 ELM ST', lat_location: '(32.78, -96.80)' },
      { unique_key: 'D2', created_date: '2026-11-20T11:00:00.000', service_request_type: 'Street Spillage/Debris in Right of Way - Hazardous - TPW', department: 'TPW', status: 'Open', address: '1840 MAIN ST', lat_location: '(32.78, -96.80)' },
    ];
    const on = parseSocrata(rows, d);
    const off = parseSocrata(rows, { ...d, site311: undefined });
    expect(on.length).toBe(2);
    on.forEach((s, i) => {
      const { contacts, ...pub } = s;
      expect(pub).toEqual(off[i]);
      expect(off[i].contacts).toBeUndefined();
      expect(`${s.title} ${s.summary}`).not.toMatch(/ELM|MAIN|2318|1840/);
      if (i === 0) expect(contacts).toEqual([{ role: 'site', name: '', address: '2300 block of ELM ST', city: 'Dallas', state: 'TX', zip: null }]);
      else expect(contacts).toBeUndefined();
    });
    // The live query is unchanged: no $select on this dataset, the window and the keyword narrowing as before.
    expect(buildSocrataQuery(d, NOW).toString()).toBe(buildSocrataQuery({ ...d, site311: undefined }, NOW).toString());
    expect(buildSocrataQuery(d, NOW).get('$select')).toBeNull();
  });

  it('NYC 311 keeps no address of any kind (apartment-level heat included); Houston 311 (probation) gets the same block rule', () => {
    expect(sd('socrata-nyc-311').site311).toBeUndefined();
    const h = ad('arcgis-houston-311');
    const items = parseArcgis({ features: [
      { attributes: { CaseNumber: 'H1', CreatedDate: Date.parse('2026-11-20T10:00:00Z'), CaseType: 'Junk Motor Vehicle', Title: 'Zelda Quixmore says junk car', Department: 'Neighborhoods', Status: 'Open', IncidentAddress: '7710 CHAPPEL AVE', Latitude: 29.76, Longitude: -95.36 } },
      { attributes: { CaseNumber: 'H2', CreatedDate: Date.parse('2026-11-20T10:00:00Z'), CaseType: 'Rodent in apartment', Title: 'x', Department: 'Health', Status: 'Open', IncidentAddress: '7710 CHAPPEL AVE', Latitude: 29.76, Longitude: -95.36 } },
    ] }, h);
    const withSite = items.filter((s) => s.contacts?.length);
    for (const s of withSite) expect(s.contacts).toEqual([{ role: 'site', name: '', address: '7700 block of CHAPPEL AVE', city: 'Houston', state: 'TX', zip: null }]);
    expect(items.find((s) => s.externalId === 'H2')?.contacts).toBeUndefined();
    for (const s of items) expect(`${s.title} ${s.summary}`).not.toMatch(/CHAPPEL|7710|Zelda/i);
    expect(hay(items)).not.toMatch(/7710/);
  });

  it('the sample clean-up keeps the block site on a 311 row and nothing else', () => {
    const s: SignalInput = { source: 'arcgis-houston-311', externalId: 'H1', kind: 'civic', title: 't', severity: 1, occurredAt: NOW.toISOString(), categories: ['junk-removal'], data: { subtype: '311' },
      contacts: [{ role: 'site', name: '', address: '7700 block of CHAPPEL AVE', city: 'Houston', state: 'TX', zip: null }, { role: 'site', name: '', address: '7710 CHAPPEL AVE' }] } as SignalInput;
    expect(sanitizeSample(s).contacts?.map((c) => c.address)).toEqual(['7700 block of CHAPPEL AVE']);
  });
});

// ---- 3. Texas Comptroller and TABC ------------------------------------------------------------------------------------------------

describe('Texas sales-tax outlets and TABC applications: companies only, never a taxpayer or owner', () => {
  it('company forms and storefront NAICS (fail closed)', () => {
    for (const t of ['Texas Limited Liability Company', 'CL', 'Texas Profit Corporation', 'Foreign Limited Partnership', 'ACME INC', 'Professional Association']) expect(isCompanyForm(t), t).toBe(true);
    for (const t of ['', 'Sole Owner', 'Individual', 'IS', 'Sole Proprietorship', 'General Partnership', 'Zelda Quixmore', 'Estate of Zelda Quixmore', 'Unknown']) expect(isCompanyForm(t), t).toBe(false);
    for (const n of ['722511', '445110', '452', '811111', '812112']) expect(isStorefrontNaics(n), n).toBe(true);
    for (const n of ['541110', '238220', '', 'abc', '72']) expect(isStorefrontNaics(n), n).toBe(false);
    expect(isFoodNaics('722513')).toBe(true);
    expect(isFoodNaics('445110')).toBe(false);
  });

  const tx = sd('socrata-txsales-dallas-business');
  const row = (o: Record<string, string>) => ({
    taxpayer_number: '32012345678', outlet_number: '00001', outlet_permit_issue_date: '2026-11-18T00:00:00.000', outlet_naics_code: '722511',
    taxpayer_organizational_type: 'Texas Limited Liability Company', outlet_name: 'DESERT GRILL LLC', outlet_address: '1840 ELM ST', outlet_city: 'DALLAS', outlet_zip_code: '75201',
    taxpayer_name: 'Zelda Quixmore', taxpayer_address: '9 SECRET LN', ...o,
  });

  it('a sole proprietor, an unknown organisation type or a home-office NAICS is dropped before anything is built', () => {
    const items = parseSocrata([row({ taxpayer_organizational_type: 'Sole Owner' }), row({ outlet_number: '2', taxpayer_organizational_type: '' }), row({ outlet_number: '3', outlet_naics_code: '541110' })], tx);
    expect(items).toEqual([]);
    expect(txSalesKeep((f) => row({})[f as keyof ReturnType<typeof row>] ?? '')).toBe(true);
  });

  it('a company storefront: NAICS sector title, premises address, issue date, hashed id; taxpayer name and address never stored or requested', () => {
    const [s] = parseSocrata([row({})], tx);
    expect(s.title).toBe('New business license in Dallas: Food service and lodging');
    expect(s.summary).toBe('Food service and lodging | 1840 ELM ST');
    expect(s.occurredAt.slice(0, 10)).toBe('2026-11-18');
    expect(s.categories).toEqual(expect.arrayContaining(['signs-printing', 'security', 'janitorial-commercial', 'pest-control']));
    expect(s.externalId).toBe(hashedId('32012345678:00001'));
    expect(hay([s])).not.toMatch(/32012345678|SECRET|Zelda/);
    expect(s.contacts?.find((c) => c.role === 'business')?.name).toBe('DESERT GRILL LLC');
    const sel = socrataSelectColumns(tx);
    expect(sel).not.toContain('taxpayer_name');
    expect(sel).not.toContain('taxpayer_address');
    expect(buildSocrataQuery(tx, NOW).get('$where')).toMatch(/outlet_county_code in \('057','043','061','220','57','43','61','220'\)/);
  });

  it('a person as the outlet name: kept only as a record with no name and no address (a company form still wraps a person name)', () => {
    const [s] = parseSocrata([row({ outlet_name: 'Zelda Quixmore' })], tx);
    expect(s.summary).toBe('Food service and lodging');
    expect(s.contacts).toBeUndefined();
    expect(hay([s])).not.toMatch(PERSON);
  });

  it('a retail outlet gets no pest control (food premises only)', () => {
    const [s] = parseSocrata([row({ outlet_naics_code: '448140' })], tx);
    expect(s.categories).not.toContain('pest-control');
  });

  it('TABC: company form only, on-premise alcohol is a food premises, the owner never stored', () => {
    const t = sd('socrata-tabc-houston-business');
    const r = (o: Record<string, string>) => ({ application_id: 'A1', received_date: '2026-11-19T00:00:00.000', license_type: 'Mixed Beverage Permit', trade_name: 'BAYOU GRILL LLC', address: '400 MAIN ST', city: 'HOUSTON', zip: '77002', county: 'HARRIS', ownership_type: 'Corporation', owner: 'Marisol Vantreek', ...o });
    const items = parseSocrata([r({}), r({ application_id: 'A2', ownership_type: 'Individual' }), r({ application_id: 'A3', license_type: 'Package Store Permit' })], t);
    expect(items.map((s) => s.externalId)).toEqual(['A1', 'A3']);
    expect(items[0].categories).toContain('pest-control');
    expect(items[1].categories).not.toContain('pest-control');
    expect(items[0].summary).toBe('Mixed Beverage Permit | 400 MAIN ST');
    expect(hay(items)).not.toMatch(PERSON);
    expect(socrataSelectColumns(t)).not.toContain('owner');
    expect(tabcKeep((f) => (f === 'ownership_type' ? 'Marisol Vantreek' : ''))).toBe(false);
  });
});

// ---- 4. Miami-Dade business tax and Phoenix liquor licences ------------------------------------------------------------------------------

describe('Miami-Dade business tax and Phoenix liquor (ArcGIS)', () => {
  const md = ad('arcgis-miamidade-business');
  const feat = (a: Record<string, unknown>) => ({ attributes: { OBJECTID: 1, BUSSDATE: Date.parse('2026-11-15T00:00:00Z'), NEWBUS: 'Y', BUSNAME: 'BISCAYNE BAGELS LLC', BUSADDR1: '120 NE 2ND AVE', BUSCITY: 'MIAMI', ZIPCODE: '33132', PHONENO: '305-555-0142', CLASSDESC: 'RESTAURANT', CATGRYNAME: 'FOOD SERVICE', OCCDESC: 'RESTAURANT', LAT: 25.77, LON: -80.19, OWNERNAME: 'Zelda Quixmore', MAILNAME: 'Zelda Quixmore', EMAIL: 'zelda@example.com', ...a }, geometry: { x: -80.19, y: 25.77 } });

  it('outFields never ask for the owner, mailing or e-mail columns', () => {
    const q = buildArcgisQuery(md, NOW, new Set(['BUSNAME', 'BUSADDR1', 'BUSCITY', 'PHONENO', 'NEWBUS'])).get('outFields')!;
    expect(q).not.toMatch(/OWNERNAME|MAILNAME|MAIL|EMAIL/);
    expect(q).toContain('NEWBUS');
  });

  it('a new company: premises address and phone (private) next to a name that passed; an old account or a person gives neither', () => {
    const items = parseArcgis({ features: [feat({}), feat({ OBJECTID: 2, NEWBUS: 'N' }), feat({ OBJECTID: 3, BUSNAME: 'Zelda Quixmore' })] }, md);
    expect(items.map((s) => s.externalId)).toEqual(['1', '3']);
    expect(items[0].summary).toBe('FOOD SERVICE | RESTAURANT | 120 NE 2ND AVE');
    expect(items[0].categories).toContain('pest-control');
    expect(items[0].contacts?.find((c) => c.role === 'business')).toMatchObject({ name: 'BISCAYNE BAGELS LLC', phone: '305-555-0142' });
    expect(items[1].summary).not.toMatch(/120 NE/);
    expect(items[1].contacts).toBeUndefined();
    expect(hay(items)).not.toMatch(PERSON);
    expect(hay(items)).not.toMatch(/zelda@/);
    expect(miamiNewBusiness(() => '')).toBe(false);
  });

  it('Phoenix restaurant liquor licences: every row a food premises; a person licensee name never stored', () => {
    const px = ad('arcgis-phoenix-liquor-business');
    const items = parseArcgis({ features: [
      { attributes: { LICENSE_NUMBER: '012-1', ISSUE_DATE: Date.parse('2026-11-10T00:00:00Z'), LICENSE_TYPE: 'Restaurant', SERIES: '12', BUSINESS_NAME: 'DESERT GRILL LLC', ADDRESS: '300 W ADAMS ST', ZIP: '85003' }, geometry: { x: -112.07, y: 33.45 } },
      { attributes: { LICENSE_NUMBER: '012-2', ISSUE_DATE: Date.parse('2026-11-10T00:00:00Z'), LICENSE_TYPE: 'Restaurant', SERIES: '12', BUSINESS_NAME: 'Marisol Vantreek', ADDRESS: '9 QUIET LN', ZIP: '85003' }, geometry: { x: -112.07, y: 33.45 } },
    ] }, px);
    expect(items).toHaveLength(2);
    for (const s of items) expect(s.categories).toEqual(expect.arrayContaining(['pest-control', 'signs-printing', 'security', 'janitorial-commercial']));
    expect(items[0].summary).toBe('Restaurant | 300 W ADAMS ST');
    expect(items[1].summary).toBe('Restaurant');
    expect(hay(items)).not.toMatch(PERSON);
    expect(hay(items)).not.toMatch(/QUIET/);
  });
});

// ---- 5. Certificates of occupancy -------------------------------------------------------------------------------------------------

describe('certificates of occupancy (LA, New York, DC): address, date, building type; no applicant or owner', () => {
  it('helpers: fixed title, printable type only, the four trades', () => {
    expect(occupancyTitle('Los Angeles', 'Apartment')).toBe('Certificate of occupancy in Los Angeles: Apartment');
    expect(occupancyTitle('Los Angeles', '')).toBe('Certificate of occupancy in Los Angeles');
    expect(occupancyTypeText(['x'.repeat(70), 'Apartment <b>', 'Apartment'])).toBe('Apartment');
    expect([...OCCUPANCY_TRADES].sort()).toEqual(['cleaning', 'landscaping', 'moving', 'security']);
  });

  it('LA: a CO row is a permit at the certificate-of-occupancy stage with the occupancy trades; the free-text description is never printed', () => {
    const la = sd('socrata-la-occupancy-permits');
    const [s] = parseSocrata([{ cofo_number: 'CO-1', cofo_issue_date: '2026-11-16T00:00:00.000', permit_type: 'Bldg-New', permit_sub_type: 'Apartment', work_description: 'NEW 5-UNIT APARTMENT FOR ZELDA QUIXMORE', address: '1234 W SUNSET BLVD', zip_code: '90026', latitude: '34.07', longitude: '-118.25', contractor_business_name: 'PACIFIC BUILDERS INC' }], la);
    expect(s.title).toBe('Certificate of occupancy in Los Angeles: Apartment');
    expect(s.permitStage).toBe('certificate_of_occupancy');
    expect(s.categories).toEqual(expect.arrayContaining([...OCCUPANCY_TRADES]));
    expect(s.summary).toMatch(/1234 W SUNSET BLVD/);
    expect(hay([s])).not.toMatch(PERSON);
    expect(s.contacts?.find((c) => c.role === 'contractor')?.name).toBe('PACIFIC BUILDERS INC');
    expect(s.contacts?.some((c) => 'license' in c && c.license)).toBe(false);
  });

  it('New York: CO title and stage; DC: PROPERTY_OWNER and OWNER_ADDRESS never asked for, a person occupant never stored', () => {
    const ny = sd('socrata-nyc-occupancy-permits');
    const [n] = parseSocrata([{ job_filing_name: 'M00123456-I1', c_of_o_issuance_date: '2026-11-17T00:00:00.000', c_of_o_filing_type: 'Final', c_of_o_status: 'Issued', borough: 'MANHATTAN', house_no: '120', street_name: 'W 44TH ST', postcode: '10036', latitude: '40.757', longitude: '-73.984' }], ny);
    expect(n.title).toBe('Certificate of occupancy in New York City: Final');
    expect(n.permitStage).toBe('certificate_of_occupancy');
    const dc = ad('arcgis-dc-occupancy-permits');
    const out = buildArcgisQuery(dc, NOW, new Set(['TRADING_AS', 'PERMISSION_GRANTED_TO'])).get('outFields')!;
    expect(out).not.toMatch(/PROPERTY_OWNER|OWNER_ADDRESS/);
    const items = parseArcgis({ features: [
      { attributes: { OBJECTID: 7, ISSUE_DATE: Date.parse('2026-11-17T00:00:00Z'), ADDRESS: '1100 4TH ST SW', DESCRIPTION_OF_OCCUPANCY: 'Restaurant for Marisol Vantreek', APPROVED_ZONING_USE: 'Restaurant', OCCUPANCY_LOAD: '80', PERMISSION_GRANTED_TO: 'Marisol Vantreek', TRADING_AS: '', PROPERTY_OWNER: 'Zelda Quixmore', OWNER_ADDRESS: '9 SECRET LN' }, geometry: { x: -77.02, y: 38.88 } },
      { attributes: { OBJECTID: 8, ISSUE_DATE: Date.parse('2026-11-17T00:00:00Z'), ADDRESS: '700 PENNSYLVANIA AVE SE', DESCRIPTION_OF_OCCUPANCY: 'Retail', APPROVED_ZONING_USE: 'Retail', OCCUPANCY_LOAD: '40', PERMISSION_GRANTED_TO: 'DESERT GRILL LLC', TRADING_AS: '' }, geometry: { x: -76.99, y: 38.88 } },
    ] }, dc);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Certificate of occupancy in Washington: Restaurant');
    expect(items[0].summary).toMatch(/1100 4TH ST/);
    expect(items[0].contacts?.some((c) => c.role === 'business')).toBeFalsy();
    expect(items[1].contacts?.find((c) => c.role === 'business')?.name).toBe('DESERT GRILL LLC');
    expect(hay(items)).not.toMatch(PERSON);
    expect(hay(items)).not.toMatch(/SECRET/);
  });
});

// ---- 6. Houston weekly permit activity report ----------------------------------------------------------------------------------------

const PAGE = `<!doctype html><html><head><title>Permit Activity</title></head><body>
<table><tr><td>Menu</td><td>Search</td></tr></table>
<table border="1">
<tr><th>Zip Code</th><th>Permit Date</th><th>Permit Type</th><th>Project No</th><th>Address</th><th>Comments</th></tr>
<tr><td>77002</td><td>11/12/2026</td><td>Building Pmt</td><td>26012345</td><td>1840 MAIN ST</td><td>NEW S.F. RES W/ ATT. GAR (1-1-5-R3-B) 06 IRC/15 IECC</td></tr>
<tr><td>77004</td><td>11/13/2026</td><td>Building Pmt</td><td>26012346</td><td>4521 ALMEDA RD</td><td>RESIDENTIAL SWIMMING POOL FOR ZELDA QUIXMORE</td></tr>
<tr><td>77006</td><td>11/14/2026</td><td>OCC-BLDG PMT</td><td>26012347</td><td>300 WESTHEIMER RD STE 100</td><td>RESTAURANT REMODEL &amp; OCCUPANCY</td></tr>
<tr><td>77006</td><td>11/14/2026</td><td>Building Pmt</td><td>BAD ID!!</td><td>1 X ST</td><td>NEW S.F. RES</td></tr>
<tr><td>77009</td><td>09/01/2026</td><td>Building Pmt</td><td>26000001</td><td>12 OLD ST</td><td>NEW S.F. RES</td></tr>
</table></body></html>`;

describe('Houston weekly Permit Activity Report (HTML table reader, no dependency)', () => {
  it('reads the table by header text, decodes entities, drops an unsafe project number', () => {
    const t = readPermitTable(PAGE);
    expect(t.problem).toBeNull();
    expect(t.headers.sort()).toEqual(['address', 'comments', 'permit_date', 'permit_type', 'project_no', 'zip_code']);
    expect(t.rows.map((r) => r.project_no)).toEqual(['26012345', '26012346', '26012347', '26000001']);
    expect(t.rows[2].comments).toBe('RESTAURANT REMODEL & OCCUPANCY');
    expect(cellText('A&nbsp;&amp;&#39;B&#x41;')).toBe("A &'BA");
  });

  it('a page without the report table is a named schema mismatch; an empty body says so', () => {
    expect(readPermitTable('<table><tr><th>Date</th><th>Other</th></tr><tr><td>1</td><td>2</td></tr></table>').problem).toMatch(/^schema mismatch: expected a table with the headers project no, permit date, address/);
    expect(readPermitTable('').problem).toBe('empty response body');
  });

  it('rows become permit records: fixed titles, the address through cleanAddress, ZIP placement, comments never printed, old rows dropped', () => {
    const { items } = parseHoustonPermits(readPermitTable(PAGE).rows, NOW);
    expect(items.map((s) => s.externalId).sort()).toEqual(expect.arrayContaining(['26012345']));
    expect(items.some((s) => s.externalId === '26000001')).toBe(false); // September: older than 21 days
    for (const s of items) {
      expect(s.source).toBe(HOUSTON_PERMITS_ID);
      expect(s.url).toBe(HOUSTON_REPORT_URL);
      expect(s.city).toBe('Houston');
      expect(s.data?.approxLocation).toBe(true);
      expect(s.data?.domain).toBe('www.houstontx.gov');
      expect(`${s.title} ${s.summary}`).not.toMatch(/IRC|IECC|SWIMMING POOL FOR|REMODEL &/);
    }
    expect(hay(items)).not.toMatch(PERSON);
    const home = items.find((s) => s.externalId === '26012345')!;
    expect(home.summary).toMatch(/1840 MAIN ST/);
    expect(home.title).toMatch(/Houston/);
  });

  it('the adapter is on probation, logs a mismatch as an error, and the probe reads the page without returning a raw cell', async () => {
    const a = buildHoustonPermitsAdapter();
    expect(a.probation).toBe(true);
    const good = ctx(() => new Response(PAGE, { status: 200 }));
    const items = await a.fetch(good.c);
    expect(items.length).toBeGreaterThan(0);
    expect(good.urls).toEqual([HOUSTON_REPORT_URL]);
    const bad = ctx(() => new Response('<html>moved</html>', { status: 200 }));
    expect(await a.fetch(bad.c)).toEqual([]);
    expect(bad.logs.join('\n')).toMatch(/error: schema mismatch/);
    const probe = await runCoverageProbe(HOUSTON_PERMITS_ID, (async () => new Response(PAGE, { status: 200 })) as unknown as typeof fetch, NOW);
    expect(probe.status).toBe('ok');
    expect(probe.platform).toBe('html');
    expect(probe.schema).toBe('ok');
    expect(probe.missingExpected).toEqual([]);
    expect(probe.freshness).toBe('ok');
    expect(JSON.stringify(probe)).not.toMatch(PERSON);
    expect(JSON.stringify(probe)).not.toMatch(/IRC|IECC/);
  });
});

// ---- 7. Probation wiring, labels, metros, i18n ---------------------------------------------------------------------------------------

describe('every NEXT source is on probation, probed, placed, labelled and exempt from SOURCE_DEFAULTS only while on probation', () => {
  const ids = [...NEXT_SOURCE_IDS, HOUSTON_PERMITS_ID].sort();

  it('the list matches the configs and the registry', () => {
    expect(NEXT_R20_SOURCES.map((s) => s.id).sort()).toEqual(ids);
    for (const d of [...NEXT_SOCRATA_DATASETS, ...NEXT_ARCGIS_DATASETS]) {
      expect(d.probation, d.id).toBe(true);
      expect((d as SocrataDataset | ArcgisDataset).schemaUnverified, d.id).toBe(true);
    }
    for (const id of ids) {
      const a = ALL_ADAPTERS.find((x) => x.id === id);
      expect(a?.probation, id).toBe(true);
      expect(PROBATION_SOURCE_IDS.has(id), id).toBe(true);
      expect(isProbationSource(id)).toBe(true);
      expect(LABEL_PENDING_INTEGRATION).toContain(id);
      expect(SOURCE_DEFAULTS[id], id).toBeUndefined();
      expect(SOURCE_META[id]?.label, id).toBe(a?.label);
      expect(coverageProbeSourceIds()).toContain(id);
    }
  });

  it('each sits under its metro (the admin metros table)', () => {
    const p = sourcePlaces();
    for (const s of NEXT_R20_SOURCES) expect(p.get(s.id), s.id).toBe(s.metro);
  });

  it('the probation overview names the probe and the file to promote it in', () => {
    const rows = probationOverview(ALL_ADAPTERS, [], () => null);
    for (const id of ids) {
      const r = rows.find((x) => x.id === id)!;
      expect(r.probe).toBe(`/api/admin/coverage-probe?source=${id}`);
      expect(r.promote).toMatch(id === HOUSTON_PERMITS_ID ? /houston-permits\.ts/ : /next-datasets\.ts/);
      expect(r.promote).toMatch(/schemaUnverified/);
    }
  });

  it('Spanish: source labels and the CO title are rebuilt from the dictionary', () => {
    expect(sourceLabelLang('socrata-la-occupancy-permits', 'es')).toBe('Datos abiertos de Los Angeles: certificados de ocupación');
    expect(sourceLabelLang('socrata-txsales-dallas-business', 'es')).toBe('Datos abiertos de Texas: permisos nuevos de impuesto sobre las ventas');
    expect(sourceLabelLang('html-houston-permits', 'es')).toBe('Ciudad de Houston: informe semanal de permisos');
    expect(sourceLabelLang('socrata-la-occupancy-permits', 'en')).toBe('Los Angeles open data: certificates of occupancy');
    expect(titleLang('Certificate of occupancy in Los Angeles: Apartment', 'es')).toBe('Certificado de ocupación en Los Angeles: Apartment');
    expect(titleLang('Certificate of occupancy in Washington', 'es')).toBe('Certificado de ocupación en Washington');
    expect(titleLang('Certificate of occupancy in Los Angeles: Apartment', 'en')).toBe('Certificate of occupancy in Los Angeles: Apartment');
  });

  it('proposed labels: one entry per NEXT source plus the Chicago address change; only alert labels for the reviewed trades', () => {
    expect(Object.keys(PROPOSED_LABELS).sort()).toEqual([...ids, 'socrata-chicago-business'].sort());
    const allowed: Record<string, string[]> = {
      'business-licence': ['signs-printing', 'security', 'janitorial-commercial', 'pest-control'],
      'certificate-of-occupancy': ['cleaning', 'moving', 'security', 'landscaping'],
    };
    for (const [id, p] of Object.entries(PROPOSED_LABELS)) {
      if (allowed[p.recordKind]) expect(Object.keys(p.labels).every((t) => allowed[p.recordKind].includes(t)), id).toBe(true);
      expect(p.callPath, id).toBe(true);
    }
  });

  it('parse never throws on junk and a probation row never names a person (planted in every column of every NEXT dataset)', () => {
    for (const d of NEXT_SOCRATA_DATASETS) {
      const cols = [...socrataSelectColumns(d), 'taxpayer_name', 'taxpayer_address', 'owner'];
      const r = Object.fromEntries(cols.map((c) => [c, 'Zelda Quixmore']));
      expect(() => parseSocrataReport([r, null, 5, 'x'], d, { now: NOW })).not.toThrow();
      expect(hay(parseSocrata([r], d))).not.toMatch(PERSON);
    }
  });
});
