import type { CategoryId } from '@/lib/signals/categories';

/**
 * Config for the Socrata (SODA) adapters. Every dataset id and field name below was read from the
 * portal's own metadata endpoint (https://<domain>/api/views/<id>.json) on 2026-11-16 via WebFetch.
 * `verifiedUrl` is the exact URL checked. Datasets with `verified: false` are disabled by default.
 *
 * Label key:  sourced = read from the portal metadata (column names + types)
 *             assumed = inferred (value vocabularies such as permit_type text, failure rules)
 */

export type SocrataSubtype = 'permit' | '311' | 'inspection';

export interface CategoryRule {
  re: RegExp;
  add: CategoryId[];
  severity?: 1 | 2 | 3;
}

export interface SocrataDataset {
  /** Adapter id and signal `source`. */
  id: string;
  city: string;
  state: string;
  domain: string;
  datasetId: string;
  kind: 'permit' | 'civic';
  subtype: SocrataSubtype;
  /** Row field that uniquely identifies the record (combined with the date for inspections). */
  idField: string;
  /** calendar_date column used for $where / $order. */
  dateField: string;
  latField?: string;
  lonField?: string;
  /** Socrata `location`/`point` column ({latitude,longitude} or GeoJSON Point). */
  locationField?: string;
  /** Text column that holds "(lat, lon)" (Dallas). Format assumed. */
  latLonTextField?: string;
  /** Used only when the dataset has no usable coordinates: city centre, flagged approx in `data`. */
  fallbackCenter?: { lat: number; lon: number };
  /** Fields joined to build the title. First non-empty for permits, all unique for 311. */
  titleFields: string[];
  /** Fields concatenated and fed to the category rules and classifyText. */
  textFields: string[];
  summaryFields: string[];
  addressFields?: string[];
  /** Business name field (inspections). */
  nameField?: string;
  zipField?: string;
  /** Raw SoQL appended with AND. Only used when the column type is sourced. */
  extraWhere?: string;
  /** 311 only: server-side narrowing on this text column with upper(col) like '%KEYWORD%'. */
  typeFilterField?: string;
  /** Inspections only: true when the row counts as a failed / critical inspection. */
  isFailure?: (row: Record<string, unknown>) => boolean;
  cadenceMinutes: number;
  verified: boolean;
  verifiedUrl: string;
  fieldSource: 'sourced' | 'assumed';
  note?: string;
}

// --- Category rules ---------------------------------------------------------------------------

export const PERMIT_RULES: CategoryRule[] = [
  { re: /\bre-?roof|\broof|\bshingle/i, add: ['roofing'] },
  { re: /\bpools?\b|\bspa\b|swimming/i, add: ['pool-spa'] },
  { re: /\bsolar|photovoltaic|\bpv\b/i, add: ['solar'] },
  { re: /\bhvac|mechanical|furnace|air.?condition|\ba\/c\b|heat pump|ductwork|\bboiler/i, add: ['hvac'] },
  { re: /\bplumb|water heater|\bsewer|backflow|gas line/i, add: ['plumbing'] },
  { re: /\belectric|\bwiring|\bpanel upgrade|service upgrade|ev charger|generator/i, add: ['electrical'] },
  { re: /\bdemolition|\bdemo\b|wrecking|\braze\b/i, add: ['junk-removal'] },
  {
    re: /new (construction|single|residential|building|home|dwelling|house|multi|commercial)/i,
    add: ['general-contractor', 'landscaping', 'cleaning'],
  },
];

export const CIVIC_RULES: CategoryRule[] = [
  { re: /\brodent|\brats?\b|\bmice\b|\bmouse\b|vermin|infestation|roach|bed ?bug/i, add: ['pest-control'] },
  { re: /\btrees?\b|\blimbs?\b|\bstump/i, add: ['tree-service'] },
  { re: /graffiti/i, add: ['painting', 'cleaning'] },
  {
    re: /illegal dump|\bdumping|bulk(y)? (item|trash|pick)|\bjunk|\bdebris|abandoned (furniture|mattress)/i,
    add: ['junk-removal'],
  },
  { re: /no heat|\bheat\b|heating|\bboiler|hot water/i, add: ['hvac', 'plumbing'], severity: 2 },
  { re: /\bsewer|water (main|leak)|\bhydrant|\bflood/i, add: ['plumbing'] },
  { re: /\bmold\b/i, add: ['restoration'] },
];

/** Applied to every row that passed the dataset's failure test. */
export const INSPECTION_RULES: CategoryRule[] = [
  { re: /./, add: ['pest-control', 'cleaning', 'janitorial-commercial'], severity: 2 },
];

export const RULES_BY_SUBTYPE: Record<SocrataSubtype, CategoryRule[]> = {
  permit: PERMIT_RULES,
  '311': CIVIC_RULES,
  inspection: INSPECTION_RULES,
};

/** Keywords for the server-side upper(type) like '%X%' narrowing of 311 feeds (re-checked client side). */
export const CIVIC_TYPE_KEYWORDS = [
  'RODENT', 'RAT', 'MICE', 'VERMIN', 'PEST', 'TREE', 'GRAFFITI', 'DUMP', 'JUNK', 'DEBRIS', 'HEAT', 'SEWER', 'MOLD', 'BULK',
];

// --- Failure rules for inspections -------------------------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

const chicagoFail = (r: Record<string, unknown>) => str(r.results).toLowerCase().startsWith('fail');
// NYC DOHMH: one row per violation. Grade-C territory is a score of 28+; critical violations only.
const nycFail = (r: Record<string, unknown>) =>
  str(r.critical_flag).toLowerCase() === 'critical' && Number(r.score) >= 28;
const austinFail = (r: Record<string, unknown>) => Number(r.score) < 70;

const D = (domain: string, id: string) => `https://${domain}/api/views/${id}.json`;

// --- Datasets ---------------------------------------------------------------------------------

export const SOCRATA_DATASETS: SocrataDataset[] = [
  // ---- Chicago ----
  {
    id: 'socrata-chicago-permits', city: 'Chicago', state: 'IL', domain: 'data.cityofchicago.org', datasetId: 'ydr8-5enu',
    kind: 'permit', subtype: 'permit', idField: 'permit_', dateField: 'issue_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['work_description', 'permit_type'], textFields: ['work_description', 'permit_type', 'work_type'],
    summaryFields: ['permit_type', 'work_type', 'reported_cost'], addressFields: ['street_number', 'street_direction', 'street_name'],
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cityofchicago.org', 'ydr8-5enu'), fieldSource: 'sourced',
    note: 'Column names sourced. permit_type vocabulary ("PERMIT - NEW CONSTRUCTION", etc.) assumed.',
  },
  {
    id: 'socrata-chicago-311', city: 'Chicago', state: 'IL', domain: 'data.cityofchicago.org', datasetId: 'v6vf-nfxy',
    kind: 'civic', subtype: '311', idField: 'sr_number', dateField: 'created_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['sr_type'], textFields: ['sr_type'], summaryFields: ['sr_type', 'status', 'zip_code'], zipField: 'zip_code',
    typeFilterField: 'sr_type', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.cityofchicago.org', 'v6vf-nfxy'),
    fieldSource: 'sourced',
  },
  {
    id: 'socrata-chicago-inspections', city: 'Chicago', state: 'IL', domain: 'data.cityofchicago.org', datasetId: '4ijn-s7e5',
    kind: 'civic', subtype: 'inspection', idField: 'inspection_id', dateField: 'inspection_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['dba_name'], textFields: ['dba_name', 'facility_type', 'violations'], nameField: 'dba_name',
    summaryFields: ['facility_type', 'results', 'inspection_type'], addressFields: ['address'], zipField: 'zip',
    extraWhere: "results = 'Fail'", isFailure: chicagoFail, cadenceMinutes: 720, verified: true,
    verifiedUrl: D('data.cityofchicago.org', '4ijn-s7e5'), fieldSource: 'sourced',
    note: "results = 'Fail' value is assumed from Chicago's public documentation of the field.",
  },
  // ---- New York City ----
  {
    id: 'socrata-nyc-permits', city: 'New York City', state: 'NY', domain: 'data.cityofnewyork.us', datasetId: 'rbx6-tga4',
    kind: 'permit', subtype: 'permit', idField: 'work_permit', dateField: 'issued_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['job_description', 'work_type'], textFields: ['job_description', 'work_type', 'permittee_s_license_type'],
    summaryFields: ['work_type', 'estimated_job_costs', 'borough'], addressFields: ['house_no', 'street_name', 'borough'], zipField: 'zip_code',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cityofnewyork.us', 'rbx6-tga4'), fieldSource: 'sourced',
    note: 'DOB NOW: Build approved permits. The legacy BIS set (ipu4-2q9a) stores dates as text, so it is not used.',
  },
  {
    id: 'socrata-nyc-311', city: 'New York City', state: 'NY', domain: 'data.cityofnewyork.us', datasetId: 'erm2-nwe9',
    kind: 'civic', subtype: '311', idField: 'unique_key', dateField: 'created_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['complaint_type', 'descriptor'], textFields: ['complaint_type', 'descriptor'], summaryFields: ['complaint_type', 'descriptor', 'borough'],
    zipField: 'incident_zip', typeFilterField: 'complaint_type', cadenceMinutes: 180, verified: true,
    verifiedUrl: D('data.cityofnewyork.us', 'erm2-nwe9'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-nyc-inspections', city: 'New York City', state: 'NY', domain: 'data.cityofnewyork.us', datasetId: '43nn-pn8j',
    kind: 'civic', subtype: 'inspection', idField: 'camis', dateField: 'inspection_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['dba'], textFields: ['dba', 'cuisine_description', 'violation_description'], nameField: 'dba',
    summaryFields: ['violation_description', 'score', 'grade'], addressFields: ['building', 'street', 'boro'], zipField: 'zipcode',
    isFailure: nycFail, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.cityofnewyork.us', '43nn-pn8j'), fieldSource: 'sourced',
    note: 'One row per violation; the parser dedupes to one signal per camis + inspection_date. Score >= 28 and critical_flag = Critical is assumed.',
  },
  // ---- San Francisco ----
  {
    id: 'socrata-sf-permits', city: 'San Francisco', state: 'CA', domain: 'data.sf.gov', datasetId: 'i98e-djp9',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issued_date', locationField: 'location',
    titleFields: ['description', 'permit_type_definition'], textFields: ['description', 'permit_type_definition', 'proposed_use'],
    summaryFields: ['permit_type_definition', 'estimated_cost', 'status'], addressFields: ['street_number', 'street_name', 'street_suffix'], zipField: 'zipcode',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.sf.gov', 'i98e-djp9'), fieldSource: 'sourced',
    note: 'data.sfgov.org redirects (302) to data.sf.gov; both hosts serve SODA.',
  },
  {
    id: 'socrata-sf-311', city: 'San Francisco', state: 'CA', domain: 'data.sf.gov', datasetId: 'vw6y-z8j6',
    kind: 'civic', subtype: '311', idField: 'service_request_id', dateField: 'requested_datetime', latField: 'lat', lonField: 'long',
    titleFields: ['service_name', 'service_subtype'], textFields: ['service_name', 'service_subtype', 'service_details'],
    summaryFields: ['service_name', 'service_subtype', 'service_details'], typeFilterField: 'service_name', cadenceMinutes: 180,
    verified: true, verifiedUrl: D('data.sf.gov', 'vw6y-z8j6'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-sf-inspections', city: 'San Francisco', state: 'CA', domain: 'data.sf.gov', datasetId: 'pyih-qa8i',
    kind: 'civic', subtype: 'inspection', idField: 'inspection_id', dateField: 'inspection_date', latField: 'business_latitude', lonField: 'business_longitude',
    titleFields: ['business_name'], textFields: ['business_name', 'violation_description'], nameField: 'business_name',
    summaryFields: ['violation_description', 'inspection_score'], addressFields: ['business_address'],
    isFailure: (r) => Number(r.inspection_score) < 70, cadenceMinutes: 720, verified: false, verifiedUrl: D('data.sf.gov', 'pyih-qa8i'),
    fieldSource: 'sourced', note: 'DISABLED: dataset is "Health Inspection Scores (2016-2019)", last updated 2021-09-24. No current SF inspection set verified.',
  },
  // ---- Austin ----
  {
    id: 'socrata-austin-permits', city: 'Austin', state: 'TX', domain: 'data.austintexas.gov', datasetId: '3syk-w9eu',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issue_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['description', 'permit_type_desc'], textFields: ['description', 'permit_type_desc', 'work_class', 'permit_class_mapped'],
    summaryFields: ['permit_type_desc', 'work_class', 'total_job_valuation'], addressFields: ['original_address1'], zipField: 'original_zip',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.austintexas.gov', '3syk-w9eu'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-austin-311', city: 'Austin', state: 'TX', domain: 'data.austintexas.gov', datasetId: 'xwdj-i9he',
    kind: 'civic', subtype: '311', idField: 'sr_number', dateField: 'sr_created_date', latField: 'sr_location_lat', lonField: 'sr_location_long',
    titleFields: ['sr_type_desc'], textFields: ['sr_type_desc'], summaryFields: ['sr_type_desc', 'sr_department_desc', 'sr_status_desc'],
    zipField: 'sr_location_zip_code', typeFilterField: 'sr_type_desc', cadenceMinutes: 180, verified: true,
    verifiedUrl: D('data.austintexas.gov', 'xwdj-i9he'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-austin-inspections', city: 'Austin', state: 'TX', domain: 'data.austintexas.gov', datasetId: 'ecmv-9xxi',
    kind: 'civic', subtype: 'inspection', idField: 'inspectionid', dateField: 'inspection_date', latField: 'lat', lonField: 'lng',
    titleFields: ['restaurant_name'], textFields: ['restaurant_name', 'process_description'], nameField: 'restaurant_name',
    summaryFields: ['process_description', 'score'], addressFields: ['address'], zipField: 'zip_code',
    extraWhere: 'score < 70', isFailure: austinFail, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.austintexas.gov', 'ecmv-9xxi'),
    fieldSource: 'sourced', note: 'score is a number column (sourced). The < 70 failing threshold is assumed. Dataset last updated 2026-11-01.',
  },
  // ---- Seattle ----
  {
    id: 'socrata-seattle-permits', city: 'Seattle', state: 'WA', domain: 'data.seattle.gov', datasetId: '76t5-zqzr',
    kind: 'permit', subtype: 'permit', idField: 'permitnum', dateField: 'issueddate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['description', 'permittypedesc'], textFields: ['description', 'permittypedesc', 'permitclass'],
    summaryFields: ['permittypedesc', 'permitclass', 'estprojectcost'], addressFields: ['originaladdress1'], zipField: 'originalzip',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.seattle.gov', '76t5-zqzr'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-seattle-311', city: 'Seattle', state: 'WA', domain: 'data.seattle.gov', datasetId: '5ngg-rpne',
    kind: 'civic', subtype: '311', idField: 'servicerequestnumber', dateField: 'createddate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['webintakeservicerequests'], textFields: ['webintakeservicerequests', 'departmentname'], summaryFields: ['departmentname', 'webintakeservicerequests'],
    zipField: 'zipcode', cadenceMinutes: 180, verified: false, verifiedUrl: D('data.seattle.gov', '5ngg-rpne'), fieldSource: 'sourced',
    note: 'DISABLED: dataset and columns verified, but it has no request-type column (only department + a web-intake flag), so rows cannot be classified into trades.',
  },
  // ---- Los Angeles ----
  {
    id: 'socrata-la-permits', city: 'Los Angeles', state: 'CA', domain: 'data.lacity.org', datasetId: 'pi9x-tg5x',
    kind: 'permit', subtype: 'permit', idField: 'permit_nbr', dateField: 'issue_date', latField: 'lat', lonField: 'lon',
    titleFields: ['work_desc', 'permit_sub_type'], textFields: ['work_desc', 'permit_type', 'permit_sub_type', 'use_desc'],
    summaryFields: ['permit_type', 'permit_sub_type', 'valuation'], addressFields: ['primary_address'], zipField: 'zip_code',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.lacity.org', 'pi9x-tg5x'), fieldSource: 'sourced',
    note: 'Last updated 2026-11-08 at time of check. LA 311 and LA inspection datasets: no ID verified, not included.',
  },
  // ---- Dallas ----
  {
    id: 'socrata-dallas-311', city: 'Dallas', state: 'TX', domain: 'www.dallasopendata.com', datasetId: 'd7e7-envw',
    kind: 'civic', subtype: '311', idField: 'unique_key', dateField: 'created_date', latLonTextField: 'lat_location',
    fallbackCenter: { lat: 32.7767, lon: -96.797 },
    titleFields: ['service_request_type'], textFields: ['service_request_type', 'department'], summaryFields: ['service_request_type', 'department', 'status'],
    typeFilterField: 'service_request_type', cadenceMinutes: 180, verified: true, verifiedUrl: D('www.dallasopendata.com', 'd7e7-envw'),
    fieldSource: 'sourced', note: 'lat_location is a text column; its string format is assumed (parsed as two decimals), else falls back to city centre.',
  },
  {
    id: 'socrata-dallas-permits', city: 'Dallas', state: 'TX', domain: 'www.dallasopendata.com', datasetId: 'e7gq-4sah',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issued_date', fallbackCenter: { lat: 32.7767, lon: -96.797 },
    titleFields: ['work_description', 'permit_type'], textFields: ['work_description', 'permit_type', 'land_use'],
    summaryFields: ['permit_type', 'value'], addressFields: ['street_address'], zipField: 'zip_code', cadenceMinutes: 360,
    verified: false, verifiedUrl: D('www.dallasopendata.com', 'e7gq-4sah'), fieldSource: 'sourced',
    note: 'DISABLED: issued_date is a text column (SoQL range filters on text are unreliable) and there are no coordinates.',
  },
  // ---- New Orleans ----
  {
    id: 'socrata-nola-permits', city: 'New Orleans', state: 'LA', domain: 'data.nola.gov', datasetId: 'rcm3-fn58',
    kind: 'permit', subtype: 'permit', idField: 'numstring', dateField: 'issuedate', locationField: 'location_1',
    titleFields: ['description', 'type'], textFields: ['description', 'type', 'projectname'],
    summaryFields: ['type', 'currentstatus', 'constrval'], addressFields: ['address'], cadenceMinutes: 360,
    verified: true, verifiedUrl: D('data.nola.gov', 'rcm3-fn58'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-nola-311', city: 'New Orleans', state: 'LA', domain: 'data.nola.gov', datasetId: '2jgv-pqrq',
    kind: 'civic', subtype: '311', idField: 'service_request', dateField: 'date_created', latField: 'latitude', lonField: 'longitude',
    titleFields: ['request_type', 'request_reason'], textFields: ['request_type', 'request_reason'],
    summaryFields: ['request_type', 'request_reason', 'request_status'], typeFilterField: 'request_type', cadenceMinutes: 180,
    verified: true, verifiedUrl: D('data.nola.gov', '2jgv-pqrq'), fieldSource: 'sourced',
  },
  // ---- Baton Rouge ----
  {
    id: 'socrata-batonrouge-permits', city: 'Baton Rouge', state: 'LA', domain: 'data.brla.gov', datasetId: '7fq7-8j7r',
    kind: 'permit', subtype: 'permit', idField: 'permitnumber', dateField: 'issueddate', latField: 'lat', lonField: 'long',
    titleFields: ['projectdescription', 'permittype'], textFields: ['projectdescription', 'permittype', 'designation'],
    summaryFields: ['permittype', 'designation', 'projectvalue'], addressFields: ['streetaddress'], zipField: 'zip',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.brla.gov', '7fq7-8j7r'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-batonrouge-311', city: 'Baton Rouge', state: 'LA', domain: 'data.brla.gov', datasetId: '7ixm-mnvx',
    kind: 'civic', subtype: '311', idField: 'id', dateField: 'createdate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['typename'], textFields: ['typename', 'parenttype', 'comments'], summaryFields: ['parenttype', 'typename', 'statusdesc'],
    typeFilterField: 'typename', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.brla.gov', '7ixm-mnvx'), fieldSource: 'sourced',
    note: 'Dataset page located via catalog.data.gov (https://catalog.data.gov/dataset/311-citizen-requests-for-service); columns read from metadata. Last updated 2026-10-28.',
  },
  // ---- Cincinnati ----
  {
    id: 'socrata-cincinnati-permits', city: 'Cincinnati', state: 'OH', domain: 'data.cincinnati-oh.gov', datasetId: 'thvx-5mem',
    kind: 'permit', subtype: 'permit', idField: 'number_key', dateField: 'date_issued', fallbackCenter: { lat: 39.1031, lon: -84.512 },
    titleFields: ['desc_of_work', 'comp_type_desc'], textFields: ['desc_of_work', 'comp_type_desc', 'sub_type_desc'],
    summaryFields: ['comp_type_desc', 'sub_type_desc'], addressFields: ['location'], cadenceMinutes: 360,
    verified: true, verifiedUrl: D('data.cincinnati-oh.gov', 'thvx-5mem'), fieldSource: 'sourced',
    note: 'No lat/lon columns (location is text), so signals carry the city centre and data.approxLocation = true. Rows are plan-review comments; the parser dedupes on number_key.',
  },
  {
    id: 'socrata-cincinnati-311', city: 'Cincinnati', state: 'OH', domain: 'data.cincinnati-oh.gov', datasetId: 'gcej-gmiw',
    kind: 'civic', subtype: '311', idField: 'sr_number', dateField: 'date_created', latField: 'latitude', lonField: 'longitude',
    titleFields: ['sr_type_desc'], textFields: ['sr_type_desc', 'group_title'], summaryFields: ['sr_type_desc', 'group_title', 'sr_status'],
    zipField: 'zipcode', typeFilterField: 'sr_type_desc', cadenceMinutes: 180, verified: true,
    verifiedUrl: D('data.cincinnati-oh.gov', 'gcej-gmiw'), fieldSource: 'sourced',
  },
];

/**
 * Atlanta: NOT included. A search for an official City of Atlanta building-permit endpoint found only
 * the Sacramento ArcGIS service (services5.arcgis.com/54falWtcpty3V47Z, owner contact sacgis@cityofsacramento.org)
 * and DeKalb County. No Atlanta-owned endpoint was verified, so nothing is configured.
 */
export const ATLANTA_NOTE = 'No verified Atlanta open-data permit endpoint; not configured.';

export function datasetPageUrl(ds: SocrataDataset): string {
  return `https://${ds.domain}/d/${ds.datasetId}`;
}
