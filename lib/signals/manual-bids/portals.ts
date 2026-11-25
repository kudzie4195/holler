/**
 * The owner's weekly hand-check list (round 33), copied from the round 32 portal map (gates/r32/PORTALS.md, "Manual list", built
 * 2026-11-25 from SpendQuery state pages). These are government bid pages Holler does not read automatically: CivicPlus Bids.aspx pages
 * (robots.txt blocks named AI crawlers from /bids.aspx and the CivicPlus terms bar automated scraping) and Bonfire/Euna portals. Holler
 * never fetches any of these URLs; the owner opens them in his own browser. Pure data, client-safe.
 *
 * Order: by metro, biggest government first (the round 32 rough population estimate).
 *
 * Each row carries the ZIP of the government's seat (city hall, or the county or parish seat) and what the owner may do with it
 * (review fixes, round 33):
 *  - 'enter': check by hand and add what is open (quick add or CSV).
 *  - 'terms': the portal's terms ban commercial use (Bonfire/Euna): look by hand only, do NOT enter its bids. Quick add refuses the host.
 *  - 'outside_area': the seat ZIP fails the site's own served test (lib/check/coverage.ts isServedZip); Holler serves nobody there yet,
 *    so its bids would be refused. tests/manual-bids/parse.test.ts checks every row's status against that test.
 *  - 'bad_url': the listed URL is the wrong government; no link is shown until the real page is found.
 */
export type PortalStatus = 'enter' | 'terms' | 'outside_area' | 'bad_url';

export interface ManualPortal {
  government: string;
  state: string;
  /** The government's seat ZIP (used for the served-area check and as the quick-add place). */
  zip: string;
  /** null when the listed URL is wrong (status 'bad_url'). */
  url: string | null;
  family: 'CivicPlus' | 'Bonfire/Euna';
  why: string;
  status: PortalStatus;
  note?: string;
}

export interface ManualMetro {
  metro: string;
  portals: ManualPortal[];
}

const CIVIC = 'CivicPlus robots.txt blocks named AI crawlers from /bids.aspx and its terms bar automated scraping.';
const BONFIRE = 'Bonfire/Euna bans commercial use; robots refused the round 32 tool.';
export const TERMS_NOTE = 'Hand-check only, do not enter (terms ban commercial use).';
export const OUTSIDE_NOTE = 'Outside the served area: Holler serves nobody here yet, so its bids are refused. Check only when that changes.';

const c = (government: string, state: string, zip: string, url: string | null, status: PortalStatus = 'enter', note?: string): ManualPortal => ({
  government,
  state,
  zip,
  url,
  family: 'CivicPlus',
  why: CIVIC,
  status,
  ...(note ? { note } : status === 'outside_area' ? { note: OUTSIDE_NOTE } : {}),
});
const b = (government: string, state: string, zip: string, url: string): ManualPortal => ({ government, state, zip, url, family: 'Bonfire/Euna', why: BONFIRE, status: 'terms', note: TERMS_NOTE });

export const MANUAL_PORTALS: readonly ManualMetro[] = [
  {
    metro: 'Atlanta GA',
    portals: [
      c('Paulding County', 'GA', '30132', 'https://paulding.gov/Bids.aspx'),
      c('Douglas County', 'GA', '30134', 'https://douglascountyga.gov/Bids.aspx'),
      b('Roswell', 'GA', '30075', 'https://roswellgov.bonfirehub.com/portal/?tab=openOpportunities'),
      b('Alpharetta', 'GA', '30009', 'https://cityofalpharetta.bonfirehub.com/portal/?tab=openOpportunities'),
      c('Marietta', 'GA', '30060', 'https://mariettaga.gov/Bids.aspx'),
      c('Stonecrest', 'GA', '30038', 'https://stonecrestga.gov/Bids.aspx'),
      c('Brookhaven', 'GA', '30319', 'https://www.brookhavenga.gov/Bids.aspx'),
      c('Peachtree Corners', 'GA', '30092', 'https://peachtreecornersga.gov/Bids.aspx'),
      c('Peachtree City', 'GA', '30269', 'https://peachtree-city.org/Bids.aspx', 'outside_area'),
      c('Norcross', 'GA', '30071', 'https://www.norcrossga.net/Bids.aspx'),
      c('Fairburn', 'GA', '30213', 'https://www.fairburn.com/Bids.aspx'),
      c('Lilburn', 'GA', '30047', 'https://www.cityoflilburn.com/Bids.aspx'),
    ],
  },
  {
    metro: 'Austin TX',
    portals: [
      b('Round Rock', 'TX', '78664', 'https://roundrocktexas.bonfirehub.com/portal/?tab=openOpportunities'),
      c('Buda', 'TX', '78610', 'https://budatx.gov/Bids.aspx'),
      c('Manor', 'TX', '78653', 'https://www.manortx.gov/Bids.aspx'),
    ],
  },
  {
    metro: 'Charlotte NC',
    portals: [c('Gaston County', 'NC', '28052', 'https://gastongov.com/Bids.aspx'), c('Huntersville', 'NC', '28078', 'https://www.huntersville.org/Bids.aspx')],
  },
  {
    metro: 'Raleigh NC',
    portals: [
      c('Clayton', 'NC', '27520', 'https://claytonnc.gov/Bids.aspx'),
      c('Orange County', 'NC', '27278', 'https://orangecountync.gov/Bids.aspx', 'outside_area'),
      c('Apex', 'NC', '27502', 'https://www.apexnc.org/Bids.aspx'),
      c('Holly Springs', 'NC', '27540', 'https://hollyspringsnc.gov/Bids.aspx'),
      c('Fuquay-Varina', 'NC', '27526', 'https://www.fuquay-varina.org/Bids.aspx'),
      // Round 32 listed http://townofcarrboro.org/Bids.aspx (http, not https); the seat is also outside the served area.
      c('Carrboro', 'NC', '27510', 'http://townofcarrboro.org/Bids.aspx', 'outside_area'),
    ],
  },
  {
    metro: 'New Orleans LA',
    portals: [
      c('Kenner', 'LA', '70062', 'https://www.kenner.la.us/Bids.aspx'),
      c('St. Bernard Parish', 'LA', '70043', 'https://www.sbpg.net/Bids.aspx'),
      c('Plaquemines Parish', 'LA', '70037', 'https://www.plaqueminesparish.gov/Bids.aspx'),
    ],
  },
  {
    metro: 'Baton Rouge LA',
    portals: [
      // Round 32 flag: SpendQuery's link for Baker is lawrenceburgtn.gov, a Tennessee town. Not linked until the real page is found.
      c('Baker', 'LA', '70714', null, 'bad_url', 'URL wrong, find the real page (the listed one belongs to a Tennessee town).'),
      c('West Baton Rouge Parish', 'LA', '70767', 'https://www.wbrcouncil.org/Bids.aspx'),
    ],
  },
];

/** Every listed bid page URL (rows with a URL). lib/signals/manual-bids/record.ts treats these as list pages, never one bid's identity. */
export function manualPortalUrls(): string[] {
  return MANUAL_PORTALS.flatMap((m) => m.portals.map((p) => p.url)).filter((u): u is string => typeof u === 'string');
}
