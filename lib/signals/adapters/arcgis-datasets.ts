import type { InspectionSummaryField, SocrataSubtype } from './socrata-datasets';
import type { ContactSpec } from '@/lib/contacts/extract';

/**
 * Config for the generic ArcGIS (FeatureServer / MapServer layer) adapter.
 *
 * Query syntax was read from Esri's REST reference on 2026-11-17:
 *   https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/
 *   - endpoint  <layer url>/query   with where, outFields, orderByFields ("FIELD DESC"), resultRecordCount (max = layer maxRecordCount),
 *               f=json, outSR=4326, returnGeometry=true
 *   - dates     esriFieldTypeDate:     FIELD >= timestamp 'yyyy-mm-dd HH24:mi:ss'
 *               esriFieldTypeDateOnly: FIELD >= date 'yyyy-mm-dd'
 *   - response  features[].attributes, date values as epoch milliseconds (UTC), point geometry {x, y} (x = longitude with outSR 4326)
 *
 * Every layer below was verified with `<layer url>?f=json` (field names and types, editingInfo where present) AND a live query
 * (`where=<date> >= timestamp '2026-11-10'` or `orderByFields=<date> DESC`) on 2026-11-17. Layers that failed the recency check are
 * listed with `verified: false` and are disabled. `verifiedUrl` is the metadata URL checked.
 */

export interface ArcgisDataset {
  id: string;
  city: string;
  state: string;
  /** IANA zone of the city. Documentation only: hosted layers store UTC and the query literal is built in UTC. */
  tz: string;
  /** Layer URL without a trailing /query (FeatureServer/<n> or MapServer/<n>). */
  layerUrl: string;
  kind: 'permit' | 'civic' | 'event';
  subtype: SocrataSubtype;
  idField: string;
  dateField: string;
  /** 'date' (esriFieldTypeDate, epoch ms in the response) or 'dateOnly' (esriFieldTypeDateOnly, 'yyyy-mm-dd'). */
  dateType: 'date' | 'dateOnly';
  /** Attribute coordinates used when the feature has no usable geometry. */
  latField?: string;
  lonField?: string;
  fallbackCenter?: { lat: number; lon: number };
  /** County-level feeds only: a point inside the county (the county seat, assumed from public geography). Says which city pages the rows land on. */
  countyAnchor?: { lat: number; lon: number };
  titleFields: string[];
  textFields: string[];
  /**
   * Permits only: text fields documented as a MIX of street address, description and name. They are read for unambiguous work
   * phrases only (lib/signals/mapping/permit.ts MIXED_FIELD_PHRASES), so a street, business or surname never picks a trade.
   */
  mixedTextFields?: string[];
  /**
   * Title or summary columns that hold free text people typed (311 details, complaint descriptions). They may be classified but are
   * never printed; a 311 or violation title then uses fixed words for its trades (permit-privacy.ts civicLabel).
   */
  freeTextFields?: string[];
  summaryFields: string[];
  addressFields?: string[];
  /** Read only into the private contacts spec; the public inspection path never reads it. */
  nameField?: string;
  /** Inspections only: categorical summary columns and their fixed value lists (see socrata-datasets.ts InspectionSummaryField). */
  inspectionSummary?: InspectionSummaryField[];
  zipField?: string;
  extraWhere?: string;
  lookbackOverride?: number;
  windowForwardDays?: number;
  cadenceMinutes: number;
  verified: boolean;
  verifiedUrl: string;
  /** Date the layer was checked. */
  checkedOn: string;
  fieldSource: 'sourced' | 'assumed';
  note?: string;
  /**
   * Who to contact (private: holler_signal_contacts only). None of the layers below has one: their field lists could not be re-read on
   * 2026-11-17 (the WebFetch of each `?f=json` URL was refused), and no column is added unread. Add one only after reading the layer's
   * fields, with the URL in contacts.verifiedUrl.
   */
  contacts?: ContactSpec;
}

const M = (layerUrl: string) => `${layerUrl}?f=json`;

const RALEIGH = 'https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0';
const DC = 'https://maps2.dcgis.dc.gov/DCGIS/rest/services/FEEDS/DCRA/MapServer/4';
const MECK = 'https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits_Accela/FeatureServer/0';
const DEKALB = 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/MapServer/0';
const ATL_PERMITS = 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0';
const DEKALB_CODE = 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Hansen/CodeEnforcementCasesInspections/FeatureServer/0';
const COBB_PERMITS = 'https://gis.cobbcounty.org/gisserver/rest/services/comdev/Accela_PermitsDashboard/FeatureServer';
/** Cobb County seat (Marietta), rounded to 2 decimals. Rows of the Cobb permit layers have no geometry and no ZIP or city column, so they sit here (data.loc = 'approx'). */
export const COBB_CENTER = { lat: 33.95, lon: -84.55 } as const;
const ATL_BIZ = 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/Business_Licenses_2026_Citywide/FeatureServer/0';

export const ARCGIS_DATASETS: ArcgisDataset[] = [
  {
    id: 'arcgis-dekalb-permits', city: 'DeKalb County', state: 'GA', tz: 'America/New_York', layerUrl: DEKALB, countyAnchor: { lat: 33.7748, lon: -84.2963 },
    kind: 'permit', subtype: 'permit', idField: 'applicationNumber', dateField: 'issuedDateTime', dateType: 'date',
    titleFields: ['WorkTypeDescription'], textFields: ['WorkTypeDescription', 'OccupancyTypeDescription'],
    summaryFields: ['WorkTypeDescription', 'OccupancyTypeDescription', 'statusDescription'], addressFields: ['location'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(DEKALB), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'Metro Atlanta (DeKalb County, GA). Hansen Building Applications MapServer layer, 44 fields. Live checks: latest issuedDateTime 2026-11-13 22:20 UTC, 453 rows issued since 2026-11-01, geometry returned as lon/lat with outSR=4326 (layer native SR is feet, wkid 102667). WorkTypeDescription values seen: Commercial Air Conditioning, Residential Air Conditioning, New Construction, Additions to Existing Structures, Owner Change Only. primaryContact*, comments and applicationName are never read.',
  },
  {
    id: 'arcgis-raleigh-permits', city: 'Raleigh', state: 'NC', tz: 'America/New_York', layerUrl: RALEIGH,
    kind: 'permit', subtype: 'permit', idField: 'permitnum', dateField: 'issueddate', dateType: 'date', latField: 'latitude_perm', lonField: 'longitude_perm',
    titleFields: ['description', 'permittype'], textFields: ['description', 'proposedworkdescription', 'workclass', 'permittype'],
    summaryFields: ['permittype', 'workclass', 'estprojectcost'], addressFields: ['originaladdress1'], zipField: 'originalzip',
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(RALEIGH), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'City of Raleigh Building Permits, 83 fields. editingInfo.lastEditDate 2026-11-15 22:03 UTC; live query returned permits issued 2026-11-10 to 2026-11-12 with lon/lat geometry. parcelownername, contractor and reviewer columns are never read.',
  },
  {
    id: 'arcgis-dc-permits', city: 'Washington', state: 'DC', tz: 'America/New_York', layerUrl: DC,
    kind: 'permit', subtype: 'permit', idField: 'PERMIT_ID', dateField: 'ISSUE_DATE', dateType: 'date', latField: 'LATITUDE', lonField: 'LONGITUDE',
    titleFields: ['DESC_OF_WORK', 'PERMIT_TYPE_NAME'], textFields: ['DESC_OF_WORK', 'PERMIT_TYPE_NAME', 'PERMIT_SUBTYPE_NAME', 'PERMIT_CATEGORY_NAME'],
    summaryFields: ['PERMIT_TYPE_NAME', 'PERMIT_SUBTYPE_NAME'], addressFields: ['FULL_ADDRESS'], zipField: 'ZIPCODE',
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(DC), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'DC DCRA feed, layer 4 "Building Permits - Last 30 Days" (a rolling layer, so no yearly layer swap). Layer 4 returned count 3950; the same schema on layer 18 (2026) returned permits issued 2026-11-10 to 2026-11-12 with lon/lat geometry. OWNER_NAME and PERMIT_APPLICANT are never read.',
  },
  {
    id: 'arcgis-mecklenburg-permits', city: 'Mecklenburg County', state: 'NC', tz: 'America/New_York', layerUrl: MECK, countyAnchor: { lat: 35.2271, lon: -80.8431 },
    kind: 'permit', subtype: 'permit', idField: 'permit_number', dateField: 'issue_date', dateType: 'date', latField: 'latitude', lonField: 'longitude',
    titleFields: ['description_of_work', 'description', 'type_of_work'], textFields: ['description_of_work', 'description', 'type_of_work', 'permit_type'],
    summaryFields: ['permit_type', 'type_of_work', 'total_square_feet'], addressFields: ['project_address'], zipField: 'zip_code',
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(MECK), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'Charlotte area (Mecklenburg County, NC), Accela building permits. Live query returned permits issued 2026-11-02 to 2026-11-13. No editingInfo is published; recency rests on the live query. owner_* columns are never read.',
  },
  // ---- Atlanta metro, round 7 ----
  {
    id: 'arcgis-atlanta-permits', city: 'Atlanta', state: 'GA', tz: 'America/New_York', layerUrl: ATL_PERMITS,
    kind: 'permit', subtype: 'permit', idField: 'RecordID', dateField: 'Opend', dateType: 'date', latField: 'DisplayY', lonField: 'DisplayX',
    // Name is a free-text project name (a street address, a description or sometimes a person's surname): read to pick trades, never printed.
    // Group_ is "Building" on every row, so it stays out (it would tag every row general-contractor).
    titleFields: ['TypeCombo'], textFields: ['Name', 'TypeCombo', 'Subtype', 'Use_'], mixedTextFields: ['Name'], summaryFields: ['TypeCombo', 'JOB_VALUE'],
    addressFields: ['Address'],
    extraWhere: "TypeCombo NOT IN ('Open Record Request','Building Complaint','Side Walk Waiver','Noise Temporary Variance','Outdoor Events')",
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(ATL_PERMITS), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'City of Atlanta Office of Buildings permit applications (Accela Citizen Access export), service building_permit_featureLayer layer 0 in the planning ArcGIS Online org (services5.arcgis.com/5RxyIIJ9boPdptdo), 23 fields, Opend is esriFieldTypeDate (midnight UTC, the day the application opened). Live checks 2026-11-19: editingInfo.dataLastEditDate 2026-11-18, newest Opend 2026-11-18, 1191 rows opened in the last 30 days, 39034 rows in all. Rows are applications (Status_1 ACA Pending, Routed for Review, Additional Materials Required and so on), not only issued permits. The earlier snapshot service Building_Permit_latest (last edit 2026-01-29) is NOT this layer. No owner, applicant or contractor column exists; Name is free text and is classifier input only. The TypeCombo values Open Record Request, Building Complaint, Side Walk Waiver, Noise Temporary Variance and Outdoor Events are excluded because they are not work.',
  },
  // ---- Cobb County permits, round 7 (rows carry NO geometry: placed at COBB_CENTER and flagged data.loc = 'approx' by arcgis-cobb.ts) ----
  {
    id: 'arcgis-cobb-residential-permits', city: 'Cobb County', state: 'GA', tz: 'America/New_York', layerUrl: `${COBB_PERMITS}/4`,
    countyAnchor: COBB_CENTER, fallbackCenter: COBB_CENTER,
    kind: 'permit', subtype: 'permit', idField: 'PermitNo', dateField: 'DateIssued', dateType: 'date',
    titleFields: ['PermitType'], textFields: ['PermitType'], summaryFields: ['PermitType', 'JobValueCalc'],
    addressFields: ['StreetNo', 'StreetName', 'StreetType'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(`${COBB_PERMITS}/4`), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'Cobb County Community Development, Accela_PermitsDashboard FeatureServer layer 4 (Residential Permits), 21 fields. Live checks 2026-11-19: 397 rows in all, 17 issued in the last 30 days, newest DateIssued 2026-11-12, every PermitType "New Home". No coordinates in the response (geometry absent on every row) and no ZIP or city column (TAXDIST and CLASS are empty on recent rows), so signals are placed at the county seat with data.loc = approx. No owner, applicant or contractor column.',
  },
  {
    id: 'arcgis-cobb-commercial-permits', city: 'Cobb County', state: 'GA', tz: 'America/New_York', layerUrl: `${COBB_PERMITS}/1`,
    countyAnchor: COBB_CENTER, fallbackCenter: COBB_CENTER,
    kind: 'permit', subtype: 'permit', idField: 'PermitNo', dateField: 'DateIssued', dateType: 'date',
    titleFields: ['PermitType', 'PermitSubType', 'CobbWorkType'], textFields: ['PermitType', 'PermitSubType', 'CobbWorkType'], summaryFields: ['PermitSubType', 'VALUE'],
    addressFields: ['StreetNo', 'StreetName', 'StreetType'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(`${COBB_PERMITS}/1`), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'Cobb County Community Development, Accela_PermitsDashboard FeatureServer layer 1 (Commercial Permits), 21 fields. Live checks 2026-11-19: 580 rows in all, 48 issued in the last 30 days (PermitSubType New Tenant 31, Remodel 12, Vacant Tenant 5), newest DateIssued 2026-11-13. No coordinates in the response and no ZIP or city column, so signals are placed at the county seat with data.loc = approx. No owner, applicant or contractor column.',
  },
  {
    id: 'arcgis-cobb-multiunit-permits', city: 'Cobb County', state: 'GA', tz: 'America/New_York', layerUrl: `${COBB_PERMITS}/3`,
    countyAnchor: COBB_CENTER, fallbackCenter: COBB_CENTER,
    kind: 'permit', subtype: 'permit', idField: 'PermitNo', dateField: 'DateIssued', dateType: 'date',
    titleFields: ['PermitType', 'PermitSubType', 'CobbWorkType'], textFields: ['PermitType', 'PermitSubType', 'CobbWorkType'], summaryFields: ['PermitSubType', 'VALUE'],
    addressFields: ['StreetNo', 'StreetName', 'StreetType'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(`${COBB_PERMITS}/3`), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'Cobb County Community Development, Accela_PermitsDashboard FeatureServer layer 3 (MultiUnit Permits), 21 fields. Live checks 2026-11-19: 152 rows in all, 9 issued in the last 30 days (all PermitSubType Townhome, VALUE 0), newest DateIssued 2026-11-11. No coordinates in the response and no ZIP or city column, so signals are placed at the county seat with data.loc = approx. No owner, applicant or contractor column.',
  },
  {
    id: 'arcgis-dekalb-violations', city: 'DeKalb County', state: 'GA', tz: 'America/New_York', layerUrl: DEKALB_CODE, countyAnchor: { lat: 33.7748, lon: -84.2963 },
    kind: 'civic', subtype: 'violation', idField: 'applicationNumber', dateField: 'addedDateTime', dateType: 'date',
    // Violation text is the county's own ordinance heading (74 distinct values in the last 30 days), classifier input only. No title field:
    // every title reads "Code violation in DeKalb County: property violation". Address is block level (publicAddress) and the point is rounded to a block.
    titleFields: [], textFields: ['codeViolations_0__description'], summaryFields: [],
    addressFields: ['address_streetNumber', 'address_streetName', 'address_suffix'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(DEKALB_CODE), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'DeKalb County Hansen code enforcement cases, FeatureServer layer 0 "Code Cases" (a point layer, 34047 cases). Live checks 2026-11-19: newest addedDateTime 2026-11-18 (case numbers 1324115 to 1324118 are consecutive with that date), 828 cases added in the last 30 days, of which 496 carry a violation heading. applicationDateTime is empty on recent rows, so addedDateTime is the date field. The layer has no owner, complainant or contact column; comments are not read. Rows without a violation heading are dropped (no text). Layer 1 (inspections) is not used: its newest callDateTime is 2026-03-31.',
  },
  {
    id: 'arcgis-atlanta-business', city: 'Atlanta', state: 'GA', tz: 'America/New_York', layerUrl: ATL_BIZ,
    kind: 'civic', subtype: 'business', idField: 'license_number', dateField: 'license_issued', dateType: 'date', latField: 'Latitude', lonField: 'Longitude',
    titleFields: [], textFields: ['license_classification', 'naics_description'], summaryFields: ['license_classification', 'naics_description'],
    windowForwardDays: 0, cadenceMinutes: 720, verified: false, verifiedUrl: M(ATL_BIZ), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'DISABLED. Business_Licenses_2026_Citywide (Dept. of Revenue), 24 fields, license_issued is esriFieldTypeDate. editingInfo.lastEditDate 2026-10-20 but the newest license_issued is 2026-07-01, so a 14 day window returns nothing. Re-enable if the Revenue export is refreshed. PRIVACY: business_name is never read (can be a person) and the street address is dropped for business rows.',
  },
];

/** Default lookback (days) for the where clause. */
export function arcgisLookbackDays(ds: ArcgisDataset): number {
  if (ds.lookbackOverride != null) return ds.lookbackOverride;
  if (ds.subtype === '311') return 3;
  if (ds.subtype === 'business') return 14;
  if (ds.subtype === 'event-permit') return 1;
  return 7;
}

export function arcgisPageUrl(ds: ArcgisDataset): string {
  return ds.layerUrl;
}
