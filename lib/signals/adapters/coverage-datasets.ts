import type { ContactSpec } from '@/lib/contacts/extract';
import type { ArcgisDataset } from './arcgis-datasets';
import { PROPERTY_CONDITION_311_RE } from '@/lib/signals/site-311';

/**
 * ROUND 19 COVERAGE: ArcGIS feeds for the four metros that had no local permit or code-enforcement feed (Dallas-Fort Worth, Houston, Miami,
 * Phoenix). EVERY entry is ON PROBATION (`probation: true`): its rows go to holler_source_samples only (lib/signals/samples.ts), never to a
 * member, a card, an email, a push, a public page or a count, until the owner has read real samples and promoted it (LAUNCH.md, "Round 19
 * coverage"). `verified: true` here only means "registered so the scan runs it"; capabilities, guides and home counts leave a probation
 * dataset out (enabledDatasets, guide-data, feedCount).
 *
 * Provenance: /home/claude/gates/r19/COVERAGE-research.md (2026-11-22). NO data row was ever pulled from any of these layers and no field
 * list was read in this unit (WebFetch of the layer metadata was refused on 2026-11-22). Each column below carries the research tag:
 *   [O]  the research opened the layer's own REST page and read the field list
 *   [3P] read on a third-party page that documents the layer (column names may be stale)
 *   [A]  assumed (a platform convention, e.g. the BLDS standard names)
 * Every entry has `schemaUnverified: true`: the adapter reads the layer's own field list before querying, reports a missing id or date
 * column as "schema mismatch: expected <col>", leaves any other missing column out of the query (the field stays empty), and follows the
 * layer's own date type. Geometry is always requested as WGS84 (outSR=4326, arcgis.ts buildArcgisQuery); the projected X/Y attribute
 * columns (PROPX/PROPY, X_COORD/Y_COORD, X/Y) are never read as coordinates.
 *
 * PRIVACY. Owner, applicant, legal-description, free-text note and "responsible party" columns are never named here, so they are never
 * fetched: Arlington none known; Miami-Dade LGLDESC1/2, CONTRNUM (a Florida contractor licence belongs to a person, the qualifier),
 * CONF_BY, VIOL_NAME; Phoenix OWNER_NAME, CONTACT (company or person unknown), PROJECT, PERMIT_NAME; Houston ResolutionNotes (round 20: IncidentAddress
 * only through the block-level 311 site rule, lib/signals/site-311.ts). Contractor and business name columns go through the existing organisation check (lib/contacts/extract.ts
 * extractContacts -> cleanOrgName) and, for samples, sanitizeContacts (lib/signals/samples.ts sanitizeSample).
 *
 * NOT ADDED (see the coverage report): Fort Worth (no public FeatureServer URL was found, only a test server), City of Miami permits (no
 * column list at all), Tempe and Phoenix code cases (violation text only through a table join / no field list), Mesa (conflicting dataset
 * ids), Scottsdale (form-driven CSV), Collin CAD (no columns), and every Houston permit source (the only fresh one is an HTML report that
 * needs a page scraper).
 */

const M = (layerUrl: string) => `${layerUrl}?f=json`;

export const ARLINGTON_PERMITS = 'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1';
const MDC = 'https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/ArcGIS/rest/services';
export const MIAMIDADE_PERMITS = `${MDC}/miamidade_permit_data/FeatureServer/0`;
export const MIAMIDADE_CODE = `${MDC}/CodeComplianceViolation_Open_View/FeatureServer/0`;
export const MIAMIDADE_BUILDING_VIOLATIONS = `${MDC}/BuildingViolation_gdb/FeatureServer/0`;
export const PHOENIX_PERMITS = 'https://mapportal.phoenix.gov/pds/rest/services/ShapePHX/ShapePHXPermitsPoints/MapServer/0';
export const TEMPE_PERMITS = 'https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0';
export const HOUSTON_311 = 'https://mycity2.houstontx.gov/pubgis01/rest/services/311/D365_SR311_PROD/MapServer/0';

/** Miami-Dade County seat (Miami), from lib/geo CITIES: says which city page and metro a county feed belongs to. */
const MIAMI_DADE_ANCHOR = { lat: 25.7743, lon: -80.1937 } as const;
const CHECKED = '2026-11-22';

export const COVERAGE_ARCGIS_DATASETS: ArcgisDataset[] = [
  // ---- Dallas-Fort Worth -----------------------------------------------------------------------------------------------------------
  {
    id: 'arcgis-arlington-permits', city: 'Arlington', state: 'TX', tz: 'America/Chicago', layerUrl: ARLINGTON_PERMITS,
    kind: 'permit', subtype: 'permit', idField: 'FOLDERSEQUENCE', idFields: ['FOLDERTYPE', 'FOLDERYEAR', 'FOLDERSEQUENCE'],
    dateField: 'ISSUEDATE', dateType: 'date', statusField: 'STATUSDESC',
    titleFields: ['WORKDESC', 'SUBDESC'], textFields: ['WORKDESC', 'SUBDESC', 'FOLDERTYPE'], summaryFields: ['SUBDESC', 'STATUSDESC'],
    addressFields: ['FOLDERNAME'], strictAddress: true,
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(ARLINGTON_PERMITS), checkedOn: CHECKED, fieldSource: 'sourced',
    note: 'ON PROBATION. City of Arlington "Issued Permits" (3-year view, updated daily M-F) [O]. Columns [O]: FOLDERYEAR, FOLDERSEQUENCE, FOLDERTYPE, SUBDESC, WORKDESC, STATUSDESC, ISSUEDATE, FOLDERNAME, ConstructionValuationDeclared, SignConstructionValue, NameofBusiness. Field TYPES and the newest row were not confirmed. FOLDERNAME is assumed to be the address (AMANDA convention, [A]); only what lib/contacts cleanAddress keeps is stored (review P1-B). NameofBusiness is probably the occupant on CO and sign permits [A]. No contractor column. PROPX/PROPY are projected and never read.',
  },
  // ---- Miami ------------------------------------------------------------------------------------------------------------------------
  {
    id: 'arcgis-miamidade-permits', city: 'Miami-Dade County', state: 'FL', tz: 'America/New_York', layerUrl: MIAMIDADE_PERMITS, countyAnchor: MIAMI_DADE_ANCHOR,
    kind: 'permit', subtype: 'permit', idField: 'ID', dateField: 'ISSUDATE', dateType: 'date', statusField: 'BPSTATUS',
    titleFields: ['DESC1', 'APPTYPE'], textFields: ['DESC1', 'DESC2', 'DESC3', 'TYPE', 'APPTYPE', 'PROPUSE'], summaryFields: ['APPTYPE', 'PROPUSE', 'BPSTATUS'],
    addressFields: ['ADDRESS'], strictAddress: true,
    windowForwardDays: 0, lookbackOverride: 14, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(MIAMIDADE_PERMITS), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION. Miami-Dade County "Building Permits Issued, 2 previous years to present", hub item 6db5f56e886446df88313ca279e59120, weekly. The service URL is ASSUMED (the name miamidade_permit_data was seen in the org directory [O]; resolve the hub item if the probe fails). Columns [3P] from the sister item 31cd319f (unofficial data dictionary): ID, ISSUDATE, TYPE, APPTYPE, PROPUSE, DESC1-DESC10, BPSTATUS, ADDRESS, CONTRNAME, ESTVALUE (text). 14 day window: the layer is published weekly. LGLDESC1/2 and CONTRNUM are never read.',
  },
  {
    id: 'arcgis-miamidade-violations', city: 'Miami-Dade County', state: 'FL', tz: 'America/New_York', layerUrl: MIAMIDADE_CODE, countyAnchor: MIAMI_DADE_ANCHOR,
    kind: 'civic', subtype: 'violation', idField: 'CASE_NUM', dateField: 'CASE_DATE', dateType: 'date',
    titleFields: ['PROBLEM_DESC'], textFields: ['PROBLEM_DESC'], summaryFields: ['PROBLEM_DESC', 'STAT_DESC'], addressFields: ['ADDRESS'],
    confidentialField: 'CONF_FLAG', strictAddress: true,
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(MIAMIDADE_CODE), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION. Miami-Dade County "Code Compliance Violations" (open cases, unincorporated county), hub item da0e434c7a914bb983222393dab2b897, daily [3P]. The service is ASSUMED to be CodeComplianceViolation_Open_View (name seen [O], mapping [A]; CCVIOL_gdb is the alternative). Columns [3P]: CASE_NUM, CASE_DATE, CASE_STATUS, STAT_DESC, PROBLEM, PROBLEM_DESC, ADDRESS, CONF_FLAG. CONF_FLAG is REQUIRED (review P1-A): a layer without it is a schema mismatch, a row without it is dropped, and any truthy value (Y, YES, TRUE, T, 1) drops the row. CONF_BY (staff) is never read. No contacts (violations never get any); address at block level, point rounded to a block.',
  },
  {
    id: 'arcgis-miamidade-building-violations', city: 'Miami-Dade County', state: 'FL', tz: 'America/New_York', layerUrl: MIAMIDADE_BUILDING_VIOLATIONS, countyAnchor: MIAMI_DADE_ANCHOR,
    kind: 'civic', subtype: 'violation', idField: 'CASE_NUM', dateField: 'OPEN_DATE', dateType: 'date',
    titleFields: ['CASE_TYPE'], textFields: ['CASE_TYPE'], summaryFields: ['CASE_TYPE'], addressFields: ['PROP_ADDR'], strictAddress: true,
    windowForwardDays: 0, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(MIAMIDADE_BUILDING_VIOLATIONS), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION. Miami-Dade County "Building Violations", hub item 7c21821b3c5c4fc8a606b763c2aae8fe, daily [3P]. The service (BuildingViolation_gdb, layer 0) is ASSUMED. Columns [3P]: CASE_NUM, CASE_TYPE, PROP_ADDR, OPEN_DATE, CLOSED_DATE. VIOL_NAME (the responsible person or entity) is NEVER read. Closed cases are not filtered (CLOSED_DATE is unverified; a where clause on a missing column would fail the whole query): check the samples.',
  },
  // ---- Phoenix ----------------------------------------------------------------------------------------------------------------------
  {
    id: 'arcgis-phoenix-permits', city: 'Phoenix', state: 'AZ', tz: 'America/Phoenix', layerUrl: PHOENIX_PERMITS,
    kind: 'permit', subtype: 'permit', idField: 'PERMIT_NUMBER', dateField: 'PERMIT_ISSUE_DATE', dateType: 'date', statusField: 'STATUS',
    titleFields: ['PERMIT_TYPE_DESC'], textFields: ['SCOPE', 'PERMIT_TYPE_DESC', 'PERMIT_TYPE'], summaryFields: ['PERMIT_TYPE_DESC', 'STATUS'],
    addressFields: ['ADDRESS'], strictAddress: true,
    windowForwardDays: 0, lookbackOverride: 14, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(PHOENIX_PERMITS), checkedOn: CHECKED, fieldSource: 'sourced',
    note: 'ON PROBATION. City of Phoenix ShapePHX permit points, MapServer layer 0, "updated on a weekly basis" [O]. Columns [O]: PERMIT_NUMBER, PERMIT_ISSUE_DATE (date), PERMIT_TYPE, PERMIT_TYPE_DESC, SCOPE, STATUS, ADDRESS. No contractor and no value column. OWNER_NAME, CONTACT (company or person unknown), PROJECT and PERMIT_NAME are never read. 14 day window: weekly publishing.',
  },
  {
    id: 'arcgis-tempe-permits', city: 'Tempe', state: 'AZ', tz: 'America/Phoenix', layerUrl: TEMPE_PERMITS,
    kind: 'permit', subtype: 'permit', idField: 'PermitNum', dateField: 'IssuedDate', dateType: 'date', statusField: 'StatusCurrent',
    latField: 'Latitude', lonField: 'Longitude',
    titleFields: ['Description', 'PermitTypeDesc'], textFields: ['Description', 'PermitClass', 'PermitType', 'PermitTypeDesc', 'WorkClass'],
    summaryFields: ['PermitTypeDesc', 'WorkClass', 'StatusCurrent'], addressFields: ['OriginalAddress1'], zipField: 'OriginalZip', strictAddress: true,
    windowForwardDays: 0, lookbackOverride: 14, cadenceMinutes: 360, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(TEMPE_PERMITS), checkedOn: CHECKED, fieldSource: 'assumed',
    note: 'ON PROBATION. City of Tempe "Permits Issued by Building Safety" (Accela in the BLDS schema), last updated 2026-11-18, weekly, CC BY 4.0 [3P]. EVERY column name is ASSUMED from the BLDS standard [A]: PermitNum, IssuedDate, Description, PermitClass, PermitType, PermitTypeDesc, WorkClass, StatusCurrent, OriginalAddress1, OriginalZip, Latitude, Longitude, ContractorCompanyName, EstProjectCost.',
  },
  // ---- Houston ----------------------------------------------------------------------------------------------------------------------
  {
    id: 'arcgis-houston-311', city: 'Houston', state: 'TX', tz: 'America/Chicago', layerUrl: HOUSTON_311,
    kind: 'civic', subtype: '311', idField: 'CaseNumber', dateField: 'CreatedDate', dateType: 'date', latField: 'Latitude', lonField: 'Longitude',
    titleFields: ['CaseType'], textFields: ['CaseType', 'Title', 'Department', 'Division'], freeTextFields: ['Title'],
    summaryFields: ['CaseType', 'Department', 'Status'],
    // Round 20 (NEXT, owner decision): a property-condition request gives a PRIVATE block-level site from IncidentAddress (lib/signals/site-311.ts):
    // never an exact house number, never on the public row, never for a request about a home or unit from the inside.
    site311: { addressFields: ['IncidentAddress'], typeFields: ['CaseType'], propertyTypes: PROPERTY_CONDITION_311_RE },
    windowForwardDays: 0, cadenceMinutes: 180, verified: true, probation: true, schemaUnverified: true,
    verifiedUrl: M(HOUSTON_311), checkedOn: CHECKED, fieldSource: 'sourced',
    note: 'ON PROBATION. City of Houston 311 (Dynamics 365), MapServer layer 0 SR311_NEW [O]. Columns [O]: CaseNumber, CreatedDate, CaseType, Title, Department, Division, Status, Latitude, Longitude. The code-related CaseType and Department values were not seen; rows that name no trade are dropped by the 311 rules. Title is classified but never printed (free text). ResolutionNotes (staff free text) is never read. Round 20: IncidentAddress is read ONLY into the block-level site rule (lib/signals/site-311.ts) and never printed. Freshness not confirmed. Houston has NO permit feed in this unit: the only fresh permit list is an HTML report that needs a page scraper.',
  },
];

/** Contacts. Business organisations only, through the existing organisation check; never a licence number, never an owner or applicant. */
export const COVERAGE_CONTACT_SPECS: Record<string, ContactSpec> = {
  'arcgis-arlington-permits': {
    verifiedUrl: M(ARLINGTON_PERMITS),
    checkedOn: CHECKED,
    fieldStatus: 'assumed',
    assumedFields: ['NameofBusiness'],
    // The column name is [O]; what it holds (occupant business, possibly a sole proprietor) is [A]. No site address: FOLDERNAME is unverified.
    orgs: [{ role: 'business', nameFields: ['NameofBusiness'] }],
  },
  'arcgis-miamidade-permits': {
    verifiedUrl: M(MIAMIDADE_PERMITS),
    checkedOn: CHECKED,
    fieldStatus: 'assumed',
    assumedFields: ['CONTRNAME', 'ADDRESS'],
    site: { addressFields: ['ADDRESS'] },
    // CONTRNAME can be a sole proprietor's own name [A]: cleanOrgName keeps only an organisation. CONTRNUM is never read.
    orgs: [{ role: 'contractor', nameFields: ['CONTRNAME'] }],
  },
  'arcgis-tempe-permits': {
    verifiedUrl: M(TEMPE_PERMITS),
    checkedOn: CHECKED,
    fieldStatus: 'assumed',
    assumedFields: ['ContractorCompanyName', 'OriginalAddress1', 'OriginalZip'],
    site: { addressFields: ['OriginalAddress1'], zipField: 'OriginalZip' },
    orgs: [{ role: 'contractor', nameFields: ['ContractorCompanyName'] }],
  },
  'arcgis-phoenix-permits': {
    verifiedUrl: M(PHOENIX_PERMITS),
    checkedOn: CHECKED,
    fieldStatus: 'sourced',
    site: { addressFields: ['ADDRESS'] },
  },
};

/** Project value columns (candidates: the adapter asks only for those the layer's own field list has). */
export const COVERAGE_VALUE_FIELDS: Record<string, { fields: string[]; assumed?: string[] }> = {
  'arcgis-arlington-permits': { fields: ['ConstructionValuationDeclared', 'SignConstructionValue'] },
  'arcgis-miamidade-permits': { fields: ['ESTVALUE'], assumed: ['ESTVALUE'] },
  'arcgis-tempe-permits': { fields: ['EstProjectCost'], assumed: ['EstProjectCost'] },
};
