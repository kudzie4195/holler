/**
 * Fixture records for the brief card tests and screenshots: one hand-written (assumed) record per family, dated 2026-11-20.
 * The label and trade of each are what the real rules give for it (lib/signals/lead-rules.ts), so no fixture is made up.
 */
import type { FeedItem } from '@/components/feed';
import type { DigestItem } from '@/lib/email/templates';
import type { MatchRow } from '@/lib/mobile/feed';

export const NOW = new Date('2026-11-21T22:00:00Z');
export const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
export const OCCURRED = '2026-11-20T15:00:00.000Z';

export interface Fx {
  name: string;
  source: string;
  kind: string;
  subtype: string | null;
  title: string;
  summary: string | null;
  url: string | null;
  label: 'act_now' | 'coming_soon' | 'market_insight';
  trade: string;
  /** Matches the real label rules for this record, so the fixture is not made up. */
  categories: string[];
  expires?: string | null;
}

export const FIXTURES: Fx[] = [
  { name: 'failed food inspection', source: 'socrata-chicago-inspections', kind: 'civic', subtype: 'inspection', title: 'Failed food inspection: Joe\'s Diner', summary: 'Result: Fail', url: 'https://data.cityofchicago.org/d/4ijn-s7e5/1', label: 'act_now', trade: 'pest-control', categories: ['pest-control'] },
  { name: 'code violation', source: 'socrata-chicago-violations', kind: 'civic', subtype: 'violation', title: 'Code violation on N Oak St', summary: null, url: 'https://data.cityofchicago.org/d/22u3-xenr/1', label: 'act_now', trade: 'plumbing', categories: ['plumbing'] },
  { name: 'NYC no heat 311', source: 'socrata-nyc-311', kind: 'civic', subtype: '311', title: '311 request in Bronx: HEAT/HOT WATER', summary: null, url: 'https://data.cityofnewyork.us/d/erm2-nwe9/1', label: 'act_now', trade: 'hvac', categories: ['hvac'] },
  { name: 'other 311', source: 'socrata-sf-311', kind: 'civic', subtype: '311', title: '311 request in San Francisco: Street cleaning', summary: null, url: null, label: 'coming_soon', trade: 'junk-removal', categories: ['junk-removal'] },
  { name: 'hail report', source: 'spc', kind: 'report', subtype: null, title: 'Hail report near Marietta, GA', summary: '1.75 in hail', url: 'https://www.spc.noaa.gov/climo/reports/today.html', label: 'act_now', trade: 'roofing', categories: ['roofing'] },
  { name: 'wind gust', source: 'spc', kind: 'report', subtype: null, title: 'Wind gust near Smyrna, GA', summary: null, url: null, label: 'coming_soon', trade: 'tree-service', categories: ['tree-service'] },
  { name: 'weather alert', source: 'nws', kind: 'alert', subtype: null, title: 'Severe Thunderstorm Warning', summary: 'Until 6 PM', url: 'https://api.weather.gov/alerts/x', label: 'coming_soon', trade: 'roofing', categories: ['roofing'] },
  { name: 'disaster declaration', source: 'fema', kind: 'disaster', subtype: null, title: 'Disaster declaration: Cobb County', summary: null, url: 'https://www.fema.gov/disaster/1', label: 'coming_soon', trade: 'restoration', categories: ['restoration'] },
  { name: 'earthquake', source: 'usgs', kind: 'quake', subtype: null, title: 'M 3.1 earthquake', summary: null, url: 'https://earthquake.usgs.gov/x', label: 'coming_soon', trade: 'restoration', categories: ['restoration'] },
  { name: 'airport delay', source: 'faa', kind: 'travel', subtype: null, title: 'Delays at ATL', summary: null, url: null, label: 'coming_soon', trade: 'rideshare-delivery', categories: ['rideshare-delivery'] },
  { name: 'new-home permit for a mover', source: 'arcgis-cobb-residential-permits', kind: 'permit', subtype: 'permit', title: 'Building permit: new home', summary: null, url: null, label: 'coming_soon', trade: 'moving', categories: ['moving'] },
  { name: 'own-trade permit', source: 'socrata-chicago-permits', kind: 'permit', subtype: 'permit', title: 'Building permit: re-roof', summary: null, url: 'https://data.cityofchicago.org/d/ydr8-5enu/1', label: 'market_insight', trade: 'roofing', categories: ['roofing'] },
  { name: 'new business license', source: 'socrata-sf-business', kind: 'civic', subtype: 'business', title: 'New business license: Cafe', summary: null, url: null, label: 'coming_soon', trade: 'cleaning', categories: ['cleaning'] },
  { name: 'special event permit', source: 'socrata-nyc-events', kind: 'event', subtype: 'event-permit', title: 'Special event: Wedding in Central Park', summary: null, url: null, label: 'coming_soon', trade: 'catering', categories: ['catering'] },
  { name: 'big event', source: 'ticketmaster', kind: 'event', subtype: null, title: 'Concert at the arena', summary: null, url: 'https://www.ticketmaster.com/e/1', label: 'coming_soon', trade: 'food-truck', categories: ['food-truck'] },
  { name: 'federal bid', source: 'sam-gov', kind: 'contract', subtype: null, title: 'Roof replacement, VA clinic', summary: null, url: 'https://sam.gov/opp/1', label: 'act_now', trade: 'roofing', categories: ['roofing'], expires: iso(10 * 86_400_000) },
  { name: 'federal award', source: 'usaspending', kind: 'contract', subtype: null, title: 'Award: HVAC maintenance', summary: null, url: 'https://www.usaspending.gov/award/1', label: 'market_insight', trade: 'hvac', categories: ['hvac'] },
  { name: 'city bid', source: 'bids-la', kind: 'contract', subtype: 'bid', title: 'Open bid in Los Angeles: REPLACE ROOFS AT TWO FIRE STATIONS', summary: null, url: 'https://www.rampla.org/s/1', label: 'act_now', trade: 'roofing', categories: ['roofing'], expires: iso(19 * 86_400_000) },
  { name: 'Baton Rouge bid (portal link)', source: 'bids-batonrouge', kind: 'contract', subtype: 'bid', title: 'Open bid in Baton Rouge: Janitorial services', summary: null, url: 'https://www.brla.gov/bids', label: 'act_now', trade: 'janitorial-commercial', categories: ['janitorial-commercial'], expires: iso(5 * 86_400_000) },
  { name: 'public post', source: 'bluesky', kind: 'ask', subtype: null, title: 'Anyone know a good roofer in Marietta?', summary: null, url: 'https://bsky.app/profile/x/post/1', label: 'act_now', trade: 'roofing', categories: ['roofing'] },
  { name: 'resident request', source: 'holler-request', kind: 'ask', subtype: null, title: 'Service request in Atlanta: Roofing', summary: null, url: 'https://localholler.com/request', label: 'act_now', trade: 'roofing', categories: ['roofing'], expires: iso(10 * 86_400_000) },
];

export const feedItem = (f: Fx, i: number): FeedItem => ({
  id: i + 1, signalId: 100 + i, status: 'new', kind: f.kind, source: f.source, subtype: f.subtype, title: f.title, summary: f.summary, url: f.url,
  distance: '2.0 mi away', place: 'Atlanta, GA', ago: '1 day ago', occurredAt: OCCURRED, draft: null, label: f.label, trade: f.trade, deadline: null,
});

export const digestItem = (f: Fx): DigestItem => ({
  kind: f.kind, source: f.source, subtype: f.subtype, title: f.title, place: 'Atlanta, GA', occurredAt: OCCURRED, sourceUrl: f.url, label: f.label, trade: f.trade, deadline: null,
});

export const mobileRow = (f: Fx, i: number): MatchRow => ({
  id: i + 1, status: 'new', distance_mi: 2, draft: null, created_at: iso(-3_600_000),
  signal: { id: 100 + i, source: f.source, kind: f.kind, subtype: f.subtype, title: f.title, summary: f.summary, url: f.url, city: 'Atlanta', state: 'GA', county: null, zip: null, severity: 2, categories: f.categories, occurred_at: OCCURRED, expires_at: f.expires ?? null },
}) as unknown as MatchRow;

