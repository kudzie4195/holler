import zipcodes from 'zipcodes';

/**
 * Atlanta-area agencies whose OWN web page lists open solicitations, read through Firecrawl (round 16 unit FC).
 * Evidence for each entry (page, structure, terms, robots) is in gates/r16/FC-report.md; fixtures are in tests/firecrawl/fixtures.
 *
 * A source is only listed here when (1) the page is on the agency's own domain, (2) the agency does not send bidders to a paid
 * third-party portal for the list itself (BidNet, OpenGov, Bonfire, Periscope, DemandStar), and (3) the page text read on 2026-11-22
 * shows a bid list. Excluded agencies (Cobb, DeKalb, Fulton, Marietta, Sandy Springs, Cherokee, Forsyth, Johns Creek, Smyrna, Atlanta,
 * Decatur) are named with their reason in the report.
 *
 * Place: an agency has an address but the list has no job sites, so the position is the centroid of the agency's ZIP code from the
 * `zipcodes` dataset the app already uses (never typed in by hand), marked data.loc = 'approx' like every city bid. The street address is
 * kept as text in data.agencyAddress only where the page prints it.
 */
export interface LocalBidSource {
  /** Adapter id and signal source. Starts with "bids-" so every bid rule, flag and filter applies. */
  id: string;
  label: string;
  /** "Gwinnett County" in "Open bid in Gwinnett County: ...". */
  placeLabel: string;
  /** Buyer name shown on the card when a row names none. */
  agency: string;
  /** The page Firecrawl reads: the agency's own list of open solicitations. */
  listUrl: string;
  /** Hosts a row link may point to (the host itself or a subdomain). */
  domains: string[];
  /** IANA zone of the dates the page prints. */
  tz: string;
  zip: string;
  city: string;
  state: string;
  /** Street address text exactly as the agency's page prints it, or null when the page prints none (never filled from memory). */
  address: string | null;
  /**
   * true: the page has no link per solicitation (or only some), so a row without a usable link on the agency's domain links to the list
   * page itself (the agency's own page, which every card may open). false: a row must carry its own link or it is dropped.
   */
  listFallback: boolean;
  /** Source-specific hints appended to the shared extraction prompt. */
  hint: string;
  /** A trailing code on the printed number that is not part of the solicitation id ("BL002-27 NOT" -> "BL002-27"). */
  numberSuffix?: RegExp;
  /** Name of the agency's own page for humans. */
  pageName: string;
}

export const LOCAL_BID_SOURCES: LocalBidSource[] = [
  {
    id: 'bids-gwinnett',
    label: 'Gwinnett County purchasing: open solicitations',
    placeLabel: 'Gwinnett County',
    agency: 'Gwinnett County Purchasing',
    listUrl: 'https://www.gwinnettcounty.com/departments/FinancialServices/Purchasing/BidsandRFPs',
    domains: ['gwinnettcounty.com'],
    tz: 'America/New_York',
    zip: '30046',
    city: 'Lawrenceville',
    state: 'GA',
    address: 'Gwinnett Justice and Administration Center, 75 Langley Drive, Lawrenceville, GA 30046',
    listFallback: false,
    hint:
      'Each entry is "number - Title - Opening Date". The number is the linked text (for example "BL137-26 NOT"); use the Title line as the title. ' +
      'dueDate is the Opening Date. detailUrl is the entry\'s own link (a PDF under /static/upload/bid/), never the Microsoft Teams link and never an addendum link. ' +
      'category is the prefix meaning: BL = Bid, RP = Request for Proposal, IWQ = Informal Written Quote. Ignore buyer contact e-mail addresses completely.',
    numberSuffix: /\s+(?:NOT|INV)$/i,
    pageName: 'Gwinnett County: Solicitations',
  },
  {
    id: 'bids-rockdale',
    label: 'Rockdale County procurement: current bids, RFPs and RFQs',
    placeLabel: 'Rockdale County',
    agency: 'Rockdale County Procurement',
    listUrl: 'https://www.rockdalecountyga.gov/current-bids-rfp-rfq',
    domains: ['rockdalecountyga.gov'],
    tz: 'America/New_York',
    zip: '30012',
    city: 'Conyers',
    state: 'GA',
    address: 'Rockdale County Administration & Services Building, 981 Milstead Ave, Conyers, GA 30012',
    listFallback: true,
    hint:
      'Each section starts with a heading like "RFP #26-28" (the number), then a Title, then "DUE: <date>, at <time>, Local Time". ' +
      'If a section says the solicitation is extended to a later date and time, dueDate is the LATER one. ' +
      'Sections with no due date (vendor lists, "continuous advertisement", qualified instructor lists) are not solicitations: leave them out. ' +
      'The page has no link per solicitation: leave detailUrl empty.',
    pageName: 'Rockdale County: Current Bids / RFP / RFQ',
  },
  {
    id: 'bids-tucker',
    label: 'City of Tucker procurement: bids and RFPs',
    placeLabel: 'Tucker',
    agency: 'City of Tucker Procurement',
    listUrl: 'https://www.tuckerga.gov/business-and-development/bids/',
    domains: ['tuckerga.gov'],
    tz: 'America/New_York',
    zip: '30084',
    city: 'Tucker',
    state: 'GA',
    address: 'Tucker City Hall, 1975 Lakeside Parkway, Suite 350, Tucker, GA 30084',
    listFallback: true,
    hint:
      'The page lists open AND past solicitations, newest first. Each has an Opening Date, a Closing Date and an activity schedule with the deadline time. ' +
      'dueDate is the closing/proposal/bid deadline with its time from the schedule when it is printed. ' +
      'status is "awarded" when the entry lists a Notice of Award, "cancelled" when it says cancelled, "open" only when it has no award or cancellation document and its deadline is still ahead. ' +
      'detailUrl is the entry\'s bid manual or notice document link (a PDF on tuckerga.gov), empty when there is none.',
    pageName: 'City of Tucker: Procurement',
  },
  {
    id: 'bids-dunwoody',
    label: 'City of Dunwoody procurement: current opportunities',
    placeLabel: 'Dunwoody',
    agency: 'City of Dunwoody Procurement',
    listUrl: 'https://www.dunwoodyga.gov/business/doing-business-with-the-city/procurement-opportunities',
    domains: ['dunwoodyga.gov'],
    tz: 'America/New_York',
    zip: '30338',
    city: 'Dunwoody',
    state: 'GA',
    address: null,
    listFallback: true,
    hint:
      'The page is a table: RFP Number, Title, Starting, Closing, Status. dueDate is the Closing column (date and time). postedDate is the Starting column. ' +
      'status is the Status column lower-cased. detailUrl is the link on the title when there is one, otherwise empty.',
    pageName: 'City of Dunwoody: Current Procurement Opportunities',
  },
];

export const LOCAL_BID_SOURCE_IDS: readonly string[] = LOCAL_BID_SOURCES.map((s) => s.id);

export function localSourceById(id: string): LocalBidSource | undefined {
  return LOCAL_BID_SOURCES.find((s) => s.id === id);
}

export interface SourcePlace {
  lat: number;
  lon: number;
  city: string;
  state: string;
  zip: string;
}

/** The agency's ZIP centroid from the zipcodes dataset. null when the ZIP is not in it (the row is then dropped, never given a made-up point). */
export function placeOf(src: Pick<LocalBidSource, 'zip' | 'city' | 'state'>): SourcePlace | null {
  const z = zipcodes.lookup(src.zip);
  if (!z || !Number.isFinite(z.latitude) || !Number.isFinite(z.longitude)) return null;
  return { lat: z.latitude, lon: z.longitude, city: src.city, state: src.state, zip: src.zip };
}
