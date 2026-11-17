import type { SocrataSubtype } from './socrata-datasets';

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
  summaryFields: string[];
  addressFields?: string[];
  nameField?: string;
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
}

const M = (layerUrl: string) => `${layerUrl}?f=json`;

const RALEIGH = 'https://services.arcgis.com/v400IkDOw1ad7Yad/arcgis/rest/services/Building_Permits/FeatureServer/0';
const DC = 'https://maps2.dcgis.dc.gov/DCGIS/rest/services/FEEDS/DCRA/MapServer/4';
const MECK = 'https://meckgis.mecklenburgcountync.gov/server/rest/services/BuildingPermits_Accela/FeatureServer/0';
const DEKALB = 'https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/MapServer/0';
const ATL_PERMITS = 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/Building_Permit_latest/FeatureServer/0';
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
  // ---- Atlanta, GA: layers exist but are stale, so they ship disabled ----
  {
    id: 'arcgis-atlanta-permits', city: 'Atlanta', state: 'GA', tz: 'America/New_York', layerUrl: ATL_PERMITS,
    kind: 'permit', subtype: 'permit', idField: 'RecordID', dateField: 'Opend', dateType: 'date', latField: 'DisplayY', lonField: 'DisplayX',
    titleFields: ['Name', 'TypeCombo'], textFields: ['Name', 'TypeCombo', 'Subtype', 'Group_', 'Use_'], summaryFields: ['TypeCombo', 'Subtype', 'JobValue'],
    addressFields: ['Address'], windowForwardDays: 0, cadenceMinutes: 720, verified: false, verifiedUrl: M(ATL_PERMITS), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'DISABLED. Service Building_Permit_latest in the City of Atlanta planning ArcGIS Online org (services5.arcgis.com/5RxyIIJ9boPdptdo). Columns verified (22 fields, Opend is esriFieldTypeDate) but editingInfo.lastEditDate is 2026-01-29 and the newest Opend is 2026-01-29: a snapshot, not a live feed. Other Atlanta services in that org (Building_Permits_2009_2014, Building_permits_2019_2024, building_permit_featureLayer, Permit_cleaned, Code_Enforcement_Data_2021_2023, 311_Cases_in_Atlanta_Main_Street_District Jan-Aug 2026) are also snapshots. Atlanta issues permits through Accela Citizen Access, which publishes no open feed. Re-enable if the city starts refreshing this layer.',
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
