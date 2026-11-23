/**
 * Round 20 (unit LIC, lever 2): state contractor licence files, each a PROBATION source with an unverified schema. Research and every
 * tag: /home/claude/gates/r20/LIC-research.md ([O] opened, [3P] third-party page, [S] search results only, [A] assumed).
 *
 * Nothing here is fetched unless HOLLER_LICENSE_SYNC_ENABLED is set (lib/licenses/switch.ts) or the owner calls the probe
 * (/api/admin/license-probe?state=XX, Bearer only). Every column name below is [A] unless the note says otherwise: the probe reports which
 * expected columns exist before the sync is trusted (schemaUnverified stays true until the owner removes it after a good probe).
 *
 * Privacy (binding): the HOLDER of the licence must pass the company rules (lib/licenses/company-row.ts); a sole proprietor's row is
 * dropped before storage. `individualType` drops rows the file itself marks as an individual. A phone is kept only from a column the
 * file names as the BUSINESS phone (`phoneIsBusiness`), and an address only when the file marks it as the business address
 * (`addressIsBusiness`, false for every source here: none is confirmed).
 */

export type LicenseFormat = 'socrata' | 'csv';

export interface LicenseColumns {
  /** The licence number. */
  number: string;
  /** The licence HOLDER (the licensee). Must pass the company rules, or the row is dropped. */
  holder: string;
  /** A doing-business-as or trade name column, shown instead of the holder when it also passes. */
  dba?: string;
  /** Another column that names a PERSON on the row (owner, qualifier): comparison only, never stored. */
  personFields?: string[];
  /** The file's own entity-type column (Sole Owner / Corporation, Individual / Business). */
  entityType?: string;
  phone?: string;
  /** Phone split in parts (CSLB fixed layout: area code, prefix, number). */
  phoneParts?: string[];
  address?: string;
  city?: string;
  zip?: string;
  licenseType?: string;
}

export interface LicenseSource {
  id: string;
  /** Two-letter state the licence numbers belong to (the lookup key with the number). */
  state: string;
  label: string;
  /** Where the file was described (research). */
  pageUrl: string;
  /** The file or API the sync reads ([A] unless noted). */
  fileUrl: string;
  format: LicenseFormat;
  /** CSV files without a header row: columns are named by position ("0", "1", ...). */
  headerless?: boolean;
  /** Socrata only: a SoQL where clause that narrows the file to contractor licences. */
  where?: string;
  columns: LicenseColumns;
  /** Values of columns.entityType that mean a natural person (dropped). */
  individualType?: RegExp;
  phoneIsBusiness: boolean;
  addressIsBusiness: boolean;
  probation: true;
  schemaUnverified: boolean;
  note: string;
}

export const LICENSE_SOURCES: readonly LicenseSource[] = [
  {
    id: 'license-fl-dbpr-construction',
    state: 'FL',
    label: 'Florida DBPR construction industry licensees',
    pageUrl: 'https://www2.myfloridalicense.com/construction-industry/public-records/',
    fileUrl: 'https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv',
    format: 'csv',
    headerless: true,
    // Positions [A] from the field list on the page [O]: licensee name, DBA name, class code, address 1-3, city, state, zip, county code,
    // licence number, status, dates. The board / occupation code is assumed to come first.
    columns: { number: '11', holder: '1', dba: '2', licenseType: '3' },
    phoneIsBusiness: false, // the file has no phone [O]
    addressIsBusiness: false, // business vs mailing address not distinguished [O]
    probation: true,
    schemaUnverified: true,
    note: 'CSV CONSTRUCTIONLICENSE_1.csv [O]; active, inactive and voluntarily inactive licensees [O]; no phone [O]. Certified and registered contractor licences are held by individuals [A], so most rows are dropped; a business entity (QB) row is kept. The file URL and the column positions are [A].',
  },
  {
    id: 'license-ca-cslb-master',
    state: 'CA',
    label: 'California CSLB License Master',
    pageUrl: 'https://www.cslb.ca.gov/OnlineServices/DataPortal/ContractorList.aspx',
    fileUrl: 'https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C',
    format: 'csv',
    columns: { number: 'LicenseNo', holder: 'BusinessName', dba: 'FullBusinessName', entityType: 'BusinessType', phone: 'BusinessPhone', licenseType: 'Classifications(s)' },
    individualType: /\b(?:sole|individual|owner)\b/i,
    phoneIsBusiness: true, // BUS-PHONE-NO in the record layout [O]
    addressIsBusiness: false, // MAILING-ADDR in the record layout [O]: never stored
    probation: true,
    schemaUnverified: true,
    note: 'Free CSV or Excel download [O]; fields per record layout LBL780J1 [O] (LIC-NUMBER, BUS-TYPE-CODE, BUS-NAME-1/2, MAILING-ADDR, BUS-PHONE). CSV header names and the download URL are [A]. The Personnel file (people) is never read.',
  },
  {
    id: 'license-az-roc-current',
    state: 'AZ',
    label: 'Arizona ROC all current contractors',
    pageUrl: 'https://roc.az.gov/posting-list',
    fileUrl: 'https://roc.az.gov/sites/default/files/postinglist/All-Current-Contractors.csv',
    format: 'csv',
    columns: { number: 'License No', holder: 'Business Name', dba: 'Doing Business As', personFields: ['Qualifying Party'], licenseType: 'Class' },
    phoneIsBusiness: false, // not marked as business in any source read
    addressIsBusiness: false,
    probation: true,
    schemaUnverified: true,
    note: '"All Current Contractors" 54,721 records, 11.66 MB [O]; file format and columns not described [O]; URL and column names [A].',
  },
  {
    id: 'license-tx-tdlr-ac',
    state: 'TX',
    label: 'Texas TDLR air conditioning contractors',
    pageUrl: 'https://www.tdlr.texas.gov/LicenseSearch/licfile.asp',
    fileUrl: 'https://data.austintexas.gov/resource/7358-krk7.json',
    format: 'socrata',
    where: "upper(license_type) like '%AIR CONDITIONING%CONTRACTOR%'",
    columns: { number: 'license_number', holder: 'name', dba: 'business_name', phone: 'business_phone_number', licenseType: 'license_type' },
    phoneIsBusiness: true, // the column is named business phone [A]
    addressIsBusiness: false,
    probation: true,
    schemaUnverified: true,
    note: 'TDLR CSV files "updated everyday" [O]; Socrata mirror 7358-krk7 [3P]; column names [A]. The holder (name) of an A/C contractor licence is a person in most rows [A], so most rows are dropped.',
  },
  {
    id: 'license-ny-dcwp-hic',
    state: 'NY',
    label: 'NYC DCWP home improvement contractor licences',
    pageUrl: 'https://catalog.data.gov/dataset/issued-licenses',
    fileUrl: 'https://data.cityofnewyork.us/resource/w7w3-xahh.json',
    format: 'socrata',
    where: "business_category = 'Home Improvement Contractor'",
    columns: { number: 'license_nbr', holder: 'business_name', dba: 'dba_trade_name', entityType: 'license_type', licenseType: 'business_category' },
    individualType: /\bindividual\b/i,
    phoneIsBusiness: false, // contact_phone is not marked as the business phone [A]: not read
    addressIsBusiness: false,
    probation: true,
    schemaUnverified: true,
    note: 'Socrata w7w3-xahh "Issued Licenses" [3P]; column names [A]. No NYC permit feed carries a DCWP number today (DOB NOW permittee licences are DOB licences of people).',
  },
];

export function licenseSourceForState(state: string | null | undefined): LicenseSource | null {
  const s = (state ?? '').trim().toUpperCase();
  return LICENSE_SOURCES.find((x) => x.state === s) ?? null;
}

/** Every column a source expects (the probe reports which are missing). */
export function expectedColumns(src: LicenseSource): string[] {
  const c = src.columns;
  return [c.number, c.holder, c.dba, ...(c.personFields ?? []), c.entityType, c.phone, ...(c.phoneParts ?? []), c.address, c.city, c.zip, c.licenseType].filter(
    (x): x is string => typeof x === 'string' && x.length > 0,
  );
}
