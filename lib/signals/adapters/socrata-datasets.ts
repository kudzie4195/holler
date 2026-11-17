import type { CategoryId } from '@/lib/signals/categories';

/**
 * Config for the Socrata (SODA) adapters. Every dataset id and field name below was read from the
 * portal's own metadata endpoint (https://<domain>/api/views/<id>.json) on 2026-11-16 via WebFetch.
 * `verifiedUrl` is the exact URL checked. Datasets with `verified: false` are disabled by default.
 *
 * Label key:  sourced = read from the portal metadata (column names + types)
 *             assumed = inferred (value vocabularies such as permit_type text, failure rules)
 */

export type SocrataSubtype = 'permit' | '311' | 'inspection' | 'business' | 'violation' | 'event-permit';

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
  /** IANA zone of the portal's floating (zoneless) timestamps; they hold local wall-clock time. */
  tz: string;
  datasetId: string;
  kind: 'permit' | 'civic' | 'event';
  subtype: SocrataSubtype;
  /** Row field that uniquely identifies the record (combined with the date for inspections). */
  idField: string;
  /** Datasets with no single id column: these fields are joined with ':' to build the external id. */
  idFields?: string[];
  /** calendar_date column used for $where / $order. */
  dateField: string;
  latField?: string;
  lonField?: string;
  /** Socrata `location`/`point` column ({latitude,longitude} or GeoJSON Point). */
  locationField?: string;
  /** Text column that holds "(lat, lon)" (Dallas). Format assumed. */
  latLonTextField?: string;
  /** County-level feeds only: a point inside the county (the county seat). Used to say which city pages the rows land on. */
  countyAnchor?: { lat: number; lon: number };
  /** Used only when the dataset has no usable coordinates: city centre, flagged approx in `data`. */
  fallbackCenter?: { lat: number; lon: number };
  /** Fields joined to build the title. First non-empty for permits, all unique for 311. */
  titleFields: string[];
  /** Fields concatenated and fed to the category rules and classifyText. */
  textFields: string[];
  summaryFields: string[];
  addressFields?: string[];
  /** Overrides the default lookback (days) of the $where window. */
  lookbackOverride?: number;
  /** When set, adds `dateField <= now + N days` (0 = never in the future). Needed for upcoming events and for portals that carry future-dated rows. */
  windowForwardDays?: number;
  /** Event permits: column holding the end of the event, used as expiresAt. */
  endDateField?: string;
  /** Business name field (inspections). */
  nameField?: string;
  zipField?: string;
  /**
   * Business feeds with no license-type text: a NAICS code column. Its first two digits name a sector (NAICS_SECTORS), which becomes the
   * title and summary ("New business license in San Francisco: Food service"). The code itself is never stored.
   */
  naicsField?: string;
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

/**
 * Column names that can hold a person's name (owner, applicant, DBA, requestor, host...). Business, violation and event-permit
 * datasets must never read one of these into a title, summary, address or classifier text, because the output is stored and shown
 * publicly. Enforced by tests/signals/adapters/privacy.test.ts. `NAME_COLUMN_OK` lists place or type columns that merely end in "name".
 */
export const NAME_LIKE_COLUMN =
  /(dba|owner|applicant|contact|licensee|requestor|requester|inspector|complainant|legal|business_name|ownership|permittee|contractor|host|organization|trade_name|first_name|last_name|full_name|restaurant_name|(^|_)name$)/i;
export const NAME_COLUMN_OK = ['park_facility_name'];
/** Subtypes whose records can describe a private individual (sole proprietors, home addresses, private hosts). */
export const PERSON_RISK_SUBTYPES: SocrataSubtype[] = ['business', 'violation', 'event-permit'];

const NEW_HOME_NOUN = '(?:single.?fam\\w*|multi.?family|dwellings?|residences?|res\\.|townhomes?|townhouses?|apartments?|condo\\w*|duplex|triplex|fourplex|sfr|sfd)';
const NEW_HOME_ACCESSORY =
  '(?:garage|barn|shed|accessory|carport|pool|greenhouse|stable|coop|poultry|chicken|livestock|agricultur\\w*|farm|gazebo|pergola|solar|pv)';
/**
 * New residential construction. Positive: "new" or "erect", then at most 5 plain words, then a residential noun (single family, dwelling,
 * residence, "res.", duplex, sfr, sfd and so on), all inside one field; or "new home", "new house", "new residential" back to back.
 * Negative: the row is an accessory or farm structure only when the accessory noun is the head noun after "new" or "erect" with no
 * residential noun in between ("New single story detached 3 car garage", "New residential solar PV system"). A house that merely has a
 * garage or carport ("New construction of a 2-story single family residence with attached garage") still counts. Checked against 19 live
 * Austin new residential permits (verify round 2 P2-4: the earlier "garage anywhere" exclusion dropped 8 of the 10 houses it should keep).
 * Exported for tests and for lib/signals/capabilities.ts (which reads the rule table).
 */
export const NEW_HOME_RE = new RegExp(
  `^(?![\\s\\S]*?(?:\\b(?:new|erect)\\b(?:\\s+(?!${NEW_HOME_NOUN})[\\w/.-]+){0,5}?\\s+(?:detached\\s+)?${NEW_HOME_ACCESSORY}\\b|\\bnew\\s+residential\\s+${NEW_HOME_ACCESSORY}\\b))` +
    `[\\s\\S]*?(?:\\b(?:new|erect)\\b(?:\\s+[\\w/.\\-\\[\\]]+){0,5}?\\s+${NEW_HOME_NOUN}(?![\\w])|\\bnew\\s+(?:home|house|residential)\\b)`,
  'i',
);

/** NAICS two-digit sectors (the public Census Bureau list), shortened for a title. Codes 31 to 33, 44 to 45 and 48 to 49 are single sectors. */
export const NAICS_SECTORS: Record<string, string> = {
  '11': 'Farming and fishing',
  '21': 'Mining and oil and gas',
  '22': 'Utilities',
  '23': 'Construction',
  '31': 'Manufacturing',
  '32': 'Manufacturing',
  '33': 'Manufacturing',
  '42': 'Wholesale trade',
  '44': 'Retail',
  '45': 'Retail',
  '48': 'Transportation and warehousing',
  '49': 'Transportation and warehousing',
  '51': 'Information and media',
  '52': 'Finance and insurance',
  '53': 'Real estate and rental',
  '54': 'Professional, scientific and technical services',
  '55': 'Company management',
  '56': 'Administrative and support services',
  '61': 'Education',
  '62': 'Health care and social assistance',
  '71': 'Arts, entertainment and recreation',
  '72': 'Food service and lodging',
  '81': 'Other services',
  '92': 'Public administration',
};

export const PERMIT_RULES: CategoryRule[] = [
  { re: /\bre-?roof|\broof|\bshingle/i, add: ['roofing'] },
  { re: /\bpools?\b|\bspa\b|swimming/i, add: ['pool-spa'] },
  { re: /\bsolar|photovoltaic|\bpv\b/i, add: ['solar'] },
  { re: /\bhvac|mechanical|furnace|air.?condition|\ba\/c\b|heat pump|ductwork|\bboiler|\bheating\b/i, add: ['hvac'] },
  { re: /\bplumb|water heater|\bsewer|backflow|gas line/i, add: ['plumbing'] },
  { re: /\belectric|\bwiring|\bpanel upgrade|service upgrade|ev charger|generator/i, add: ['electrical'] },
  { re: /\bdemolition|\bdemo\b|wrecking|\braze\b/i, add: ['junk-removal'] },
  {
    re: /new (construction|single|residential|building|home|dwelling|house|multi|commercial)/i,
    add: ['general-contractor', 'landscaping', 'cleaning'],
  },
  // A new home gets sold and then moved into: new RESIDENTIAL construction is a lead for agents and movers.
  // The words "new" and a residential noun must sit close together inside one field (no "|" between them), so a furnace "for home" or a
  // class label ("New | Residential") never counts. Agricultural and accessory structures never count, wherever the word appears
  // ("New single story Chicken Barn accessory building" and "New single story detached 3 car garage" are live Austin rows, verify.md P2-8).
  { re: NEW_HOME_RE, add: ['real-estate', 'moving'] },
  // Trades added in round 2.
  { re: /\bfenc(e|es|ing)\b|\bfendrive\b/i, add: ['fencing'] },
  { re: /\bdriveways?\b|\bconcrete\b|\bpaving\b|\bpavers?\b|\bsidewalks?\b|\basphalt\b|\bflatwork\b|\bfendrive\b/i, add: ['concrete-paving'] },
  { re: /\bwindows?\b|\bdoors?\b/i, add: ['windows-doors'] },
  { re: /\bsiding\b|\bgutters?\b|\bdownspouts?\b|\bsoffits?\b|\bfascia\b/i, add: ['siding-gutters'] },
  // "floor" alone is in most commercial descriptions ("6th floor office"), so only flooring work phrases count.
  { re: /\bflooring\b|\bhardwood\b|\bfloor (replacement|installation|covering|refinish)|\b(replace|install|new) floors?\b/i, add: ['flooring'] },
  { re: /\bsigns?\b|\bsignage\b/i, add: ['signs-printing'] },
];

export const CIVIC_RULES: CategoryRule[] = [
  { re: /\brodent|\brats?\b|\bmice\b|\bmouse\b|vermin|infestation|roach|bed ?bug/i, add: ['pest-control'] },
  { re: /\btrees?\b|\blimbs?\b|\bstump/i, add: ['tree-service'] },
  { re: /graffiti/i, add: ['painting', 'cleaning'] },
  {
    re: /illegal dump|\billdump\b|\bdumping|bulk(y)? (item|trash|pick)|\bbulky\b|\bjunk|\bdebris|abandoned (furniture|mattress)/i,
    add: ['junk-removal'],
  },
  { re: /\bweeds?\b|\bovergrown|\b(high|tall) grass|\bvacant lot/i, add: ['lawn-care', 'landscaping'] },
  { re: /\bproperty violation|\bhealthy homes|\bbldgmaint\b|\bbuilding maint|\bvacant (building|house|structure)/i, add: ['general-contractor', 'handyman'] },
  { re: /no heat|\bheat\b|heating|\bboiler|hot water/i, add: ['hvac', 'plumbing'], severity: 2 },
  { re: /\bsewer|water (main|leak)|\bhydrant|\bflood/i, add: ['plumbing'] },
  { re: /\bmold\b/i, add: ['restoration'] },
];

/** Code and building enforcement. Text is the violation type or description only (never inspector comments or owner fields). */
export const VIOLATION_RULES: CategoryRule[] = [
  { re: /\bweeds?\b|\bovergrown|\b(high|tall) grass|\bgrass\b|\bvegetation|\bbrush\b/i, add: ['lawn-care', 'landscaping'] },
  { re: /property abatement/i, add: ['junk-removal', 'lawn-care', 'landscaping'] },
  { re: /\btrash|\brubbish|\bgarbage|\bdebris|\bjunk|\bdump|\bbulk|\blitter|\bwaste\b|\btires?\b/i, add: ['junk-removal'] },
  { re: /\binoperable|\babandoned vehicle|\bjunk vehicle/i, add: ['towing', 'junk-removal'] },
  { re: /\brodent|\brats?\b|\bmice\b|\bvermin|\binfest|\broach|\bbed ?bug|\bpests?\b/i, add: ['pest-control'] },
  { re: /\broof|\bshingle/i, add: ['roofing', 'general-contractor'] },
  { re: /\bsiding\b|\bgutters?\b|\bsoffits?\b|\bfascia\b/i, add: ['siding-gutters', 'general-contractor'] },
  {
    re: /exterior wall|\bfacade|\bmasonry|\bbrick\b|\bstucco|\bfoundation|\bporch|\bstair|\bdeck\b|\bbalcon|\bstructur|\bunsafe|\bdilapidat|\bdeteriorat|\bcollapse|\bvacant|\bboarded|\bbuilding maint|\bdemolition|without (a )?permit|\bunpermitted/i,
    add: ['general-contractor', 'handyman'],
  },
  { re: /\bunsafe|\bdangerous|\bcollapse|\bimminent/i, add: [], severity: 2 },
  { re: /\bfenc(e|es|ing)\b/i, add: ['fencing'] },
  { re: /\bwindows?\b|\bdoors?\b/i, add: ['windows-doors', 'handyman'] },
  { re: /\bpaint|\bpeeling|\bgraffiti/i, add: ['painting'] },
  { re: /\bplumb|\bsewer|\bwater (leak|heater)|\bleak/i, add: ['plumbing'] },
  { re: /\belectric|\bwiring|\bsmoke detector/i, add: ['electrical'] },
  { re: /\bheat\b|\bheating|\bfurnace|\bboiler|\bhvac|\bair.?condition/i, add: ['hvac'] },
  { re: /\bmold\b|\bwater damage|\bfire damage|\bflood/i, add: ['restoration'] },
  { re: /\bdriveway|\bsidewalk|\bpavement|\bconcrete|\bparking lot|\basphalt/i, add: ['concrete-paving'] },
  { re: /\bfloors?\b/i, add: ['flooring'] },
  { re: /\btrees?\b|\blimbs?\b|\bstump/i, add: ['tree-service'] },
  { re: /\bpools?\b|\bswimming/i, add: ['pool-spa'] },
];

/**
 * A new business needs signs, books, insurance, cleaning, security and keys/lock hardware for the new space.
 * Food businesses also need pest control and HVAC. Only the license type and activity are ever classified or stored,
 * never a business or owner name (see NAME_COLUMN in tests/signals/business-privacy.test.ts).
 */
export const BUSINESS_RULES: CategoryRule[] = [
  { re: /./, add: ['signs-printing', 'business-services', 'insurance', 'janitorial-commercial', 'security', 'cleaning', 'locksmith'] },
  {
    re: /restau|\bcafe\b|coffee|bakery|\bpizza|\btaco|\bgrill\b|kitchen|\bfood\b|\bdeli\b|\bbbq\b|barbecue|\bbar\b|tavern|brew|sushi|diner|eatery|bistro|burger|retail food|\bliquor|catering/i,
    add: ['pest-control', 'hvac'],
  },
];

/** A permitted event needs food, event services, security and cleanup. */
export const EVENT_RULES: CategoryRule[] = [
  { re: /./, add: ['food-truck', 'catering', 'event-services', 'security', 'cleaning'] },
];

/** Applied to every row that passed the dataset's failure test. */
export const INSPECTION_RULES: CategoryRule[] = [
  { re: /./, add: ['pest-control', 'cleaning', 'janitorial-commercial'], severity: 2 },
];

export const RULES_BY_SUBTYPE: Record<SocrataSubtype, CategoryRule[]> = {
  permit: PERMIT_RULES,
  '311': CIVIC_RULES,
  inspection: INSPECTION_RULES,
  business: BUSINESS_RULES,
  violation: VIOLATION_RULES,
  'event-permit': EVENT_RULES,
};

/** Keywords for the server-side upper(type) like '%X%' narrowing of 311 feeds (re-checked client side). */
export const CIVIC_TYPE_KEYWORDS = [
  'RODENT', 'RAT', 'MICE', 'VERMIN', 'PEST', 'TREE', 'GRAFFITI', 'DUMP', 'JUNK', 'DEBRIS', 'HEAT', 'SEWER', 'MOLD', 'BULK',
  'PROPERTY VIOL', 'HEALTHY HOMES', 'BLDG', 'WEED', 'OVERGROWN', 'VACANT',
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
    id: 'socrata-chicago-permits', city: 'Chicago', state: 'IL', tz: 'America/Chicago', domain: 'data.cityofchicago.org', datasetId: 'ydr8-5enu',
    kind: 'permit', subtype: 'permit', idField: 'permit_', dateField: 'issue_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['work_description', 'permit_type'], textFields: ['work_description', 'permit_type', 'work_type'],
    summaryFields: ['permit_type', 'work_type', 'reported_cost'], addressFields: ['street_number', 'street_direction', 'street_name'],
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cityofchicago.org', 'ydr8-5enu'), fieldSource: 'sourced',
    note: 'Column names sourced. permit_type vocabulary ("PERMIT - NEW CONSTRUCTION", etc.) assumed.',
  },
  {
    id: 'socrata-chicago-311', city: 'Chicago', state: 'IL', tz: 'America/Chicago', domain: 'data.cityofchicago.org', datasetId: 'v6vf-nfxy',
    kind: 'civic', subtype: '311', idField: 'sr_number', dateField: 'created_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['sr_type'], textFields: ['sr_type'], summaryFields: ['sr_type', 'status', 'zip_code'], zipField: 'zip_code',
    typeFilterField: 'sr_type', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.cityofchicago.org', 'v6vf-nfxy'),
    fieldSource: 'sourced',
  },
  {
    id: 'socrata-chicago-inspections', city: 'Chicago', state: 'IL', tz: 'America/Chicago', domain: 'data.cityofchicago.org', datasetId: '4ijn-s7e5',
    kind: 'civic', subtype: 'inspection', idField: 'inspection_id', dateField: 'inspection_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['dba_name'], textFields: ['dba_name', 'facility_type', 'violations'], nameField: 'dba_name',
    summaryFields: ['facility_type', 'results', 'inspection_type'], addressFields: ['address'], zipField: 'zip',
    extraWhere: "results = 'Fail'", isFailure: chicagoFail, cadenceMinutes: 720, verified: true,
    verifiedUrl: D('data.cityofchicago.org', '4ijn-s7e5'), fieldSource: 'sourced',
    note: "results = 'Fail' value is assumed from Chicago's public documentation of the field.",
  },
  // ---- New York City ----
  {
    id: 'socrata-nyc-permits', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: 'rbx6-tga4',
    kind: 'permit', subtype: 'permit', idField: 'work_permit', dateField: 'issued_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['job_description', 'work_type'], textFields: ['job_description', 'work_type', 'permittee_s_license_type'],
    summaryFields: ['work_type', 'estimated_job_costs', 'borough'], addressFields: ['house_no', 'street_name', 'borough'], zipField: 'zip_code',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cityofnewyork.us', 'rbx6-tga4'), fieldSource: 'sourced',
    note: 'DOB NOW: Build approved permits. The legacy BIS set (ipu4-2q9a) stores dates as text, so it is not used.',
  },
  {
    id: 'socrata-nyc-311', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: 'erm2-nwe9',
    kind: 'civic', subtype: '311', idField: 'unique_key', dateField: 'created_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['complaint_type', 'descriptor'], textFields: ['complaint_type', 'descriptor'], summaryFields: ['complaint_type', 'descriptor', 'borough'],
    zipField: 'incident_zip', typeFilterField: 'complaint_type', cadenceMinutes: 180, verified: true,
    verifiedUrl: D('data.cityofnewyork.us', 'erm2-nwe9'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-nyc-inspections', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: '43nn-pn8j',
    kind: 'civic', subtype: 'inspection', idField: 'camis', dateField: 'inspection_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['dba'], textFields: ['dba', 'cuisine_description', 'violation_description'], nameField: 'dba',
    summaryFields: ['violation_description', 'score', 'grade'], addressFields: ['building', 'street', 'boro'], zipField: 'zipcode',
    isFailure: nycFail, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.cityofnewyork.us', '43nn-pn8j'), fieldSource: 'sourced',
    note: 'One row per violation; the parser dedupes to one signal per camis + inspection_date. Score >= 28 and critical_flag = Critical is assumed.',
  },
  // ---- San Francisco ----
  {
    id: 'socrata-sf-permits', city: 'San Francisco', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.sf.gov', datasetId: 'i98e-djp9',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issued_date', locationField: 'location',
    titleFields: ['description', 'permit_type_definition'], textFields: ['description', 'permit_type_definition', 'proposed_use'],
    summaryFields: ['permit_type_definition', 'estimated_cost', 'status'], addressFields: ['street_number', 'street_name', 'street_suffix'], zipField: 'zipcode',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.sf.gov', 'i98e-djp9'), fieldSource: 'sourced',
    note: 'data.sfgov.org redirects (302) to data.sf.gov; both hosts serve SODA.',
  },
  {
    id: 'socrata-sf-311', city: 'San Francisco', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.sf.gov', datasetId: 'vw6y-z8j6',
    kind: 'civic', subtype: '311', idField: 'service_request_id', dateField: 'requested_datetime', latField: 'lat', lonField: 'long',
    titleFields: ['service_name', 'service_subtype'], textFields: ['service_name', 'service_subtype', 'service_details'],
    summaryFields: ['service_name', 'service_subtype', 'service_details'], typeFilterField: 'service_name', cadenceMinutes: 180,
    verified: true, verifiedUrl: D('data.sf.gov', 'vw6y-z8j6'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-sf-inspections', city: 'San Francisco', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.sf.gov', datasetId: 'pyih-qa8i',
    kind: 'civic', subtype: 'inspection', idField: 'inspection_id', dateField: 'inspection_date', latField: 'business_latitude', lonField: 'business_longitude',
    titleFields: ['business_name'], textFields: ['business_name', 'violation_description'], nameField: 'business_name',
    summaryFields: ['violation_description', 'inspection_score'], addressFields: ['business_address'],
    isFailure: (r) => Number(r.inspection_score) < 70, cadenceMinutes: 720, verified: false, verifiedUrl: D('data.sf.gov', 'pyih-qa8i'),
    fieldSource: 'sourced', note: 'DISABLED: dataset is "Health Inspection Scores (2016-2019)", last updated 2021-09-24. No current SF inspection set verified.',
  },
  // ---- Austin ----
  {
    id: 'socrata-austin-permits', city: 'Austin', state: 'TX', tz: 'America/Chicago', domain: 'data.austintexas.gov', datasetId: '3syk-w9eu',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issue_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['description', 'permit_type_desc'], textFields: ['description', 'permit_type_desc', 'work_class', 'permit_class_mapped'],
    summaryFields: ['permit_type_desc', 'work_class', 'total_job_valuation'], addressFields: ['original_address1'], zipField: 'original_zip',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.austintexas.gov', '3syk-w9eu'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-austin-311', city: 'Austin', state: 'TX', tz: 'America/Chicago', domain: 'data.austintexas.gov', datasetId: 'xwdj-i9he',
    kind: 'civic', subtype: '311', idField: 'sr_number', dateField: 'sr_created_date', latField: 'sr_location_lat', lonField: 'sr_location_long',
    titleFields: ['sr_type_desc'], textFields: ['sr_type_desc'], summaryFields: ['sr_type_desc', 'sr_department_desc', 'sr_status_desc'],
    zipField: 'sr_location_zip_code', typeFilterField: 'sr_type_desc', cadenceMinutes: 180, verified: true,
    verifiedUrl: D('data.austintexas.gov', 'xwdj-i9he'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-austin-inspections', city: 'Austin', state: 'TX', tz: 'America/Chicago', domain: 'data.austintexas.gov', datasetId: 'ecmv-9xxi',
    kind: 'civic', subtype: 'inspection', idField: 'inspectionid', dateField: 'inspection_date', latField: 'lat', lonField: 'lng',
    titleFields: ['restaurant_name'], textFields: ['restaurant_name', 'process_description'], nameField: 'restaurant_name',
    summaryFields: ['process_description', 'score'], addressFields: ['address'], zipField: 'zip_code',
    extraWhere: 'score < 70', isFailure: austinFail, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.austintexas.gov', 'ecmv-9xxi'),
    fieldSource: 'sourced', note: 'score is a number column (sourced). The < 70 failing threshold is assumed. Dataset last updated 2026-11-01.',
  },
  // ---- Seattle ----
  {
    id: 'socrata-seattle-permits', city: 'Seattle', state: 'WA', tz: 'America/Los_Angeles', domain: 'data.seattle.gov', datasetId: '76t5-zqzr',
    kind: 'permit', subtype: 'permit', idField: 'permitnum', dateField: 'issueddate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['description', 'permittypedesc'], textFields: ['description', 'permittypedesc', 'permitclass'],
    summaryFields: ['permittypedesc', 'permitclass', 'estprojectcost'], addressFields: ['originaladdress1'], zipField: 'originalzip',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.seattle.gov', '76t5-zqzr'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-seattle-311', city: 'Seattle', state: 'WA', tz: 'America/Los_Angeles', domain: 'data.seattle.gov', datasetId: '5ngg-rpne',
    kind: 'civic', subtype: '311', idField: 'servicerequestnumber', dateField: 'createddate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['webintakeservicerequests'], textFields: ['webintakeservicerequests', 'departmentname'], summaryFields: ['departmentname', 'webintakeservicerequests'],
    zipField: 'zipcode', cadenceMinutes: 180, verified: false, verifiedUrl: D('data.seattle.gov', '5ngg-rpne'), fieldSource: 'sourced',
    note: 'DISABLED: dataset and columns verified, but it has no request-type column (only department + a web-intake flag), so rows cannot be classified into trades.',
  },
  // ---- Los Angeles ----
  {
    id: 'socrata-la-permits', city: 'Los Angeles', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.lacity.org', datasetId: 'pi9x-tg5x',
    kind: 'permit', subtype: 'permit', idField: 'permit_nbr', dateField: 'issue_date', latField: 'lat', lonField: 'lon',
    titleFields: ['work_desc', 'permit_sub_type'], textFields: ['work_desc', 'permit_type', 'permit_sub_type', 'use_desc'],
    summaryFields: ['permit_type', 'permit_sub_type', 'valuation'], addressFields: ['primary_address'], zipField: 'zip_code',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.lacity.org', 'pi9x-tg5x'), fieldSource: 'sourced',
    note: 'Last updated 2026-11-08 at time of check. LA 311 and LA inspection datasets: no ID verified, not included.',
  },
  // ---- Dallas ----
  {
    id: 'socrata-dallas-311', city: 'Dallas', state: 'TX', tz: 'America/Chicago', domain: 'www.dallasopendata.com', datasetId: 'd7e7-envw',
    kind: 'civic', subtype: '311', idField: 'unique_key', dateField: 'created_date', latLonTextField: 'lat_location',
    fallbackCenter: { lat: 32.7767, lon: -96.797 },
    titleFields: ['service_request_type'], textFields: ['service_request_type', 'department'], summaryFields: ['service_request_type', 'department', 'status'],
    typeFilterField: 'service_request_type', cadenceMinutes: 180, verified: true, verifiedUrl: D('www.dallasopendata.com', 'd7e7-envw'),
    fieldSource: 'sourced', note: 'lat_location is a text column; its string format is assumed (parsed as two decimals), else falls back to city centre.',
  },
  {
    id: 'socrata-dallas-permits', city: 'Dallas', state: 'TX', tz: 'America/Chicago', domain: 'www.dallasopendata.com', datasetId: 'e7gq-4sah',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issued_date', fallbackCenter: { lat: 32.7767, lon: -96.797 },
    titleFields: ['work_description', 'permit_type'], textFields: ['work_description', 'permit_type', 'land_use'],
    summaryFields: ['permit_type', 'value'], addressFields: ['street_address'], zipField: 'zip_code', cadenceMinutes: 360,
    verified: false, verifiedUrl: D('www.dallasopendata.com', 'e7gq-4sah'), fieldSource: 'sourced',
    note: 'DISABLED: issued_date is a text column (SoQL range filters on text are unreliable) and there are no coordinates.',
  },
  // ---- New Orleans ----
  {
    id: 'socrata-nola-permits', city: 'New Orleans', state: 'LA', tz: 'America/Chicago', domain: 'data.nola.gov', datasetId: 'rcm3-fn58',
    kind: 'permit', subtype: 'permit', idField: 'numstring', dateField: 'issuedate', locationField: 'location_1',
    titleFields: ['description', 'type'], textFields: ['description', 'type', 'projectname'],
    summaryFields: ['type', 'currentstatus', 'constrval'], addressFields: ['address'], cadenceMinutes: 360,
    verified: true, verifiedUrl: D('data.nola.gov', 'rcm3-fn58'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-nola-311', city: 'New Orleans', state: 'LA', tz: 'America/Chicago', domain: 'data.nola.gov', datasetId: '2jgv-pqrq',
    kind: 'civic', subtype: '311', idField: 'service_request', dateField: 'date_created', latField: 'latitude', lonField: 'longitude',
    titleFields: ['request_type', 'request_reason'], textFields: ['request_type', 'request_reason'],
    summaryFields: ['request_type', 'request_reason', 'request_status'], typeFilterField: 'request_type', cadenceMinutes: 180,
    verified: true, verifiedUrl: D('data.nola.gov', '2jgv-pqrq'), fieldSource: 'sourced',
  },
  // ---- Baton Rouge ----
  {
    id: 'socrata-batonrouge-permits', city: 'Baton Rouge', state: 'LA', tz: 'America/Chicago', domain: 'data.brla.gov', datasetId: '7fq7-8j7r',
    kind: 'permit', subtype: 'permit', idField: 'permitnumber', dateField: 'issueddate', latField: 'lat', lonField: 'long',
    titleFields: ['projectdescription', 'permittype'], textFields: ['projectdescription', 'permittype', 'designation'],
    summaryFields: ['permittype', 'designation', 'projectvalue'], addressFields: ['streetaddress'], zipField: 'zip',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.brla.gov', '7fq7-8j7r'), fieldSource: 'sourced',
  },
  {
    id: 'socrata-batonrouge-311', city: 'Baton Rouge', state: 'LA', tz: 'America/Chicago', domain: 'data.brla.gov', datasetId: '7ixm-mnvx',
    kind: 'civic', subtype: '311', idField: 'id', dateField: 'createdate', latField: 'latitude', lonField: 'longitude',
    titleFields: ['typename'], textFields: ['typename', 'parenttype', 'comments'], summaryFields: ['parenttype', 'typename', 'statusdesc'],
    typeFilterField: 'typename', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.brla.gov', '7ixm-mnvx'), fieldSource: 'sourced',
    note: 'Dataset page located via catalog.data.gov (https://catalog.data.gov/dataset/311-citizen-requests-for-service); columns read from metadata. Last updated 2026-10-28.',
  },
  // ---- Cincinnati ----
  {
    id: 'socrata-cincinnati-permits', city: 'Cincinnati', state: 'OH', tz: 'America/New_York', domain: 'data.cincinnati-oh.gov', datasetId: 'thvx-5mem',
    kind: 'permit', subtype: 'permit', idField: 'number_key', dateField: 'date_issued', fallbackCenter: { lat: 39.1031, lon: -84.512 },
    titleFields: ['desc_of_work', 'comp_type_desc'], textFields: ['desc_of_work', 'comp_type_desc', 'sub_type_desc'],
    summaryFields: ['comp_type_desc', 'sub_type_desc'], addressFields: ['location'], cadenceMinutes: 360,
    verified: true, verifiedUrl: D('data.cincinnati-oh.gov', 'thvx-5mem'), fieldSource: 'sourced',
    note: 'No lat/lon columns (location is text), so signals carry the city centre and data.approxLocation = true. Rows are plan-review comments; the parser dedupes on number_key.',
  },
  {
    id: 'socrata-cincinnati-311', city: 'Cincinnati', state: 'OH', tz: 'America/New_York', domain: 'data.cincinnati-oh.gov', datasetId: 'gcej-gmiw',
    kind: 'civic', subtype: '311', idField: 'sr_number', dateField: 'date_created', latField: 'latitude', lonField: 'longitude',
    titleFields: ['sr_type_desc'], textFields: ['sr_type_desc', 'group_title'], summaryFields: ['sr_type_desc', 'group_title', 'sr_status'],
    zipField: 'zipcode', typeFilterField: 'sr_type_desc', cadenceMinutes: 180, verified: true,
    verifiedUrl: D('data.cincinnati-oh.gov', 'gcej-gmiw'), fieldSource: 'sourced',
  },
  // ======================= Round 2 (U3 coverage), all checked 2026-11-17 =======================
  // Verification: metadata from https://<domain>/api/views/<id>.json (column names + types, rowsUpdatedAt), plus a live
  // `$select=max(<date col>)` or group-by query on /resource/<id>.json to confirm recent records and value vocabularies.
  // ---- More permit cities ----
  {
    id: 'socrata-cambridge-permits', city: 'Cambridge', state: 'MA', tz: 'America/New_York', domain: 'data.cambridgema.gov', datasetId: '3wsm-e5jx',
    kind: 'permit', subtype: 'permit', idField: 'id', dateField: 'issue_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['permit_type'], textFields: ['permit_type'], summaryFields: ['permit_type', 'status'], addressFields: ['full_address'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cambridgema.gov', '3wsm-e5jx'), fieldSource: 'sourced',
    note: 'Cambridge Permit Finder. Updated 2026-11-17, max issue_date 2026-11-13, 559 rows since Nov 1. The set has only permit_type (Electrical, Plumbing, Mechanical, Roof, Tree Removal, Dumpster...) so only trade-like types map.',
  },
  {
    id: 'socrata-norfolk-permits', city: 'Norfolk', state: 'VA', tz: 'America/New_York', domain: 'data.norfolk.gov', datasetId: 'fahm-yuh4',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issue_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['work_type', 'type'], textFields: ['type', 'work_type', 'use_type'], summaryFields: ['type', 'work_type', 'project_cost'], addressFields: ['address'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: D('data.norfolk.gov', 'fahm-yuh4'), fieldSource: 'sourced',
    note: 'Updated 2026-11-16. issue_date holds future dates (max 2026-12-24), so the query caps it at now (windowForwardDays 0).',
  },
  {
    id: 'socrata-buffalo-permits', city: 'Buffalo', state: 'NY', tz: 'America/New_York', domain: 'data.buffalony.gov', datasetId: '9p2d-f3yt',
    kind: 'permit', subtype: 'permit', idField: 'apno', dateField: 'issued', latField: 'latitude', lonField: 'longitude',
    titleFields: ['descofwork', 'aptype'], textFields: ['descofwork', 'aptype'], summaryFields: ['aptype', 'value'], addressFields: ['stname'], zipField: 'zip',
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: D('data.buffalony.gov', '9p2d-f3yt'), fieldSource: 'sourced',
    note: 'Updated 2026-11-16, max issued 2026-11-15, 428 rows since Nov 1. aptype values seen: REPAIR, ELECTRICAL, PLUMBING, HEATING, FENDRIVE, GC, TEAROUT. Only the street name is published, no house number.',
  },
  {
    id: 'socrata-montgomery-permits', city: 'Montgomery County', state: 'MD', countyAnchor: { lat: 39.084, lon: -77.1528 }, tz: 'America/New_York', domain: 'data.montgomerycountymd.gov', datasetId: 'm88u-pqki',
    kind: 'permit', subtype: 'permit', idField: 'permitno', dateField: 'issueddate', locationField: 'location',
    titleFields: ['description', 'worktype'], textFields: ['description', 'worktype', 'applicationtype'], summaryFields: ['worktype', 'declaredvaluation', 'status'],
    addressFields: ['stno', 'predir', 'stname', 'suffix', 'postdir'], zipField: 'zip',
    lookbackOverride: 30, windowForwardDays: 0, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.montgomerycountymd.gov', 'm88u-pqki'), fieldSource: 'sourced',
    note: 'Residential Permit. rowsUpdatedAt 2026-11-13 but max issueddate is 2026-10-28, so the portal lags about 2 weeks: 30 day lookback. The Commercial set (i26v-w6bd) has the same columns but was last updated 2026-10-30 and is left out.',
  },
  {
    id: 'socrata-orlando-permits', city: 'Orlando', state: 'FL', tz: 'America/New_York', domain: 'data.cityoforlando.net', datasetId: 'ryhf-m453',
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issue_permit_date', locationField: 'geocoded_column',
    titleFields: ['project_name', 'worktype', 'application_type'], textFields: ['worktype', 'application_type', 'project_name', 'plan_review_type'],
    summaryFields: ['application_type', 'worktype', 'estimated_cost'], addressFields: ['permit_address'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cityoforlando.net', 'ryhf-m453'), fieldSource: 'sourced',
    note: 'Updated 2026-11-16, max issue_permit_date 2026-11-16. worktype values seen: Roof, Repair, LowVoltage, New, Alt, Irrigation, Sign, Fence. property_owner_name and contractor columns are never read.',
  },
  {
    id: 'socrata-pgcounty-permits', city: "Prince George's County", state: 'MD', countyAnchor: { lat: 38.8296, lon: -76.8466 }, tz: 'America/New_York', domain: 'data.princegeorgescountymd.gov', datasetId: 'weik-ttee',
    kind: 'permit', subtype: 'permit', idField: 'permit_case_id', dateField: 'permit_issuance_date', fallbackCenter: { lat: 38.8296, lon: -76.8466 },
    titleFields: ['case_name', 'permit_type'], textFields: ['case_name', 'permit_type', 'permit_category'], summaryFields: ['permit_type', 'permit_category', 'expected_construction_cost'],
    addressFields: ['street_address'], zipField: 'zip_code', windowForwardDays: 0, cadenceMinutes: 720, verified: false,
    verifiedUrl: D('data.princegeorgescountymd.gov', 'weik-ttee'), fieldSource: 'sourced',
    note: 'DISABLED: columns verified, but the latest permit_issuance_date is 2026-09-25 (rowsUpdatedAt 2026-10-01), so a 7 day window returns nothing. location is a text column.',
  },
  // ---- More 311 cities ----
  {
    id: 'socrata-kansascity-311', city: 'Kansas City', state: 'MO', tz: 'America/Chicago', domain: 'data.kcmo.org', datasetId: 'd4px-6rwg',
    kind: 'civic', subtype: '311', idField: 'workorder_', dateField: 'open_date_time', latField: 'latitude', lonField: 'longitude',
    titleFields: ['issue_type', 'issue_sub_type'], textFields: ['issue_type', 'issue_sub_type', 'reported_issue'], summaryFields: ['issue_type', 'issue_sub_type', 'current_status'],
    typeFilterField: 'issue_type', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.kcmo.org', 'd4px-6rwg'), fieldSource: 'sourced',
    note: 'Updated 2026-11-16, max open_date_time 2026-11-16. issue_type values seen: Property Violations, Illegal Dumping, Trash Recycling Bulky Services, Healthy Homes, Trees City Row. KC building permits (ntw8-aacc, last updated 2025-06) and Property Violations (nhtf-e75a, archived 2022) are stale and not used.',
  },
  {
    id: 'socrata-cambridge-311', city: 'Cambridge', state: 'MA', tz: 'America/New_York', domain: 'data.cambridgema.gov', datasetId: '2z9k-mv9g',
    kind: 'civic', subtype: '311', idField: 'ticket_id', dateField: 'ticket_created_date_time', latField: 'lat', lonField: 'lng',
    titleFields: ['issue_type'], textFields: ['issue_type', 'issue_category'], summaryFields: ['issue_type', 'ticket_status'],
    typeFilterField: 'issue_type', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.cambridgema.gov', '2z9k-mv9g'), fieldSource: 'sourced',
    note: 'Commonwealth Connect, updated 2026-11-17. issue_description (free text from residents) is never read.',
  },
  {
    id: 'socrata-oakland-311', city: 'Oakland', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.oaklandca.gov', datasetId: 'quth-gb8e',
    kind: 'civic', subtype: '311', idField: 'requestid', dateField: 'datetimeinit', locationField: 'reqaddress',
    titleFields: ['reqcategory', 'description'], textFields: ['reqcategory', 'description'], summaryFields: ['reqcategory', 'description', 'status'], zipField: 'zipcode',
    typeFilterField: 'reqcategory', cadenceMinutes: 180, verified: true, verifiedUrl: D('data.oaklandca.gov', 'quth-gb8e'), fieldSource: 'sourced',
    note: 'Updated 2026-11-16, max datetimeinit 2026-11-15. reqcategory values seen: ILLDUMP, BLDGMAINT, TREES, GRAFFITI, ABANDONED AUTO. reqaddress is a location column; its JSON shape is assumed (GeoJSON or {latitude,longitude}).',
  },
  // ---- Code and building violations ----
  {
    id: 'socrata-chicago-violations', city: 'Chicago', state: 'IL', tz: 'America/Chicago', domain: 'data.cityofchicago.org', datasetId: '22u3-xenr',
    kind: 'civic', subtype: 'violation', idField: 'id', dateField: 'violation_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['violation_description'], textFields: ['violation_description'], summaryFields: ['violation_description', 'violation_status'], addressFields: ['address'],
    extraWhere: "violation_status = 'OPEN'", cadenceMinutes: 360, verified: true, verifiedUrl: D('data.cityofchicago.org', '22u3-xenr'), fieldSource: 'sourced',
    note: 'Building Violations, updated 2026-11-17. violation_status values seen: OPEN, COMPLIED, NO ENTRY. violation_inspector_comments is free text and is never read. Many rows are elevator or inspection-scheduling codes; the rules drop those.',
  },
  {
    id: 'socrata-austin-violations', city: 'Austin', state: 'TX', tz: 'America/Chicago', domain: 'data.austintexas.gov', datasetId: '6wtj-zbtb',
    kind: 'civic', subtype: 'violation', idField: 'case_id', dateField: 'opened_date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['description'], textFields: ['description', 'case_type'], summaryFields: ['description', 'status'], addressFields: ['address'], zipField: 'zip_code',
    cadenceMinutes: 360, verified: true, verifiedUrl: D('data.austintexas.gov', '6wtj-zbtb'), fieldSource: 'sourced',
    note: 'Austin Code Complaint Cases, updated 2026-11-17. description values seen: Property Abatement, Land Use Violation(s), Structure Condition Violation(s), Work Without Permit. The inspector column is never read.',
  },
  // ---- New business licenses and registrations (record only newly issued / started rows) ----
  {
    id: 'socrata-chicago-business', city: 'Chicago', state: 'IL', tz: 'America/Chicago', domain: 'data.cityofchicago.org', datasetId: 'uupf-x98q',
    kind: 'civic', subtype: 'business', idField: 'id', dateField: 'date_issued', latField: 'latitude', lonField: 'longitude',
    titleFields: [], textFields: ['license_description', 'business_activity'],
    summaryFields: ['license_description', 'business_activity'], zipField: 'zip_code',
    extraWhere: "application_type = 'ISSUE' AND license_description NOT IN ('Pop-Up Retail User','Peddler License','Pharmaceutical Representative','Shared Housing Unit Operator','Pop-Up Food Est. User - Tier I')", windowForwardDays: 0, cadenceMinutes: 720, verified: true,
    verifiedUrl: D('data.cityofchicago.org', 'uupf-x98q'), fieldSource: 'sourced',
    note: "Business Licenses - Current Active, updated 2026-11-13. application_type = 'ISSUE' (new license; RENEW rows are 80% of the set and excluded), max date_issued for ISSUE 2026-11-16. PRIVACY: no name column is read (doing_business_as_name, legal_name, account fields): 12 of 60 live DBA values were bare personal names, and Shared Housing Unit Operator rows are home addresses. Title is the license type only, no street address, and individual license types are excluded (live group-by of license_description for ISSUE rows, 2026-11-17).",
  },
  {
    id: 'socrata-sf-business', city: 'San Francisco', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.sf.gov', datasetId: 'g8m3-pdis',
    kind: 'civic', subtype: 'business', idField: 'uniqueid', dateField: 'location_start_date', locationField: 'location',
    titleFields: [], textFields: ['lic_code_description', 'lic_code_descriptions_list', 'self_reported_naics_code'], summaryFields: ['lic_code_description'],
    zipField: 'business_zip', naicsField: 'self_reported_naics_code',
    extraWhere: "city = 'San Francisco' AND location_end_date IS NULL AND (lic_code_description IS NULL OR lic_code_description NOT IN ('TATTOO, BODY PIERCING, PRACTITIONER','GENERAL MASSAGE PRACTITIONER','OUTCALL MASSAGE SERVICE','TOW CAR DRIVER','RENEWAL OF COMMERCIAL DOG WALKER - OWNER','RENEWAL OF COMMERCIAL DOG WALKER - EMPLOYEE','TOUR GUIDE: OWNER - WALKING'))", windowForwardDays: 0,
    cadenceMinutes: 720, verified: true, verifiedUrl: D('data.sf.gov', 'g8m3-pdis'), fieldSource: 'sourced',
    note: 'Registered Business Locations, updated 2026-11-15. The dataset covers every business registered in the city, including ones located in other cities (live 2026-11-17: Clovis, Livermore, San Jose, Fremont, Stockton, even New York), so the query keeps only city = San Francisco (verify round 2 P2-3). location_start_date holds future dates (max 2028-02-26), so the query caps it at now. PRIVACY: no name column is read (dba_name, ownership_name): 11 of 60 live dba_name values were bare personal names (for example Kelly Lewis). Title is the license type only, no street address, individual practitioner types are excluded. uniqueid is assumed unique per row. self_reported_naics_code (a 6-digit NAICS code, never a name) is read as a text field only so the parser can tell a live feed from a changed one: live 2026-11-17, 267 of 268 rows since 2026-11-03 have no lic_code_description and every row has the NAICS code (review verify.md N2).',
  },
  {
    id: 'socrata-la-business', city: 'Los Angeles', state: 'CA', tz: 'America/Los_Angeles', domain: 'data.lacity.org', datasetId: '6rrh-rzua',
    kind: 'civic', subtype: 'business', idField: 'location_account', dateField: 'location_start_date', locationField: 'location_1',
    titleFields: [], textFields: ['primary_naics_description'], summaryFields: ['primary_naics_description'],
    zipField: 'zip_code',
    extraWhere: "location_end_date IS NULL AND (primary_naics_description IS NULL OR primary_naics_description NOT IN ('Independent artists, writers, & performers','Motion picture & video industries (except video rental)','Lessors of real estate (including mini warehouses & self-storage units)','All other personal services','Individual & family services','Home health care services','Legal services','Offices of physicians (except mental health specialists)','Offices of mental health practitioners (except physicians)','Offices of all other miscellaneous health practitioners','Offices of physical, occupational & speech therapists, & audiologists','Offices of real estate agents & brokers','Agents & managers for artists, athletes, entertainers, & other public figures','Other direct selling establishments (including door-to-door retailing, frozen food plan providers, party plan merchandisers, & coffee-break service providers)','Other Personal Care Services','Musical Groups and Artists','Other Management Consulting Services'))", windowForwardDays: 0,
    cadenceMinutes: 720, verified: true, verifiedUrl: D('data.lacity.org', '6rrh-rzua'), fieldSource: 'sourced',
    note: 'Listing of Active Businesses, updated 2026-11-16. location_start_date holds future dates (max 2027-04-17), so the query caps it at now. PRIVACY: no name column is read (dba_name, business_name): both can be a sole proprietor personal name. Title is the NAICS description only, no street address. Sole-proprietor-heavy NAICS groups are excluded (live group-by 2026-11-17; the last three spellings were seen live by the verification review, verify.md P2-7).',
  },
  {
    id: 'socrata-nyc-business', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: 'w7w3-xahh',
    kind: 'civic', subtype: 'business', idField: 'license_nbr', dateField: 'license_creation_date', latField: 'latitude', lonField: 'longitude',
    fallbackCenter: { lat: 40.7128, lon: -74.006 },
    titleFields: [], textFields: ['business_category', 'license_type'], summaryFields: ['business_category'],
    zipField: 'address_zip',
    extraWhere: "license_status = 'Active' AND business_category NOT IN ('Tow Truck Driver','Sightseeing Guide','Ticket Seller Individual','Pedicab Driver','Process Server Individual')",
    lookbackOverride: 30, windowForwardDays: 0, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.cityofnewyork.us', 'w7w3-xahh'), fieldSource: 'sourced',
    note: 'DCWP Issued Licenses, updated 2026-11-06, max license_creation_date 2026-10-30, hence the 30 day lookback. Individual licences (drivers, guides) are excluded; PRIVACY: no name column is read (dba_trade_name, business_name): both can be a person. Title is the business category, no street address.',
  },
  {
    id: 'socrata-orlando-business', city: 'Orlando', state: 'FL', tz: 'America/New_York', domain: 'data.cityoforlando.net', datasetId: '7388-4re5',
    kind: 'civic', subtype: 'business', idField: 'case_number', dateField: 'business_open_date', locationField: 'geocoded_column',
    titleFields: [], textFields: ['license_type', 'license_category'], summaryFields: ['license_type', 'license_category'],
    extraWhere: "business_close_date IS NULL AND license_category NOT IN ('PROFES','PEDDLE','MASSEU') AND license_type NOT IN ('INSURANCE ADJUSTER','INSTRUCTOR/TUTOR','MISC PEDDLER','FOOD PEDDLER')", windowForwardDays: 0,
    cadenceMinutes: 720, verified: true, verifiedUrl: D('data.cityoforlando.net', '7388-4re5'), fieldSource: 'sourced',
    note: 'Business Tax Receipts, updated 2026-11-16, 214 rows opened since Oct 15. business_open_date holds garbage future dates (max year 8201), so the query caps it at now. business_owner_name, email and phone are never read. PRIVACY: business_name is not read either: 18 of 60 live values were personal names (nurse practitioners, sole proprietors). Title is the license type only, no street address, and the PROFES, PEDDLE and MASSEU categories (individuals, 2026-11-17 group-by) are excluded.',
  },
  // ---- Special event and film permits (upcoming events: window runs forward) ----
  {
    id: 'socrata-nyc-events', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: 'tvpp-9vvx',
    kind: 'event', subtype: 'event-permit', idField: 'event_id', dateField: 'start_date_time', endDateField: 'end_date_time',
    fallbackCenter: { lat: 40.7128, lon: -74.006 },
    titleFields: ['event_type'], textFields: ['event_type'], summaryFields: ['event_type', 'event_borough'], addressFields: ['event_location'],
    extraWhere: "event_type NOT IN ('Sport - Youth','Sport - Adult','Theater Load in and Load Outs')",
    lookbackOverride: 1, windowForwardDays: 14, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.cityofnewyork.us', 'tvpp-9vvx'), fieldSource: 'sourced',
    note: 'NYC Permitted Event Information, updated 2026-11-12, rows through 2027. No coordinates, so signals carry the city centre (data.approxLocation = true). event_name is never read (can hold a private host).',
  },
  {
    id: 'socrata-chicago-events', city: 'Chicago', state: 'IL', tz: 'America/Chicago', domain: 'data.cityofchicago.org', datasetId: 'pk66-w54g',
    kind: 'event', subtype: 'event-permit', idField: 'park_number', idFields: ['park_number', 'reservation_start_date', 'event_type'],
    dateField: 'reservation_start_date', endDateField: 'reservation_end_date', fallbackCenter: { lat: 41.8781, lon: -87.6298 },
    titleFields: ['event_type'], textFields: ['event_type'], summaryFields: ['event_type', 'permit_status'], addressFields: ['park_facility_name'],
    extraWhere: "permit_status = 'Approved' AND (event_type like 'Permit - Event%' OR event_type like 'Venue Rental%' OR event_type like 'Permit - Media: Filming%')",
    lookbackOverride: 1, windowForwardDays: 14, cadenceMinutes: 720, verified: true, verifiedUrl: D('data.cityofchicago.org', 'pk66-w54g'), fieldSource: 'sourced',
    note: 'Chicago Park District outdoor event permits, updated 2026-11-16. No id or coordinates: the id is park_number + start + type, location is the city centre (approx). requestor_, organization and event_description are never read.',
  },
  {
    id: 'socrata-nyc-filmpermits', city: 'New York City', state: 'NY', tz: 'America/New_York', domain: 'data.cityofnewyork.us', datasetId: 'tg4x-b46p',
    kind: 'event', subtype: 'event-permit', idField: 'eventid', dateField: 'startdatetime', endDateField: 'enddatetime',
    fallbackCenter: { lat: 40.7128, lon: -74.006 },
    titleFields: ['category', 'subcategoryname'], textFields: ['category', 'eventtype'], summaryFields: ['eventtype', 'borough'], addressFields: ['parkingheld'], zipField: 'zipcode_s',
    lookbackOverride: 1, windowForwardDays: 14, cadenceMinutes: 720, verified: false, verifiedUrl: D('data.cityofnewyork.us', 'tg4x-b46p'), fieldSource: 'sourced',
    note: 'DISABLED: columns verified, but max(enteredon) is 2026-08-14 and max(startdatetime) 2026-08-17 (rowsUpdatedAt 2026-10-27 is a re-publish of old rows). NYC Permitted Event Information above carries film shoots as "Production Event".',
  },
];

/**
 * Atlanta has no Socrata portal. Its ArcGIS layers are handled in arcgis-datasets.ts (see the Atlanta notes there).
 */
export const ATLANTA_NOTE = 'Atlanta is not on Socrata. See arcgis-datasets.ts.';

/** Fixed lookback for the $where window. 311 rows appear within hours; permits and inspections are date-only and publish late. */
export function lookbackDays(ds: SocrataDataset): number {
  if (ds.lookbackOverride != null) return ds.lookbackOverride;
  if (ds.subtype === '311') return 3;
  if (ds.subtype === 'business') return 14;
  if (ds.subtype === 'event-permit') return 1;
  return 7;
}

export function datasetPageUrl(ds: SocrataDataset): string {
  return `https://${ds.domain}/d/${ds.datasetId}`;
}
