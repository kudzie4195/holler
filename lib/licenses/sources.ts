/**
 * Round 20 (unit LIC, lever 2): state contractor licence files, each a PROBATION source with an unverified schema. Research and every
 * tag: /home/claude/gates/r20/LIC-research.md ([O] opened, [3P] third-party page, [S] search results only, [A] assumed).
 *
 * Nothing here is fetched unless the owner calls the probe (/api/admin/license-probe?state=XX, Bearer only), or HOLLER_LICENSE_SYNC_ENABLED
 * is set AND the state's source has been PROMOTED (review LIC P2-4): `probation` and `schemaUnverified` both removed (set to false) in
 * this file after a good probe. Every source below is still on probation, so the sync loads nothing today. Every column name, position
 * and file URL is [A] unless the note says otherwise.
 *
 * Privacy (binding):
 *  - the HOLDER of the licence must pass the company rules (lib/licenses/company-row.ts); a sole proprietor's row is dropped before
 *    storage, and so is a holder or DBA cell that joins two names ("JOHN SMITH DBA ACME ROOFING LLC", review LIC P1-1);
 *  - `companyType` is an ALLOW-LIST on the file's own type column (review LIC P1-2): a row is kept only when the trimmed type value
 *    matches it; any unknown, individual or blank code ("S", "01", "SoleOwner", "IND", "") is dropped;
 *  - `numberPattern` (review LIC P1-3): a row whose licence-number cell does not match the state's pattern is dropped, so a misread
 *    column (a date, a ZIP code, a street) never becomes a key; `typePattern`: a licence type that does not match is stored as null;
 *  - a headerless file (Florida) is read by the fixed layout below and stays "schema unverified: no header" in the probe until
 *    `layout.confirmed` is set by a developer from the probe's shape report;
 *  - a phone only from a column the file names as the BUSINESS phone (`phoneIsBusiness`); an address only when the file marks it as the
 *    business address (`addressIsBusiness`, false for every source here: none is confirmed).
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
  /** The file's own entity or licence-class column, checked against companyType (an allow-list). */
  entityType?: string;
  phone?: string;
  /** Phone split in parts (CSLB fixed layout: area code, prefix, number). */
  phoneParts?: string[];
  address?: string;
  city?: string;
  zip?: string;
  licenseType?: string;
}

export interface HeaderlessLayout {
  /** True only after a developer checked the probe's shape report against the file's published layout. */
  confirmed: boolean;
  /** The documented position of each field, for the probe and the reader. */
  description: string;
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
  /** CSV files without a header row: columns are named by position ("0", "1", ...), by the fixed layout. */
  headerless?: HeaderlessLayout;
  /** Socrata only: a SoQL where clause that narrows the file to contractor licences. */
  where?: string;
  columns: LicenseColumns;
  /** ALLOW-LIST of columns.entityType values that mean a company. Required when entityType is set; anything else is dropped. */
  companyType?: RegExp;
  /** The state's licence-number shape (after upper case and space removal). A row whose number does not match is dropped. */
  numberPattern: RegExp;
  /** The shape of a licence type value; a value that does not match is stored as null. */
  typePattern: RegExp;
  phoneIsBusiness: boolean;
  addressIsBusiness: boolean;
  /** Removed (false) only when the source is promoted after a good probe; the sync refuses a source on probation. */
  probation: boolean;
  /** Removed (false) only when the columns (or the headerless layout) were confirmed on a real sample; the sync refuses otherwise. */
  schemaUnverified: boolean;
  note: string;
}

/** A licence class or trade label: letters, digits and a few separators, at most 60 characters, never a street (no digit run of 3+). */
const LABEL = /^(?!.*\d{3})[A-Za-z0-9][A-Za-z0-9 /&|,().-]{0,59}$/;

export const LICENSE_SOURCES: readonly LicenseSource[] = [
  {
    id: 'license-fl-dbpr-construction',
    state: 'FL',
    label: 'Florida DBPR construction industry licensees',
    pageUrl: 'https://www2.myfloridalicense.com/construction-industry/public-records/',
    fileUrl: 'https://www2.myfloridalicense.com/sto/file_download/extracts/CONSTRUCTIONLICENSE_1.csv',
    format: 'csv',
    headerless: {
      confirmed: false,
      // The field order the page lists [O] starts with Licensee Name and Doing Business as Name; the position of Class Code and of the
      // licence number among the later fields is [A]. The probe reports, per position, how many cells match the number pattern and the
      // class allow-list, so the layout can be confirmed or corrected without printing any value.
      description:
        '0 Licensee Name, 1 Doing Business as Name, 2 Class Code, 3-5 Address Line 1-3, 6 City, 7 State, 8 Zip, 9 County Code, 10 License Number, then status and dates [order from the page O, positions A]',
    },
    columns: { number: '10', holder: '0', dba: '1', entityType: '2', licenseType: '2' },
    // QB is the business-organisation certificate; every individual contractor class (CGC, CBC, CRC, CCC ...) is dropped [A].
    companyType: /^QB$/,
    numberPattern: /^[A-Z]{1,4}\d{4,8}$/,
    typePattern: /^[A-Z]{2,4}$/,
    phoneIsBusiness: false, // the file has no phone [O]
    addressIsBusiness: false, // business vs mailing address not distinguished [O]
    probation: true,
    schemaUnverified: true,
    note: 'CSV CONSTRUCTIONLICENSE_1.csv [O], no header row; active, inactive and voluntarily inactive licensees [O]; no phone [O]. Only business-organisation (QB) rows can be kept [A]; certified and registered contractor licences belong to individuals. The file URL and the positions are [A].',
  },
  {
    id: 'license-ca-cslb-master',
    state: 'CA',
    label: 'California CSLB License Master',
    pageUrl: 'https://www.cslb.ca.gov/OnlineServices/DataPortal/ContractorList.aspx',
    fileUrl: 'https://www.cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C',
    format: 'csv',
    columns: { number: 'LicenseNo', holder: 'BusinessName', dba: 'FullBusinessName', entityType: 'BusinessType', phone: 'BusinessPhone', licenseType: 'Classifications(s)' },
    companyType: /^(?:corporation|limited liability(?: company)?|llc|partnership|joint ?venture)$/i,
    numberPattern: /^\d{5,8}$/,
    typePattern: LABEL,
    phoneIsBusiness: true, // BUS-PHONE-NO in the record layout [O]
    addressIsBusiness: false, // MAILING-ADDR in the record layout [O]: never stored
    probation: true,
    schemaUnverified: true,
    note: 'Free CSV or Excel download [O]; fields per record layout LBL780J1 [O] (LIC-NUMBER, BUS-TYPE-CODE, BUS-NAME-1/2, MAILING-ADDR, BUS-PHONE). CSV header names, the BusinessType values and the download URL are [A]; the probe lists the type values it sees so the allow-list can be corrected. The Personnel file (people) is never read.',
  },
  {
    id: 'license-az-roc-current',
    state: 'AZ',
    label: 'Arizona ROC all current contractors',
    pageUrl: 'https://roc.az.gov/posting-list',
    fileUrl: 'https://roc.az.gov/sites/default/files/postinglist/All-Current-Contractors.csv',
    format: 'csv',
    columns: { number: 'License No', holder: 'Business Name', dba: 'Doing Business As', personFields: ['Qualifying Party'], licenseType: 'Class' },
    numberPattern: /^(?:ROC)?\d{5,7}$/,
    typePattern: LABEL,
    phoneIsBusiness: false, // not marked as business in any source read
    addressIsBusiness: false,
    probation: true,
    schemaUnverified: true,
    note: '"All Current Contractors" 54,721 records, 11.66 MB [O]; file format and columns not described [O]; URL and column names [A]. No entity-type column is known: rows pass on the holder name rules alone, and the qualifying party is compared.',
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
    numberPattern: /^[A-Z]{0,6}\d{3,10}[A-Z]?$/,
    typePattern: LABEL,
    phoneIsBusiness: true, // the column is named business phone [A]
    addressIsBusiness: false,
    probation: true,
    schemaUnverified: true,
    note: 'TDLR CSV files "updated everyday" [O]; Socrata mirror 7358-krk7 [3P] (the domain may be data.texas.gov and the type may read "A/C Contractor": both unverified, both fail safe); column names [A]. No entity-type column: the holder (name) of an A/C contractor licence is a person in most rows [A], so most rows are dropped by the name rules.',
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
    companyType: /^business$/i,
    numberPattern: /^\d{5,8}(?:-DCA)?$/,
    typePattern: LABEL,
    phoneIsBusiness: false, // contact_phone is not marked as the business phone [A]: not read
    addressIsBusiness: false,
    probation: true,
    schemaUnverified: true,
    note: 'Socrata w7w3-xahh "Issued Licenses" [3P]; column names [A]. No NYC permit feed carries a DCWP number today (DOB NOW permittee licences are DOB licences of people). The lookup key is (state, number): if a DOB feed ever opts in, the licensing body must join the key.',
  },
];

export function licenseSourceForState(state: string | null | undefined): LicenseSource | null {
  const s = (state ?? '').trim().toUpperCase();
  return LICENSE_SOURCES.find((x) => x.state === s) ?? null;
}

/** A source the sync may load: promoted (probation and schemaUnverified both removed), and a headerless layout confirmed. */
export function isPromoted(src: LicenseSource): boolean {
  return src.probation === false && src.schemaUnverified === false && (!src.headerless || src.headerless.confirmed);
}

/** Every column a source expects (the probe reports which are missing; a Socrata read selects only these). */
export function expectedColumns(src: LicenseSource): string[] {
  const c = src.columns;
  return [
    ...new Set(
      [c.number, c.holder, c.dba, ...(c.personFields ?? []), c.entityType, c.phone, ...(c.phoneParts ?? []), c.address, c.city, c.zip, c.licenseType].filter(
        (x): x is string => typeof x === 'string' && x.length > 0,
      ),
    ),
  ];
}
