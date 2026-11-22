import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { credentials, dfsCall, estimateUsd, PRICE_TABLE, type DfsDeps } from '@/lib/dataforseo/client';
import { foldName, isOrganisationName } from '@/lib/contacts/org';
import { plainWebsite, usPhone } from '@/lib/contacts/sanitize';
import type { ContactRecord, ListingInfo } from '@/lib/contacts/types';
import { CITIES, haversineMi, lookupZip, stateByCode } from '@/lib/geo';

/**
 * Business phone and website from public listings (round 18, unit LOOKUP).
 *
 * A card can name a business (a contractor on a permit, a business on a licence, an awardee) without a phone or website. For the cards
 * that are about to be emailed, this module looks the business up ONCE by name near the record's city on DataForSEO's Business Listings
 * search, accepts a listing only when it is clearly the same business in the same place, and caches the answer.
 *
 * Endpoint (sourced, https://docs.dataforseo.com/v3/business_data/business_listings/search/live/): POST
 * /v3/business_data/business_listings/search/live with one task { title, location_coordinate: "lat,lon,radius_km", limit }. Fields read
 * from tasks[0].result[0].items[]: title, phone, url, domain, address_info.city, address_info.region, address_info.country_code,
 * latitude, longitude. Price (sourced, https://dataforseo.com/pricing/business-data/business-listings-api): $0.012 per request plus
 * $0.00036 per returned item, so one lookup with limit 10 is at most $0.0156. The real cost from the response is what is booked.
 * How the API matches `title` (exact or full text) is NOT documented, so every candidate is checked here and the API's ranking is not
 * trusted.
 *
 * Safety rules (on any doubt the answer is "not found": a wrong phone number is worse than none):
 *  - only a name the business classifier accepts (lib/contacts/org.ts isOrganisationName) is ever looked up, and only for roles
 *    business, contractor and awardee; a person's name, a public buyer and a site address never are;
 *  - names: lower case, accents folded, "&" read as "and", legal forms (LLC, Inc, Corp, Co ...) and "the", "and", "of" dropped. The query
 *    needs at least 2 words left. A listing word that is only the city or state name is ignored. Score: Dice coefficient of the two word
 *    sets, 2|A n B| / (|A| + |B|); accepted at NAME_MATCH_THRESHOLD (0.88) or above. In practice the word sets must be equal, unless both
 *    names have 4+ words and differ by one extra word ("Smith Brothers Roofing Contractors" / "Smith Brothers Roofing" is 0.857: refused);
 *  - place: the listing must not be outside the US or in another state (when it says), and must be either in the same city (and, when it
 *    has coordinates, within SAME_CITY_MAX_KM of the city centre) or within MAX_DISTANCE_KM of the city centre;
 *  - two or more accepted listings with different phones or websites: ambiguous, not found;
 *  - the phone must be a valid US number and the website an http(s) address with a real host, else that field is dropped; a listing with
 *    neither is not found.
 *
 * Spend: every call goes through lib/dataforseo/client.ts dfsCall, which books it in holler_dataforseo_spend under the existing monthly cap
 * (DATAFORSEO_MONTHLY_CAP_USD). On top: at most HOLLER_LOOKUP_MAX_PER_RUN calls per notify run (default 5) and HOLLER_LOOKUP_MAX_PER_DAY
 * calls per UTC day (default 25, counted from today's ledger rows for this endpoint). HOLLER_LOOKUP_DRY_RUN=1 makes no call at all.
 * Without DataForSEO credentials, with a cap reached, or without migration 0026 (the cache table), no call is made and cards are unchanged.
 * Credentials are never logged, stored or returned (dfsCall holds them; nothing here reads them except to test that both are set).
 */

type Db = SupabaseClient;

export const LOOKUP_TABLE = 'holler_business_lookup';
export const LOOKUP_KIND = 'businessListingsSearch' as const;
export const LOOKUP_PATH = PRICE_TABLE.businessListingsSearch.path;
/** Items asked for per lookup. A small number: the name is checked here, and every returned item is billed. */
export const LOOKUP_LIMIT = 10;
/** Search radius sent to the API, km. */
export const SEARCH_RADIUS_KM = 25;
/** A listing outside the record's city is accepted only within this distance of the city centre, km. */
export const MAX_DISTANCE_KM = 25;
/** A listing in the record's city (same name) that has coordinates must still be within this distance of the city centre, km. */
export const SAME_CITY_MAX_KM = 50;
export const NAME_MATCH_THRESHOLD = 0.88;
export const MIN_NAME_TOKENS = 2;
export const FOUND_TTL_DAYS = 90;
export const NOT_FOUND_TTL_DAYS = 30;
export const DEFAULT_MAX_PER_RUN = 5;
export const DEFAULT_MAX_PER_DAY = 25;
/** Roles that name a business that may have a public listing. Never 'buyer' (a public office) and never 'site' (an address). */
export const LOOKUP_ROLES: ReadonlySet<string> = new Set(['business', 'contractor', 'awardee']);

const DAY_MS = 86_400_000;
const KM_PER_MI = 1.609344;

// ---- names ----------------------------------------------------------------------------------------------------------------------------

/** Words that never tell two businesses apart: legal forms, articles and joiners. */
const IGNORED_WORDS = new Set([
  'llc', 'lc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'lp', 'llp', 'lllp', 'pllc', 'pc', 'pa',
  'plc', 'the', 'and', 'of',
]);

/** Name words: folded, lower case, "&" as "and", apostrophes and periods removed ("L.L.C." -> "llc", "Joe's" -> "joes"). */
function words(raw: string): string[] {
  return foldName(raw)
    .replace(/&/g, ' and ')
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** The distinctive words of a business name, in order. */
export function nameTokens(raw: string): string[] {
  return words(raw).filter((w) => !IGNORED_WORDS.has(w));
}

/** Cache key of a name: its distinctive words joined by one space. Null when nothing is left. */
export function nameKey(raw: string): string | null {
  const t = nameTokens(raw);
  return t.length > 0 ? t.join(' ').slice(0, 120) : null;
}

/** Cache key of a city: folded, lower case, single spaces. */
export function cityKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const k = words(raw).join(' ');
  return k ? k.slice(0, 80) : null;
}

/** A 2-letter state code in upper case, or null. */
export function stateCode(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) && stateByCode(s) ? s : null;
}

/**
 * Name similarity, 0 to 1: the Dice coefficient of the two distinctive word sets. Words of the listing that are only part of the place
 * (city or state name or code) and do not occur in the query are ignored ("Acme Roofing Atlanta" vs "Acme Roofing").
 */
export function nameScore(query: string, listing: string, place: { city?: string | null; state?: string | null } = {}): number {
  const a = new Set(nameTokens(query));
  const placeWords = new Set([...words(place.city ?? ''), ...words(place.state ?? ''), ...words(stateByCode(place.state ?? '')?.name ?? '')]);
  const b = new Set(nameTokens(listing).filter((w) => a.has(w) || !placeWords.has(w)));
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return (2 * common) / (a.size + b.size);
}

export function namesMatch(query: string, listing: string, place: { city?: string | null; state?: string | null } = {}): boolean {
  return nameScore(query, listing, place) >= NAME_MATCH_THRESHOLD - 1e-9;
}

// ---- place ----------------------------------------------------------------------------------------------------------------------------

export interface LookupPlace {
  city: string;
  state: string;
  lat: number;
  lon: number;
}

/** The city centre for a lookup: the city list by name and state, else the ZIP code's point. Null when neither is known. */
export function resolvePlace(city: string | null | undefined, state: string | null | undefined, zip?: string | null): LookupPlace | null {
  const st = stateCode(state);
  const ck = cityKey(city);
  if (!st || !ck || typeof city !== 'string') return null;
  const hit = CITIES.find((c) => c.state === st && cityKey(c.name) === ck);
  if (hit) return { city: city.trim(), state: st, lat: hit.lat, lon: hit.lon };
  const z = typeof zip === 'string' ? zip.trim().slice(0, 5) : '';
  if (/^\d{5}$/.test(z)) {
    const info = lookupZip(z);
    if (info && info.state === st && cityKey(info.city) === ck) return { city: city.trim(), state: st, lat: info.lat, lon: info.lon };
  }
  return null;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineMi(lat1, lon1, lat2, lon2) * KM_PER_MI;
}

// ---- response parser ------------------------------------------------------------------------------------------------------------------

/** One listing as read from the documented item fields. Everything else in the item is ignored. */
export interface ListingItem {
  title: string;
  phone: string | null;
  url: string | null;
  domain: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Items of a Business Listings search task (dfsCall's task): task.result[0].items[]. Anything not shaped like the documented response
 * gives an empty list, which reads as "not found".
 */
export function parseListingItems(task: { result?: unknown } | null | undefined): ListingItem[] {
  const result = task && Array.isArray(task.result) ? task.result : [];
  const out: ListingItem[] = [];
  for (const r of result) {
    const items = r && typeof r === 'object' && Array.isArray((r as { items?: unknown }).items) ? (r as { items: unknown[] }).items : [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const title = str(o.title);
      if (!title) continue;
      const ai = o.address_info && typeof o.address_info === 'object' ? (o.address_info as Record<string, unknown>) : {};
      out.push({
        title,
        phone: str(o.phone),
        url: str(o.url),
        domain: str(o.domain),
        city: str(ai.city),
        region: str(ai.region),
        countryCode: str(ai.country_code),
        lat: fin(o.latitude),
        lon: fin(o.longitude),
      });
      if (out.length >= 100) return out;
    }
  }
  return out;
}

/** True when the listing is in the place: same country and state when it says, then same city or close to the city centre. */
export function placeMatches(item: ListingItem, place: LookupPlace): boolean {
  if (item.countryCode && item.countryCode.toUpperCase() !== 'US') return false;
  if (item.region) {
    const r = item.region.trim().toUpperCase();
    const name = stateByCode(place.state)?.name.toUpperCase();
    if (r !== place.state && r !== name) return false;
  }
  const hasPoint = item.lat !== null && item.lon !== null;
  const km = hasPoint ? distanceKm(place.lat, place.lon, item.lat!, item.lon!) : null;
  if (item.city && cityKey(item.city) === cityKey(place.city)) return km === null || km <= SAME_CITY_MAX_KM;
  return km !== null && km <= MAX_DISTANCE_KM;
}

export interface ListingChoice {
  listing: ListingInfo & { name: string };
  candidates: number;
}

/**
 * The one listing to attach, or null. Candidates must pass the name and place checks; two candidates that disagree on the phone or the
 * website make it ambiguous (null). The chosen listing needs a valid US phone or an http(s) website.
 */
export function chooseListing(name: string, place: LookupPlace, items: readonly ListingItem[]): { choice: ListingChoice | null; reason: string } {
  const ok = items.filter((it) => namesMatch(name, it.title, place) && placeMatches(it, place));
  if (ok.length === 0) return { choice: null, reason: items.length === 0 ? 'no_listing' : 'no_match' };
  const cleaned = ok.map((it) => ({ it, phone: usPhone(it.phone), website: plainWebsite(it.url ?? it.domain) }));
  const phones = new Set(cleaned.map((c) => c.phone).filter(Boolean));
  const hosts = new Set(cleaned.map((c) => (c.website ? new URL(c.website).hostname.replace(/^www\./, '') : null)).filter(Boolean));
  if (phones.size > 1 || hosts.size > 1) return { choice: null, reason: 'ambiguous' };
  const best = cleaned.find((c) => c.phone || c.website);
  if (!best) return { choice: null, reason: 'no_contact_detail' };
  return {
    choice: { listing: { phone: best.phone, website: best.website, name: best.it.title.slice(0, 200) }, candidates: ok.length },
    reason: 'found',
  };
}

// ---- cache ----------------------------------------------------------------------------------------------------------------------------

/** Table missing (PostgREST PGRST205, Postgres 42P01) or a column missing (PGRST204, 42703): migration 0026 is not applied. */
export function isMissingCache(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && ['PGRST205', '42P01', 'PGRST204', '42703'].includes(e.code)) return true;
  return typeof e.message === 'string' && /holler_business_lookup/.test(e.message) && /does not exist|schema cache|could not find/i.test(e.message);
}

export interface CacheEntry {
  status: 'found' | 'not_found';
  listing: (ListingInfo & { name: string | null }) | null;
  checkedAt: string;
}

interface CacheRow {
  name_key?: unknown;
  city_key?: unknown;
  state?: unknown;
  status?: unknown;
  phone?: unknown;
  website?: unknown;
  listing_name?: unknown;
  checked_at?: unknown;
}

/** A stored row as an entry, or null when it is malformed or stale (found: 90 days, not_found: 30 days). */
function entryOf(r: CacheRow, nowMs: number): CacheEntry | null {
  if (!r || (r.status !== 'found' && r.status !== 'not_found') || typeof r.checked_at !== 'string') return null;
  const at = Date.parse(r.checked_at);
  if (!Number.isFinite(at)) return null;
  const ttl = (r.status === 'found' ? FOUND_TTL_DAYS : NOT_FOUND_TTL_DAYS) * DAY_MS;
  if (nowMs - at > ttl || at - nowMs > DAY_MS) return null;
  if (r.status === 'not_found') return { status: 'not_found', listing: null, checkedAt: r.checked_at };
  const phone = usPhone(r.phone);
  const website = plainWebsite(r.website);
  if (!phone && !website) return null;
  return { status: 'found', listing: { phone, website, name: typeof r.listing_name === 'string' ? r.listing_name : null }, checkedAt: r.checked_at };
}

const CACHE_COLUMNS = 'name_key, city_key, state, status, phone, website, listing_name, checked_at';

type CacheRead = { state: 'hit'; entry: CacheEntry } | { state: 'miss' } | { state: 'off' } | { state: 'error' };

export async function readCache(db: Db, key: { name: string; city: string; state: string }, now: Date): Promise<CacheRead> {
  try {
    const { data, error } = await db
      .from(LOOKUP_TABLE)
      .select(CACHE_COLUMNS)
      .eq('name_key', key.name)
      .eq('city_key', key.city)
      .eq('state', key.state)
      .limit(1);
    if (error) return isMissingCache(error) ? { state: 'off' } : { state: 'error' };
    const row = Array.isArray(data) ? (data[0] as CacheRow | undefined) : undefined;
    const entry = row ? entryOf(row, now.getTime()) : null;
    return entry ? { state: 'hit', entry } : { state: 'miss' };
  } catch {
    return { state: 'error' };
  }
}

async function writeCache(
  db: Db,
  key: { name: string; city: string; state: string },
  value: { status: 'found'; listing: ListingInfo & { name: string } } | { status: 'not_found' },
  costUsd: number,
  now: Date,
): Promise<boolean> {
  const row = {
    name_key: key.name,
    city_key: key.city,
    state: key.state,
    status: value.status,
    phone: value.status === 'found' ? value.listing.phone : null,
    website: value.status === 'found' ? value.listing.website : null,
    listing_name: value.status === 'found' ? value.listing.name : null,
    cost_usd: Math.max(0, Math.round(costUsd * 100_000) / 100_000),
    checked_at: now.toISOString(),
  };
  try {
    const { error } = await db.from(LOOKUP_TABLE).upsert([row], { onConflict: 'name_key,city_key,state' });
    if (error) {
      console.error('[lookup] cache write failed', typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'unknown');
      return false;
    }
    return true;
  } catch {
    console.error('[lookup] cache write failed', 'exception');
    return false;
  }
}

// ---- settings and budget --------------------------------------------------------------------------------------------------------------

function intEnv(raw: string | undefined, fallback: number): number {
  const s = raw?.trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export interface LookupSettings {
  maxPerRun: number;
  maxPerDay: number;
  dryRun: boolean;
  /** Both DataForSEO credentials are set. The values themselves never leave lib/dataforseo/client.ts. */
  configured: boolean;
}

export function lookupSettings(env: Record<string, string | undefined> = process.env): LookupSettings {
  return {
    maxPerRun: intEnv(env.HOLLER_LOOKUP_MAX_PER_RUN, DEFAULT_MAX_PER_RUN),
    maxPerDay: intEnv(env.HOLLER_LOOKUP_MAX_PER_DAY, DEFAULT_MAX_PER_DAY),
    dryRun: ['1', 'true', 'on', 'yes'].includes((env.HOLLER_LOOKUP_DRY_RUN ?? '').trim().toLowerCase()),
    configured: credentials(env) !== null,
  };
}

/** Per-run counters. One budget per notify run; the day count is read once, on the first call that needs it. */
export interface LookupBudget {
  runLeft: number;
  maxPerDay: number;
  usedToday: number | null;
  calls: number;
  spentUsd: number;
  found: number;
  notFound: number;
  cacheHits: number;
  skipped: Record<string, number>;
}

export function newBudget(settings: Pick<LookupSettings, 'maxPerRun' | 'maxPerDay'>): LookupBudget {
  return { runLeft: settings.maxPerRun, maxPerDay: settings.maxPerDay, usedToday: null, calls: 0, spentUsd: 0, found: 0, notFound: 0, cacheHits: 0, skipped: {} };
}

/** Lookup calls booked today (UTC) in the DataForSEO ledger, refused reservations excluded. Read at most maxPerDay + 1 rows. Null on error. */
export async function lookupsToday(db: Db, now: Date, maxPerDay: number): Promise<number | null> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  try {
    const { data, error } = await db
      .from('holler_dataforseo_spend')
      .select('id')
      .eq('endpoint', LOOKUP_PATH)
      .gte('created_at', dayStart)
      .neq('status', 'refused')
      .limit(maxPerDay + 1);
    if (error || !Array.isArray(data)) return null;
    return data.length;
  } catch {
    return null;
  }
}

// ---- lookup ---------------------------------------------------------------------------------------------------------------------------

export type SkipReason =
  | 'not_business'
  | 'short_name'
  | 'no_place'
  | 'no_database'
  | 'cache_missing'
  | 'cache_error'
  | 'not_configured'
  | 'dry_run'
  | 'run_cap'
  | 'day_cap'
  | 'spend_unavailable'
  | 'cap_reached'
  | 'api_error';

export type LookupOutcome =
  | { status: 'found'; source: 'cache' | 'api'; listing: ListingInfo & { name: string | null }; costUsd: number; candidates?: number }
  | { status: 'not_found'; source: 'cache' | 'api'; costUsd: number; reason?: string }
  | { status: 'skipped'; reason: SkipReason; estimateUsd?: number; request?: Record<string, unknown> };

export interface LookupInput {
  name: string;
  city: string | null | undefined;
  state: string | null | undefined;
  zip?: string | null;
}

export interface LookupDeps {
  /** Service-role client; null means no database (nothing is looked up). */
  db: Db | null;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface LookupOptions {
  /** Shared per-run counters (the notify run). Absent: a single lookup that is still held to the per-day cap. */
  budget?: LookupBudget;
  /** The owner probe: skip the cache read and write nothing but the ledger row. */
  probe?: boolean;
  /** No call at all (also when HOLLER_LOOKUP_DRY_RUN is set). */
  dryRun?: boolean;
}

export const ESTIMATE_PER_LOOKUP_USD = estimateUsd(LOOKUP_KIND, LOOKUP_LIMIT);

/** The task body sent for one lookup. Public so the probe can show it on a dry run. */
export function lookupRequest(name: string, place: LookupPlace): Record<string, unknown> {
  return {
    title: name.slice(0, 200),
    location_coordinate: `${place.lat.toFixed(7).replace(/0+$/, '').replace(/\.$/, '')},${place.lon.toFixed(7).replace(/0+$/, '').replace(/\.$/, '')},${SEARCH_RADIUS_KM}`,
    limit: LOOKUP_LIMIT,
  };
}

function skip(budget: LookupBudget | undefined, reason: SkipReason, extra: Partial<Extract<LookupOutcome, { status: 'skipped' }>> = {}): LookupOutcome {
  if (budget) budget.skipped[reason] = (budget.skipped[reason] ?? 0) + 1;
  return { status: 'skipped', reason, ...extra };
}

/**
 * Looks up one business. Never throws. Order: classifier, name, place, cache (unless probe), credentials, dry run, run and day caps, then
 * ONE call through dfsCall (monthly cap and ledger). A found or not-found answer from a call is cached (unless probe).
 */
export async function lookupBusiness(input: LookupInput, deps: LookupDeps, opts: LookupOptions = {}): Promise<LookupOutcome> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const budget = opts.budget;
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  // Never a person: only a name the business classifier accepts is ever sent anywhere.
  if (!name || !isOrganisationName(name)) return skip(budget, 'not_business');
  const nk = nameKey(name);
  if (!nk || nameTokens(name).length < MIN_NAME_TOKENS) return skip(budget, 'short_name');
  const place = resolvePlace(input.city, input.state, input.zip);
  const ck = cityKey(place?.city);
  if (!place || !ck) return skip(budget, 'no_place');
  const key = { name: nk, city: ck, state: place.state };
  const db = deps.db;
  if (!db) return skip(budget, 'no_database');

  if (!opts.probe) {
    const cached = await readCache(db, key, now);
    if (cached.state === 'off') return skip(budget, 'cache_missing');
    if (cached.state === 'error') return skip(budget, 'cache_error');
    if (cached.state === 'hit') {
      if (budget) budget.cacheHits++;
      return cached.entry.status === 'found' && cached.entry.listing
        ? { status: 'found', source: 'cache', listing: cached.entry.listing, costUsd: 0 }
        : { status: 'not_found', source: 'cache', costUsd: 0 };
    }
  }

  const settings = lookupSettings(env);
  if (!settings.configured) return skip(budget, 'not_configured');
  const request = lookupRequest(name, place);
  if (opts.dryRun || settings.dryRun) return skip(budget, 'dry_run', { estimateUsd: ESTIMATE_PER_LOOKUP_USD, request });

  if (budget && budget.runLeft <= 0) return skip(budget, 'run_cap');
  const maxPerDay = budget?.maxPerDay ?? settings.maxPerDay;
  let usedToday = budget?.usedToday ?? null;
  if (usedToday === null) {
    usedToday = await lookupsToday(db, now, maxPerDay);
    if (usedToday === null) return skip(budget, 'spend_unavailable');
    if (budget) budget.usedToday = usedToday;
  }
  if (usedToday >= maxPerDay) return skip(budget, 'day_cap');

  const dfsDeps: DfsDeps = { db, env, now: () => now, timeoutMs: deps.timeoutMs ?? 15_000 };
  if (deps.fetch) dfsDeps.fetch = deps.fetch;
  if (deps.sleep) dfsDeps.sleep = deps.sleep;
  const res = await dfsCall(LOOKUP_PATH, request, { kind: LOOKUP_KIND, items: LOOKUP_LIMIT }, dfsDeps);
  if (!res.ok) {
    if (res.reason === 'not_configured') return skip(budget, 'not_configured');
    if (res.reason === 'cap_reached') return skip(budget, 'cap_reached');
    if (res.reason === 'spend_unavailable') return skip(budget, 'spend_unavailable');
    // A failed call may still have been booked by dfsCall; count it against the caps.
    if (budget) {
      budget.runLeft--;
      budget.usedToday = (budget.usedToday ?? 0) + 1;
      budget.calls++;
    }
    return skip(budget, 'api_error');
  }
  if (budget) {
    budget.runLeft--;
    budget.usedToday = (budget.usedToday ?? 0) + 1;
    budget.calls++;
    budget.spentUsd = Math.round((budget.spentUsd + res.cost) * 100_000) / 100_000;
  }
  const { choice, reason } = chooseListing(name, place, parseListingItems(res.task));
  if (!choice) {
    if (budget) budget.notFound++;
    if (!opts.probe) await writeCache(db, key, { status: 'not_found' }, res.cost, now);
    return { status: 'not_found', source: 'api', costUsd: res.cost, reason };
  }
  if (budget) budget.found++;
  if (!opts.probe) await writeCache(db, key, { status: 'found', listing: choice.listing }, res.cost, now);
  return { status: 'found', source: 'api', listing: choice.listing, costUsd: res.cost, candidates: choice.candidates };
}

// ---- contacts -------------------------------------------------------------------------------------------------------------------------

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * True when this contact may get a listing: a business, contractor or awardee whose name the classifier accepts, and that has neither a
 * phone nor a website of its own on the record.
 */
export function mayLookUp(c: Pick<ContactRecord, 'role' | 'name' | 'phone' | 'website'> | null | undefined): boolean {
  if (!c || !LOOKUP_ROLES.has(c.role)) return false;
  if (clean(c.phone) || clean(c.website)) return false;
  const name = clean(c.name);
  return !!name && isOrganisationName(name);
}

/** The place a contact is looked up in: its own city and state when the record gives both, else the record's. */
export function lookupPlaceOf(c: Pick<ContactRecord, 'city' | 'state' | 'zip'>, signal: { city?: string | null; state?: string | null } | undefined): { city: string | null; state: string | null; zip: string | null } {
  if (clean(c.city) && clean(c.state)) return { city: clean(c.city), state: clean(c.state), zip: clean(c.zip) || null };
  return { city: clean(signal?.city) || null, state: clean(signal?.state) || null, zip: null };
}

export type SignalPlaces = ReadonlyMap<number, { city?: string | null; state?: string | null }>;

/**
 * Display side (no call ever): attaches a fresh cached "found" listing to each eligible contact. Any error, a missing table (0026 not
 * applied) or a contact that fails mayLookUp leaves the contact exactly as it was. Returns a new map; the input is not changed.
 */
export async function attachCachedListings(
  db: Db | null | undefined,
  contacts: ReadonlyMap<number, ContactRecord[]>,
  places: SignalPlaces,
  now: Date = new Date(),
): Promise<Map<number, ContactRecord[]>> {
  const out = new Map(contacts);
  if (!db) return out;
  const wanted: { signalId: number; idx: number; key: { name: string; city: string; state: string } }[] = [];
  for (const [signalId, list] of contacts) {
    if (!Array.isArray(list)) continue;
    list.forEach((c, idx) => {
      if (!mayLookUp(c) || c.listing) return;
      const p = lookupPlaceOf(c, places.get(signalId));
      const nk = nameKey(clean(c.name));
      const ck = cityKey(p.city);
      const st = stateCode(p.state);
      if (nk && ck && st) wanted.push({ signalId, idx, key: { name: nk, city: ck, state: st } });
    });
  }
  if (wanted.length === 0) return out;
  try {
    const names = [...new Set(wanted.map((w) => w.key.name))].slice(0, 100);
    const { data, error } = await db.from(LOOKUP_TABLE).select(CACHE_COLUMNS).in('name_key', names).limit(500);
    if (error || !Array.isArray(data)) return out;
    const byKey = new Map<string, CacheEntry>();
    for (const r of data as CacheRow[]) {
      if (!r || typeof r.name_key !== 'string' || typeof r.city_key !== 'string' || typeof r.state !== 'string') continue;
      const e = entryOf(r, now.getTime());
      if (e && e.status === 'found' && e.listing) byKey.set(`${r.name_key}|${r.city_key}|${r.state}`, e);
    }
    for (const w of wanted) {
      const e = byKey.get(`${w.key.name}|${w.key.city}|${w.key.state}`);
      if (!e || !e.listing) continue;
      const list = [...(out.get(w.signalId) ?? [])];
      list[w.idx] = { ...list[w.idx], listing: { phone: e.listing.phone, website: e.listing.website } };
      out.set(w.signalId, list);
    }
  } catch {
    return new Map(contacts);
  }
  return out;
}

export interface CardForLookup {
  signalId: number;
  city?: string | null;
  state?: string | null;
  /** The contact the card and the email name first (lib/outreach/plan.ts namedContact). */
  contact: ContactRecord | null;
}

/**
 * Notify side: for the cards about to be emailed, in order, looks up the named contact when it may be looked up and has no listing yet,
 * within the budget. Returns the contacts map with any found listing attached (a new map; the input is not changed). Without credentials,
 * with both caps at 0 or with no database it returns at once: no read, no call.
 */
export async function lookupForCards(
  contacts: ReadonlyMap<number, ContactRecord[]>,
  cards: readonly CardForLookup[],
  budget: LookupBudget,
  deps: LookupDeps,
): Promise<Map<number, ContactRecord[]>> {
  const out = new Map(contacts);
  const settings = lookupSettings(deps.env ?? process.env);
  if (!settings.configured || !deps.db || budget.runLeft <= 0 || budget.maxPerDay <= 0) return out;
  for (const card of cards) {
    const c = card.contact;
    if (!c || c.signalId !== card.signalId || c.listing || !mayLookUp(c)) continue;
    if (budget.runLeft <= 0 || budget.skipped.cache_missing || budget.skipped.day_cap || budget.skipped.cap_reached || budget.skipped.spend_unavailable) break;
    const p = lookupPlaceOf(c, card);
    const r = await lookupBusiness({ name: c.name, city: p.city, state: p.state, zip: p.zip }, deps, { budget });
    if (r.status !== 'found') continue;
    const list = out.get(card.signalId);
    if (!Array.isArray(list)) continue;
    const listing: ListingInfo = { phone: r.listing.phone, website: r.listing.website };
    out.set(card.signalId, list.map((x) => (x === c ? { ...x, listing } : x)));
  }
  return out;
}
