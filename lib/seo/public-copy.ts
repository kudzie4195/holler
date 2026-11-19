import { hasEnv, type EnvKey } from '@/lib/env';
import { signalTypeActive, sourceActive } from './signal-types';
import { TIER_NAMES } from '@/lib/plan/limits';
import { FROM_MONTHLY, namedPlanPrices } from '@/lib/plan/price-copy';
import { priceLabel } from '@/lib/stripe/plans';
import { TRIAL_PHRASE } from '@/lib/plan/price-copy';
import { PUSH_CAP } from './home-cadence';

/**
 * Every sentence on the home page, /about and /llms.txt that depends on an optional key lives here, built from the keys that are set.
 * The three pages hold no key-gated wording of their own (tests/seo/public-copy.test.ts reads their source to prove it).
 * Rule: a source or signal type that needs a key is named only when its key is set. When it is not set the item is left out or
 * reworded, never kept as a promise. `has` is for tests; production code never passes it.
 */
type Has = (...k: EnvKey[]) => boolean;

export interface Flags {
  /**
   * Public posts from people asking for a recommendation: needs Brave, Serper or both Bluesky keys. Resident requests made on Holler
   * (/request) are also kind 'ask' but need no key and are not covered by this flag; they are described as requests posted on Holler.
   */
  ask: boolean;
  /** Big ticketed events: needs the Ticketmaster key. */
  event: boolean;
  /** SAM.gov bids: needs SAM_API_KEY. */
  sam: boolean;
  bluesky: boolean;
  /** Licensed web search APIs: Brave or Serper. */
  search: boolean;
}

export function flagsFor(has: Has = hasEnv): Flags {
  return {
    ask: signalTypeActive('ask', has),
    event: signalTypeActive('event', has),
    sam: sourceActive('sam', has),
    bluesky: sourceActive('bluesky', has),
    search: sourceActive('search', has),
  };
}

export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The ways people-asking posts reach us, for the keys that are set. Empty when none are. */
function askChannels(f: Flags): string[] {
  return [...(f.search ? ['licensed search APIs'] : []), ...(f.bluesky ? ['Bluesky search'] : [])];
}

/** What we keep from a public post. Names the Bluesky handle only when Bluesky is on. */
function askKeeps(f: Flags): string {
  return f.bluesky ? 'the title, a short snippet, the link and, for Bluesky posts, the author handle' : 'the title, a short snippet and the link';
}

/** Check cadences for the sources that are on. The adapters' real cadences are asserted in tests/seo/cadence.test.ts. */
export function cadenceFor(f: Flags): string {
  const hazards = f.ask
    ? 'Weather alerts and airport delays are checked every 15 minutes, storm and earthquake reports every 30 minutes, and posts from people asking online every six hours.'
    : 'Weather alerts and airport delays are checked every 15 minutes, and storm and earthquake reports every 30 minutes.';
  const slow = joinList(['City records', 'federal contracts', ...(f.event ? ['events'] : [])]);
  return `${hazards} ${slow} are checked a few times a day.`;
}

// ---- Home page ---------------------------------------------------------------------------------------------------------

/** One row of the "three kinds of record" ledger. Trade names are plain text; one "See all trades" link under the ledger goes to /for. */
export interface HomeFamily {
  id: 'weather' | 'permit' | 'civic';
  /** Mono tag, upper case. */
  tag: string;
  title: string;
  /** Where the records come from, one sentence. */
  from: string;
  /** "Good for ..." trades: label as shown, and the trade category id. */
  goodFor: { label: string; id: string }[];
}

export interface HomeCopy {
  metaDescription: string;
  /** The subhead under the h1: what Holler does, in two sentences. */
  heroLead: string;
  /** The three parts of an alert, matching the numbered marks on the example card. */
  steps: { title: string; body: string }[];
  /** The ledger rows, in order: weather, permits, 311 and code. Only record types that need no key. */
  families: HomeFamily[];
  /** At most four. The page renders exactly these and its FAQPage JSON-LD uses the same list. */
  faqs: { q: string; a: string }[];
}

export function homeCopy(has: Has = hasEnv): HomeCopy {
  const f = flagsFor(has);

  const extra = [...(f.sam ? ['SAM.gov'] : []), ...(f.event ? ['the Ticketmaster Discovery API'] : [])];
  const dataAnswer =
    'City open-data portals, the National Weather Service, NOAA storm reports and 311 systems. Each alert links to its source.' +
    (extra.length ? ` Also ${joinList(extra)}.` : '') +
    (f.ask ? ` People asking online come from ${joinList(askChannels(f))}, and we keep ${askKeeps(f)}.` : '');

  return {
    metaDescription: `Holler watches public data${f.ask ? ' and local posts' : ''} and sends a short alert when something nearby fits what you do. Plans from ${FROM_MONTHLY} a month after a ${TRIAL_PHRASE}. No card to start.`,
    heroLead: 'Alerts when hail, a permit or a 311 request near you fits your trade. Each one links to its public source.',
    steps: [
      { title: 'What happened', body: 'In plain words, matched to the trades you picked.' },
      { title: 'How far from you', body: 'Only records inside the radius you drive.' },
      { title: 'The source', body: 'One tap to the city or weather service page it came from.' },
    ],
    families: [
      {
        id: 'weather',
        tag: 'WEATHER',
        title: 'Hail reports and storm warnings',
        from: 'From the National Weather Service and NOAA.',
        goodFor: [
          { label: 'roofing', id: 'roofing' },
          { label: 'tree service', id: 'tree-service' },
          { label: 'restoration', id: 'restoration' },
          { label: 'auto glass', id: 'auto-glass' },
        ],
      },
      {
        id: 'permit',
        tag: 'PERMITS',
        title: 'New building permits',
        from: 'From cities and counties that publish them.',
        goodFor: [
          { label: 'plumbing', id: 'plumbing' },
          { label: 'HVAC', id: 'hvac' },
          { label: 'electrical', id: 'electrical' },
          { label: 'windows and doors', id: 'windows-doors' },
        ],
      },
      {
        id: 'civic',
        tag: '311 AND CODE',
        title: 'City requests and code cases',
        from: 'Fallen trees, dumping, rats and repair orders.',
        goodFor: [
          { label: 'tree service', id: 'tree-service' },
          { label: 'handyman', id: 'handyman' },
          { label: 'junk removal', id: 'junk-removal' },
          { label: 'pest control', id: 'pest-control' },
        ],
      },
    ],
    faqs: [
      {
        q: 'Is this a lead list?',
        a: `No. Holler shows public records that point to work. It does not promise a job or a customer.${f.ask ? ' If you ask for a draft reply to a public post, you get text to edit and post yourself.' : ''}`,
      },
      { q: 'Where does it come from?', a: dataAnswer },
      {
        q: 'How do alerts reach me?',
        a: `By email today. iPhone and Android apps are coming, and push will be capped at ${PUSH_CAP}.`,
      },
      {
        q: 'Does it cover my area?',
        a: 'Weather covers the whole US. Permits and 311 come from the cities Holler has connected. Check your ZIP to see.',
      },
    ],
  };
}

// ---- About page --------------------------------------------------------------------------------------------------------

export interface AboutSource {
  name: string;
  href: string;
  what: string;
}

export interface AboutCopy {
  metaDescription: string;
  sources: AboutSource[];
  whatItIs: string[];
  dataIntro: string;
  coverage: string;
  cadence: string;
  /** Only when people-asking is on. */
  postsNote: string | null;
}

/**
 * Source homepages are the publishers' public sites (SOURCED from general knowledge of each publisher, not from the adapters).
 * ASSUMED: the adapters in lib/signals use these publishers. Update this list if an adapter is added or dropped.
 */
export function aboutCopy(has: Has = hasEnv): AboutCopy {
  const f = flagsFor(has);
  const sources: AboutSource[] = [
    { name: 'National Weather Service', href: 'https://www.weather.gov', what: 'Weather warnings, watches and advisories.' },
    { name: 'NOAA Storm Prediction Center', href: 'https://www.spc.noaa.gov', what: 'Local storm reports: hail, wind and tornadoes.' },
    { name: 'FEMA OpenFEMA', href: 'https://www.fema.gov/about/openfema', what: 'Disaster declarations.' },
    { name: 'USGS Earthquake Hazards Program', href: 'https://earthquake.usgs.gov', what: 'Earthquake reports.' },
    { name: 'FAA National Airspace System Status', href: 'https://nasstatus.faa.gov', what: 'Airport delays and ground stops.' },
    {
      name: 'City open data portals (Socrata)',
      href: 'https://dev.socrata.com',
      what: 'Building permits, 311 requests and health inspections, where a city publishes them.',
    },
    { name: 'USAspending.gov', href: 'https://www.usaspending.gov', what: 'Federal contract awards.' },
    ...(f.sam ? [{ name: 'SAM.gov', href: 'https://sam.gov', what: 'Federal contract opportunities.' }] : []),
    ...(f.event ? [{ name: 'Ticketmaster Discovery API', href: 'https://developer.ticketmaster.com', what: 'Large public events.' }] : []),
    ...(f.bluesky ? [{ name: 'Bluesky public posts', href: 'https://bsky.app', what: 'People asking for recommendations.' }] : []),
    ...(f.search
      ? [{ name: 'Licensed web search APIs', href: 'https://brave.com/search/api/', what: 'Public posts where people ask for local help.' }]
      : []),
  ];

  const opener =
    'A storm rolls through, and the roofers who hear about it first get the calls. A health inspection fails and a cleaning crew could help.';
  const third = f.ask
    ? ' When a neighbor posts "anyone recommend a plumber?" the first useful reply often wins the job.'
    : ' A new building permit is filed, and the fence builders and junk haulers nearby can call first.';

  return {
    metaDescription:
      'Holler turns public data into short alerts for local businesses. See where the data comes from, what we never do and what the two plans cost.',
    sources,
    whatItIs: [
      `${opener}${third}`,
      'Holler watches for moments like these in public data. You tell us what you do and where you work, and when something nearby matches, you get a short alert with a link to the source. That, plus a free page where residents can ask local businesses for help, is the whole product.',
      `There are two plans. ${TIER_NAMES.starter} is ${priceLabel('starter', 'monthly')} a month, or ${priceLabel('starter', 'annual')} a year, for one service area and up to five trades. ${TIER_NAMES.pro} is ${priceLabel('pro', 'monthly')} a month, or ${priceLabel('pro', 'annual')} a year, for up to three areas and 15 trades. Both start with a ${TRIAL_PHRASE} that needs no card. Cancel from Settings whenever you like.`,
      'Holler is new, so judge it on the records and the source links, not on a customer count.',
    ],
    dataIntro: `Everything comes from official APIs and open data${f.search ? ' and licensed search APIs' : ''}, and each alert links to the page or dataset it came from.`,
    coverage:
      'Coverage is uneven. Weather, disasters and federal contracts cover the whole US, and airport status covers 40 major airports. Permits, 311 and inspections come only from the cities we have connected so far, such as Chicago, New York and Austin, so a town we have not connected still gets the national alerts but not its own city records. Some sources run late. A few will be wrong. Check the source before you act.',
    cadence: cadenceFor(f),
    postsNote: f.ask
      ? `When we find a public post where someone is asking for help, we keep ${askKeeps(f)}. If you ask for a draft reply, you get text to edit and post yourself.`
      : null,
  };
}

// ---- llms.txt ----------------------------------------------------------------------------------------------------------

export interface LlmsInput {
  cityCount: number;
  states: { name: string; slug: string }[];
  url: (path: string) => string;
}

export function llmsText(input: LlmsInput, has: Has = hasEnv): string {
  const f = flagsFor(has);
  // Weather, storm, disaster and earthquake records exist for every city page; the open-data record types only for the cities Holler has
  // connected to a city portal. Airport status and federal contracts are tagged to the places they name.
  const everywhere = ['active weather alerts', 'storm reports', 'disaster declarations and earthquakes', 'federal contracts', ...(f.event ? ['big events'] : []), 'airport status'];
  const connectedOnly = ['building permits', '311 requests', 'inspections', 'new business licenses', 'code violations', 'event permits'];
  const asks = f.ask ? ', and public posts where someone asked for a local recommendation (titles and links only)' : '';
  const sourceLines = [
    '- National Weather Service alerts: https://www.weather.gov/alerts',
    '- NOAA Storm Prediction Center storm reports: https://www.spc.noaa.gov/climo/reports/',
    '- FEMA OpenFEMA disaster declarations: https://www.fema.gov/disaster/declarations',
    '- USGS earthquake feeds: https://earthquake.usgs.gov/earthquakes/map/',
    '- FAA National Airspace System status: https://nasstatus.faa.gov/',
    '- USAspending.gov federal awards: https://www.usaspending.gov/',
    ...(f.sam ? ['- SAM.gov contract opportunities: https://sam.gov/'] : []),
    '- City and county open data portals (building permits, 311, inspections, new business licenses, code violations, event permits)',
    ...(f.event ? ['- Ticketmaster Discovery API (events)'] : []),
    ...(f.ask ? [`- Public posts found through ${joinList(askChannels(f))}${f.bluesky ? ' (an app-password login)' : ''}`] : []),
  ];
  return [
    '# Holler',
    '',
    "> Holler tells local businesses when their area needs them. It watches public data and sends a short alert when something nearby matches what a business does. It never posts for the user and never touches anyone's social accounts.",
    '',
    '## What the public pages contain',
    '',
    `Each of ${input.cityCount} US cities with 50,000 or more people has a page that lists recent public records tagged to that city: ${joinList(everywhere)}${asks}. City records (${joinList(connectedOnly)}) exist only for the cities Holler has connected to a city open data portal, so most city pages list the first group alone. Every item names its source and links to it. Records are tagged to a city when they fall within 40 miles of it. Pages refresh about every 6 hours. Pages with fewer than 5 records in the last 60 days are marked noindex.`,
    '',
    '## Summary sentence and weekly pages',
    '',
    'A city page that has records from the last 7 days opens with one sentence that counts them, in the form "In the 7 days to <date>, <City>, <ST> had <count> building permits, <count> storm reports and <count> weather alerts." (the angle brackets mark where real values go). It names only record types with a count above zero, counts only records that already happened, and shows the date it was computed. Where a count comes from a county feed the sentence says "area".',
    '',
    `Each city also has weekly pages at ${input.url('/local/<state>/<city>/week/<YYYY-MM-DD>')}, where the date is the Monday (UTC) that starts the week. They list that week's records grouped by type, each with its source. Only the current week and the 11 before it exist. A weekly page with fewer than 10 records is marked noindex.`,
    '',
    '## Public data sources',
    '',
    ...sourceLines,
    '',
    '## Trade pages',
    '',
    'Each trade has a page that says which signals matter to it and why, with the latest matching public records. Pages with fewer than 5 live examples are marked noindex.',
    '',
    '## Pricing',
    '',
    `${namedPlanPrices('starter', 'per')}. ${namedPlanPrices('pro', 'per')}. Both start with a ${TRIAL_PHRASE}; no card is needed to start.`,
    '',
    '## Pages',
    '',
    `- [Check your area](${input.url('/check')})`,
    `- [Alerts by trade](${input.url('/for')})`,
    `- [All states](${input.url('/local')})`,
    ...input.states.map((s) => `- [${s.name}](${input.url(`/local/${s.slug}`)})`),
    '',
  ].join('\n');
}
