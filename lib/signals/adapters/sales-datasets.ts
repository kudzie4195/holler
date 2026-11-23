/**
 * ROUND 20 SALES: recorded property sales and deed transfers in the 10 metros. EVERY entry is ON PROBATION (`probation: true`) and
 * `schemaUnverified: true`, exactly like the round 19 coverage feeds (coverage-datasets.ts): rows go to holler_source_samples only
 * (lib/signals/samples.ts), never to a member, a card, an email, a push, a public page or a count, until the owner has probed the source
 * (/api/admin/coverage-probe), read real samples and promoted it (LAUNCH.md, "Round 20 sales").
 *
 * Provenance: /home/claude/gates/r20/SALES-research.md (2026-11-22). NO data row was ever pulled from any of these sources and no column
 * list was read from a portal itself in this unit. Each column carries the research tag:
 *   [O]  the research opened the portal's own page and read it there
 *   [3P] read on a third-party page (data.gov harvest, a scraper's documentation, a mailing list); names may be stale
 *   [A]  assumed (platform convention or memory of the dataset)
 *
 * PRIVACY (round 20, binding). Property sales and deeds name private people as buyers and sellers. The query itself names ONLY the columns
 * listed here (Socrata $select, ArcGIS outFields, Carto SELECT list), so a buyer, seller, grantor, grantee, party, owner, mailing or
 * attention column is never even fetched: NYC ACRIS Parties (636b-3b5g) is never queried; Cook County buyer_name, seller_name,
 * owner_address_name and mail_address_*; Philadelphia grantors, grantees, owner_1, owner_2 and mailing_*; Miami-Dade TRUE_OWNER1-3 and
 * TRUE_MAILING_*. tests/signals/sales-r20.test.ts proves no query names such a column and that names planted in every column of a row
 * never reach a stored record. A record keeps only: the street address (through lib/contacts cleanAddress, as a 'site' contact), the sale
 * or recording date, a price BAND (never the price) and the property class. No business buyer is stored either (the commercial
 * "business buyer" path would need a party column; it is not built).
 *
 * Why a separate adapter (lib/signals/adapters/sales.ts) and not more Socrata, ArcGIS or Carto entries: none of the existing parsers can
 * band a price instead of storing it, map a land-use code to four fixed classes, or join a second table (NYC and Cook County keep the
 * address in a second dataset). The sales adapter reuses their date, schema-check, timeout and probation-note helpers, so a sale source
 * fails exactly like a coverage feed (schema mismatch, not JSON, no recent rows, row cap, timeout).
 */

export type SaleClass = 'residential_single' | 'condo' | 'multi_family' | 'commercial';
export type SalePlatform = 'socrata' | 'arcgis' | 'carto';
export type SaleMetro = 'new-york' | 'chicago' | 'philadelphia' | 'miami';

/** Socrata only: a second dataset holding the address (and/or the class), read by key for the rows of the main query. */
export interface SaleJoin {
  datasetId: string;
  /** Key column in the join dataset. */
  keyField: string;
  /** Key column in the main dataset whose value is looked up. */
  mainKeyField: string;
  /** Every column the join request names ($select). */
  columns: string[];
  /** Newest first when the join dataset has several rows per key (Cook County addresses: one per tax year): only the first row is kept. */
  orderField?: string;
  /**
   * Without orderField every join row of a key is kept (NYC: one deed can cover several lots), sorted by these columns (numeric when they
   * read as numbers) so the order is stable; the parser then keeps one record per deed (review P2-6).
   */
  sortFields?: string[];
  verifiedUrl: string;
}

export interface SaleDataset {
  /** Adapter id and signal `source`. The prefix says the platform (socrata-, arcgis-, carto-). */
  id: string;
  platform: SalePlatform;
  metro: SaleMetro;
  /** Where the source lives, for the metro scorecard (lib/admin/metros.ts sourcePlaces). */
  city: string;
  state: string;
  /** County feeds: the county seat, says which metro and city pages the rows belong to. */
  countyAnchor?: { lat: number; lon: number };
  /** IANA zone of floating (zoneless) timestamps. */
  tz: string;
  /** Socrata: domain and dataset id. ArcGIS: layer URL. Carto: SQL endpoint and FROM clause. */
  domain?: string;
  datasetId?: string;
  layerUrl?: string;
  cartoFrom?: string;
  /** Carto: column expressions in the FROM's aliases; each key is the output column name, each value the SQL expression. */
  cartoSelect?: Record<string, string>;
  /** The id column, or every column of a composite id (joined with ':'). */
  idField: string;
  idFields?: string[];
  /** Sale or recording date column (window, order, record date). */
  dateField: string;
  /** Carto: the qualified date column for WHERE and ORDER BY ("r.recording_date"). Default dateField. */
  cartoDateExpr?: string;
  priceField: string;
  /** Carto: the qualified price column for WHERE. */
  cartoPriceExpr?: string;
  classField: string;
  /** Columns joined with a space, then cut by cleanAddress (house number, street, suffix, one unit). */
  addressFields: string[];
  unitField?: string;
  zipField?: string;
  /** A place column (borough code, city name): only a known place is ever printed (sales.ts placeOf). */
  placeField?: string;
  /** Point columns (Carto aliases). ArcGIS uses the feature geometry. */
  latField?: string;
  lonField?: string;
  /** Every column the main query names. */
  columns: string[];
  /** Extra $order columns after the date and the id (Socrata), so rows of one deed come in a stable order. */
  orderTiebreak?: string[];
  join?: SaleJoin;
  /** Raw where clause appended with AND (column vocabulary of the main query). */
  extraWhere?: string;
  /** The window reaches back this many days (the feeds publish with a lag). */
  lookbackDays: number;
  /** Land-use or class code to one of the four classes; null drops the row (vacant land, exempt, unknown). */
  classOf: (raw: string) => SaleClass | null;
  cadenceMinutes: number;
  verified: true;
  /** Remove (set false) together with schemaUnverified to promote; a test fails if only one is removed. */
  probation: boolean;
  schemaUnverified: boolean;
  /** The page the column list should be read from (the probe reads it). */
  verifiedUrl: string;
  /** Human page of the dataset, used as the record's public source link. */
  sourceUrl: string;
  checkedOn: string;
  fieldSource: 'sourced' | 'assumed';
  /** Research tags of this entry's facts. */
  evidence: { columns: 'O' | '3P' | 'A'; endpoint: 'O' | '3P' | 'A'; freshness: 'O' | '3P' | 'A' };
  note: string;
}

const CHECKED = '2026-11-22';

/** A row below this price is not a market sale (family transfer, nominal $1 or $10 deed): dropped, in the query and again in code. */
export const MIN_SALE_PRICE = 10_000;

// ---- class code tables -------------------------------------------------------------------------------------------------------------
// Review fix (P2-4, P2-5): every code below was checked against the published list, tagged per table. A code not listed DROPS the row:
// a wrong code can never relabel a home as commercial or the reverse.

/**
 * NYC ACRIS property type codes, read 2026-11-22 from the city's own table "ACRIS - Property Types Codes" (94g4-w6xz, CSV export) [O].
 * Mapped: D1 "DWELLING ONLY - 1 FAMILY", RG "1-2 FAMILY DWELLING WITH ATTACHED GARAGE", RP "1- 2 FAM WITH ATTCH GAR &/OR VACANT LAND",
 * RV "1-2 FAMILY DWELLING WITH VACANT LAND" (a house); SC "SINGLE RESIDENTIAL CONDO UNIT" (condo); D2-D6 "DWELLING ONLY - 2..6 FAMILY",
 * AP "APARTMENT BUILDING", MC "MULTIPLE RESIDENTIAL CONDO UNT", F1 "1-3 FAMILY WITH STORE / OFFICE", F4 "4-6 FAMILY WITH STORE / OFFICE",
 * F5 "5-6 FAMILY WITH STORE / OFFICE", FS "4 FAMILY WITH STORE / OFFICE" (multi-family: homes over a store are residential buildings);
 * CC "COMMERCIAL CONDO UNIT(S)", CP "COMMERCIAL COOP UNIT(S)", CR "COMMERCIAL REAL ESTATE", OF "OFFICE BUILDING", IB "INDUSTRIAL BUILDING",
 * RB "RETAIL BUILDING" (commercial). Dropped on purpose: coop units (SP, MP, SA: shares, not deeds), parking, storage and maid's rooms
 * (PS, SR, MR), garages (GR), vacant land (VL, VR, VN, VI), bulk and combined sales (BS, SM, CA, MU), REITs (RE, R1, R2), timeshares,
 * religious, utility, entertainment, HDFC, "other", "not applicable", pre-ACRIS. (The first version mapped 1F-4F, CM, ST and IP, which
 * are not in the table, F1 as commercial, and SR and MR as condos: all wrong, all fixed here.)
 */
export const NYC_PROPERTY_TYPES: Readonly<Record<string, SaleClass>> = {
  D1: 'residential_single', RG: 'residential_single', RP: 'residential_single', RV: 'residential_single',
  SC: 'condo',
  D2: 'multi_family', D3: 'multi_family', D4: 'multi_family', D5: 'multi_family', D6: 'multi_family', AP: 'multi_family', MC: 'multi_family',
  F1: 'multi_family', F4: 'multi_family', F5: 'multi_family', FS: 'multi_family',
  CC: 'commercial', CP: 'commercial', CR: 'commercial', OF: 'commercial', IB: 'commercial', RB: 'commercial',
};

export function nycClassOf(raw: string): SaleClass | null {
  const k = raw.trim().toUpperCase();
  return Object.hasOwn(NYC_PROPERTY_TYPES, k) ? NYC_PROPERTY_TYPES[k] : null;
}

/**
 * Cook County Assessor classes, read 2026-11-22 from the Assessor's "Class codes definitions 12.16.24" PDF [O]
 * (prodassets.cookcountyassessor.com). Single-family: 2-02 to 2-09 (one-story and two-or-more story residences), 2-10 (old style row
 * house), 2-34 (split level), 2-78 (two-or-more story, 2,001 to 3,800 sq ft), 2-95 (individually owned townhome or row house).
 * Condo: 2-99 (residential condominium). Multi-family: 2-11 (apartment building, 2 to 6 units), 2-12 (mixed-use, 6 units or less),
 * 3-13, 3-14, 3-15, 3-18, 3-91, 3-96, 3-99 (rental apartments, 7+ units; rental condominium). Commercial: 5-xx improved (5-17 one-story
 * commercial, 5-22 automotive, 5-23 gasoline station, 5-31 shopping center, 5-91 over three stories, 5-92, 5-97, 5-99 commercial condo,
 * other 5-xx buildings). Dropped: vacant land (1-00, 1-90, 2-41, 3-00, 5-00 commercial land, 5-50 industrial land), minor improvements
 * (2-90, 3-01, 5-90), cooperatives (2-13), farm, SRO, bed and breakfast, special and exemption classes (2-19, 2-24, 2-25, 2-36, 2-39,
 * 2-40, 2-88, 2-97, 3-97).
 */
const COOK_SINGLE = new Set([202, 203, 204, 205, 206, 207, 208, 209, 210, 234, 278, 295]);
const COOK_MULTI = new Set([211, 212, 313, 314, 315, 318, 391, 396, 399]);
const COOK_COMMERCIAL_DROP = new Set([500, 550, 590]);

export function cookClassOf(raw: string): SaleClass | null {
  const d = raw.replace(/\D/g, '');
  if (!/^\d{3}$/.test(d)) return null;
  const n = Number(d);
  if (COOK_SINGLE.has(n)) return 'residential_single';
  if (n === 299) return 'condo';
  if (COOK_MULTI.has(n)) return 'multi_family';
  if (n >= 500 && n <= 599 && !COOK_COMMERCIAL_DROP.has(n)) return 'commercial';
  return null;
}

/**
 * Philadelphia OPA category_code_description [A: values from memory; the column name is 3P]. A condo unit has no category of its own
 * there, so it reads as "Home". MIXED USE (a store with a dwelling above it) is DROPPED (final review P3-7): read as commercial it would
 * keep the exact address of somebody's home if promoted. The probe's mapped rows show whether these hold.
 */
export function phlClassOf(raw: string): SaleClass | null {
  const v = raw.trim().toUpperCase();
  if (v === 'SINGLE FAMILY') return 'residential_single';
  if (v === 'MULTI FAMILY') return 'multi_family';
  if (v === 'COMMERCIAL' || v === 'INDUSTRIAL') return 'commercial';
  return null; // VACANT LAND and anything else
}

/**
 * Florida DOR land use codes, read 2026-11-22 from Fla. Admin. Code R. 12D-8.008 (Cornell LII) [O]: 0100 Single Family, 0300
 * Multi-family 10 units or more, 0400 Condominia, 0800 Multi-family less than 10 units, 1100-3900 commercial (1000 Vacant Commercial),
 * 4100-4900 industrial (4000 Vacant Industrial). Miami-Dade writes the code as 4 digits [3P]; a shorter value (a number that lost its
 * leading zero, "101", 303) is padded back to 4 digits before reading the first two (review P2-4), so "303" is 0303 (multi-family), never
 * commercial. Dropped: vacant (00, 10, 40), mobile homes (02), cooperatives (05), retirement homes (06), miscellaneous residential (07), 09,
 * and 50 and up (agricultural, institutional, government, ...).
 */
export function miamiClassOf(raw: string): SaleClass | null {
  const d = raw.trim();
  if (!/^\d{1,4}$/.test(d)) return null;
  const two = Number(d.padStart(4, '0').slice(0, 2));
  if (two === 1) return 'residential_single';
  if (two === 4) return 'condo';
  if (two === 3 || two === 8) return 'multi_family';
  if ((two >= 11 && two <= 39) || (two >= 41 && two <= 49)) return 'commercial';
  return null;
}

/** Residential classes: stored and shown at block level only, never with a house number or unit (review P1-2, owner decision r20). */
export const RESIDENTIAL_CLASSES: ReadonlySet<SaleClass> = new Set(['residential_single', 'condo', 'multi_family']);

// ---- endpoints --------------------------------------------------------------------------------------------------------------------

export const NYC_ACRIS_MASTER = 'bnx9-e6tj';
export const NYC_ACRIS_LEGALS = '8h5j-fqxa';
/** NEVER queried: it holds the parties' names and addresses. Listed only so a test can prove no request names it. */
export const NYC_ACRIS_PARTIES = '636b-3b5g';
export const COOK_SALES = 'wvhk-k5uv';
export const COOK_ADDRESSES = '3723-97qp';
export const MIAMIDADE_PA_POINTS = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services/PaGISView_gdb/FeatureServer/0';
export const PHL_CARTO = 'https://phl.carto.com/api/v2/sql';

export const SALES_DATASETS: SaleDataset[] = [
  // ---- New York ---------------------------------------------------------------------------------------------------------------------
  {
    id: 'socrata-nyc-acris-sales', platform: 'socrata', metro: 'new-york', city: 'New York', state: 'NY', tz: 'America/New_York',
    domain: 'data.cityofnewyork.us', datasetId: NYC_ACRIS_MASTER,
    idField: 'document_id', dateField: 'recorded_datetime', priceField: 'document_amt', classField: 'property_type',
    addressFields: ['street_number', 'street_name'], unitField: 'unit', placeField: 'borough',
    columns: ['document_id', 'doc_type', 'recorded_datetime', 'document_amt'],
    extraWhere: `doc_type in ('DEED','DEEDO') AND document_amt >= ${MIN_SALE_PRICE}`,
    join: {
      datasetId: NYC_ACRIS_LEGALS, keyField: 'document_id', mainKeyField: 'document_id',
      columns: ['document_id', 'borough', 'block', 'lot', 'property_type', 'street_number', 'street_name', 'unit'],
      sortFields: ['borough', 'block', 'lot'],
      verifiedUrl: `https://data.cityofnewyork.us/api/views/${NYC_ACRIS_LEGALS}.json`,
    },
    lookbackDays: 45, classOf: nycClassOf, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: `https://data.cityofnewyork.us/api/views/${NYC_ACRIS_MASTER}.json`,
    sourceUrl: 'https://data.cityofnewyork.us/d/bnx9-e6tj', checkedOn: CHECKED, fieldSource: 'assumed',
    evidence: { columns: 'A', endpoint: '3P', freshness: '3P' },
    note: 'ON PROBATION. NYC ACRIS Real Property Master (bnx9-e6tj) joined to Real Property Legals (8h5j-fqxa) on document_id [3P ids]. Columns [A]: master document_id, doc_type, recorded_datetime, document_amt; legals document_id, borough, property_type, street_number, street_name, unit. Deeds only (DEED, DEEDO [A]) of at least $10,000. Real Property Parties (636b-3b5g, names and addresses) is NEVER queried. Freshness is UNCERTAIN: "lags the live City Register by weeks" and one capture said Master was last updated 2026-09-08 [3P]; if the probe says stale, do not promote. No ZIP or coordinates: rows sit at their borough centre (approxLocation). A deed over several lots makes ONE record: the first lot (borough, block, lot order) whose property type is residential, else the first lot. Property type codes are from the city\'s own table 94g4-w6xz [O].',
  },
  // ---- Chicago ----------------------------------------------------------------------------------------------------------------------
  {
    id: 'socrata-cook-sales', platform: 'socrata', metro: 'chicago', city: 'Cook County', state: 'IL', tz: 'America/Chicago',
    countyAnchor: { lat: 41.85003, lon: -87.65005 },
    domain: 'datacatalog.cookcountyil.gov', datasetId: COOK_SALES,
    // One deed, one record (review P2-1): a deed over several PINs repeats doc_no on each PIN's row; the parser keeps one.
    idField: 'doc_no', dateField: 'sale_date', orderTiebreak: ['pin'], priceField: 'sale_price', classField: 'class',
    addressFields: ['prop_address_full'], zipField: 'prop_address_zipcode_1', placeField: 'prop_address_city_name',
    columns: ['pin', 'doc_no', 'sale_date', 'sale_price', 'class'],
    extraWhere: `sale_price >= ${MIN_SALE_PRICE}`,
    join: {
      datasetId: COOK_ADDRESSES, keyField: 'pin', mainKeyField: 'pin',
      columns: ['pin', 'year', 'prop_address_full', 'prop_address_city_name', 'prop_address_zipcode_1'], orderField: 'year',
      verifiedUrl: `https://datacatalog.cookcountyil.gov/api/views/${COOK_ADDRESSES}.json`,
    },
    lookbackDays: 60, classOf: cookClassOf, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: `https://datacatalog.cookcountyil.gov/api/views/${COOK_SALES}.json`,
    sourceUrl: 'https://datacatalog.cookcountyil.gov/d/wvhk-k5uv', checkedOn: CHECKED, fieldSource: 'assumed',
    evidence: { columns: 'A', endpoint: '3P', freshness: '3P' },
    note: 'ON PROBATION. Cook County Assessor Parcel Sales (wvhk-k5uv) joined to Parcel Addresses (3723-97qp) on pin [3P ids]; both semi-monthly, last updated 2026-11-15 [3P]. Sales arrive late ("many records not populating until months after their official recording date"; newest sale ~5.5 weeks behind in Aug 2026 [3P]), so the window is 60 days. Columns [A]: sales pin, doc_no, sale_date, sale_price, class; addresses pin, year, prop_address_full, prop_address_city_name, prop_address_zipcode_1 (newest year kept). buyer_name, seller_name, owner_address_name and mail_address_* are NEVER selected. Rows are placed at their ZIP centre (approxLocation). One deed over several PINs makes ONE record (the first residential PIN, else the first PIN, in PIN order).',
  },
  // ---- Philadelphia -----------------------------------------------------------------------------------------------------------------
  {
    id: 'carto-phl-sales', platform: 'carto', metro: 'philadelphia', city: 'Philadelphia', state: 'PA', tz: 'America/New_York',
    cartoFrom: 'rtt_summary r LEFT JOIN opa_properties_public o ON o.parcel_number = r.opa_account_num',
    cartoSelect: {
      document_id: 'r.document_id',
      recording_date: 'r.recording_date',
      total_consideration: 'r.total_consideration',
      street_address: 'r.street_address',
      zip_code: 'r.zip_code',
      category_code_description: 'o.category_code_description',
      lat: 'ST_Y(r.the_geom)',
      lon: 'ST_X(r.the_geom)',
    },
    idField: 'document_id', dateField: 'recording_date', cartoDateExpr: 'r.recording_date',
    priceField: 'total_consideration', cartoPriceExpr: 'r.total_consideration', classField: 'category_code_description',
    addressFields: ['street_address'], zipField: 'zip_code', latField: 'lat', lonField: 'lon',
    columns: ['document_id', 'recording_date', 'total_consideration', 'street_address', 'zip_code', 'category_code_description', 'lat', 'lon'],
    extraWhere: "r.document_type = 'DEED'",
    lookbackDays: 21, classOf: phlClassOf, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: 'https://cityofphiladelphia.github.io/carto-api-explorer/#RTT_SUMMARY',
    sourceUrl: 'https://opendataphilly.org/datasets/real-estate-transfers/', checkedOn: CHECKED, fieldSource: 'assumed',
    evidence: { columns: 'A', endpoint: 'O', freshness: 'A' },
    note: 'ON PROBATION. Philadelphia Real Estate Transfers, Carto table RTT_SUMMARY [O], City of Philadelphia License [O]; update frequency not stated [O] (daily [A]). The property class comes from opa_properties_public.category_code_description [3P], LEFT JOINed on parcel_number = opa_account_num [3P]; the OpenDataPhilly list reports only ~60% of RTT rows join on parcel_number, and an unjoined row has no class and is dropped. Columns [A]: document_id, document_type, recording_date, total_consideration, street_address, zip_code, the_geom. grantors, grantees, owner_1, owner_2 and mailing_* are NEVER selected. Deeds only (document_type DEED [A]) of at least $10,000.',
  },
  // ---- Miami ------------------------------------------------------------------------------------------------------------------------
  {
    id: 'arcgis-miamidade-sales', platform: 'arcgis', metro: 'miami', city: 'Miami-Dade County', state: 'FL', tz: 'America/New_York',
    countyAnchor: { lat: 25.7743, lon: -80.1937 },
    layerUrl: MIAMIDADE_PA_POINTS,
    idField: 'FOLIO', idFields: ['FOLIO', 'DATEOFSALE_UTC'], dateField: 'DATEOFSALE_UTC', priceField: 'PRICE_1', classField: 'DOR_CODE_CUR',
    addressFields: ['TRUE_SITE_ADDR_NO_UNIT'], unitField: 'TRUE_SITE_UNIT', zipField: 'TRUE_SITE_ZIP_CODE', placeField: 'TRUE_SITE_CITY',
    columns: ['FOLIO', 'DATEOFSALE_UTC', 'PRICE_1', 'DOR_CODE_CUR', 'CONDO_FLAG', 'TRUE_SITE_ADDR_NO_UNIT', 'TRUE_SITE_UNIT', 'TRUE_SITE_CITY', 'TRUE_SITE_ZIP_CODE'],
    extraWhere: `PRICE_1 >= ${MIN_SALE_PRICE}`,
    lookbackDays: 30, classOf: miamiClassOf, cadenceMinutes: 720,
    verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: `${MIAMIDADE_PA_POINTS}?f=json`,
    sourceUrl: 'https://opendata.miamidade.gov/datasets/bf92e51f90a8426cae904ebc15018067', checkedOn: CHECKED, fieldSource: 'assumed',
    evidence: { columns: '3P', endpoint: 'A', freshness: '3P' },
    note: 'ON PROBATION. Miami-Dade Property Appraiser "Property Point View", hub item bf92e51f90a8426cae904ebc15018067, weekly [3P]. The service URL is ASSUMED: PaGISView_gdb is in the county org\'s service list [O], that it is this layer is [A]; resolve the hub item if the probe cannot read the field list. Columns [3P unofficial data dictionary]: FOLIO, DATEOFSALE_UTC (date), PRICE_1, DOR_CODE_CUR, CONDO_FLAG, TRUE_SITE_ADDR_NO_UNIT, TRUE_SITE_UNIT, TRUE_SITE_CITY, TRUE_SITE_ZIP_CODE. It holds the LATEST sale per folio (a weekly snapshot), so the id is FOLIO:DATEOFSALE_UTC. TRUE_OWNER1-3 and TRUE_MAILING_* are NEVER in outFields.',
  },
];

/** Every column a sale source's requests may name, main and join. */
export function saleRequestColumns(ds: SaleDataset): string[] {
  return [...new Set([...ds.columns, ...(ds.join?.columns ?? [])])];
}
