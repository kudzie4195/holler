/**
 * The owner's weekly hand-check list (round 33), copied from the round 32 portal map (gates/r32/PORTALS.md, "Manual list", built
 * 2026-11-25 from SpendQuery state pages). These are government bid pages Holler does not read automatically: CivicPlus Bids.aspx pages
 * (robots.txt blocks named AI crawlers from /bids.aspx and the CivicPlus terms bar automated scraping) and Bonfire/Euna portals (terms bar
 * commercial use). Holler never fetches any of these URLs; the owner opens them in his own browser. Pure data, client-safe.
 *
 * Order: by metro, biggest government first (the round 32 rough population estimate). `flag` carries the round 32 warning where the
 * listed URL looked wrong; the row is kept so the owner can fix it, not silently dropped.
 */
export interface ManualPortal {
  government: string;
  state: string;
  url: string;
  family: 'CivicPlus' | 'Bonfire/Euna';
  why: string;
  flag?: string;
}

export interface ManualMetro {
  metro: string;
  portals: ManualPortal[];
}

const CIVIC = 'CivicPlus robots.txt blocks named AI crawlers from /bids.aspx and its terms bar automated scraping.';
const BONFIRE = 'Bonfire/Euna bans commercial use; robots refused the round 32 tool.';

const c = (government: string, state: string, url: string, flag?: string): ManualPortal => ({ government, state, url, family: 'CivicPlus', why: CIVIC, ...(flag ? { flag } : {}) });
const b = (government: string, state: string, url: string): ManualPortal => ({ government, state, url, family: 'Bonfire/Euna', why: BONFIRE });

export const MANUAL_PORTALS: readonly ManualMetro[] = [
  {
    metro: 'Atlanta GA',
    portals: [
      c('Paulding County', 'GA', 'https://paulding.gov/Bids.aspx'),
      c('Douglas County', 'GA', 'https://douglascountyga.gov/Bids.aspx'),
      b('Roswell', 'GA', 'https://roswellgov.bonfirehub.com/portal/?tab=openOpportunities'),
      b('Alpharetta', 'GA', 'https://cityofalpharetta.bonfirehub.com/portal/?tab=openOpportunities'),
      c('Marietta', 'GA', 'https://mariettaga.gov/Bids.aspx'),
      c('Stonecrest', 'GA', 'https://stonecrestga.gov/Bids.aspx'),
      c('Brookhaven', 'GA', 'https://www.brookhavenga.gov/Bids.aspx'),
      c('Peachtree Corners', 'GA', 'https://peachtreecornersga.gov/Bids.aspx'),
      c('Peachtree City', 'GA', 'https://peachtree-city.org/Bids.aspx'),
      c('Norcross', 'GA', 'https://www.norcrossga.net/Bids.aspx'),
      c('Fairburn', 'GA', 'https://www.fairburn.com/Bids.aspx'),
      c('Lilburn', 'GA', 'https://www.cityoflilburn.com/Bids.aspx'),
    ],
  },
  {
    metro: 'Austin TX',
    portals: [
      b('Round Rock', 'TX', 'https://roundrocktexas.bonfirehub.com/portal/?tab=openOpportunities'),
      c('Buda', 'TX', 'https://budatx.gov/Bids.aspx'),
      c('Manor', 'TX', 'https://www.manortx.gov/Bids.aspx'),
    ],
  },
  {
    metro: 'Charlotte NC',
    portals: [c('Gaston County', 'NC', 'https://gastongov.com/Bids.aspx'), c('Huntersville', 'NC', 'https://www.huntersville.org/Bids.aspx')],
  },
  {
    metro: 'Raleigh NC',
    portals: [
      c('Clayton', 'NC', 'https://claytonnc.gov/Bids.aspx'),
      c('Orange County', 'NC', 'https://orangecountync.gov/Bids.aspx'),
      c('Apex', 'NC', 'https://www.apexnc.org/Bids.aspx'),
      c('Holly Springs', 'NC', 'https://hollyspringsnc.gov/Bids.aspx'),
      c('Fuquay-Varina', 'NC', 'https://www.fuquay-varina.org/Bids.aspx'),
      c('Carrboro', 'NC', 'http://townofcarrboro.org/Bids.aspx', 'The listed URL is http, not https. A record added from it needs the https address of the bid page.'),
    ],
  },
  {
    metro: 'New Orleans LA',
    portals: [
      c('Kenner', 'LA', 'https://www.kenner.la.us/Bids.aspx'),
      c('St. Bernard Parish', 'LA', 'https://www.sbpg.net/Bids.aspx'),
      c('Plaquemines Parish', 'LA', 'https://www.plaqueminesparish.gov/Bids.aspx'),
    ],
  },
  {
    metro: 'Baton Rouge LA',
    portals: [
      c('Baker', 'LA', 'https://www.lawrenceburgtn.gov/bids.aspx', 'Round 32 flag: this URL is lawrenceburgtn.gov (a Tennessee town), the wrong government. Find Baker, LA\'s own bid page before using it.'),
      c('West Baton Rouge Parish', 'LA', 'https://www.wbrcouncil.org/Bids.aspx'),
    ],
  },
];

/** Every list page URL above, normalized (lib/signals/manual-bids/record.ts normalizeUrl compares against these). */
export function manualPortalUrls(): string[] {
  return MANUAL_PORTALS.flatMap((m) => m.portals.map((p) => p.url));
}
