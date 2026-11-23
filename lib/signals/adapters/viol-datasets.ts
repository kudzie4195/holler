import type { CategoryRule, SocrataDataset } from './socrata-datasets';
import type { ArcgisDataset } from './arcgis-datasets';

/**
 * ROUND 20 VIOL: code-violation and building-problem 311 feeds for metros that lacked them (New York HPD and rodent findings, Washington DC
 * 311, Montgomery County MD housing code for the Washington metro). EVERY entry is ON PROBATION (`probation: true`) and schema-unverified
 * (`schemaUnverified: true`), exactly like round 19 coverage (lib/signals/adapters/coverage-datasets.ts): its rows go to holler_source_samples
 * only, never to a member, a card, an email, a push, a public page or a count, until the owner has probed it
 * (/api/admin/coverage-probe?source=<id>), read real samples and promoted it (LAUNCH.md, "Round 20 violations and inspections").
 *
 * Provenance: /home/claude/gates/r20/VIOL-research.md (2026-11-22). NO data row was ever pulled from these portals (the sandbox cannot reach
 * them). Column tags:
 *   [O]  read on the publisher's own page or service (HPD data dictionary, DC layer field list)
 *   [3P] read on a third-party page that documents the data (column names may be stale)
 *   [A]  assumed (API spelling of a documented column, a value vocabulary, a volume)
 * Socrata: a schema-unverified dataset asks ONLY for the columns it reads ($select), so a person column the portal has is never downloaded,
 * and a 400 for an unknown column is reported as "schema mismatch". ArcGIS: the layer's field list is read first and only configured columns
 * that exist are asked for (outFields).
 *
 * PRIVACY. Never named here, so never fetched: Phoenix NSD owner, complainant and inspector columns (whatever their names); HPD Apartment and Story (they locate a unit), owner and registration contacts (other datasets);
 * DC 311 INSPECTORNAME (staff) and DETAILS (resident free text); Montgomery unitNumber and locationDescription (free text). No entry carries a
 * contact spec (violations and 311 rows never get contacts). Addresses are block level (socrata.ts publicAddress / blockAddress) after the
 * shared site-address rule (strictAddress, lib/contacts cleanAddress); 311 summaries carry no address at all. HPD order texts are read for
 * trades only and never printed (freeTextFields): the card title uses fixed words for its trades (permit-privacy.ts civicLabel).
 *
 * INSPECTIONS. The shared inspection path is the FOOD path ("Failed inspection in <city>: food establishment"; migration 0007 rewrites every
 * source whose id ends in "-inspections" to that title). A DOHMH rodent inspection that finds active rat signs is an order to the owner at a
 * named address, so it is modelled as a violation, and its id deliberately does NOT end in "-inspections".
 */

const D = (domain: string, id: string) => `https://${domain}/api/views/${id}.json`;
const M = (layerUrl: string) => `${layerUrl}?f=json`;
const NYC = 'data.cityofnewyork.us';
const MONTGOMERY = 'data.montgomerycountymd.gov';
export const PHOENIX_NSD_LAYER = 'https://maps.phoenix.gov/pub/rest/services/Public/NSD_Property_Maintenance/MapServer/0';
export const DC_311_LAYER = 'https://maps2.dcgis.dc.gov/DCGIS/rest/services/DCGIS_DATA/ServiceRequests/MapServer/13';
const CHECKED = '2026-11-22';

/**
 * Server-side narrowing of the DC 311 layer to request types that can name a trade (the same keywords the Socrata 311 feeds use,
 * socrata-datasets.ts CIVIC_TYPE_KEYWORDS, re-checked client side by CIVIC_RULES). Literal ArcGIS SQL, no user input.
 */
export const DC_311_TYPE_WHERE = [
  // Review P3-8: no 'RAT' (it matches ADMINISTRATION, REGISTRATION) and no 'TREE' (it matches STREET); rodent types say RODENT.
  'RODENT', 'PEST', 'GRAFFITI', 'DUMP', 'JUNK', 'DEBRIS', 'HEAT', 'SEWER', 'MOLD', 'BULK', 'HOUSING', 'BLDG', 'WEED', 'GRASS', 'VACANT',
]
  .map((k) => `UPPER(SERVICECODEDESCRIPTION) LIKE '%${k}%'`)
  .join(' OR ');

/**
 * Review P3-2: HPD order wording the shared violation rules do not read. HPD only (SocrataDataset.extraRules), so no live source changes.
 * Order texts these were written from (HPD form [A]): "§ 27-2031 ADM CODE PROVIDE HOT WATER AT ALL HOT WATER FIXTURES", "REPAIR THE BROKEN
 * OR DEFECTIVE RADIATOR", "ABATE THE NUISANCE CONSISTING OF STOPPAGE IN THE TOILET", "PROVIDE AN APPROVED AND OPERATIONAL CARBON MONOXIDE
 * DETECTING DEVICE". Elevator orders are deliberately NOT mapped: no Holler trade does elevator work (it needs a licensed elevator
 * contractor), so such a row names no trade and is dropped.
 */
export const HPD_EXTRA_RULES: CategoryRule[] = [
  { re: /\bhot water\b/i, add: ['plumbing'] },
  { re: /\bradiators?\b/i, add: ['hvac'] },
  { re: /\b(?:stoppage|clogged|stopped up)\b/i, add: ['plumbing'] },
  { re: /carbon monoxide|\bco detect/i, add: ['electrical'] },
];

/** Review P3-3: Montgomery reads its condition "Inoperable" only with a vehicle item (a towing or hauling job); otherwise the item alone. */
export function montgomeryText(get: (field: string) => string): string {
  const item = get('item');
  const condition = get('condition');
  const vehicle = /\b(?:vehicle|car|auto|truck|trailer|boat|motorcycle|rv)\b/i.test(item);
  const keep = /\binoperable\b/i.test(condition) && !vehicle ? condition.replace(/\binoperable\b/gi, '').trim() : condition;
  return [item, keep].filter(Boolean).join(' | ');
}

export const VIOL_SOCRATA_DATASETS: SocrataDataset[] = [
  // ---- New York --------------------------------------------------------------------------------------------------------------------
  {
    id: 'socrata-nyc-hpd-violations', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: NYC, datasetId: 'wvxf-dwi5',
    kind: 'civic', subtype: 'violation', idField: 'violationid', dateField: 'novissueddate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['novdescription'], textFields: ['novdescription'], freeTextFields: ['novdescription'], summaryFields: ['currentstatus'], extraRules: HPD_EXTRA_RULES,
    addressFields: ['housenumber', 'streetname'], zipField: 'zip', strictAddress: true, addressRule: 'nyc',
    extraWhere: "violationstatus = 'Open' AND class IN ('B','C')",
    lookbackOverride: 2, maxPages: 6, windowForwardDays: 0, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: D(NYC, 'wvxf-dwi5'), fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 VIOL). HPD Housing Maintenance Code Violations, "updated daily", last modified 2026-11-17 [O]. Columns from HPD\'s own data dictionary [O]; their SODA spelling (lower case, no spaces) and latitude/longitude are [A]. Classes B (hazardous) and C (immediately hazardous) only: class A includes paperwork orders ("FILE ANNUAL BEDBUG REPORT") and I is informational. NOVDescription is the order number\'s fixed text plus a location tail ("AT NORTH WALL IN THE BATHROOM LOCATED AT APT 2A"): classified, never printed. Apartment and Story are never requested. About 7,000 B and C violations a week [A]: 2 day window, 6 pages; a full last page is reported as "row cap reached".',
  },
  {
    id: 'socrata-nyc-rodent-violations', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: NYC, datasetId: 'p937-wjvj',
    kind: 'civic', subtype: 'violation', idField: 'job_ticket_or_work_order_id', dateField: 'inspection_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['result'], textFields: ['result'], summaryFields: ['inspection_type'],
    addressFields: ['house_number', 'street_name'], zipField: 'zip_code', strictAddress: true, addressRule: 'nyc',
    extraWhere: "upper(result) like '%RAT%'",
    lookbackOverride: 7, maxPages: 2, windowForwardDays: 0, cadenceMinutes: 720, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: D(NYC, 'p937-wjvj'), fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 VIOL). DOHMH Rodent Inspection (Pest Control Database), last modified 2026-11-17 [O]. Columns inspection_type, result, inspection_date, street_name, zip_code, latitude, longitude [3P]; job_ticket_or_work_order_id and house_number [A]. Only rows whose result names rats ("Rat Activity" [A]) are read: an active-rat finding is an order to the owner of a named property, so it is a VIOLATION record (the "-inspections" food path and migration 0007 would title it "food establishment"). About 600 rows a week [A]. No person column is known [3P].',
  },
  // ---- Washington DC metro (Montgomery County, MD) ----------------------------------------------------------------------------------
  {
    id: 'socrata-montgomery-violations', city: 'Montgomery County', state: 'MD', countyAnchor: { lat: 39.084, lon: -77.1528 }, tz: 'America/New_York',
    domain: MONTGOMERY, datasetId: 'k9nj-z35d',
    kind: 'civic', subtype: 'violation', idField: 'violation_id', dateField: 'date_inspected', latField: 'latitude', lonField: 'longitude',
    titleFields: ['item', 'condition'], textFields: ['item', 'condition'], textOf: montgomeryText, summaryFields: ['condition', 'violation_category'],
    addressFields: ['street_address'], zipField: 'zip_code', strictAddress: true,
    extraWhere: 'date_corrected IS NULL',
    lookbackOverride: 30, maxPages: 2, windowForwardDays: 0, cadenceMinutes: 720, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: D(MONTGOMERY, 'k9nj-z35d'), fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 VIOL). Montgomery County MD "Housing Code Violations" (2013 to present), weekly, last modified 2026-11-15 [O]. 28 columns read from a third-party analysis in camel case (caseId, violationId, dateInspected, dateCorrected, streetAddress, zipCode, item, condition, violationCategory, latitude, longitude ...) [3P]; the snake_case API spelling is [A]. item and condition are the county\'s fixed code lists ("Water Heater", "Windows", "Water/Mold-Light", "Windows/doors") [3P]. unitNumber and locationDescription are never requested. Uncorrected violations only. 30 day window: the county portal lags about two weeks (socrata-montgomery-permits). About 300 rows a week [A].',
  },
];

export const VIOL_ARCGIS_DATASETS: ArcgisDataset[] = [
  // ---- Phoenix (scorecard priority: a code-enforcement feed with a street address in a metro that has none) ------------------------
  {
    id: 'arcgis-phoenix-violations', city: 'Phoenix', state: 'AZ', tz: 'America/Phoenix', layerUrl: PHOENIX_NSD_LAYER,
    kind: 'civic', subtype: 'violation', idField: 'CASE_NUMBER', dateField: 'OPEN_DATE', dateType: 'date',
    titleFields: ['CASE_TYPE'], textFields: ['CASE_TYPE', 'VIOLATION_TYPE', 'VIOLATION_DESC'], summaryFields: ['CASE_TYPE', 'CASE_STATUS'],
    addressFields: ['ADDRESS'], zipField: 'ZIP', strictAddress: true,
    windowForwardDays: 0, lookbackOverride: 14, cadenceMinutes: 720, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(PHOENIX_NSD_LAYER), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 VIOL, scorecard priority). City of Phoenix Neighborhood Services "NSD Property Maintenance", MapServer layer 0: "complaints made on properties in the City of Phoenix", subject to the phoenixopendata.com Terms of Use [O: item info]. The layer\'s FIELD LIST WAS NOT READABLE here: EVERY column name is [A] (CASE_NUMBER, OPEN_DATE, CASE_TYPE, VIOLATION_TYPE, VIOLATION_DESC, CASE_STATUS, ADDRESS, ZIP). The adapter reads the layer\'s own field list first: a missing id or date column is "schema mismatch: expected CASE_NUMBER, OPEN_DATE" with no data query, and the probe lists the real column names, so one probe gives the fix. Owner, complainant and inspector columns are never named. The same cases are published as a CSV on phoenixopendata.com ("Property Maintenance Data") [O]. Freshness and volume not known [A]: 14 day window.',
  },
  {
    id: 'arcgis-dc-311', city: 'Washington', state: 'DC', tz: 'America/New_York', layerUrl: DC_311_LAYER,
    kind: 'civic', subtype: '311', idField: 'SERVICEREQUESTID', dateField: 'ADDDATE', dateType: 'date', latField: 'LATITUDE', lonField: 'LONGITUDE',
    titleFields: ['SERVICECODEDESCRIPTION'], textFields: ['SERVICECODEDESCRIPTION', 'SERVICETYPECODEDESCRIPTION'],
    summaryFields: ['SERVICECODEDESCRIPTION', 'SERVICEORDERSTATUS'], zipField: 'ZIPCODE',
    extraWhere: DC_311_TYPE_WHERE,
    lookbackOverride: 2, windowForwardDays: 0, cadenceMinutes: 180, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(DC_311_LAYER), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION (round 20 VIOL). DC 311 "All Service Requests - Last 90 Days", MapServer layer 13 (a rolling layer: no yearly swap). Field names [O] from the 2026 layer (21) of the same service; that layer 13 has the same names is [A] (the service says it matches the current fiscal year layer). INSPECTORNAME (staff) and DETAILS (resident free text) are never requested. Request types were not read [A]: most are city work (rodent baiting, bulk pickup, dumping), which the current 311 rules leave as context; only types that name a building problem reach a member. 311 summaries carry no address.',
  },
];
