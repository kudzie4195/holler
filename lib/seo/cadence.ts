/**
 * Public wording for how often sources are checked. Real cadences live in each adapter's `cadenceMinutes`:
 * nws and faa 15, spc and usgs 30, bluesky and web search 360, fema 360, Socrata 180 (311), 360 (permits) or 720
 * (inspections), usaspending, sam-gov and ticketmaster 720. tests/seo/cadence.test.ts fails if these phrases drift from the adapters.
 */
export const CADENCE_SHORT = 'Weather alerts and airport delays are checked every 15 minutes, and city records a few times a day.';

export const CADENCE_LONG =
  'Weather alerts and airport delays are checked every 15 minutes, storm and earthquake reports every 30 minutes, and posts from people asking online every six hours. City records, federal contracts and events are checked a few times a day.';
