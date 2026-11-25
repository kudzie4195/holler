import { createHash } from 'node:crypto';
import { cityBySlug, lookupPlaceByName, lookupZip } from '@/lib/geo';
import { isServedZip } from '@/lib/check/coverage';
import { metroFor } from '@/lib/geo/metros';
import { zoneFor } from '@/lib/storms/zones';
import { parseDue } from '@/lib/firecrawl/extract';
import { bidTrades } from '@/lib/signals/bid-trades';
import { cleanText, localDay, tidyBuyer } from '@/lib/signals/adapters/city-bids';
import { normalizeState } from '@/lib/signals/adapters/usaspending';
import { isCategoryId, type CategoryId } from '@/lib/signals/categories';
import type { SignalInput } from '@/lib/signals/types';
import { MANUAL_BID_SOURCE } from './flag';
import { manualPortalUrls } from './portals';

/**
 * One hand-added bid (quick-add form or one CSV row) checked and turned into a normal bid SignalInput (round 33). Server-side (the ZIP
 * dataset is large). The output has exactly the shape of the other bid sources (lib/signals/adapters/city-bids.ts, lib/firecrawl/extract.ts):
 * kind 'contract', data.subtype 'bid', title "Open bid in <city>: <title>", the buyer and due day in data, the position a place centroid
 * marked data.loc = 'approx', and the record link the agency's own public page.
 *
 * Privacy: the position is the centroid of the ZIP or city the owner typed, rounded to 3 decimals (about a block), never a street address.
 * The description is read only to pick the trade and is never stored. E-mail addresses and links are removed from the title.
 */

export interface ManualBidFields {
  url?: string;
  title?: string;
  agency?: string;
  /** "2026-12-10", "12/10/2026" or "Dec 10, 2026", optionally with a time. A date alone closes at 11:59 PM in the place's state. */
  dueDate?: string;
  /** Quick-add: a 5-digit ZIP, or "City, ST". */
  place?: string;
  zip?: string;
  city?: string;
  state?: string;
  solicitationId?: string;
  description?: string;
  /** A Holler trade id; empty means the bid trade routing decides (lib/signals/bid-trades.ts). */
  trade?: string;
}

export type ManualBidProblem =
  | 'bad_url'
  | 'no_title'
  | 'no_agency'
  | 'no_due'
  | 'bad_due'
  | 'closed'
  | 'due_far'
  | 'no_place'
  | 'outside_area'
  | 'bad_trade'
  | 'no_trade';

export const PROBLEM_TEXT: Record<ManualBidProblem | 'duplicate_in_file' | 'already_in_holler', string> = {
  bad_url: 'Link must be a full https:// address',
  no_title: 'No title',
  no_agency: 'No agency',
  no_due: 'No due date',
  bad_due: 'Due date not readable (use 2026-12-10 or 12/10/2026)',
  closed: 'Closed: the due date has passed',
  due_far: 'Due date is more than a year away (looks like a placeholder)',
  no_place: 'Place not found (use a 5-digit ZIP, or City, ST)',
  outside_area: 'Outside the areas Holler serves',
  bad_trade: 'Unknown trade',
  no_trade: 'No trade matched the title (pick a trade to add it anyway)',
  duplicate_in_file: 'Duplicate of an earlier row in this file',
  already_in_holler: 'Already in Holler (same link, or same agency and solicitation number)',
};

/** More than this far ahead is a placeholder date, as for the city bid feeds. */
export const MAX_DUE_DAYS = 365;

export interface ManualBidKeys {
  /** The link, normalized; null when the link is an agency's list page (many bids share it, so it does not identify one). */
  urlKey: string | null;
  /** agency + solicitation number, normalized; null without a number. */
  solKey: string | null;
}

export interface ManualBidReady {
  ok: true;
  signal: SignalInput;
  keys: ManualBidKeys;
  /** For the preview table. */
  view: { title: string; agency: string; dueDate: string; place: string; trades: CategoryId[]; solicitationId: string | null; url: string };
}

export type ManualBidResult = ManualBidReady | { ok: false; problem: ManualBidProblem };

export interface PlaceFound {
  zip: string | null;
  city: string;
  state: string;
  lat: number;
  lon: number;
}

export interface RecordDeps {
  now: Date;
  /** Defaults to servedPlace. */
  served?: (p: { lat: number; lon: number; state: string }) => boolean;
}

/**
 * "Inside the areas Holler serves": the app's own coverage test (lib/check/coverage.ts isServedZip: a local feed within 25 miles), or
 * inside one of Holler's metros (lib/geo/metros.ts). The metro part keeps a suburb such as Peachtree City, GA (on the owner's manual
 * list, inside the Atlanta metro, but more than 25 miles from a local feed's centre) from being refused.
 */
export function servedPlace(p: { lat: number; lon: number; state: string }): boolean {
  return isServedZip(p) || metroFor(p.lat, p.lon, p.state) !== null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

function noContactBits(t: string): string {
  return t.replace(/https?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ').replace(/\S+@\S+\.\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

function trunc(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

/** https only, a real host, no user name or password in it. Returns the link without its #fragment, or null. */
export function cleanUrl(raw: string | undefined): string | null {
  const t = (raw ?? '').trim();
  if (!t || t.length > 600 || /\s/.test(t)) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
  u.hash = '';
  return u.toString();
}

/** Comparison form of a link: host lower-cased without "www.", no trailing slash, the query kept (Bids.aspx?bidID=12 is one bid). */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

let listPages: Set<string> | null = null;
/** True for an agency's list page (the manual list's own URLs, or a bare CivicPlus Bids.aspx): many bids share it. */
export function isListPage(url: string): boolean {
  listPages ??= new Set(manualPortalUrls().map(normalizeUrl));
  const n = normalizeUrl(url);
  if (listPages.has(n)) return true;
  try {
    const u = new URL(url);
    return /\/bids\.aspx$/i.test(u.pathname) && !u.search;
  } catch {
    return false;
  }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A ZIP or a city and state to a centroid, with the app's own geo helpers. Coordinates rounded to 3 decimals. */
export function resolvePlace(f: Pick<ManualBidFields, 'place' | 'zip' | 'city' | 'state'>): PlaceFound | null {
  const placeText = (f.place ?? '').trim();
  const zipText = (f.zip ?? '').trim() || (/^\d{5}(?:-\d{4})?$/.test(placeText) ? placeText : '');
  if (zipText) {
    const z = lookupZip(zipText.slice(0, 5));
    if (z) return { zip: z.zip, city: z.city, state: z.state, lat: round3(z.lat), lon: round3(z.lon) };
    if (!f.city) return null;
  }
  let city = (f.city ?? '').trim();
  let state = (f.state ?? '').trim();
  if (!city && placeText) {
    const m = /^(.+?)[,\s]+([A-Za-z]{2}|[A-Za-z][A-Za-z ]+)$/.exec(placeText);
    if (m) {
      city = m[1].trim();
      state = m[2].trim();
    }
  }
  const st = normalizeState(state);
  if (!city || !st) return null;
  const known = cityBySlug(`${slugify(city)}-${st.toLowerCase()}`);
  if (known) return { zip: null, city: known.name, state: known.state, lat: round3(known.lat), lon: round3(known.lon) };
  const byName = lookupPlaceByName(city, st);
  if (byName) return { zip: null, city: byName.city, state: byName.state, lat: round3(byName.lat), lon: round3(byName.lon) };
  return null;
}

/** The due instant and calendar day in the place's state. Rejects impossible days (Feb 31). */
export function parseManualDue(raw: string, state: string): { iso: string; day: string } | null {
  const tz = zoneFor(state) ?? 'America/New_York';
  const due = parseDue(raw, tz);
  if (!due) return null;
  const day = localDay(due.iso, tz);
  if (!day) return null;
  const typed = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim()) ?? /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw.trim());
  if (typed) {
    const [y, m, d] = typed[0].includes('/') ? [Number(typed[3]), Number(typed[1]), Number(typed[2])] : [Number(typed[1]), Number(typed[2]), Number(typed[3])];
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  }
  return { iso: due.iso, day };
}

function idPart(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

/** Checks one hand-added bid and builds its signal. Pure apart from the geo lookup and the coverage test. */
export function buildManualBid(f: ManualBidFields, deps: RecordDeps): ManualBidResult {
  const now = deps.now;
  const url = cleanUrl(f.url);
  if (!url) return { ok: false, problem: 'bad_url' };
  const title = trunc(noContactBits(cleanText(f.title ?? '')), 140);
  if (title.length < 4) return { ok: false, problem: 'no_title' };
  const agency = trunc(tidyBuyer(noContactBits(f.agency ?? '')), 120);
  if (agency.length < 2) return { ok: false, problem: 'no_agency' };
  const dueRaw = (f.dueDate ?? '').trim();
  if (!dueRaw) return { ok: false, problem: 'no_due' };
  const place = resolvePlace(f);
  if (!place) return { ok: false, problem: 'no_place' };
  const due = parseManualDue(dueRaw, place.state);
  if (!due) return { ok: false, problem: 'bad_due' };
  const dueMs = Date.parse(due.iso);
  if (dueMs <= now.getTime()) return { ok: false, problem: 'closed' };
  if (dueMs - now.getTime() > MAX_DUE_DAYS * 86_400_000) return { ok: false, problem: 'due_far' };
  const served = deps.served ?? servedPlace;
  if (!served({ lat: place.lat, lon: place.lon, state: place.state })) return { ok: false, problem: 'outside_area' };

  const hint = (f.trade ?? '').trim();
  let trades: CategoryId[];
  if (hint) {
    if (!isCategoryId(hint)) return { ok: false, problem: 'bad_trade' };
    trades = [hint];
  } else {
    // Same routing as every bid source: the title decides; the description only adds trades the title's own filters allow.
    trades = bidTrades({ title, description: f.description ? cleanText(f.description).slice(0, 2000) : null });
    if (trades.length === 0) return { ok: false, problem: 'no_trade' };
  }

  const solicitationId = trunc(cleanText(f.solicitationId ?? ''), 60) || null;
  const list = isListPage(url);
  const urlKey = list ? null : normalizeUrl(url);
  const agencyKey = norm(agency).slice(0, 60);
  const solKey = solicitationId && norm(solicitationId).length >= 2 ? `${agencyKey}|${norm(solicitationId)}` : null;
  const externalId = solKey
    ? `manual:${agencyKey}:${norm(solicitationId as string).slice(0, 60)}`
    : urlKey
      ? `manual:u:${idPart(urlKey)}`
      : `manual:l:${idPart(`${normalizeUrl(url)}|${norm(title)}|${due.day}`)}`;
  const tz = zoneFor(place.state) ?? 'America/New_York';
  const summary = trunc([agency, solicitationId ?? '', `due ${due.day}`].filter(Boolean).join(' | '), 280);
  const signal: SignalInput = {
    source: MANUAL_BID_SOURCE,
    externalId,
    kind: 'contract',
    title: `Open bid in ${place.city}: ${title}`,
    summary,
    url,
    lat: place.lat,
    lon: place.lon,
    city: place.city,
    state: place.state,
    zip: place.zip,
    categories: trades,
    severity: 2,
    occurredAt: now.toISOString(),
    expiresAt: due.iso,
    data: {
      subtype: 'bid',
      domain: new URL(url).hostname,
      solicitationId,
      buyer: agency,
      dueDate: due.day,
      noDueDate: false,
      linkKind: list ? 'list' : 'solicitation',
      tz,
      // The position is the ZIP or city centroid, not a job site: the matcher reads radius + 15 miles and no screen shows a distance.
      loc: 'approx',
      approxLocation: true,
      via: 'manual',
      ...(hint ? { tradeHint: hint } : {}),
    },
  };
  return {
    ok: true,
    signal,
    keys: { urlKey, solKey },
    view: { title, agency, dueDate: due.day, place: `${place.city}, ${place.state}${place.zip ? ` ${place.zip}` : ''}`, trades, solicitationId, url },
  };
}
