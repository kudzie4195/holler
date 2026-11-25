import type { CategoryId } from '@/lib/signals/categories';

/**
 * Round 33: USAC E-Rate FCC Form 470 open data. Config only (no adapter imports), so tests, lib/signals/bid-sources.ts and the copy can
 * read it. The reader is lib/signals/adapters/erate.ts.
 *
 * WHAT IT IS. Schools and libraries that want E-Rate money post an FCC Form 470 to ask for bids on network services. They may not sign a
 * contract before the "allowable contract date" (28 days after they certify the form), so bids are open until that date. USAC publishes the
 * forms as open data. Holler shows the cabling requests as bid-style cards for electrical and low-voltage firms.
 *
 * SOURCE (all read on 2026-11-25 through WebFetch; the shell had no outbound network, so every figure below was read through that tool):
 *   dataset      "E-Rate FCC Form 470 Tool Data", Socrata id jt8s-3q52 on opendata.usac.org, 1.63 million rows, one row per service request
 *                line (and per attached RFP file, so a request repeats). Metadata: https://opendata.usac.org/api/views/jt8s-3q52.json
 *   licence      Socrata licenseId PUBLIC_DOMAIN, attribution "Universal Service Administrative Company (usac.org)"; no licence link in the metadata.
 *   access       robots.txt (read 2026-11-25): User-agent *, Crawl-delay 1, Disallow only for /browse filters, /OData.svc/, /api/odata/, /login,
 *                /tiles/, /views/INLINE/rows.json clustering and /api/collocate. The SODA path /resource/jt8s-3q52.json is NOT disallowed. No
 *                token is needed (anonymous reads are throttled by IP, and the scan makes one request per run, twice a day). Holler sends no
 *                app token to this host: an app token belongs to one portal and none is registered for USAC.
 *   the row       application_number, form_pdf {url}, funding_year, fcc_form_470_status (Certified | Canceled), allowable_contract_date and
 *                certified_date_time (floating timestamps), billed_entity_number / _name / _city / _state / _zip, applicant_type (School,
 *                School District, Library, Library System, Consortium), service_category (Category 1 | Category 2), service_type (4 values on open
 *                rows), function (about 30 values), quantity, unit, installation_initial and maintenance_technical_support (checkboxes; a false
 *                or empty checkbox may be missing from the JSON), plus narrative text (category_one_description, category_two_description,
 *                state_or_local_restrictions_1, other_function) and contact columns.
 *
 * PRIVACY. The contact columns hold named people, direct phone numbers and personal email addresses (a live row held a gmail address).
 * The narrative columns hold them too: a live row's "state or local restrictions" text named a procurement officer with a phone number and
 * an email. So the reader asks the portal for the ERATE_FIELDS columns only (a SoQL $select), copies only those keys out of every row it
 * receives (a second guard in case the portal ever ignores $select), and never reads a narrative column. Nothing the reader keeps can hold a
 * contact: the record carries the institution's name (a school, library or district, checked against the person-name rules), its public
 * city, state and ZIP, the dates, and the public link. The street address is never selected. tests/signals/adapters/erate.test.ts proves it
 * with rows that carry contact values.
 */

export const ERATE_ID = 'bids-erate';
export const ERATE_DOMAIN = 'opendata.usac.org';
export const ERATE_DATASET_ID = 'jt8s-3q52';
/** The SODA endpoint (no query string). It is an open-data API path, not a page. */
export const ERATE_ENDPOINT = `https://${ERATE_DOMAIN}/resource/${ERATE_DATASET_ID}.json`;
/** The dataset's own page: the source home on cards and the link when a row has no form link. */
export const ERATE_PAGE_URL = `https://${ERATE_DOMAIN}/d/${ERATE_DATASET_ID}`;
export const ERATE_LABEL = 'E-Rate school and library network bids (USAC FCC Form 470)';
/** Cadence: the form data changes daily and a request stays open 28 days, so twice a day is plenty. */
export const ERATE_CADENCE_MINUTES = 720;
/** One page. About 2,000 cabling lines are open across the whole country today; the page holds 2.5 times as many. */
export const ERATE_ROW_CAP = 5000;
/** The portal's own robots.txt asks for a 1 second gap between requests; the scan makes one request. */
export const ERATE_ACCESS = {
  robotsUrl: `https://${ERATE_DOMAIN}/robots.txt`,
  robotsCheckedOn: '2026-11-25',
  crawlDelaySeconds: 1,
  requestsPerRun: 1,
} as const;

/**
 * The only columns the reader asks for. Every one is a public fact about the request or the institution; none is a contact, an address
 * line or a narrative. Never add a column to this list without reading its live values for a person's name, phone or email.
 */
export const ERATE_FIELDS = [
  'application_number',
  'form_pdf',
  'funding_year',
  'fcc_form_470_status',
  'allowable_contract_date',
  'certified_date_time',
  'billed_entity_number',
  'billed_entity_name',
  'applicant_type',
  'billed_entity_city',
  'billed_entity_state',
  'billed_entity_zip',
  'service_category',
  'service_type',
  'function',
  'installation_initial',
  'maintenance_technical_support',
] as const;
export type ErateField = (typeof ERATE_FIELDS)[number];

/**
 * Columns of the dataset that hold a person or free text and are NEVER selected or kept (the live column list, 2026-11-25). Listed so a test
 * can prove no request asks for one and no stored record contains one.
 */
export const ERATE_NEVER_READ: readonly string[] = [
  'billed_entity_email', 'billed_entity_phone', 'billed_entity_phone_ext', 'ben_address_1', 'ben_address_2', 'ben_fcc_registration_number',
  'website_url',
  'contact_name', 'contact_address1', 'contact_address2', 'contact_city', 'contact_state', 'contact_zip', 'contact_zip_ext', 'contact_phone',
  'contact_phone_ext', 'contact_email',
  'technical_contact_name', 'technical_contact_title', 'technical_contact_phone', 'technical_contact_phone_ext', 'technical_contact_email',
  'authorized_person_name', 'authorized_person_address', 'authorized_person_city', 'authorized_person_state', 'authorized_person_zip',
  'authorized_person_zip_ext', 'authorized_person_phone', 'authorized_person_phone_ext', 'authorized_person_email', 'authorized_person_title',
  'authorized_person_employer', 'consulting_firm_data',
  'category_one_description', 'category_two_description', 'state_or_local_restrictions_1', 'other_function', 'other_manufacturer',
  'rfp_documents', 'form_nickname',
];

/** What a request is about, as the card says it. Two kinds only. */
export type ErateWork = 'cabling' | 'cabling_upkeep';

export interface ErateRoute {
  /** service_type, exactly as the portal writes it. */
  serviceType: string;
  /** function, exactly as the portal writes it. */
  functionName: string;
  /** Holler trades the request is shown under. */
  trades: CategoryId[];
  work: ErateWork;
  /** The line must also have this checkbox set (the portal writes true). */
  requires?: 'installation_initial';
}

/**
 * TRADE ROUTING, from the two service fields only. Conservative on purpose: a missed request costs a card, a wrong trade costs trust.
 *
 * Open rows today carry 4 service types and about 30 functions (counts of open lines, 2026-11-25, whole country):
 *   Internal Connections           Cabling 1279 (installation_initial true on 1133), Antennas/Connectors 1169, Racks 387, UPS 629, Switches 1689,
 *                                  Wireless Access Points 1239, Firewall 489, Routers 118, Wireless Controllers 162, Caching 27
 *   Basic Maintenance of Internal  Cabling 722, Switches 1014, Wireless Access Points 771, Antennas/Connectors 444, Firewall 396, UPS 386,
 *     Connections                  Racks 172, Wireless Controllers 154, Routers 109, Caching 25
 *   Managed Internal Broadband     Existing Equipment 1043, Leased Equipment 67
 *   Data Transmission/Internet     Internet Access 1551, Standalone Data Transmission 348, Network Equipment 197, Maintenance and Operations
 *                                  160, Leased Dark/Lit Fiber 256, Standalone Internet Access 106, Third-party networks 59, Self-provisioned
 *                                  network 57, Cellular plans 24
 *
 * Mapped, and why:
 *   Internal Connections + Cabling + installation_initial true  -> electrical, "network cabling". Pulling and terminating low-voltage cable is
 *       an electrician's or a cabler's job. A cabling line with installation_initial false buys cable or a service with no installation, so it is
 *       not shown (146 of the 1279 open lines).
 *   Basic Maintenance of Internal Connections + Cabling        -> electrical, "maintenance of network cabling": repair and upkeep of cable.
 * NOT mapped, and why:
 *   Antennas/Connectors, Racks, UPS: equipment lines. They say what is bought, not that anyone must install it, and the buyers are IT resellers.
 *   Switches, access points, firewalls, routers, controllers, caching, managed broadband, internet access, fiber, cellular: network gear and
 *       carrier services done by IT integrators and carriers. Not electrical work. Basic Maintenance of those functions is equipment support, not
 *       construction, so NOTHING routes to general-contractor.
 *   Security (cameras, access control): no service type or function names them. E-Rate does not fund video surveillance, so no row routes to
 *       'security'. The narrative could mention a camera, but the narrative is never read (privacy), so nothing is inferred from it.
 */
export const ERATE_ROUTES: readonly ErateRoute[] = [
  { serviceType: 'Internal Connections', functionName: 'Cabling', trades: ['electrical'], work: 'cabling', requires: 'installation_initial' },
  { serviceType: 'Basic Maintenance of Internal Connections', functionName: 'Cabling', trades: ['electrical'], work: 'cabling_upkeep' },
];

/** The route a line takes, or null when it takes none. `line` holds the portal's own values. */
export function routeFor(line: { service_type?: unknown; function?: unknown; installation_initial?: unknown }): ErateRoute | null {
  const st = typeof line.service_type === 'string' ? line.service_type.trim() : '';
  const fn = typeof line.function === 'string' ? line.function.trim() : '';
  if (!st || !fn) return null;
  for (const r of ERATE_ROUTES) {
    if (r.serviceType !== st || r.functionName !== fn) continue;
    if (r.requires && !(line[r.requires] === true || line[r.requires] === 'true')) continue;
    return r;
  }
  return null;
}

/** Who is asking, as the card says it (applicant_type). The portal has five values; anything else reads as "school or library". */
export type ErateWho = 'school' | 'school-district' | 'library' | 'library-system' | 'consortium' | 'either';

export const ERATE_WHO_EN: Record<ErateWho, string> = {
  school: 'school',
  'school-district': 'school district',
  library: 'library',
  'library-system': 'library system',
  consortium: 'group of schools and libraries',
  either: 'school or library',
};

export function whoFor(applicantType: unknown): ErateWho {
  const t = typeof applicantType === 'string' ? applicantType.trim().toLowerCase() : '';
  if (t === 'school') return 'school';
  if (t === 'school district') return 'school-district';
  if (t === 'library') return 'library';
  if (t === 'library system') return 'library-system';
  if (t === 'consortium') return 'consortium';
  return 'either';
}

export const ERATE_WORK_EN: Record<ErateWork, string> = {
  cabling: 'network cabling',
  cabling_upkeep: 'maintenance of network cabling',
};

/** The English title of a card. title-i18n.ts reads this exact shape back to say it in Spanish. */
export function erateTitle(who: ErateWho, place: string, work: ErateWork): string {
  return `A ${ERATE_WHO_EN[who]} in ${place} is asking for bids on ${ERATE_WORK_EN[work]}`;
}

/** The summary parts Holler writes itself (summary-i18n.ts says them in Spanish). The buyer's name, when shown, is the other part. */
export const ERATE_SUMMARY_KIND = 'E-Rate request (FCC Form 470)';
export function erateUntilPart(day: string): string {
  return `bids accepted until ${day}`;
}
