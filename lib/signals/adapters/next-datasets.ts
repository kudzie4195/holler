import type { ContactSpec } from '@/lib/contacts/extract';
import type { ArcgisDataset } from './arcgis-datasets';
import type { SocrataDataset } from './socrata-datasets';
import { isCompanyForm, isPremisesNaics, isStorefrontNaics } from './next-filters';

/**
 * ROUND 20 NEXT: new-business feeds (Texas Comptroller sales-tax outlets, TABC pending liquor applications, Miami-Dade business tax, Phoenix
 * liquor licences) and certificates of occupancy (Los Angeles, New York, Washington DC). EVERY entry is ON PROBATION (`probation: true`) with
 * `schemaUnverified: true`, exactly like the round 19 coverage feeds (coverage-datasets.ts): its rows go to holler_source_samples only, never
 * to a member, a card, an email, a public page or a count, until the owner has read real samples (GET /api/admin/coverage-probe?source=<id>)
 * and promoted it (LAUNCH.md, "Round 20 next sources").
 *
 * Provenance: /home/claude/gates/r20/SCOUT-research.md (2026-11-22). NO data row was pulled from any of these sources and no Socrata column list
 * was read in this unit (shell curl cannot reach the portals). Research tags per column:
 *   [O]  the research opened the publisher's own page or layer and read the field list
 *   [3P] a third-party page (data.gov catalogue, firecrawl dictionaries)
 *   [A]  assumed (Socrata's usual lower_snake form of a published column title, or a guess)
 * The adapter treats a missing id or date column as "schema mismatch: expected <col>" (an error the sources report shows); any other missing
 * column leaves its field empty (ArcGIS: never asked for; Socrata: $select refuses an unknown column with HTTP 400, also reported as a
 * schema mismatch).
 *
 * PRIVACY (round 20 rules):
 *   - Texas Comptroller: Taxpayer Name and Taxpayer Address are NEVER requested. A row is dropped before anything is built unless its
 *     organisation type reads as a company form (next-filters.ts isCompanyForm: sole owners, individuals and unknown values are dropped;
 *     fail closed) and its NAICS code is a storefront sector (722, 44-45, 811, 812). The taxpayer number is used only inside a KEYED
 *     external id (hashId: HMAC with a server secret, lib/signals/id-key.ts; no secret, no request). The outlet name is a business name: it is stored (private contacts) only when it passes the licence name rule.
 *   - TABC: the owner column is NEVER requested; same company-form and name rules.
 *   - Miami-Dade business tax: OWNERNAME, MAILNAME, MAIL* and EMAIL are NEVER requested. BUSNAME and PHONENO go through the licence name rule
 *     (a phone is kept only next to a name that passed).
 *   - Phoenix liquor: only the licence, series, address and date columns; the licensee/agent columns are never named.
 *   - Certificates of occupancy: no applicant, owner, occupant, permittee or agent column is ever named (DC PROPERTY_OWNER, OWNER_ADDRESS,
 *     PERMISSION_GRANTED_TO and TRADING_AS are never in outFields). A contractor name is a business only through the existing name rules. A
 *     residential certificate prints its block only and a home occupation nothing (review fix P2-3; New York: every row, no type column).
 *   - Review fix P1-2: every Socrata source here sends its column allow-list ($select) on every request, also after promotion (selectOnly).
 *   - A new-business card prints the business PREMISES address only when its name passed (socrata-datasets.ts `premises`); a CO card prints
 *     the building address through lib/contacts cleanAddress (strictAddress).
 */

const CHECKED = '2026-11-22';
const D = (domain: string, id: string) => `https://${domain}/api/views/${id}.json`;
const M = (layerUrl: string) => `${layerUrl}?f=json`;

/** lib/geo/metros.ts centres. */
const DFW_CENTRE = { lat: 32.7831, lon: -96.8067 } as const;
const HOU_CENTRE = { lat: 29.7633, lon: -95.3633 } as const;

// ---- Texas Comptroller "Active Sales Tax Permit Holders" (jrea-zgmq) ------------------------------------------------------------------

/** Texas Comptroller county numbers (alphabetical, 001 Anderson ... 254 Zavala) [A]. Inside or reaching into 25 miles of the centre. */
const DFW_COUNTIES = ['057', '043', '061', '220']; // Dallas, Collin, Denton, Tarrant (Arlington; Fort Worth rows fall outside the ZIP radius)
const HOU_COUNTIES = ['101', '079', '020']; // Harris, Fort Bend (Sugar Land), Brazoria (Pearland)
const countyIn = (field: string, codes: string[]) => `${field} in (${[...codes, ...codes.map((c) => String(Number(c)))].map((c) => `'${c}'`).join(',')})`;

const TX_SALES_COLUMNS = '[A] outlet_name, outlet_address, outlet_city, outlet_zip_code, outlet_county_code, outlet_naics_code, outlet_permit_issue_date, taxpayer_number, outlet_number, taxpayer_organizational_type (Socrata names of the column titles read on the Comptroller page [O])';

/** A Texas sales-tax outlet is kept only for a company form and a storefront NAICS sector (fail closed on blank or unknown). */
export const txSalesKeep = (get: (f: string) => string) => isCompanyForm(get('taxpayer_organizational_type')) && isStorefrontNaics(get('outlet_naics_code'));

/** The outlet as a business: its name through the licence name rule; its address only next to a name that passed. Never the taxpayer. */
export const TX_SALES_PREMISES: ContactSpec = {
  verifiedUrl: 'https://comptroller.texas.gov/transparency/open-data/recent-sales-tax-permits',
  checkedOn: CHECKED,
  fieldStatus: 'assumed',
  assumedFields: ['outlet_name', 'outlet_address', 'outlet_city', 'outlet_zip_code'],
  orgs: [{ role: 'business', nameFields: ['outlet_name'], storefront: true }],
  site: { addressFields: ['outlet_address'], cityField: 'outlet_city', zipField: 'outlet_zip_code', onlyWithOrganisation: true },
};

function txSales(id: string, city: string, near: { lat: number; lon: number }, counties: string[]): SocrataDataset {
  return {
    id, city, state: 'TX', tz: 'America/Chicago', domain: 'data.texas.gov', datasetId: 'jrea-zgmq', label: 'Texas open data: new sales tax permits',
    kind: 'civic', subtype: 'business', idField: 'outlet_number', idFields: ['taxpayer_number', 'outlet_number'], hashId: true,
    dateField: 'outlet_permit_issue_date', zipField: 'outlet_zip_code', zipCentroid: { near, maxMi: 30 },
    titleFields: [], textFields: ['outlet_naics_code'], summaryFields: [], naicsField: 'outlet_naics_code', naicsText: true,
    // Review fixes: the keep columns are requested (P1-1); the allow-list stays after promotion (P1-2); the premises address is printed
    // only for a commercial-premises NAICS class (P2-2).
    keepRow: txSalesKeep, keepFields: ['taxpayer_organizational_type', 'outlet_naics_code'], selectOnly: true,
    premises: TX_SALES_PREMISES, premisesWhen: (get) => isPremisesNaics(get('outlet_naics_code')), contacts: TX_SALES_PREMISES,
    extraWhere: countyIn('outlet_county_code', counties),
    lookbackOverride: 7, maxPages: 3, windowForwardDays: 0, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true, verifiedUrl: D('data.texas.gov', 'jrea-zgmq'), fieldSource: 'assumed',
    note: `ON PROBATION (round 20 NEXT). Texas Comptroller "Active Sales Tax Permit Holders", statewide, catalogue modified 2026-10-24 [3P]; the Comptroller page lists the columns [O] and says its "recent" report covers the week before its update; refresh cadence not stated. Socrata field names ${TX_SALES_COLUMNS}. Volume [A]: about 2,000-2,500 new outlets a week statewide, 100-200 a week per metro after the NAICS filter. County codes in the query are [A] (both '057' and '57' forms). Rows are placed at the outlet ZIP centroid (no coordinates). Taxpayer Name and Address are never requested; sole proprietors are dropped before storage (keepRow).`,
  };
}

// ---- TABC "Pending Original New License Applications" (mxm5-tdpj), the backup -----------------------------------------------------

/** TABC: company form only (ownership type, [A]); fail closed. */
export const tabcKeep = (get: (f: string) => string) => isCompanyForm(get('ownership_type'));

export const TABC_PREMISES: ContactSpec = {
  verifiedUrl: 'https://catalog.data.gov/dataset/pending-original-new-primary-and-subordinate-license-applications',
  checkedOn: CHECKED,
  fieldStatus: 'assumed',
  assumedFields: ['trade_name', 'address', 'city', 'zip'],
  orgs: [{ role: 'business', nameFields: ['trade_name'], storefront: true }],
  site: { addressFields: ['address'], cityField: 'city', zipField: 'zip', onlyWithOrganisation: true },
};

function tabc(id: string, city: string, near: { lat: number; lon: number }, counties: string[]): SocrataDataset {
  return {
    id, city, state: 'TX', tz: 'America/Chicago', domain: 'data.texas.gov', datasetId: 'mxm5-tdpj', label: 'Texas open data: pending liquor license applications',
    kind: 'civic', subtype: 'business', idField: 'application_id', dateField: 'received_date', zipField: 'zip', zipCentroid: { near, maxMi: 30 },
    titleFields: [], textFields: ['license_type'], summaryFields: ['license_type'],
    keepRow: tabcKeep, keepFields: ['ownership_type'], selectOnly: true, premises: TABC_PREMISES, contacts: TABC_PREMISES,
    // On-premise alcohol (a bar or restaurant) is a food premises: pest control too. Package stores and distributors are not.
    extraRules: [{ re: /mixed beverage|on.?premise|food and beverage|restaurant|brewpub|wine and malt beverage retailer|beer retailer/i, add: ['pest-control'], unless: /package|off.?premise|distributor|wholesal|manufactur|carrier/i }],
    extraWhere: `upper(county) in (${counties.map((c) => `'${c}'`).join(',')})`,
    lookbackOverride: 14, windowForwardDays: 0, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true, verifiedUrl: D('data.texas.gov', 'mxm5-tdpj'), fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 NEXT, backup for the sales-tax outlets). TABC "Pending Original New Primary and Subordinate License Applications": received or in review, "current through midnight of the previous day", renewals excluded; catalogue modified 2026-10-26 [3P]. EVERY column name is ASSUMED [A]: application_id, received_date, license_type, trade_name, address, city, zip, county, ownership_type. The owner column is never requested; an application whose ownership type is not a company form is dropped before storage (keepRow, fail closed).',
  };
}

// ---- Certificates of occupancy (Socrata) -----------------------------------------------------------------------------------------------

const LA_CO_CONTACTS: ContactSpec = {
  verifiedUrl: 'https://www.firecrawl.dev/alexandria/agents/providers/data-lacity-org',
  checkedOn: CHECKED,
  fieldStatus: 'assumed',
  assumedFields: ['contractor_business_name', 'address', 'zip_code'],
  site: { addressFields: ['address'], zipField: 'zip_code' },
  // The contractor licence number is NOT read (a licence can belong to a sole proprietor; tests/contacts/permit-sources.test.ts).
  orgs: [{ role: 'contractor', nameFields: ['contractor_business_name'] }],
};

const NYC_CO_CONTACTS: ContactSpec = {
  verifiedUrl: 'https://catalog.data.gov/dataset/dob-now-certificate-of-occupancy',
  checkedOn: CHECKED,
  fieldStatus: 'assumed',
  assumedFields: ['house_no', 'street_name', 'postcode'],
  site: { addressFields: ['house_no', 'street_name'], zipField: 'postcode' },
};

export const NEXT_SOCRATA_DATASETS: SocrataDataset[] = [
  txSales('socrata-txsales-dallas-business', 'Dallas', DFW_CENTRE, DFW_COUNTIES),
  txSales('socrata-txsales-houston-business', 'Houston', HOU_CENTRE, HOU_COUNTIES),
  tabc('socrata-tabc-dallas-business', 'Dallas', DFW_CENTRE, ['DALLAS', 'COLLIN', 'DENTON', 'TARRANT']),
  tabc('socrata-tabc-houston-business', 'Houston', HOU_CENTRE, ['HARRIS', 'FORT BEND', 'BRAZORIA']),
  {
    id: 'socrata-la-occupancy-permits', city: 'Los Angeles', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.lacity.org', datasetId: '3f9m-afei', label: 'Los Angeles open data: certificates of occupancy',
    kind: 'permit', subtype: 'permit', idField: 'cofo_number', dateField: 'cofo_issue_date', latField: 'latitude', lonField: 'longitude',
    occupancy: { typeFields: ['permit_sub_type', 'permit_type'] }, selectOnly: true,
    titleFields: ['permit_sub_type', 'permit_type'], textFields: ['permit_type', 'permit_sub_type', 'work_description'], freeTextFields: ['work_description'],
    summaryFields: ['permit_sub_type'], addressFields: ['address'], zipField: 'zip_code', strictAddress: true, contacts: LA_CO_CONTACTS,
    lookbackOverride: 14, maxPages: 2, windowForwardDays: 0, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true, verifiedUrl: D('data.lacity.org', '3f9m-afei'), fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 NEXT). LADBS "Building and Safety Certificate of Occupancy", modified 2026-11-16 [3P]; LADBS loads new certificates weekly on Mondays [3P]. Columns per a third-party dictionary [3P] (permit_number, cofo_number, address, ZIP, lat/lon, permit type/class, description, valuation, housing units, issued and completed dates, contractor company and licence); the Socrata spellings used here are [A]. 14 day window: weekly loads. work_description is classified but never printed. Each row is a certificate of occupancy: stage certificate_of_occupancy, occupancy trades.',
  },
  {
    id: 'socrata-nyc-occupancy-permits', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: 'pkdm-hqz6', label: 'New York City open data: certificates of occupancy',
    kind: 'permit', subtype: 'permit', idField: 'job_filing_name', dateField: 'c_of_o_issuance_date', latField: 'latitude', lonField: 'longitude',
    // Review fix P2-3: no building-type column is known, so every row is treated as residential (block level only).
    occupancy: { typeFields: ['c_of_o_filing_type'], unknownType: true }, selectOnly: true,
    titleFields: ['c_of_o_filing_type'], textFields: ['c_of_o_filing_type', 'c_of_o_status'], summaryFields: ['c_of_o_status', 'borough'],
    addressFields: ['house_no', 'street_name'], zipField: 'postcode', strictAddress: true, contacts: NYC_CO_CONTACTS,
    lookbackOverride: 14, windowForwardDays: 0, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true, verifiedUrl: D('data.cityofnewyork.us', 'pkdm-hqz6'), fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 NEXT). NYC DOB NOW "Certificate of Occupancy", modified 2026-11-17 [3P]: job filing name, BIN, address, CO status, sequence, label and issuance date; no owner or applicant name mentioned [3P]. Every Socrata spelling here is [A]. New York numbered streets ("EAST 130 STREET") may not pass the shared cleanAddress rule: such a row prints no address (the r20-viol New York reader can replace it at integration).',
  },
];

// ---- ArcGIS: Miami-Dade business tax, Phoenix liquor licences, DC certificates of occupancy --------------------------------------------

export const MIAMIDADE_BUSINESS = 'https://gisweb.miamidade.gov/arcgis/rest/services/BusinessTracker/MapServer/0';
export const PHOENIX_LIQUOR_RESTAURANTS = 'https://maps.phoenix.gov/pub/rest/services/public/LIQUOR_RACMap/MapServer/11';
export const DC_OCCUPANCY = 'https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/Business_Licensing_and_Grants_WebMercator/FeatureServer/46';

/** Miami-Dade: NEWBUS must say new (Y, YES, TRUE, T, 1, NEW; any case). Fails closed on a blank or other value. */
export const miamiNewBusiness = (get: (f: string) => string) => /^(?:y|yes|true|t|1|new)$/i.test(get('NEWBUS').replace(/\s+/g, ''));

const MIAMI_BUSINESS_SPEC: ContactSpec = {
  verifiedUrl: M(MIAMIDADE_BUSINESS),
  checkedOn: CHECKED,
  fieldStatus: 'sourced',
  orgs: [{ role: 'business', nameFields: ['BUSNAME'], phoneField: 'PHONENO', homeFields: ['CLASSDESC', 'OCCDESC'], storefront: false }],
  site: { addressFields: ['BUSADDR1'], cityField: 'BUSCITY', zipField: 'ZIPCODE', onlyWithOrganisation: true },
};

const PHOENIX_LIQUOR_SPEC: ContactSpec = {
  verifiedUrl: M(PHOENIX_LIQUOR_RESTAURANTS),
  checkedOn: CHECKED,
  fieldStatus: 'assumed',
  assumedFields: ['BUSINESS_NAME', 'ADDRESS', 'ZIP'],
  orgs: [{ role: 'business', nameFields: ['BUSINESS_NAME'], storefront: true }],
  site: { addressFields: ['ADDRESS'], zipField: 'ZIP', onlyWithOrganisation: true },
};


export const NEXT_ARCGIS_DATASETS: ArcgisDataset[] = [
  {
    id: 'arcgis-miamidade-business', city: 'Miami-Dade County', state: 'FL', tz: 'America/New_York', layerUrl: MIAMIDADE_BUSINESS,
    countyAnchor: { lat: 25.7743, lon: -80.1937 },
    kind: 'civic', subtype: 'business', idField: 'OBJECTID', dateField: 'BUSSDATE', dateType: 'date', latField: 'LAT', lonField: 'LON',
    titleFields: [], textFields: ['CLASSDESC', 'CATGRYNAME', 'OCCDESC'], summaryFields: ['CATGRYNAME', 'CLASSDESC'], zipField: 'ZIPCODE',
    keepRow: miamiNewBusiness, keepFields: ['NEWBUS'], premises: MIAMI_BUSINESS_SPEC, contacts: MIAMI_BUSINESS_SPEC,
    windowForwardDays: 0, cadenceMinutes: 720, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(MIAMIDADE_BUSINESS), checkedOn: CHECKED, fieldSource: 'sourced',
    note: 'ON PROBATION (round 20 NEXT). Miami-Dade "BusinessTracker" Local Business Tax layer 0, point layer, max 1,000 rows a page. Fields [O]: BUSNAME, BUSADDR1-3, BUSCITY, ZIPCODE, GEOADDR, BUSSDATE (start date), BUSCDATE, NEWBUS, CLASSCODE/CLASSDESC, CATGRYNAME, OCCDESC, BUSNAICSCD, PHONENO, EMAIL, LAT/LON, ACCSTATUS. OBJECTID as the id is [A] (every ArcGIS layer has an object id; it may change on a full reload). Update cadence not stated [A]. NEWBUS values are [A]: a row is kept only when it reads as new (fail closed). OWNERNAME, MAILNAME, MAIL* and EMAIL are NEVER requested.',
  },
  {
    id: 'arcgis-phoenix-liquor-business', city: 'Phoenix', state: 'AZ', tz: 'America/Phoenix', layerUrl: PHOENIX_LIQUOR_RESTAURANTS, label: 'Phoenix open data: restaurant liquor licenses',
    kind: 'civic', subtype: 'business', idField: 'LICENSE_NUMBER', dateField: 'ISSUE_DATE', dateType: 'date',
    titleFields: [], textFields: ['LICENSE_TYPE', 'SERIES'], summaryFields: ['LICENSE_TYPE'], zipField: 'ZIP',
    // The layer is the series 12 (restaurant) group: every row is a food premises.
    extraRules: [{ re: /./, add: ['pest-control'] }],
    premises: PHOENIX_LIQUOR_SPEC, contacts: PHOENIX_LIQUOR_SPEC, lookbackOverride: 30,
    windowForwardDays: 0, cadenceMinutes: 720, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(PHOENIX_LIQUOR_RESTAURANTS), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 NEXT). City of Phoenix LIQUOR_RACMap MapServer: 14 layers, one per licence series, "all liquor license applicants and licensees grouped by license series number", updates hourly [O, service description]. The layer index of series 12 (restaurant) and EVERY field name here are ASSUMED [A]: LICENSE_NUMBER, ISSUE_DATE, LICENSE_TYPE, SERIES, BUSINESS_NAME, ADDRESS, ZIP. 30 day window: an issued restaurant licence is a slow trickle. Licensee and agent columns are never named.',
  },
  {
    id: 'arcgis-dc-occupancy-permits', city: 'Washington', state: 'DC', tz: 'America/New_York', layerUrl: DC_OCCUPANCY, label: 'Washington open data: certificates of occupancy',
    kind: 'permit', subtype: 'permit', idField: 'OBJECTID', dateField: 'ISSUE_DATE', dateType: 'date',
    occupancy: { typeFields: ['APPROVED_ZONING_USE', 'DESCRIPTION_OF_OCCUPANCY'] }, keepQuadrant: true,
    titleFields: ['APPROVED_ZONING_USE'], textFields: ['DESCRIPTION_OF_OCCUPANCY', 'APPROVED_ZONING_USE'], freeTextFields: ['DESCRIPTION_OF_OCCUPANCY'],
    summaryFields: ['APPROVED_ZONING_USE'], addressFields: ['ADDRESS'], strictAddress: true,
    // Review fix P2-3: no contact spec at all. The occupant columns (PERMISSION_GRANTED_TO, TRADING_AS) are never requested, and the private
    // site would lose the quadrant (lib/contacts cleanAddress): the public summary carries the address with its quadrant instead.
    lookbackOverride: 14, windowForwardDays: 0, cadenceMinutes: 720, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(DC_OCCUPANCY), checkedOn: CHECKED, fieldSource: 'sourced',
    note: 'ON PROBATION (round 20 NEXT). DC "Certificate of Occupancy" FeatureServer layer 46, catalogue modified 2026-11-17 [3P], max 2,000 rows a page. Fields [O]: ADDRESS, ISSUE_DATE, PERMISSION_GRANTED_TO, TRADING_AS, DESCRIPTION_OF_OCCUPANCY, APPROVED_ZONING_USE, OCCUPANCY_LOAD, PROPERTY_OWNER, OWNER_ADDRESS. OBJECTID as the id is [A]. PROPERTY_OWNER, OWNER_ADDRESS, PERMISSION_GRANTED_TO and TRADING_AS (owner and occupant) are NEVER in outFields. A residential certificate prints its block only, a home occupation nothing; the quadrant (NW, NE, SW, SE) is kept. DESCRIPTION_OF_OCCUPANCY is classified but never printed (free text).',
  },
];

/** Every source id this unit added (probation), for the probation list, the probe and the tests. */
export const NEXT_SOURCE_IDS: readonly string[] = [...NEXT_SOCRATA_DATASETS, ...NEXT_ARCGIS_DATASETS].map((d) => d.id);
