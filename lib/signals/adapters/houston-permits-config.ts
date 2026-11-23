import type { SocrataDataset } from './socrata-datasets';

/**
 * Round 20 NEXT: the Houston weekly Permit Activity Report's config (see houston-permits.ts for the reader and the research). Config only, no
 * adapter imports, so lib/signals/probation.ts and lib/admin/metros.ts can list it.
 */

export const HOUSTON_PERMITS_ID = 'html-houston-permits';
export const HOUSTON_REPORT_URL = 'https://www.houstontx.gov/planning/Publications/listsrv/WebeReport.html';
/** The page is about one week of permits; a little over a megabyte at most [A]. Larger bodies are cut. */
export const MAX_BODY_CHARS = 4_000_000;
/** At most this many rows per run (the report holds about 470 a week). */
export const HOUSTON_ROW_CAP = 3000;

/** The headers the reader needs, by row key. Matching is case- and space-insensitive on the whole header text. */
export const HOUSTON_HEADERS: Record<string, string> = {
  zip_code: 'zip code',
  permit_date: 'permit date',
  permit_type: 'permit type',
  project_no: 'project no',
  address: 'address',
  comments: 'comments',
};
/** Review fix P2-5: a short list of other spellings of the same headers (matched like the main ones). */
export const HOUSTON_HEADER_ALIASES: Record<string, readonly string[]> = {
  zip_code: ['zip', 'zipcode', 'zip code'],
  permit_date: ['permit date', 'permit issue date', 'issue date', 'issued date', 'date issued'],
  permit_type: ['permit type', 'type'],
  project_no: ['project no', 'project number', 'project #', 'project'],
  address: ['address', 'site address', 'project address'],
  comments: ['comments', 'comment', 'description'],
};

/**
 * Review fix P1-3: the owner's access record for the page. Nothing is requested from houstontx.gov (the page, its robots.txt, the probe)
 * until the owner has read its robots.txt and terms of use in a browser and recorded them here, with termsChecked set to true: the same
 * per-source gate as the page-watch sources (branch r20-watch, page-watch-datasets.ts termsChecked). Ships false. Even then the shared
 * robots checker (lib/firecrawl/robots.ts checkRobots, failing closed when robots.txt cannot be read) must allow the page path.
 */
export const HOUSTON_ACCESS: { termsChecked: boolean; robotsUrl?: string; termsUrl?: string; checkedOn?: string } = {
  termsChecked: false,
  robotsUrl: 'https://www.houstontx.gov/robots.txt',
  termsUrl: undefined,
  checkedOn: undefined,
};

/** The access record is complete: termsChecked, the robots and terms pages read, and the day (YYYY-MM-DD). */
export function houstonAccessCleared(a: typeof HOUSTON_ACCESS = HOUSTON_ACCESS): boolean {
  return a.termsChecked === true && Boolean(a.robotsUrl) && Boolean(a.termsUrl) && /^\d{4}-\d{2}-\d{2}$/.test(a.checkedOn ?? '');
}

/** Review fix P1-3: the user agent of every request to the page, naming the site and its bot page. */
export const HOUSTON_USER_AGENT = 'Holler/1.0 (+https://localholler.com/bot)';
/** Without these the table is not the report (schema mismatch). */
export const HOUSTON_REQUIRED = ['project_no', 'permit_date', 'address'] as const;

/** The shared-parser config of the report rows (a Socrata-shaped config; the url and data are fixed after parsing). */
export const HOUSTON_PERMITS_DS: SocrataDataset = {
  id: HOUSTON_PERMITS_ID, city: 'Houston', state: 'TX', tz: 'America/Chicago', domain: 'www.houstontx.gov', datasetId: 'permit-activity-report',
  kind: 'permit', subtype: 'permit', idField: 'project_no', dateField: 'permit_date', dateFormat: 'mdy', maxRecordAgeDays: 21,
  zipField: 'zip_code', zipCentroid: { near: { lat: 29.7633, lon: -95.3633 }, maxMi: 30 },
  titleFields: ['permit_type'], textFields: ['permit_type', 'comments'], freeTextFields: ['comments'],
  summaryFields: ['permit_type'], addressFields: ['address'], strictAddress: true,
  cadenceMinutes: 1440, verified: true, probation: true, schemaUnverified: true,
  verifiedUrl: HOUSTON_REPORT_URL, fieldSource: 'sourced',
  note: 'ON PROBATION (round 20 NEXT). City of Houston weekly Permit Activity Report (HTML). Columns [O]: Zip Code, Permit Date, Permit Type, Project No, Address, Comments. No person name column. Comments are classified, never printed. Dates are read as month/day/year text [A]; a row older than 21 days is dropped.',
};

