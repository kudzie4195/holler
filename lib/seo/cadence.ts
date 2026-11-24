/**
 * Public wording for how often sources are checked. Real cadences live in each adapter's `cadenceMinutes`:
 * nws and faa 15, spc and usgs 30, bluesky and web search 360, fema 360, Socrata 180 (311), 360 (permits) or 720
 * (inspections), usaspending, sam-gov and ticketmaster 720. tests/seo/cadence.test.ts fails if these phrases drift from the adapters.
 */
export const CADENCE_SHORT = 'Weather alerts and airport delays are checked every 15 minutes, and city records a few times a day.';

/** Which optional sources are switched on. With nothing switched on, only sources that need no key are described. */
export interface CadenceOptions {
  /** Public posts from people asking online: needs a search or Bluesky key. */
  ask?: boolean;
  /** Big ticketed events: needs the Ticketmaster key. */
  event?: boolean;
}

/**
 * The long cadence text, in short clauses (round 24 INT2, COPY report section 9: one long shared sentence on every city page read as
 * machine-made). The base is the keyless sources only (weather, storm and earthquake reports, airport delays, city records, federal
 * contracts). Posts from people asking online and events are named only when their keys are set.
 */
export function cadenceLong({ ask = false, event = false }: CadenceOptions = {}): string {
  const slow = event ? 'City records, federal contracts and events' : 'City records and federal contracts';
  return [
    'Weather alerts and airport delays: every 15 minutes.',
    'Storm and earthquake reports: every 30 minutes.',
    ...(ask ? ['Posts from people asking online: every six hours.'] : []),
    `${slow}: a few times a day.`,
    'Requests that residents post on Holler are added once they are confirmed.',
  ].join(' ');
}

/** What every city page says when no optional key is set. */
export const CADENCE_LONG = cadenceLong();
