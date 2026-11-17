import { STATES, citiesInState, CITIES } from '@/lib/geo';
import { absoluteUrl } from '@/lib/seo/canonical';

export function GET() {
  const states = STATES.filter((s) => citiesInState(s.code).length > 0);
  const lines = [
    '# Holler',
    '',
    '> Holler tells local businesses when their area needs them. It watches public data and sends a short alert when something nearby matches what a business does. It never posts for the user and never touches anyone\'s social accounts.',
    '',
    '## What the public pages contain',
    '',
    `Each of ${CITIES.length} US cities with 50,000 or more people has a page that lists recent public records tagged to that city: active weather alerts, storm reports, disaster declarations and earthquakes, building permits, 311 requests, inspections, new business licenses, code violations, federal contracts, big events, event permits, airport status, and public posts where someone asked for a local recommendation (titles and links only). Every item names its source and links to it. Records are tagged to a city when they fall within 40 miles of it. Pages refresh about every 6 hours. Pages with fewer than 5 records in the last 60 days are marked noindex.`,
    '',
    '## Public data sources',
    '',
    '- National Weather Service alerts: https://www.weather.gov/alerts',
    '- NOAA Storm Prediction Center storm reports: https://www.spc.noaa.gov/climo/reports/',
    '- FEMA OpenFEMA disaster declarations: https://www.fema.gov/disaster/declarations',
    '- USGS earthquake feeds: https://earthquake.usgs.gov/earthquakes/map/',
    '- FAA National Airspace System status: https://nasstatus.faa.gov/',
    '- USAspending.gov federal awards: https://www.usaspending.gov/',
    '- SAM.gov contract opportunities: https://sam.gov/',
    '- City and county open data portals (building permits, 311, inspections, new business licenses, code violations, event permits)',
    '- Ticketmaster Discovery API (events)',
    '- Public posts found through licensed search APIs and the Bluesky public API',
    '',
    '## Trade pages',
    '',
    'Each trade has a page that says which signals matter to it and why, with the latest matching public records. Pages with fewer than 5 live examples are marked noindex.',
    '',
    '## Pricing',
    '',
    '$5 per month after a 7-day free trial. No card is needed to start.',
    '',
    '## Pages',
    '',
    `- [Check your area](${absoluteUrl('/check')})`,
    `- [Alerts by trade](${absoluteUrl('/for')})`,
    `- [All states](${absoluteUrl('/local')})`,
    ...states.map((s) => `- [${s.name}](${absoluteUrl(`/local/${s.slug}`)})`),
    '',
  ];
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
