import type { CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';

/**
 * Ticketmaster Discovery API v2, Event Search.
 * Docs (sourced): https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/
 *  - GET https://app.ticketmaster.com/discovery/v2/events.json?apikey=...&countryCode=US&startDateTime=&endDateTime=&size=&page=&sort=&segmentName=
 *  - limits: 5,000 calls/day, 5 req/s, size*page < 1000
 *  - response: _embedded.events[] {id,name,url,dates.start{dateTime,localDate},classifications[],_embedded.venues[]{name,city.name,state.stateCode,postalCode,location{latitude,longitude}}}, page{size,totalElements,totalPages,number}
 * Assumed: startDateTime/endDateTime use ISO 8601 UTC without milliseconds (YYYY-MM-DDTHH:mm:ssZ), the format Ticketmaster's examples use.
 * Assumed: the API has no capacity filter, so "large" is approximated by segment Sports/Music and relevance sort (top results nationwide).
 */

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';
const PAGES = 2;
const SIZE = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const BASE_CATEGORIES: CategoryId[] = ['food-truck', 'catering', 'event-services', 'rideshare-delivery', 'cleaning'];

/** Pure parser for a Discovery API events response. */
export function parseTicketmaster(raw: unknown): SignalInput[] {
  try {
    const events = isObj(raw) && isObj(raw._embedded) ? raw._embedded.events : null;
    if (!Array.isArray(events)) return [];
    const out: SignalInput[] = [];
    for (const ev of events) {
      try {
        if (!isObj(ev)) continue;
        const id = str(ev.id);
        const name = str(ev.name);
        if (!id || !name) continue;

        const start = isObj(ev.dates) && isObj(ev.dates.start) ? ev.dates.start : {};
        const dt = str(start.dateTime) || (str(start.localDate) ? `${str(start.localDate)}T00:00:00Z` : '');
        const when = new Date(dt);
        if (!dt || Number.isNaN(when.getTime())) continue;

        const venues = isObj(ev._embedded) && Array.isArray(ev._embedded.venues) ? ev._embedded.venues : [];
        const venue = isObj(venues[0]) ? (venues[0] as Obj) : {};
        const loc = isObj(venue.location) ? venue.location : {};
        const lat = numOrNull(loc.latitude);
        const lon = numOrNull(loc.longitude);
        const city = isObj(venue.city) ? str(venue.city.name) : '';
        const state = isObj(venue.state) ? str(venue.state.stateCode) : '';
        const venueName = str(venue.name);

        const cls = Array.isArray(ev.classifications) && isObj(ev.classifications[0]) ? (ev.classifications[0] as Obj) : {};
        const segment = isObj(cls.segment) ? str(cls.segment.name) : '';
        const genre = isObj(cls.genre) ? str(cls.genre.name) : '';
        const big = /^(sports|music)$/i.test(segment);
        const severity: Severity = big ? 2 : 1;

        out.push({
          source: 'ticketmaster',
          externalId: id,
          kind: 'event',
          title: `${name}${venueName ? ` at ${venueName}` : ''}${city ? `, ${city}${state ? ` ${state}` : ''}` : ''}`.slice(0, 200),
          summary:
            [segment && genre ? `${segment} / ${genre}` : segment || genre, `starts ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`]
              .filter(Boolean)
              .join(', ') || null,
          url: str(ev.url) || null,
          lat: lat != null && lon != null ? lat : null,
          lon: lat != null && lon != null ? lon : null,
          city: city || null,
          state: state || null,
          zip: str(venue.postalCode).slice(0, 5) || null,
          categories: BASE_CATEGORIES,
          severity,
          occurredAt: when.toISOString(),
          expiresAt: new Date(when.getTime() + 8 * 3_600_000).toISOString(),
          data: { venue: venueName || null, segment: segment || null, genre: genre || null },
        });
      } catch {
        // skip malformed event
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function buildTicketmasterUrl(apiKey: string, now: Date, page: number): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const end = new Date(now.getTime() + 7 * 86_400_000);
  const p = new URLSearchParams({
    apikey: apiKey,
    countryCode: 'US',
    startDateTime: iso(now),
    endDateTime: iso(end),
    segmentName: 'Sports,Music',
    sort: 'relevance,desc',
    size: String(SIZE),
    page: String(page),
  });
  return `${ENDPOINT}?${p.toString()}`;
}

const ticketmaster: Adapter = {
  id: 'ticketmaster',
  label: 'Big events this week (Ticketmaster)',
  kind: 'event',
  cadenceMinutes: 720,
  requiresEnv: ['TICKETMASTER_API_KEY'],
  sourceUrl: 'https://www.ticketmaster.com/',
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    const key = ctx.env.TICKETMASTER_API_KEY ?? env.TICKETMASTER_API_KEY;
    if (!key) {
      ctx.log('ticketmaster: TICKETMASTER_API_KEY missing');
      return [];
    }
    const out: SignalInput[] = [];
    try {
      const now = new Date();
      for (let page = 0; page < PAGES; page++) {
        const res = await ctx.fetch(buildTicketmasterUrl(key, now, page), {
          headers: { Accept: 'application/json', 'User-Agent': UA },
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          ctx.log(`ticketmaster: HTTP ${res.status}`);
          break;
        }
        const json = await res.json();
        const parsed = parseTicketmaster(json);
        out.push(...parsed);
        const totalPages = isObj(json) && isObj(json.page) ? Number(json.page.totalPages) : 0;
        if (!(totalPages > page + 1)) break;
      }
    } catch (e) {
      ctx.log(`ticketmaster: ${e instanceof Error ? e.message : String(e)}`);
    }
    return out;
  },
};

export const adapters: Adapter[] = [ticketmaster];
