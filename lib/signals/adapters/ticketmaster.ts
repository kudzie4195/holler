import { HOLLER_UA } from '@/lib/user-agent';
import type { CategoryId } from '@/lib/signals/categories';
import type { Adapter, AdapterContext, Severity, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';

/**
 * Ticketmaster Discovery API v2, Event Search.
 * Docs (confirmed 2026-11-17 by fetching developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ and .../discovery-manual/v2):
 *  - GET https://app.ticketmaster.com/discovery/v2/events.json?apikey=...&countryCode=US&startDateTime=&endDateTime=&size=&page=&sort=&segmentName=
 *  - startDateTime/endDateTime: the manual's parameter table shows the example value "2017-01-01T00:00:00Z" (ISO 8601 UTC, no milliseconds);
 *    the prose does not define the format.
 *  - segmentName is listed as an Array, but the docs never say that several values may be comma separated (only source, venueId, attractionId say so),
 *    so one request is made per segment (Sports, Music) instead of "Sports,Music".
 *  - sort allowed: name,asc|desc, date,asc|desc, relevance,asc|desc, distance,asc, random, ... Default relevance,desc. size default 20, page default 0, size*page < 1000.
 *  - limits: 5,000 calls/day, 5 req/s; 429 body error code policies.ratelimit.QuotaViolation; 401 body {fault:{faultstring:"Invalid ApiKey",detail:{errorcode:"oauth.v2.InvalidApiKey"}}}.
 *  - response: _links, _embedded.events[] {name,type,id,test,url,locale,images,sales,dates{start{localDate,localTime,dateTime,dateTBD,dateTBA,timeTBA,noSpecificTime},timezone,status},
 *    classifications[]{primary,segment{id,name},genre,subGenre}, promoter, _embedded{venues[]{name,id,postalCode,timezone,city{name},state{name,stateCode},
 *    country{countryCode},address,location{longitude,latitude} (strings in the sample),markets}, attractions[]}}, page{size,totalElements,totalPages,number}.
 *    With zero matches the API returns page{totalElements:0} and no _embedded key.
 * Assumed: the API has no capacity filter, so "large" is approximated by segment Sports/Music and relevance sort (top results nationwide).
 */

const ENDPOINT = 'https://app.ticketmaster.com/discovery/v2/events.json';
const UA = HOLLER_UA;
const PAGES = 1;
const SEGMENTS = ['Sports', 'Music'];
const SIZE = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const BASE_CATEGORIES: CategoryId[] = ['food-truck', 'catering', 'event-services', 'rideshare-delivery', 'cleaning'];

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
            [segment && genre ? `${segment} / ${genre}` : segment || genre, startsText(start, when)]
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

/** Venue-local start when the API gives it (an 8 pm show must not read as the next day in UTC). */
function startsText(start: Obj, when: Date): string {
  const d = str(start.localDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const t = /^\d{2}:\d{2}/.exec(str(start.localTime))?.[0];
    return t ? `starts ${d} ${t} local time` : `starts ${d}`;
  }
  return `starts ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function buildTicketmasterUrl(apiKey: string, now: Date, page: number, segment: string = SEGMENTS[0]): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const end = new Date(now.getTime() + 7 * 86_400_000);
  const p = new URLSearchParams({
    apikey: apiKey,
    countryCode: 'US',
    startDateTime: iso(now),
    endDateTime: iso(end),
    segmentName: segment,
    sort: 'relevance,desc',
    size: String(SIZE),
    page: String(page),
  });
  return `${ENDPOINT}?${p.toString()}`;
}

/** Structural counts for the silent-empty check. null means the wrapper is missing although the page says events exist. */
export function ticketmasterRowStats(raw: unknown): { rows: number; usable: number; total: number } | 'wrapper' | null {
  if (!isObj(raw)) return 'wrapper';
  const total = isObj(raw.page) ? Number(raw.page.totalElements) : NaN;
  const events = isObj(raw._embedded) ? raw._embedded.events : undefined;
  if (events === undefined) {
    // Zero matches: documented as a response with page.totalElements 0 and no _embedded.
    if (isObj(raw.page) && total === 0) return null;
    return 'wrapper';
  }
  if (!Array.isArray(events)) return 'wrapper';
  let usable = 0;
  for (const e of events) if (isObj(e) && str(e.id) && str(e.name)) usable++;
  return { rows: events.length, usable, total };
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
    const seen = new Set<string>();
    try {
      const now = new Date();
      outer: for (const segment of SEGMENTS) {
        for (let page = 0; page < PAGES; page++) {
          const res = await ctx.fetch(buildTicketmasterUrl(key, now, page, segment), {
            headers: { Accept: 'application/json', 'User-Agent': UA },
            signal: AbortSignal.timeout(15000),
          });
          const text = await res.text();
          if (!res.ok) {
            const hint = res.status === 401 || res.status === 403 ? ' (apikey invalid or missing)' : res.status === 429 ? ' (rate limit or daily quota exceeded)' : '';
            ctx.log(`error: ticketmaster HTTP ${res.status}${hint}`);
            break outer;
          }
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            ctx.log(`error: ticketmaster ${/^\s*</.test(text) ? 'returned an HTML page instead of JSON' : 'returned non-JSON text'}`);
            break outer;
          }
          if (isObj(json) && isObj(json.fault)) {
            ctx.log(`error: ticketmaster fault ${str((json.fault as Obj).faultstring) || 'unknown'}`);
            break outer;
          }
          const stats = ticketmasterRowStats(json);
          if (stats === 'wrapper') {
            const keys = isObj(json) ? Object.keys(json).slice(0, 8).join(',') : typeof json;
            ctx.log(`error: ticketmaster response has no _embedded.events array, wrapper may have changed (top-level keys: ${keys})`);
            break outer;
          }
          const parsed = parseTicketmaster(json);
          if (stats && stats.rows > 0 && parsed.length === 0) ctx.log(`error: parsed 0 of ${stats.rows} rows, shape may have changed`);
          for (const s of parsed) {
            if (seen.has(s.externalId)) continue;
            seen.add(s.externalId);
            out.push(s);
          }
          const totalPages = isObj(json) && isObj(json.page) ? Number(json.page.totalPages) : 0;
          if (!(totalPages > page + 1)) break;
        }
      }
    } catch (e) {
      ctx.log(`error: ticketmaster ${e instanceof Error ? e.message : String(e)}`);
    }
    return out;
  },
};

export const adapters: Adapter[] = [ticketmaster];
