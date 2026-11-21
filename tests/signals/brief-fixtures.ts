/**
 * Fixture cards for the brief card tests and screenshots.
 *
 * Every record is built by the REAL adapter parser from the repo's own adapter fixtures (tests/fixtures/*, tests/signals/adapters/fixtures/*:
 * source ids, titles, categories, links, dates and positions are what the parsers produce), except two that have no parser fixture: a new-home
 * permit (real classifier `classifyPermit` and `permitTitleFor`) and a resident request (real `buildRequestSignal`). Each record is then run
 * through the REAL matcher `matchOne` for a fixture member (a profile placed at the record, with the trade that member picked): the card's
 * label comes from the match, the trade from `tradeForRecord`, the deadline from `deadlineOf`. A fixture whose record does not match its
 * member throws, so no card is shown to a trade the rules do not give it. Row values in the adapter fixtures are mostly hand-written
 * (assumed) or copied from live portals (see the provenance headers of the adapter tests); the members are hand-written.
 * Clock: 2026-11-21T22:00:00Z.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeedItem } from '@/components/feed';
import { formatDistance, timeAgo } from '@/components/format';
import type { DigestItem } from '@/lib/email/templates';
import type { MatchRow } from '@/lib/mobile/feed';
import { buildRequestSignal } from '@/lib/requests/signal';
import { parseBids, BID_DATASETS } from '@/lib/signals/adapters/city-bids';
import { parseBluesky } from '@/lib/signals/adapters/bluesky';
import { parseFaa } from '@/lib/signals/adapters/faa';
import { parseFema } from '@/lib/signals/adapters/fema';
import { parseNws } from '@/lib/signals/adapters/nws';
import { parseSam } from '@/lib/signals/adapters/sam';
import { parseSocrata } from '@/lib/signals/adapters/socrata';
import { SOCRATA_DATASETS } from '@/lib/signals/adapters/socrata-datasets';
import { parseSpc } from '@/lib/signals/adapters/spc';
import { parseTicketmaster } from '@/lib/signals/adapters/ticketmaster';
import { parseUsaSpending } from '@/lib/signals/adapters/usaspending';
import { parseUsgs } from '@/lib/signals/adapters/usgs';
import { bidCardLine } from '@/lib/signals/bid-card';
import { tradeForRecord } from '@/lib/signals/brief';
import { classifyPermit, permitTitleFor } from '@/lib/signals/mapping/permit';
import { deadlineOf, labelFor, orderByLabel, type OpportunityLabel } from '@/lib/signals/lead-rules';
import { matchOne, type MatchProfile, type MatchResult, type MatchSignal } from '@/lib/signals/match';
import { matchScope } from '@/lib/plan/scope';
import type { SignalInput } from '@/lib/signals/types';

export const NOW = new Date('2026-11-21T22:00:00Z');
export const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const fx = (n: string) => readFileSync(join(__dirname, '../fixtures', n), 'utf8');
const j = (n: string): unknown => JSON.parse(fx(n));
const bidFx = (id: string): unknown => JSON.parse(readFileSync(join(__dirname, '../signals/adapters/fixtures', `bids-${id}-live-2026-11-21.json`), 'utf8'));
const social = (id: string) => SOCRATA_DATASETS.find((d) => d.id === id)!;
const bidDs = (id: string) => BID_DATASETS.find((d) => d.id === id)!;

export interface FixtureCase {
  name: string;
  /** The fixture member: a profile placed at the record, with the trades that member picked. */
  member: { business_name: string; categories: string[] };
  profile: MatchProfile;
  /** The member's trades under their plan (what the web feed, the digest and the app call matchScope(profile).categories). */
  trades: string[];
  signal: SignalInput & { id: number };
  match: MatchResult;
  label: OpportunityLabel;
  /** The member's trade the card was matched to (null: a keyword-only match). */
  trade: string | null;
  deadline: string | null;
}

let nextId = 100;

export function matchSignalOf(s: SignalInput & { id: number }): MatchSignal {
  return {
    id: s.id, categories: s.categories, lat: s.lat ?? null, lon: s.lon ?? null, state: s.state ?? null, severity: s.severity, occurred_at: s.occurredAt,
    source: s.source, title: s.title, summary: s.summary ?? null, kind: s.kind, subtype: (s.data?.subtype as string | undefined) ?? null, data: s.data ?? null,
  };
}

export function profileFor(s: SignalInput, categories: string[], business_name: string): MatchProfile & { business_name: string } {
  return {
    user_id: `member-${nextId}`, business_name, categories, lat: s.lat ?? null, lon: s.lon ?? null, state: s.state ?? null, radius_mi: 25,
    plan: 'starter', subscription_status: 'active',
  };
}

/** Builds one case, or throws when the real matcher does not give this record to this member. */
export function buildCase(name: string, sig: SignalInput, categories: string[], business_name: string): FixtureCase {
  const signal = { ...sig, id: nextId++ };
  const profile = profileFor(signal, categories, business_name);
  const m = matchOne(matchSignalOf(signal), profile, true);
  if (!m) throw new Error(`fixture "${name}": the real matcher gives this record to no one with trades ${categories.join(', ')}`);
  const trades = matchScope(profile).categories;
  const trade = tradeForRecord({ source: signal.source, kind: signal.kind, subtype: (signal.data?.subtype as string | undefined) ?? null, title: signal.title }, signal.categories, trades);
  return {
    name, member: { business_name, categories }, profile, trades, signal, match: m, label: m.label, trade,
    deadline: deadlineOf({ source: signal.source, expires_at: signal.expiresAt ?? null, data: signal.data ?? null }),
  };
}

function pick<T extends SignalInput>(list: T[], test: (s: T) => boolean, what: string): T {
  const f = list.find(test);
  if (!f) throw new Error(`fixture record not found: ${what}`);
  return f;
}

const newHomePermit = (): SignalInput => {
  const pc = classifyPermit({ structured: ['New Construction'], free: ['new single family home'] });
  return {
    source: 'arcgis-atlanta-permits', externalId: 'fx-newhome-1', kind: 'permit', title: permitTitleFor('Atlanta', pc.label), summary: null,
    url: 'https://services5.arcgis.com/5RxyIIJ9boPdptdo/arcgis/rest/services/building_permit_featureLayer/FeatureServer/0', lat: 33.76, lon: -84.4,
    city: 'Atlanta', state: 'GA', categories: pc.categories, severity: 1, occurredAt: '2026-11-18T05:00:00.000Z', data: { subtype: 'permit' },
  };
};

const request = (): SignalInput => {
  const r = buildRequestSignal(
    { public_id: 'fx-req-1', trade: 'roofing', zip: '30303', city: 'Atlanta', state: 'GA', place_slug: 'atlanta-ga', lat: 33.75, lon: -84.39 },
    { siteUrl: 'https://localholler.com', now: new Date('2026-11-21T16:00:00Z'), expiresAt: new Date('2026-12-05T16:00:00Z') },
  );
  return { ...(r as unknown as SignalInput), externalId: r.externalId };
};

const NWS = parseNws(j('nws-alerts.json'));
const SPC_HAIL = parseSpc({ csv: fx('spc-hail.csv'), type: 'hail', day: '2026-11-20' });
const SPC_WIND = parseSpc({ csv: fx('spc-wind.csv'), type: 'wind', day: '2026-11-20' });
const FEMA = parseFema(j('fema-declarations.json'));
const USGS = parseUsgs(j('usgs-2.5_day.json'));
const FAA = parseFaa(fx('faa-status.xml'));
const sx = (id: string, file: string) => parseSocrata(j(file), social(id));

const CASES: (() => FixtureCase)[] = [
  () => buildCase('failed food inspection', sx('socrata-chicago-inspections', 'socrata-chicago-inspections.json')[0], ['pest-control'], 'Lakeview Pest Control'),
  () => buildCase('code violation', pick(sx('socrata-chicago-violations', 'socrata-chicago-violations.json'), (s) => /EXTERIOR WALL/.test(s.title), 'exterior wall'), ['general-contractor'], 'Prairie Builders'),
  () => buildCase('no-heat 311', pick(sx('socrata-nyc-311', 'socrata-nyc-311.json'), (s) => /HEAT/.test(s.title), 'heat'), ['hvac'], 'Harbor Heating'),
  () => buildCase('other 311', pick(sx('socrata-nyc-311', 'socrata-nyc-311.json'), (s) => /Rodent/.test(s.title), 'rodent'), ['pest-control'], 'Bronx Pest Control'),
  () => buildCase('hail report', SPC_HAIL.find((s) => /1\.50 inch/.test(s.title))!, ['roofing'], 'Longview Roofing'),
  () => buildCase('wind gust', SPC_WIND.find((s) => /68 mph/.test(s.title))!, ['tree-service'], 'Celina Tree Service'),
  () => buildCase('weather alert', pick(NWS, (s) => /Severe Thunderstorm/.test(s.title), 'thunderstorm'), ['roofing'], 'Cobb Roofing'),
  () => buildCase('disaster declaration', pick(FEMA, (s) => /TORNADOES \(GA\)/.test(s.title), 'ga declaration'), ['restoration'], 'Peach State Restoration'),
  () => buildCase('earthquake', pick(USGS, (s) => /Ridgecrest/.test(s.title), 'ridgecrest'), ['plumbing'], 'Kern Plumbing'),
  () => buildCase('airport delay', pick(FAA, (s) => /\(ATL\)/.test(s.title), 'ATL'), ['rideshare-delivery'], 'Peachtree Rides'),
  () => buildCase('new-home permit for a mover', newHomePermit(), ['moving'], 'Midtown Movers'),
  () => buildCase('own-trade permit', pick(sx('socrata-chicago-permits', 'socrata-chicago-permits.json'), (s) => /Roof/.test(s.title), 'roof permit'), ['roofing'], 'Logan Roofing'),
  () => buildCase('new business license', pick(sx('socrata-sf-business', 'socrata-sf-business.json'), (s) => /Food Service/.test(s.title), 'food service'), ['cleaning'], 'Mission Cleaning'),
  () => buildCase('special event permit', sx('socrata-nyc-events', 'socrata-nyc-events.json')[0], ['catering'], 'Village Catering'),
  () => buildCase('big event', parseTicketmaster(j('ticketmaster-events.json'))[0], ['food-truck'], 'Peach Food Truck'),
  () => buildCase('federal bid', pick(parseSam(j('sam-opportunities.json')), (s) => /Roof/.test(s.title), 'roof bid'), ['roofing'], 'Trinity Roofing'),
  () => buildCase('federal award', pick(parseUsaSpending(j('usaspending-awards.json')), (s) => /Plumbing/.test(s.title), 'plumbing award'), ['plumbing'], 'Queen City Plumbing'),
  () => buildCase('city bid', parseBids(bidFx('la'), bidDs('bids-la'), NOW).items[0], ['hvac'], 'Angeleno HVAC'),
  () => buildCase('city bid with a portal link', parseBids(bidFx('batonrouge'), bidDs('bids-batonrouge'), NOW).items[0], ['janitorial-commercial'], 'Capital City Janitorial'),
  () => buildCase('public post', pick(parseBluesky(j('bluesky-search.json'), NOW), (s) => /plumber/.test(s.title), 'plumber post'), ['plumbing'], 'Marietta Plumbing'),
  () => buildCase('resident request', request(), ['roofing'], 'Acme Roofing'),
];

/** Built once. Throws, with the fixture's name, when the real matcher disagrees with a fixture. */
export const FIXTURES: FixtureCase[] = CASES.map((f) => f());

/** The cards in the order the web feed shows them: Act now first, then Coming soon, then Market insight. */
export const ORDERED = orderByLabel(FIXTURES, (c) => c.label);

const dataOf = (c: FixtureCase) => (c.signal.data ?? {}) as Record<string, unknown>;
const isBid = (c: FixtureCase) => dataOf(c).subtype === 'bid';

/** What the web page builds (app/app/page.tsx), for one case. */
export const feedItem = (c: FixtureCase, i = 0): FeedItem => ({
  id: i + 1, signalId: c.signal.id, status: 'new', kind: c.signal.kind, source: c.signal.source, subtype: (dataOf(c).subtype as string | undefined) ?? null,
  title: c.signal.title, summary: c.signal.summary ?? null, url: c.signal.url ?? null, distance: formatDistance(c.match.distance_mi),
  place: [c.signal.city, c.signal.state].filter(Boolean).join(', ') || null, ago: timeAgo(c.signal.occurredAt, NOW.getTime()), occurredAt: c.signal.occurredAt,
  draft: null, label: c.label, trade: c.trade, deadline: c.deadline,
  bidLine: isBid(c) ? bidCardLine({ buyer: dataOf(c).buyer as string, dueDate: dataOf(c).dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW) : null,
});

/** What the digest cron builds (app/api/cron/notify/route.ts), for one case. */
export const digestItem = (c: FixtureCase): DigestItem => ({
  kind: c.signal.kind, source: c.signal.source, subtype: (dataOf(c).subtype as string | undefined) ?? null, title: c.signal.title, summary: c.signal.summary ?? null,
  place: [c.signal.city, c.signal.state].filter(Boolean).join(', ') || null, occurredAt: c.signal.occurredAt, sourceUrl: c.signal.url ?? null,
  label: c.label, trade: c.trade, deadline: c.deadline,
  bidLine: isBid(c) ? bidCardLine({ buyer: dataOf(c).buyer as string, dueDate: dataOf(c).dueDate as string, expiresAt: c.signal.expiresAt ?? null }, NOW) : null,
});

/** What the mobile feed reads (MATCH_SELECT), for one case. */
/** The brief the real code builds for a fixture card (the record's own title and summary go in, as every surface passes them). */
export const briefInputOf = (c: FixtureCase) => ({
  source: c.signal.source, kind: c.signal.kind, subtype: (c.signal.data?.subtype as string | undefined) ?? null, title: c.signal.title, summary: c.signal.summary ?? null, label: c.label, trade: c.trade,
});

export const mobileRow = (c: FixtureCase, i = 0): MatchRow =>
  ({
    id: i + 1, status: 'new', distance_mi: c.match.distance_mi, draft: null, created_at: iso(-3_600_000),
    signal: {
      id: c.signal.id, source: c.signal.source, kind: c.signal.kind, subtype: (dataOf(c).subtype as string | undefined) ?? null, title: c.signal.title,
      summary: c.signal.summary ?? null, url: c.signal.url ?? null, city: c.signal.city ?? null, state: c.signal.state ?? null, county: null, zip: null,
      severity: c.signal.severity, categories: c.signal.categories, occurred_at: c.signal.occurredAt, expires_at: c.signal.expiresAt ?? null,
      dueDate: (dataOf(c).dueDate as string | undefined) ?? null, bidBuyer: (dataOf(c).buyer as string | undefined) ?? null,
    },
  }) as unknown as MatchRow;

export { labelFor };
