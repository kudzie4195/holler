import type { CategoryId } from '@/lib/signals/categories';
import type { MetroId } from '@/lib/signals/proposed-labels';

/**
 * ROUND 20 WATCH: public bid and solicitation pages read with a plain fetch (lib/signals/adapters/page-watch.ts). Pure data, client-safe.
 *
 * EVERY entry is ON PROBATION (`probation: true`) and `schemaUnverified: true`: its rows go to holler_source_samples only
 * (lib/signals/samples.ts), never to a member, a card, an email, a push, a public page or a count, until the owner has run the probe
 * (GET /api/admin/coverage-probe?source=<id>), read real samples and promoted it (LAUNCH.md, "Round 20 page watch"). No page below was
 * fetched by this unit (the build sandbox cannot reach city portals): row layouts come from /home/claude/gates/r20/WATCH-research.md, tagged
 *   [O]  the page was opened on 2026-11-22 and its rows or headers were read
 *   [3P] a third-party page documents it
 *   [A]  assumed (the page was opened but its rows were not shown, or a platform convention)
 *
 * ROBOTS AND TERMS. No robots.txt of these hosts could be read here (WebFetch only opens URLs that appear in search results). The adapter
 * fetches each host's robots.txt before the page (cached one hour, RFC 9309 rules, lib/firecrawl/robots.ts) and never fetches a disallowed
 * path: the source then reports `robots_disallowed`. No page read here carried a clause on automated access; the footer terms pages were not
 * opened (`terms` says so per entry). Reading them is a promotion step.
 *
 * PRIVACY. Only the title, number, due date, posted date, category, status, agency/department and link columns are ever read. A column whose
 * header names a person (buyer, contact, specialist, phone, e-mail, ...) is never read, even when its header also matches a wanted word
 * (page-watch-parse.ts CONTACT_HEADER). A buyer named on a bid page is a government employee: never stored.
 *
 * BIDS FLAG. Ids start with "bids-" so every bid rule applies once promoted (lib/signals/bid-sources.ts isBidSignal, bidHidden): a promoted
 * source runs, and its rows reach members, only while HOLLER_BIDS_ENABLED is on. While on probation the plain-fetch sources run without that
 * flag (samples only, $0). Firecrawl spend (`firecrawl: 'only'` or 'fallback') always needs HOLLER_LOCAL_BIDS_ENABLED and FIRECRAWL_API_KEY.
 */

export type PageWatchPlatform = 'bonfire' | 'opengov' | 'beaconbid' | 'own-site';
/**
 * How rows are read. `bonfire`: the Bonfire public portal's JSON list. `html-table`: a server-rendered table, columns found by header words.
 * `html-links`: a list of links whose text starts with a solicitation number. `text-blocks`: prose blocks that start with a number.
 * `rss` and `csv`: generic feed and file parsers (no dataset uses them yet). `none`: no parser; rows only through Firecrawl.
 */
export type PageWatchParserId = 'bonfire' | 'html-table' | 'html-links' | 'text-blocks' | 'rss' | 'csv' | 'none';

/** Header words per field for html-table and csv (lower case, matched as substrings). Each field takes the column of its earliest hint. */
export interface ColumnHints {
  title?: string[];
  number?: string[];
  due?: string[];
  posted?: string[];
  category?: string[];
  status?: string[];
  agency?: string[];
}

export interface PageWatchDataset {
  /** Adapter id and signal source. Starts with "bids-pw-". */
  id: string;
  metro: MetroId;
  /** The buying agency, as the card names it: "Bid: <title> (<agency>)". */
  agency: string;
  /** Adapter label and source-meta label. */
  label: string;
  /** What is fetched: the list page, or the platform's list endpoint. */
  url: string;
  /** The page a person opens (adapter sourceUrl; a row's link when it has none of its own). */
  pageUrl: string;
  platform: PageWatchPlatform;
  parser: PageWatchParserId;
  /** Bonfire: the agency's subdomain ("dart" in dart.bonfirehub.com). */
  bonfireSlug?: string;
  columns?: ColumnHints;
  /** html-links and text-blocks: the solicitation number at the start of a row (regex source, matched case-insensitively). */
  numberPattern?: string;
  /** Regex sources marking the listing area: only the text between them is hashed and parsed. Absent: the whole page body. */
  areaStart?: string;
  areaEnd?: string;
  /** Regex source of the page's own "nothing open" message: zero rows with it is an empty list, not a parser mismatch. */
  emptyText?: string;
  /** Status text that means the row is NOT open (regex source); added to the shared list (awarded, cancelled, closed ...). */
  notOpenStatus?: string;
  /** Hosts a row link may point to (the host itself or a subdomain); any other link falls back to pageUrl. */
  linkDomains: string[];
  /** IANA zone of the dates the page prints. */
  tz: string;
  /** Bonfire's close dates: 'utc' when the endpoint returns UTC wall time [A], else the page's zone. */
  dueZone?: 'utc' | 'local';
  /** Agency office ZIP: its centroid is the row's approximate position (zipcodes dataset, never typed coordinates). */
  zip: string;
  city: string;
  state: string;
  /** The trades the research expects this source to serve (proposed labels; the row's own trades come from its title). */
  trades: CategoryId[];
  cadenceMinutes: number;
  /** 'off': plain fetch only. 'fallback': Firecrawl extraction when the parser reads nothing (opt-in). 'only': the page needs a browser. */
  firecrawl: 'off' | 'fallback' | 'only';
  /** Extra instruction for the Firecrawl extraction prompt. */
  firecrawlHint?: string;
  /** On probation: rows go to holler_source_samples only. Promote by removing it (and schemaUnverified) after the probe and samples. */
  probation: boolean;
  /** Column names and row layout not yet seen on a live answer: the probe and the samples confirm them. */
  schemaUnverified: boolean;
  /**
   * Round 20 review P0: the owner has read this host's robots.txt and terms of use in a browser (and the vendor's terms for a vendor
   * portal) and recorded them below. false: NOTHING is requested from the source, by the scan, the coverage probe or Firecrawl
   * (accessCleared). Every entry ships false.
   */
  termsChecked: boolean;
  /** Registered with the scan. */
  verified: boolean;
  evidence: {
    /** The robots.txt the owner read, e.g. https://www.septa.org/robots.txt. Required with termsChecked. */
    robotsUrl?: string;
    /** The terms page the owner read (the vendor's own page for Bonfire, OpenGov, BeaconBid). Required with termsChecked. */
    termsUrl?: string;
    /** YYYY-MM-DD the owner read them. Required with termsChecked. */
    checkedOn?: string;
    checkedBy?: string;
    /**
     * Bonfire only: the vendor's terms were read and allow an automated client to call the portal's list endpoint. Without it the
     * endpoint is never called and no browser-only header (X-Requested-With) is ever sent.
     */
    endpointAllowed?: boolean;
    /** Research tag of the row layout. */
    layout: 'O' | '3P' | 'A';
    robots: string;
    terms: string;
    /** Expected new rows a month (research estimate) and its tag. */
    rowsPerMonth: number;
    rowsTag: 'O' | '3P' | 'A';
    note: string;
  };
}

const RUNTIME_ROBOTS = 'not read in research; checked on every run (cached 1 h), a disallowed path is never fetched';
const DAY = 1440;

/** Shared column words: the table parser's defaults (a dataset's own hints come first). */
export const DEFAULT_COLUMNS: Required<ColumnHints> = {
  number: ['solicitation number', 'solicitation #', 'solicitation id', 'specification', 'negotiation', 'bid number', 'bid #', 'rfq/bid', 'reference', 'number', 'no.', '#'],
  due: ['due', 'closing', 'close', 'deadline', 'response', 'bid opening', 'submission'],
  posted: ['posted', 'issuance', 'issued', 'issue date', 'release', 'start date'],
  status: ['status', 'results', 'stage', 'phase'],
  category: ['category', 'procurement type', 'solicitation type', 'commodity', 'nigp', 'type'],
  agency: ['agency', 'department', 'program office', 'division'],
  title: ['title', 'description', 'contract name', 'solicitation name', 'project name', 'project', 'name', 'subject'],
};

const bonfire = (slug: string) => ({
  url: `https://${slug}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData`,
  pageUrl: `https://${slug}.bonfirehub.com/portal/?tab=openOpportunities`,
  platform: 'bonfire' as const,
  parser: 'bonfire' as const,
  bonfireSlug: slug,
  linkDomains: [`${slug}.bonfirehub.com`],
  dueZone: 'utc' as const,
});

const BONFIRE_TERMS = 'agency page: no automated-access clause [O]; Euna EULA binds licensed customers only, no scraping clause [O]; the portal footer Terms of Service not opened';

export const PAGE_WATCH_DATASETS: PageWatchDataset[] = [
  // ---- Dallas-Fort Worth ----------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-dallas-city', metro: 'dallas-fort-worth', agency: 'City of Dallas', label: 'City of Dallas procurement (Bonfire): open solicitations',
    ...bonfire('dallascityhall'),
    tz: 'America/Chicago', zip: '75201', city: 'Dallas', state: 'TX',
    trades: ['general-contractor', 'roofing', 'hvac', 'concrete-paving', 'janitorial-commercial', 'landscaping', 'electrical', 'plumbing'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: false,
    evidence: {
      layout: '3P', robots: RUNTIME_ROBOTS, terms: BONFIRE_TERMS, rowsPerMonth: 30, rowsTag: 'A',
      note: 'dallascityhall.com/departments/procurement: "The City of Dallas utilizes Bonfire as its electronic procurement platform" [O]. JSON endpoint path [3P]; field names [A].',
    },
  },
  {
    id: 'bids-pw-dart', metro: 'dallas-fort-worth', agency: 'Dallas Area Rapid Transit (DART)', label: 'DART procurement (Bonfire): open solicitations',
    ...bonfire('dart'),
    tz: 'America/Chicago', zip: '75202', city: 'Dallas', state: 'TX',
    trades: ['electrical', 'concrete-paving', 'janitorial-commercial', 'hvac', 'landscaping'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: false,
    evidence: {
      layout: '3P', robots: RUNTIME_ROBOTS, terms: BONFIRE_TERMS, rowsPerMonth: 15, rowsTag: 'A',
      note: 'dart.org: "Euna Procurement DART Hub (formerly Bonfire) at dart.bonfirehub.com/portal/?tab=openOpportunities" [O]. Many rows are parts purchases, dropped by the supply rule.',
    },
  },
  {
    id: 'bids-pw-dallas-isd', metro: 'dallas-fort-worth', agency: 'Dallas ISD', label: 'Dallas ISD procurement: open bids',
    url: 'https://www.dallasisd.org/fs/pages/160334', pageUrl: 'https://www.dallasisd.org/fs/pages/160334', platform: 'own-site', parser: 'html-table',
    linkDomains: ['dallasisd.org'], tz: 'America/Chicago', zip: '75204', city: 'Dallas', state: 'TX',
    trades: ['roofing', 'hvac', 'janitorial-commercial', 'concrete-paving', 'general-contractor', 'plumbing'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'A', robots: RUNTIME_ROBOTS, terms: 'no automated-access clause on the procurement page [O]; site terms not opened', rowsPerMonth: 12, rowsTag: 'A',
      note: '"View Open Bids" link on dallasisd.org/departments/procurement/procurement-services [O]; rows not seen. An older district list had "RFQ/Bid # | Start Date | End Date | Board Doc | Description | Buyer | Phone" [S]: Buyer and Phone are never read.',
    },
  },
  // ---- Houston --------------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-houston-metro', metro: 'houston', agency: 'Houston METRO', label: 'Houston METRO procurement: open solicitations',
    url: 'https://www.ridemetro.org/about/business-to-business/procurement-opportunities', pageUrl: 'https://www.ridemetro.org/about/business-to-business/procurement-opportunities',
    platform: 'own-site', parser: 'html-table',
    columns: { number: ['solicitation number'], title: ['title'], due: ['close date', 'close'] },
    linkDomains: ['ridemetro.org', 'ridemetro.bonfirehub.com'], tz: 'America/Chicago', zip: '77002', city: 'Houston', state: 'TX',
    trades: ['janitorial-commercial', 'cleaning', 'painting', 'electrical', 'concrete-paving'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'no automated-access clause on the page [O]; footer Terms of Use not opened', rowsPerMonth: 5, rowsTag: 'A',
      note: 'Open Solicitations table "Solicitation Number (a link), Title, and Close Date", e.g. "IFB 2027000009", "Hybrid Battery Disposal", Dec 2, 2026 2 PM [O, read through the CDN mirror website-cdn-prod.azureedge.us]. The SAP Ariba table was empty.',
    },
  },
  {
    id: 'bids-pw-hha', metro: 'houston', agency: 'Houston Housing Authority', label: 'Houston Housing Authority procurement: solicitations',
    url: 'https://housingforhouston.com/?p=24920', pageUrl: 'https://housingforhouston.com/?p=24920', platform: 'own-site', parser: 'html-table',
    columns: { title: ['title', 'solicitation'], number: ['number', 'no.'], due: ['submit responses', 'response', 'proposal', 'bid'], status: ['status'] },
    notOpenStatus: 'under review|tabulation|evaluation',
    linkDomains: ['housingforhouston.com'], tz: 'America/Chicago', zip: '77092', city: 'Houston', state: 'TX',
    trades: ['hvac', 'general-contractor', 'plumbing', 'roofing', 'landscaping'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'page sets bidder rules, no automated-access clause [O]; site terms not opened', rowsPerMonth: 3, rowsTag: 'A',
      note: 'Table: title, solicitation number, solicitation documents, deadline to submit questions, deadline to submit responses, status; e.g. "Replacement of Heater at Cuney Homes Apartments | 08/14/23 4:00 pm | 08/31/23 2:00 pm | Initial Bid Tabulation" [O]. Rows seen were from 2023: the probe shows whether the page is current.',
    },
  },
  {
    id: 'bids-pw-harris-county', metro: 'houston', agency: 'Harris County', label: 'Harris County purchasing (Bonfire): open solicitations',
    ...bonfire('harriscountytx'),
    tz: 'America/Chicago', zip: '77002', city: 'Houston', state: 'TX',
    trades: ['concrete-paving', 'general-contractor', 'janitorial-commercial', 'landscaping', 'electrical', 'roofing', 'hvac'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: false,
    evidence: {
      layout: '3P', robots: RUNTIME_ROBOTS, terms: BONFIRE_TERMS, rowsPerMonth: 30, rowsTag: 'A',
      note: 'purchasing.harriscountytx.gov: Harris County "utilizes Bonfire to manage suppliers and to distribute and receive bids and proposals online"; list at harriscountytx.bonfirehub.com/portal/?tab=openOpportunities [O].',
    },
  },
  {
    id: 'bids-pw-houston-isd', metro: 'houston', agency: 'Houston ISD', label: 'Houston ISD procurement: solicitations and bids',
    url: 'https://www.houstonisd.org/Page/179249', pageUrl: 'https://www.houstonisd.org/Page/179249', platform: 'own-site', parser: 'html-table',
    linkDomains: ['houstonisd.org'], tz: 'America/Chicago', zip: '77092', city: 'Houston', state: 'TX',
    trades: ['general-contractor', 'roofing', 'hvac', 'janitorial-commercial', 'plumbing'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'A', robots: RUNTIME_ROBOTS, terms: 'no automated-access clause on the page [O]; site terms not opened', rowsPerMonth: 8, rowsTag: 'A',
      note: '"SOLICITATIONS / BIDS": "Below you will find current bid proposals ... Click on the proposal name" [O]; rows not seen. A page that is not a table reads parser_mismatch.',
    },
  },
  {
    id: 'bids-pw-houston-city', metro: 'houston', agency: 'City of Houston', label: 'City of Houston strategic procurement: current solicitations',
    url: 'https://houstontx.gov/bizwithhou/index.html', pageUrl: 'https://houstontx.gov/bizwithhou/index.html', platform: 'beaconbid', parser: 'none',
    linkDomains: ['houstontx.gov', 'beaconbid.com'], tz: 'America/Chicago', zip: '77002', city: 'Houston', state: 'TX',
    trades: ['general-contractor', 'concrete-paving', 'roofing', 'hvac', 'janitorial-commercial', 'landscaping', 'electrical', 'plumbing'],
    cadenceMinutes: 2 * DAY, firecrawl: 'only',
    firecrawlHint: 'The current solicitations are listed by an embedded BeaconBid widget. Each row has a solicitation title, number and due or closing date. detailUrl is the row\'s beaconbid.com or houstontx.gov link, empty when none.',
    termsChecked: false, probation: true, schemaUnverified: true, verified: false,
    evidence: {
      layout: 'A', robots: RUNTIME_ROBOTS + ' (Firecrawl checks robots.txt too)', terms: 'city page: no automated-access clause [O]; BeaconBid terms not read', rowsPerMonth: 25, rowsTag: 'A',
      note: 'houstontx.gov/bizwithhou: "Browse current solicitation opportunities from the City of Houston" through a BeaconBid widget (beaconbid.com/solicitations/city-of-houston/open) [O]. The page hash cannot see the widget, so Firecrawl change tracking decides.',
    },
  },
  // ---- Atlanta --------------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-atlanta-housing', metro: 'atlanta', agency: 'Atlanta Housing', label: 'Atlanta Housing: open solicitations',
    url: 'https://www.atlantahousing.org/doing-business-with-ah/solicitations/', pageUrl: 'https://www.atlantahousing.org/doing-business-with-ah/solicitations/',
    platform: 'own-site', parser: 'html-links', numberPattern: '(?:RFP|RFQL|RFQ|IFB|ITB|RFI)\\s*#?\\s*\\d{4}-\\d{4}',
    // Only the open list: from its heading to the next heading, a closed or awarded list, or the footer. Not found: whole page, feed-only.
    areaStart: 'Open\\s+Solicitations', areaEnd: '<h[1-3]\\b|(?:Closed|Awarded|Past|Archived)\\s+Solicitations|<footer\\b',
    linkDomains: ['atlantahousing.org'], tz: 'America/New_York', zip: '30303', city: 'Atlanta', state: 'GA',
    trades: ['general-contractor', 'cleaning', 'landscaping', 'roofing', 'painting'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: 'robots.txt read in round 18: allowed [O]; checked again on every run', terms: 'Terms of Use page exists (atlantahousing.org/terms-of-use), not opened', rowsPerMonth: 3, rowsTag: 'A',
      note: 'Bulleted links: "RFP 2027-0052 Compensation Study Services", "RFQL 2027-0045 Commercial and Residential Property Management Services Bench" [O]. No due dates on the list: rows are heads-up only.',
    },
  },
  {
    id: 'bids-pw-decatur-housing', metro: 'atlanta', agency: 'Decatur Housing Authority', label: 'Decatur Housing Authority: procurements',
    url: 'https://www.decaturhousing.org/procurement', pageUrl: 'https://www.decaturhousing.org/procurement', platform: 'own-site', parser: 'text-blocks',
    numberPattern: 'RFP-[A-Z]{2}-\\d{3}-\\d{4}-\\d{2}',
    areaStart: 'Procurements\\s+Page', areaEnd: '<footer\\b|(?:Closed|Awarded|Past)\\s+(?:Procurements|Solicitations|RFPs)',
    linkDomains: ['decaturhousing.org'], tz: 'America/New_York', zip: '30030', city: 'Decatur', state: 'GA',
    trades: ['cleaning', 'flooring', 'landscaping', 'general-contractor'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'no automated-access clause on the page [O]', rowsPerMonth: 1, rowsTag: 'A',
      note: 'Text blocks: "RFP-GA-011-2026-05" "Carpet Cleaning - RE-BID", with "PROPOSAL DUE DATE" "December 10, 2026" in a small table [O].',
    },
  },
  {
    id: 'bids-pw-aps', metro: 'atlanta', agency: 'Atlanta Public Schools', label: 'Atlanta Public Schools procurement: outstanding solicitations',
    url: 'https://www.atlantapublicschools.us/about/departments/finance/procurement-services/outstanding-solicitations',
    pageUrl: 'https://www.atlantapublicschools.us/about/departments/finance/procurement-services/outstanding-solicitations',
    platform: 'own-site', parser: 'html-table',
    linkDomains: ['atlantapublicschools.us'], tz: 'America/New_York', zip: '30303', city: 'Atlanta', state: 'GA',
    trades: ['hvac', 'general-contractor', 'roofing', 'janitorial-commercial', 'plumbing'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'A', robots: RUNTIME_ROBOTS, terms: 'none in the part of the procurement page read [O]', rowsPerMonth: 6, rowsTag: 'A',
      note: '"Outstanding Solicitations" linked from the procurement services page [O]; rows not seen. Titles seen elsewhere: "M. Agnes Jones Elementary School HVAC Upgrades", "Martin Luther King Jr. Middle School Kitchen Renovation" [S].',
    },
  },
  // ---- Philadelphia ---------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-pha', metro: 'philadelphia', agency: 'Philadelphia Housing Authority', label: 'Philadelphia Housing Authority (Bonfire): open solicitations',
    ...bonfire('pha'),
    tz: 'America/New_York', zip: '19121', city: 'Philadelphia', state: 'PA',
    trades: ['roofing', 'cleaning', 'junk-removal', 'hvac', 'plumbing', 'concrete-paving', 'general-contractor'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: false,
    evidence: {
      layout: '3P', robots: RUNTIME_ROBOTS, terms: BONFIRE_TERMS + '; PHA Terms & Conditions page not opened', rowsPerMonth: 6, rowsTag: 'A',
      note: 'pha.phila.gov/business-opportunities: "partnered with Euna", list at pha.bonfirehub.com/portal/?tab=openOpportunities [O]. Titles seen: "Roofing Repair, Replacement and Related Maintenance Work" (P-005115), "Housekeeping Services" (P-005310), "Cleanout Services for Vacant PAPMC Properties" (P-005338) [S].',
    },
  },
  {
    id: 'bids-pw-septa', metro: 'philadelphia', agency: 'SEPTA', label: 'SEPTA procurement: open bids and RFPs',
    url: 'https://www.septa.org/procurement/bids/', pageUrl: 'https://www.septa.org/procurement/bids/', platform: 'own-site', parser: 'html-links',
    numberPattern: '(?:Item\\s+)?\\d{2}-\\d{5}-[A-Z]{4}',
    areaStart: 'Open\\s+ePS\\s+Bids', areaEnd: '<nav\\b|<footer\\b|Quotes,\\s+Under|Closed\\s+Bids|Awarded',
    linkDomains: ['septa.org'], tz: 'America/New_York', zip: '19107', city: 'Philadelphia', state: 'PA',
    trades: ['janitorial-commercial', 'landscaping', 'general-contractor', 'signs-printing', 'electrical'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'no automated-access clause on the page [O]; copyright notices not opened', rowsPerMonth: 20, rowsTag: 'A',
      note: '"26-00299-ATWP: Janitorial and Landscaping Services at SEPTA Railroad Stations", "26-00260-ADMC: 2728 S. Front Street Site Demolition"; 49 open, 25 a page; no due date on the list [O]. First page only (newest 25). Links on the page use the host wwww.septa.org [O].',
    },
  },
  {
    id: 'bids-pw-philasd-capital', metro: 'philadelphia', agency: 'School District of Philadelphia', label: 'School District of Philadelphia: capital bid opportunities',
    url: 'https://philasd.org/procurement/?p=4721', pageUrl: 'https://philasd.org/procurement/?p=4721', platform: 'own-site', parser: 'html-table',
    columns: { number: ['negotiation'], title: ['description'], due: ['due date'], posted: ['posted'], status: ['results'], agency: ['program office'] },
    notOpenStatus: 'bid tab|award',
    linkDomains: ['philasd.org'], tz: 'America/New_York', zip: '19130', city: 'Philadelphia', state: 'PA',
    trades: ['hvac', 'plumbing', 'electrical', 'general-contractor', 'roofing'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'no automated-access clause on the page [O]', rowsPerMonth: 6, rowsTag: 'A',
      note: 'Table: Negotiation Number, Posted Date, Due Date, Description, Program Office, Buyer Contact, Pre-Bid Conference/Walkthrough, Addenda, Budget, Results; e.g. "NG10353 | 7/9/2024 | 8/8/2024 | Kitchen Ventilation Upgrade at Thomas Alva Edison High School" [O]. Buyer Contact holds staff names: never read.',
    },
  },
  // ---- Miami ----------------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-miamidade-construction', metro: 'miami', agency: 'Miami-Dade County', label: 'Miami-Dade County strategic procurement: construction solicitations',
    url: 'https://www.miamidade.gov/apps/ISD/stratproc/Home/CurrentSolicitations', pageUrl: 'https://www.miamidade.gov/apps/ISD/stratproc/Home/CurrentSolicitations',
    platform: 'own-site', parser: 'html-table',
    columns: { number: ['solicitation number'], category: ['solicitation type'], title: ['title'], due: ['opening date'], posted: ['posted'] },
    emptyText: 'no data to show',
    linkDomains: ['miamidade.gov'], tz: 'America/New_York', zip: '33128', city: 'Miami', state: 'FL',
    trades: ['roofing', 'general-contractor', 'concrete-paving', 'painting'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'footer Disclaimer not opened; none on the page [O]', rowsPerMonth: 4, rowsTag: 'A',
      note: 'Headers: Solicitation Number, Solicitation Type, Title, Opening Date, Posted Date; 0 rows on 2026-11-22: "No data to show right now -- check back later!" [O]. Opening Date is the bid opening, read as the due date.',
    },
  },
  // ---- Phoenix --------------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-phoenix-opengov', metro: 'phoenix', agency: 'City of Phoenix', label: 'City of Phoenix procurement (OpenGov): current solicitations',
    url: 'https://procurement.opengov.com/portal/phoenix', pageUrl: 'https://procurement.opengov.com/portal/phoenix', platform: 'opengov', parser: 'none',
    linkDomains: ['procurement.opengov.com', 'phoenix.gov'], tz: 'America/Phoenix', zip: '85003', city: 'Phoenix', state: 'AZ',
    trades: ['landscaping', 'concrete-paving', 'general-contractor', 'janitorial-commercial', 'hvac', 'roofing', 'electrical'],
    cadenceMinutes: 2 * DAY, firecrawl: 'only',
    firecrawlHint: 'This is an OpenGov procurement portal. List only projects whose status is open or accepting submissions. detailUrl is the project\'s procurement.opengov.com/portal/phoenix/projects/<id> link. dueDate is the submission deadline.',
    termsChecked: false, probation: true, schemaUnverified: true, verified: false,
    evidence: {
      layout: 'A', robots: RUNTIME_ROBOTS + ' (Firecrawl checks robots.txt too)', terms: 'OpenGov platform terms not read', rowsPerMonth: 20, rowsTag: 'A',
      note: 'phoenix.gov procurement FAQ: "Current Solicitations" -> procurement.opengov.com/portal/phoenix [O]; single-page app, no public feed found [3P].',
    },
  },
  // ---- Chicago --------------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-chicago', metro: 'chicago', agency: 'City of Chicago', label: 'City of Chicago and CTA: active solicitations',
    url: 'https://webapps1.chicago.gov/vcsearch/solicitations', pageUrl: 'https://webapps1.chicago.gov/vcsearch/solicitations', platform: 'own-site', parser: 'html-table',
    columns: { agency: ['agency'], category: ['category', 'procurement type'], number: ['specification'], title: ['contract name'], status: ['status'], due: ['response due'] },
    linkDomains: ['webapps1.chicago.gov', 'chicago.gov'], tz: 'America/Chicago', zip: '60602', city: 'Chicago', state: 'IL',
    trades: ['general-contractor', 'concrete-paving', 'plumbing', 'electrical', 'landscaping', 'janitorial-commercial', 'roofing', 'hvac'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'footer Disclaimer and Privacy links only, not opened [O]', rowsPerMonth: 30, rowsTag: 'A',
      note: 'Columns: Agency, Procurement Type, Specification #, Contract Name, Status, Category, Response Due Date; about 127 rows (CITY and CTA); e.g. "CITY BID 1338908 Term Agreement for Block Level Lead Service Line Replacement: Dist 8 ACTIVE Construction" [O]. Stale active rows are dropped by their past due date.',
    },
  },
  // ---- Los Angeles ----------------------------------------------------------------------------------------------------------------
  {
    id: 'bids-pw-lacounty-dpw', metro: 'los-angeles', agency: 'LA County Public Works', label: 'LA County Public Works: contract opportunities',
    url: 'https://dpw.lacounty.gov/contracts/Opportunities.aspx', pageUrl: 'https://dpw.lacounty.gov/contracts/Opportunities.aspx', platform: 'own-site', parser: 'html-table',
    columns: { title: ['name'], posted: ['open'], due: ['close'], category: ['type'] },
    numberPattern: '[A-Z]{2,4}-?[A-Z]{0,3}-?\\d{6,10}',
    linkDomains: ['dpw.lacounty.gov'], tz: 'America/Los_Angeles', zip: '91803', city: 'Alhambra', state: 'CA',
    trades: ['concrete-paving', 'electrical', 'landscaping', 'general-contractor'],
    cadenceMinutes: DAY, firecrawl: 'off', termsChecked: false, probation: true, schemaUnverified: true, verified: true,
    evidence: {
      layout: 'O', robots: RUNTIME_ROBOTS, terms: 'footer "Privacy - Terms of Use" not opened [O]', rowsPerMonth: 8, rowsTag: 'A',
      note: 'Headers Name, Open, Close with a Type per row; "Total: 20"; e.g. "RDC0016342 - South Whittier Community Bikeway Access Improvements | 9/29/2026 | 11/3/2026" [O].',
    },
  },
];

/**
 * May anything be requested from this source? Only when the owner set termsChecked AND recorded the robots.txt URL, the terms URL and the
 * date, and, for a vendor's list endpoint (Bonfire), that the vendor's terms allow it. Pure.
 */
export function accessCleared(d: PageWatchDataset): boolean {
  const e = d.evidence;
  return (
    d.termsChecked === true &&
    /^https:\/\/\S+\/robots\.txt$/.test(e.robotsUrl ?? '') &&
    /^https:\/\/\S+$/.test(e.termsUrl ?? '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.checkedOn ?? '') &&
    (d.parser !== 'bonfire' || e.endpointAllowed === true)
  );
}

export const PAGE_WATCH_IDS: readonly string[] = PAGE_WATCH_DATASETS.map((d) => d.id);

export function pageWatchDataset(id: string): PageWatchDataset | undefined {
  return PAGE_WATCH_DATASETS.find((d) => d.id === id);
}
