import type { CategoryRule, InspectionSummaryField, SocrataSubtype } from './socrata-datasets';
import type { ContactSpec } from '@/lib/contacts/extract';
import type { Site311Rule } from '@/lib/signals/site-311';
import { COVERAGE_ARCGIS_DATASETS, COVERAGE_CONTACT_SPECS, COVERAGE_VALUE_FIELDS } from './coverage-datasets';
import { VIOL_ARCGIS_DATASETS } from './viol-datasets';
import { NEXT_ARCGIS_DATASETS } from './next-datasets';

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
  /**
   * The date is a calendar DAY that the portal stores as midnight UTC (Atlanta Opend, Cobb DateIssued, Johns Creek ISSUE_DATE; round 15 Q3).
   * The stored occurred_at is kept as is, and every card prints it as that calendar day (lib/signals/lead-rules.ts formatRecordDate), never
   * shifted to New York time. The list of such source ids is DATE_ONLY_SOURCES there; tests/signals/date-only.test.ts keeps the two in step.
   */
  dateOnly?: true;
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
  /** Probation: the adapter built from this config keeps its rows in holler_source_samples only (Adapter.probation) and is not listed as live anywhere. */
  probation?: boolean;
  verifiedUrl: string;
  /** Date the layer was checked. */
  checkedOn: string;
  fieldSource: 'sourced' | 'assumed';
  note?: string;
  /**
   * Who to contact (private: holler_signal_contacts only). Round 15 adds specs (CONTACT_SPECS below). A spec marked fieldStatus
   * 'assumed' names candidate columns: an ArcGIS layer rejects an unknown outField, so the adapter reads the layer's own field list
   * first and asks only for the fields that exist (arcgis.ts resolveOptionalFields). Sourced specs are asked for as before.
   */
  contacts?: ContactSpec;
  /** Permits: project value columns, tried in order (permit-value.ts parseMoney). Stored as data.jobValue. Same candidate rule as contacts. */
  valueFields?: string[];
  /** Fields of valueFields that were not read from the layer's field list (candidates). */
  assumedValueFields?: string[];
  /** Permits: the status column, read into a fixed stage code by lib/signals/stage.ts permitStageOf (see socrata-datasets.ts statusField). */
  statusField?: string;
  /** Round 19 coverage: a composite id (Arlington FOLDERTYPE + FOLDERYEAR + FOLDERSEQUENCE), joined with ':'. idField is then documentation. */
  idFields?: string[];
  /**
   * Round 19 coverage: the column names were NOT read from the layer (research tags [3P] or [A]). The adapter reads the layer's field list
   * first: a missing id or date column (or a date column that is text) is reported as "schema mismatch: ..." without querying, other
   * missing columns are left out of outFields (the field stays empty), and the date comparison follows the layer's own date type.
   */
  schemaUnverified?: boolean;
  /**
   * Round 19 coverage (review P1-B): the address columns are unverified and may hold a name ("4521 MARIA LOPEZ FENCE"). Only what the tree's
   * shared site-address rule keeps (lib/contacts/sanitize.ts cleanAddress: house number, street words, street suffix, cut there) is stored;
   * anything else gives no address at all.
   */
  strictAddress?: boolean;
  /**
   * Round 19 coverage (review P1-A): the column that marks a confidential case (Miami-Dade CONF_FLAG). REQUIRED: it is always asked for, a
   * layer whose field list lacks it is a schema mismatch, a row without it is dropped, and any truthy value (Y, YES, TRUE, T, 1, any case,
   * spaces ignored) drops the row (arcgis.ts isConfidential).
   */
  confidentialField?: string;
  /** Round 20 (NEXT), business rows only: the premises address rule (see socrata-datasets.ts `premises`). */
  premises?: ContactSpec;
  /** Review fix P2-2: the premises address is printed only when this also says so (a commercial-premises NAICS class); absent: always. */
  premisesWhen?: (get: (field: string) => string) => boolean;
  /** Review fix P2-3: a trailing quadrant (NW, NE, SW, SE) of the address is kept (Washington DC: without it one address is four places). */
  keepQuadrant?: boolean;
  /** Round 20 (NEXT), 311 only: the block-level site rule (lib/signals/site-311.ts). */
  site311?: Site311Rule;
  /** Round 20 (NEXT), permit rows only: a certificate-of-occupancy feed (see socrata-datasets.ts `occupancy`). */
  occupancy?: { typeFields: string[]; /** Review fix P2-3: no building-type column (New York): every row is treated as residential. */ unknownType?: boolean };
  /** Round 20 (NEXT): drop a row before anything is built from it unless this says keep (see socrata-datasets.ts `keepRow`). */
  keepRow?: (get: (field: string) => string) => boolean;
  /** Round 20 (NEXT): columns `keepRow` reads (asked for in outFields like the other optional columns). */
  keepFields?: string[];
  /** Round 20 (NEXT): extra category rules for this layer only, applied after the subtype's rules (socrata.ts categorize). */
  extraRules?: CategoryRule[];
  /** Round 20 (NEXT): the source label, when "<city> open data: <subtype words>" would misname it. */
  label?: string;
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
    statusField: 'statusDescription', kind: 'permit', subtype: 'permit', idField: 'applicationNumber', dateField: 'issuedDateTime', dateType: 'date',
    titleFields: ['WorkTypeDescription'], textFields: ['WorkTypeDescription', 'OccupancyTypeDescription'],
    summaryFields: ['WorkTypeDescription', 'OccupancyTypeDescription', 'statusDescription'], addressFields: ['location'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(DEKALB), checkedOn: '2026-11-17', fieldSource: 'sourced',
    note: 'Metro Atlanta (DeKalb County, GA). Hansen Building Applications MapServer layer, 44 fields. Live checks: latest issuedDateTime 2026-11-13 22:20 UTC, 453 rows issued since 2026-11-01, geometry returned as lon/lat with outSR=4326 (layer native SR is feet, wkid 102667). WorkTypeDescription values seen: Commercial Air Conditioning, Residential Air Conditioning, New Construction, Additions to Existing Structures, Owner Change Only. primaryContact*, comments and applicationName are never read.',
  },
  {
    id: 'arcgis-raleigh-permits', city: 'Raleigh', state: 'NC', tz: 'America/New_York', layerUrl: RALEIGH,
    kind: 'permit', subtype: 'permit', idField: 'permitnum', dateField: 'issueddate', dateType: 'date', latField: 'latitude_perm', lonField: 'longitude_perm',
    titleFields: ['description', 'permittype'], textFields: ['description', 'proposedworkdescription', 'workclass', 'permittype', 'permitclassmapped'],
    summaryFields: ['permittype', 'workclass', 'permitclassmapped', 'estprojectcost'], addressFields: ['originaladdress1'], zipField: 'originalzip',
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(RALEIGH), checkedOn: '2026-11-24', fieldSource: 'sourced',
    note: 'City of Raleigh Building Permits, 83 fields. editingInfo.lastEditDate 2026-11-15 22:03 UTC; live query returned permits issued 2026-11-10 to 2026-11-12 with lon/lat geometry. parcelownername, contractor and reviewer columns are never read. Round 28: permitclassmapped ("Residential" or "Non-Residential", read from live features 2026-11-24; permitclass is null on them) is a summary part, so routing and the property filter see the class. It is classifier text too, as the Austin permit_class_mapped is: there "Non-Residential" makes an alteration or addition a tenant fit-out (lib/signals/mapping/permit.ts SOURCE_COMMERCIAL_CLASS_RE).',
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
    kind: 'permit', subtype: 'permit', idField: 'RecordID', dateField: 'Opend', dateType: 'date', dateOnly: true, latField: 'DisplayY', lonField: 'DisplayX',
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
    kind: 'permit', subtype: 'permit', idField: 'PermitNo', dateField: 'DateIssued', dateType: 'date', dateOnly: true,
    titleFields: ['PermitType'], textFields: ['PermitType'], summaryFields: ['PermitType', 'JobValueCalc'],
    addressFields: ['StreetNo', 'StreetName', 'StreetType'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(`${COBB_PERMITS}/4`), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'Cobb County Community Development, Accela_PermitsDashboard FeatureServer layer 4 (Residential Permits), 21 fields. Live checks 2026-11-19: 397 rows in all, 17 issued in the last 30 days, newest DateIssued 2026-11-12, every PermitType "New Home". Re-read 2026-11-21 (WebFetch of /4?f=pjson and /4/query): layer name "Residential Permits", geometryType esriGeometryPoint, maxRecordCount 1000, Query capability only, the same 21 fields, no description, no copyrightText and no licence text on the layer (the county site says only that information on it is public under the Georgia Open Records Act); newest DateIssued 2026-11-18; no owner, applicant or contractor column. No coordinates in the response (geometry absent on every row) and no ZIP or city column (TAXDIST and CLASS are empty on recent rows), so signals are placed at the county seat with data.loc = approx. No owner, applicant or contractor column.',
  },
  {
    id: 'arcgis-cobb-commercial-permits', city: 'Cobb County', state: 'GA', tz: 'America/New_York', layerUrl: `${COBB_PERMITS}/1`,
    countyAnchor: COBB_CENTER, fallbackCenter: COBB_CENTER,
    kind: 'permit', subtype: 'permit', idField: 'PermitNo', dateField: 'DateIssued', dateType: 'date', dateOnly: true,
    titleFields: ['PermitType', 'PermitSubType', 'CobbWorkType'], textFields: ['PermitType', 'PermitSubType', 'CobbWorkType'], summaryFields: ['PermitSubType', 'VALUE'],
    addressFields: ['StreetNo', 'StreetName', 'StreetType'],
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, verifiedUrl: M(`${COBB_PERMITS}/1`), checkedOn: '2026-11-19', fieldSource: 'sourced',
    note: 'Cobb County Community Development, Accela_PermitsDashboard FeatureServer layer 1 (Commercial Permits), 21 fields. Live checks 2026-11-19: 580 rows in all, 48 issued in the last 30 days (PermitSubType New Tenant 31, Remodel 12, Vacant Tenant 5), newest DateIssued 2026-11-13. No coordinates in the response and no ZIP or city column, so signals are placed at the county seat with data.loc = approx. No owner, applicant or contractor column.',
  },
  {
    id: 'arcgis-cobb-multiunit-permits', city: 'Cobb County', state: 'GA', tz: 'America/New_York', layerUrl: `${COBB_PERMITS}/3`,
    countyAnchor: COBB_CENTER, fallbackCenter: COBB_CENTER,
    kind: 'permit', subtype: 'permit', idField: 'PermitNo', dateField: 'DateIssued', dateType: 'date', dateOnly: true,
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
  // Round 19 coverage (Dallas-Fort Worth, Houston, Miami, Phoenix): ALL ON PROBATION, schemas unverified. See coverage-datasets.ts.
  ...COVERAGE_ARCGIS_DATASETS,
  // Round 20 VIOL (Washington DC 311): ON PROBATION, schema unverified. See viol-datasets.ts.
  ...VIOL_ARCGIS_DATASETS,
  // Round 20 NEXT (Miami-Dade business tax, Phoenix liquor licences, DC certificates of occupancy): ALL ON PROBATION. See next-datasets.ts.
  ...NEXT_ARCGIS_DATASETS,
];

/**
 * ROUND 15 (PLAN-2.0 1.2, 1.3): contacts and project value per permit layer.
 *
 * DeKalb: read 2026-11-21 from https://dcgis.dekalbcountyga.gov/mapping/rest/services/Building_Permit_Applications/MapServer/layers
 * (44 fields). Contact columns: primaryContactName, primaryContactPhone, primaryContactType, primaryContactEMailAddress, primaryContactId,
 * primaryIdentityId. There is NO applicant, contractor or company column: primaryContact* is the person or business that filed the
 * application, so a homeowner appears there too. Only a name the organisation classifier accepts is kept, only when primaryContactType
 * is on the contractor allow-list (blank or unknown types show nothing), and its phone is kept only with such a name. The e-mail column is never read. Value columns:
 * declaredValuation and calculatedValuation (both text). Address: location, locationLine1 (no separate city, state or ZIP).
 *
 * Raleigh: contractorcompanyname and contractorlicnum named by https://www.openpermitdata.com/raleigh/methodology (fetched 2026-11-21,
 * "approximately 92% of all permits" carry the company name). contractorphone is a candidate. contractorfullname (a person) is never read.
 *
 * DC: PERMIT_APPLICANT and OWNER_NAME exist (round 4 note). Neither is read: the applicant is often the owner or the owner's company and
 * is never labelled the contractor (review HSK G-P1-1). No contractor column is known; the value names below are candidates.
 *
 * Mecklenburg, Atlanta, Johns Creek, Cobb: address (and, where the summary has it, value) only. owner_* columns are never read.
 */
export const CONTACT_SPECS: Record<string, ContactSpec> = {
  'arcgis-dekalb-permits': {
    verifiedUrl: M(DEKALB),
    checkedOn: '2026-11-21',
    fieldStatus: 'sourced',
    site: { addressFields: ['locationLine1'] },
    orgs: [
      {
        role: 'contractor',
        nameFields: ['primaryContactName'],
        phoneField: 'primaryContactPhone',
        typeField: 'primaryContactType',
        // Review HSK G-P1-1: the filer of a DeKalb application is often the owner or the owner's company. Only a filer whose type says
        // contractor (or builder, or a licensed professional) is shown as the contractor; a blank or unknown type shows nothing.
        // Anchored (review HSK re-verification): the type must START with the allowed word, so "Non-Contractor", "Not a Contractor",
        // "Landlord Contractor" and "Self Builder" do not match; the deny regex still removes "Contractor/Owner", "Contractor Agent" and so on.
        // Redo 1 (review P3-5): the WHOLE type must match, so "Contractor Primary", "Contractor Authorized" and a type with a hidden
        // character after it ("Contractor\u200B") show nothing.
        acceptType: /^(?:(?:general|sub-?|licensed)\s*)?contractor(?:\s+-\s+(?:residential|commercial))?$|^builder$|^licensed\s+professional$/i,
        rejectType: /\b(?:owners?|residents?|tenants?|home\s?owners?|individuals?|persons?|occupants?|applicants?|agents?|architects?|engineers?|landlords?|non|not|self)\b/i,
      },
    ],
  },
  'arcgis-raleigh-permits': {
    verifiedUrl: M(RALEIGH),
    checkedOn: '2026-11-21',
    fieldStatus: 'assumed',
    assumedFields: ['contractorphone'],
    site: { addressFields: ['originaladdress1'], zipField: 'originalzip' },
    orgs: [{ role: 'contractor', nameFields: ['contractorcompanyname'], phoneField: 'contractorphone', licenseFields: ['contractorlicnum'] }],
  },
  'arcgis-dc-permits': {
    verifiedUrl: M(DC),
    checkedOn: '2026-11-21',
    fieldStatus: 'sourced',
    site: { addressFields: ['FULL_ADDRESS'], zipField: 'ZIPCODE' },
    // Review HSK G-P1-1: PERMIT_APPLICANT is the applicant, often the owner or the owner's LLC, never labelled the contractor. Not read.
  },
  'arcgis-mecklenburg-permits': {
    verifiedUrl: M(MECK),
    checkedOn: '2026-11-17',
    fieldStatus: 'sourced',
    site: { addressFields: ['project_address'], zipField: 'zip_code' },
  },
  'arcgis-atlanta-permits': {
    verifiedUrl: M(ATL_PERMITS),
    checkedOn: '2026-11-19',
    fieldStatus: 'sourced',
    site: { addressFields: ['Address'] },
  },
  'arcgis-cobb-residential-permits': {
    verifiedUrl: M(`${COBB_PERMITS}/4`),
    checkedOn: '2026-11-19',
    fieldStatus: 'sourced',
    site: { addressFields: ['StreetNo', 'StreetName', 'StreetType'] },
  },
  'arcgis-cobb-commercial-permits': {
    verifiedUrl: M(`${COBB_PERMITS}/1`),
    checkedOn: '2026-11-19',
    fieldStatus: 'sourced',
    site: { addressFields: ['StreetNo', 'StreetName', 'StreetType'] },
  },
  'arcgis-cobb-multiunit-permits': {
    verifiedUrl: M(`${COBB_PERMITS}/3`),
    checkedOn: '2026-11-19',
    fieldStatus: 'sourced',
    site: { addressFields: ['StreetNo', 'StreetName', 'StreetType'] },
  },
};

/** Value columns per layer. Sourced ones are summaryFields already (or the DeKalb field list); the rest are candidates. */
export const PERMIT_VALUE_FIELDS: Record<string, { fields: string[]; assumed?: string[] }> = {
  'arcgis-dekalb-permits': { fields: ['declaredValuation', 'calculatedValuation'] },
  'arcgis-raleigh-permits': { fields: ['estprojectcost'] },
  'arcgis-atlanta-permits': { fields: ['JOB_VALUE'] },
  'arcgis-cobb-residential-permits': { fields: ['JobValueCalc'] },
  'arcgis-cobb-commercial-permits': { fields: ['VALUE'] },
  'arcgis-cobb-multiunit-permits': { fields: ['VALUE'] },
  'arcgis-dc-permits': { fields: ['ESTIMATED_COST', 'COST_OF_CONSTRUCTION'], assumed: ['ESTIMATED_COST', 'COST_OF_CONSTRUCTION'] },
  'arcgis-mecklenburg-permits': { fields: ['project_cost', 'total_cost'], assumed: ['project_cost', 'total_cost'] },
};

for (const [id, spec] of Object.entries(COVERAGE_CONTACT_SPECS)) CONTACT_SPECS[id] = spec;
for (const [id, v] of Object.entries(COVERAGE_VALUE_FIELDS)) PERMIT_VALUE_FIELDS[id] = v;

for (const d of ARCGIS_DATASETS) {
  if (CONTACT_SPECS[d.id]) d.contacts = CONTACT_SPECS[d.id];
  const v = PERMIT_VALUE_FIELDS[d.id];
  if (v) {
    d.valueFields = v.fields;
    if (v.assumed) d.assumedValueFields = v.assumed;
  }
}

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
