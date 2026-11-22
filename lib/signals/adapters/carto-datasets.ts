import type { ContactSpec } from '@/lib/contacts/extract';
import type { SocrataDataset, SocrataSubtype } from './socrata-datasets';

/**
 * Config for the Carto SQL adapters (Philadelphia, https://phl.carto.com/api/v2/sql). A Carto table is a flat table like a Socrata one, so a
 * dataset here is a thin wrapper: the `parse` part is the SAME shape of config the Socrata parser reads (title fields, text fields, summary
 * fields, address, contacts) and carto.ts feeds the rows to the same parser (parseSocrataReport), so permits, violations and licences are
 * titled, categorised, privacy-filtered and contact-extracted exactly like the Socrata ones.
 *
 * Provenance: table names, column names and sample values come from /home/claude/runlog/recon-phl-nyc.md (live recon 2026-11-22, SOURCED).
 * Anything not in that file is marked ASSUMED below and listed in /home/claude/runlog/r13-phl.md.
 *
 * PRIVACY: `columns` is the whole SELECT list. It never names opa_owner, legalfirstname, legallastname, ownercontact*name, or any other
 * column that holds a person, so those values are never fetched. legalname and business_name are fetched only to feed the organisation
 * check (cleanOrgName) and only survive `prepareRow` for rows whose legalentitytype is Company.
 */

export type CartoSubtype = Extract<SocrataSubtype, 'permit' | 'violation' | 'business'>;

export interface CartoDataset {
  /** Adapter id and signal `source`. */
  id: string;
  city: string;
  state: string;
  table: string;
  kind: 'permit' | 'civic';
  subtype: CartoSubtype;
  /** Column that uniquely identifies the record. */
  idField: string;
  /** Newest-date column used for the lookback, NOT NULL filter and ORDER BY. */
  dateField: string;
  /** Plain columns to SELECT (the_geom is added as lat/lon through ST_Y/ST_X). */
  columns: string[];
  /** Raw SQL appended with AND (column vocabulary below). */
  extraWhere?: string;
  /** The window never reaches back less than this many days before `now` (publication lag; duplicates are absorbed by unique(source, external_id)). */
  minLookbackDays: number;
  cadenceMinutes: number;
  /** Human-readable page of the dataset (ASSUMED slugs, see the run log). */
  sourceUrl: string;
  /** Always true: Philadelphia stays on probation until someone has read the samples. */
  probation: true;
  fieldSource: 'sourced' | 'assumed';
  note?: string;
  /** Row clean-up applied before the shared parser reads it (private-person fields blanked). Pure. */
  prepareRow?: (row: Record<string, unknown>) => Record<string, unknown>;
  /** The Socrata-shaped parse config. */
  parse: Pick<SocrataDataset, 'titleFields' | 'textFields' | 'summaryFields' | 'addressFields' | 'zipField' | 'freeTextFields' | 'mixedTextFields'> & { contacts?: ContactSpec };
}

export const PHL_RECON = '/home/claude/runlog/recon-phl-nyc.md';
const CONTACT_CHECKED = '2026-11-22';

/** Business licences: a person's licence (legalentitytype Individual) never yields a name: the name columns are blanked before parsing. */
export function phlBusinessPrepare(row: Record<string, unknown>): Record<string, unknown> {
  const t = typeof row.legalentitytype === 'string' ? row.legalentitytype.trim().toLowerCase() : '';
  if (t === 'company') return row;
  return { ...row, legalname: '', business_name: '' };
}

export const CARTO_DATASETS: CartoDataset[] = [
  {
    id: 'carto-phl-permits', city: 'Philadelphia', state: 'PA', table: 'permits', kind: 'permit', subtype: 'permit',
    idField: 'permitnumber', dateField: 'permitissuedate',
    columns: ['permitnumber', 'permittype', 'typeofwork', 'permitdescription', 'approvedscopeofwork', 'permitissuedate', 'contractorname', 'address', 'zip'],
    extraWhere: undefined, minLookbackDays: 2, cadenceMinutes: 360,
    sourceUrl: 'https://opendataphilly.org/datasets/licenses-and-inspections-building-permits/', probation: true, fieldSource: 'sourced',
    note: 'L&I permits. Ordering by permitissuedate without IS NOT NULL puts denied permits (null date) first, so the query filters them out (recon). permitdescription is not in the recon row samples (it is in the field list). opa_owner and contractoraddress1 (name + street text) are never selected. The 3 newest rows in the recon were all Zoning permits; contractorname was empty on 2 of 3.',
    parse: {
      titleFields: ['approvedscopeofwork', 'permittype'],
      textFields: ['approvedscopeofwork', 'permitdescription', 'permittype', 'typeofwork'],
      summaryFields: ['permittype', 'typeofwork'],
      addressFields: ['address'],
      zipField: 'zip',
      contacts: {
        verifiedUrl: PHL_RECON,
        note: 'Column names read from the live recon field list 2026-11-22 (SQL API, SELECT * ... LIMIT 3), not from portal metadata.',
        checkedOn: CONTACT_CHECKED,
        site: { addressFields: ['address'], zipField: 'zip' },
        orgs: [{ role: 'contractor', nameFields: ['contractorname'] }],
      },
    },
  },
  {
    id: 'carto-phl-violations', city: 'Philadelphia', state: 'PA', table: 'violations', kind: 'civic', subtype: 'violation',
    idField: 'violationnumber', dateField: 'casecreateddate',
    columns: ['violationnumber', 'casenumber', 'casecreateddate', 'violationcodetitle', 'violationstatus', 'address', 'zip'],
    extraWhere: "violationstatus = 'OPEN'", minLookbackDays: 2, cadenceMinutes: 360,
    sourceUrl: 'https://opendataphilly.org/datasets/licenses-and-inspections-violations/', probation: true, fieldSource: 'sourced',
    note: "L&I violations. violationstatus values OPEN and CLOSED seen in the recon. violationcodetitle (e.g. ALTER EXISTING PLUMBING, EXTERIOR AREA WEEDS, VACANT STRUCTURE & LAND) is the code's fixed title. opa_owner, caseresponsibility and violationcode are never selected. No contacts (violations never get any).",
    parse: {
      titleFields: ['violationcodetitle'],
      textFields: ['violationcodetitle'],
      summaryFields: ['violationcodetitle', 'violationstatus'],
      addressFields: ['address'],
      zipField: 'zip',
    },
  },
  {
    id: 'carto-phl-business', city: 'Philadelphia', state: 'PA', table: 'business_licenses', kind: 'civic', subtype: 'business',
    idField: 'licensenum', dateField: 'initialissuedate',
    columns: ['licensenum', 'licensetype', 'rentalcategory', 'initialissuedate', 'licensestatus', 'legalentitytype', 'legalname', 'business_name', 'address', 'zip'],
    extraWhere: "licensestatus = 'Active'", minLookbackDays: 7, cadenceMinutes: 360,
    sourceUrl: 'https://opendataphilly.org/datasets/licenses-and-inspections-business-licenses/', probation: true, fieldSource: 'sourced',
    note: 'L&I business licences, initialissuedate = first issue (new licences only). legalentitytype Company / Individual seen in the recon. legalfirstname, legallastname, opa_owner and ownercontact*name are never selected. legalname and business_name survive prepareRow only for Company rows and then only through cleanOrgName. No licence type is excluded: the recon rows were Rental and Limited Lodging Operator, so the probation samples must show whether landlord licences belong in the feed.',
    prepareRow: phlBusinessPrepare,
    parse: {
      titleFields: [],
      textFields: ['licensetype', 'rentalcategory'],
      summaryFields: ['licensetype', 'rentalcategory'],
      zipField: 'zip',
      contacts: {
        verifiedUrl: PHL_RECON,
        note: 'Column names read from the live recon field list 2026-11-22. Company rows only (prepareRow). ownercontact*name and legalfirst/lastname are never read.',
        checkedOn: CONTACT_CHECKED,
        site: { addressFields: ['address'], zipField: 'zip', onlyWithOrganisation: true },
        orgs: [{ role: 'business', nameFields: ['legalname', 'business_name'] }],
      },
    },
  },
];
