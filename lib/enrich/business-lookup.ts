import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { credentials, dfsCall, estimateUsd, monthKey, monthlyCapUsd, monthSpendUsd, PRICE_TABLE, type DfsDeps } from '@/lib/dataforseo/client';
import { foldName, isOrganisationName } from '@/lib/contacts/org';
import { usPhone } from '@/lib/contacts/sanitize';
import type { ContactRecord, ListingInfo } from '@/lib/contacts/types';
import { safeWebsite } from '@/lib/outreach/links';
import { CITIES, haversineMi, lookupZip, stateByCode } from '@/lib/geo';

/**
 * Business phone and website from public listings (round 18, unit LOOKUP; redo 1 and redo 2 after review).
 *
 * A card can name a business (a contractor on a permit, a business on a licence or inspection) without a phone or website. For the cards
 * that are about to be emailed, this module looks the business up ONCE on DataForSEO's Business Listings search, accepts a listing only
 * when it is plainly the same business in the right place, and caches the answer. Federal awardees are not looked up: the award record
 * stores no recipient address.
 *
 * Endpoint (sourced, https://docs.dataforseo.com/v3/business_data/business_listings/search/live/): POST
 * /v3/business_data/business_listings/search/live with one task { title, location_coordinate: "lat,lon,radius_km", limit }. Read from
 * tasks[0].result[0]: total_count ("total number of results in our database relevant to your request") and items[] with title, phone, url,
 * domain, address, address_info.address ("street address"), address_info.city, address_info.zip ("ZIP code of the business entity"),
 * address_info.country_code, latitude, longitude and work_time.work_hours.current_status ("current status of the establishment": open,
 * close, temporarily_closed, closed_forever). address_info.region is a "DMA region" (a media market, not a state) and is never read.
 * Price (sourced, https://dataforseo.com/pricing/business-data/business-listings-api): $0.012 per request plus $0.00036 per returned item;
 * limit 20 is at most $0.0192. How the API matches `title` is NOT documented (the sample "pizza" returns "Pizza Mate"). If it matches any
 * word, every answer is cut by the page limit and refused as truncated: such answers are cached for 7 days, and a daily circuit breaker
 * stops all lookups for the UTC day when its first 5 answers hold no found listing (the health email and the notify JSON then say "Business
 * lookups returned no usable match today (N tried). Run the lookup probe.").
 *
 * Where the business is (lookupInputFor): a contractor's own ZIP (searched there, 25 km), else its own city and state, else, when the
 * record gives no place for it, the job city (25 km); another state with no city or ZIP is not looked up. A business on a licence or
 * inspection is at its site: the record's site ZIP and street line are required, the search is 5 km round that ZIP, and a listing is
 * accepted only with the same ZIP and the same street address (house number and normalised street words).
 *
 * Accepting a listing (on any doubt nothing: a wrong phone number is worse than none):
 *  - name: never a person (lib/contacts/org.ts isOrganisationName), never a placeholder ("TBD", "Owner", "Self", "N/A"...) and never generic
 *    (every word a trade, shop or descriptor word or a place word: "General Contractor", "Home Daycare", "Coin Laundry", "Currency
 *    Exchange", "Atlanta Roofing"). A listing matches only when its word set EQUALS the query's after trailing legal forms are removed;
 *  - closed (temporarily or for good) listings never count as a match;
 *  - ambiguity: more than one open same-named listing is refused unless all carry the same phone AND the same website host; a phone that
 *    is also on another-named listing in the same answer is refused; an answer cut by the page limit is refused (truncated);
 *  - place: the listing's state comes from its ZIP (address_info.zip, else a "ST 12345" ending of `address`) and must equal the lookup's;
 *    the listing must be within the radius (by its point, else by its ZIP's point); for a site, the same ZIP and street address;
 *  - the phone must be a valid US number and the website a https-able host (the card's own check); a listing with neither is not found.
 *
 * Spend and time: every call goes through lib/dataforseo/client.ts dfsCall (one request, no retry), booked in holler_dataforseo_spend under
 * the monthly cap (DATAFORSEO_MONTHLY_CAP_USD). The daily cap (HOLLER_LOOKUP_MAX_PER_DAY, default 25) is admitted against the ledger rows
 * booked today up to the call's own reservation, so overlapping runs stay at the cap except when inserts commit out of id order (then at
 * most 3 x the overlapping runs minus 1 over). At most HOLLER_LOOKUP_MAX_PER_RUN calls per notify run (default 5), one per business, 3 at a
 * time, inside one deadline per run (LOOKUP_RUN_BUDGET_MS); each call times out after LOOKUP_CALL_TIMEOUT_MS. A 'retry' row is written
 * before each call, so a call that times out or fails is not repeated for 6 hours. HOLLER_LOOKUP_DRY_RUN=1 makes no call. Without
 * credentials, with a cap reached or without migration 0026 the alert run makes no call and cards are unchanged. Credentials are never
 * logged, stored or returned.
 */

type Db = SupabaseClient;

export const LOOKUP_TABLE = 'holler_business_lookup';
export const LOOKUP_KIND = 'businessListingsSearch' as const;
export const LOOKUP_PATH = PRICE_TABLE.businessListingsSearch.path;
/**
 * Items asked for per lookup. Every returned item is billed ($0.00036), but a result cut by the limit is refused (total_count), so a page of
 * 20 refuses fewer real matches than 10 for at most $0.0036 more per call.
 */
export const LOOKUP_LIMIT = 20;
/** Search radius and acceptance distance, km, for a contractor or awardee. */
export const MAX_DISTANCE_KM = 25;
/** Search radius and acceptance distance, km, for a business at its site (licence, inspection). */
export const SITE_DISTANCE_KM = 5;
export const MIN_NAME_TOKENS = 2;
export const FOUND_TTL_DAYS = 90;
export const NOT_FOUND_TTL_DAYS = 30;
export const RETRY_TTL_HOURS = 6;
/** A result cut by the page limit (total_count larger than the items read) is not asked again for 7 days (review 2, decision 4a). */
export const TRUNCATED_TTL_DAYS = 7;
/** Circuit breaker (decision 4b): when the first BREAKER_SAMPLE answers of a UTC day hold no usable match, no lookup runs that day. */
export const BREAKER_SAMPLE = 5;
/** A cache row dated further than this in the future (a wrong clock) is ignored. */
const FUTURE_SKEW_MS = 10 * 60_000;
export const DEFAULT_MAX_PER_RUN = 5;
export const DEFAULT_MAX_PER_DAY = 25;
/**
 * Time. The notify route has maxDuration 60 s, stops starting members at 50 s and gives push until 56 s; each member's email is one Resend
 * call (well under a second). Lookups get 6 s in TOTAL per run (about a tenth of the run), each call at most 3 s (the documented sample
 * answered in 0.33 s), at most 3 in parallel, and none starts after 30 s into the run, so a slow DataForSEO can never push an email or the
 * push step past the platform limit.
 */
export const LOOKUP_RUN_BUDGET_MS = 6_000;
export const LOOKUP_CALL_TIMEOUT_MS = 3_000;
export const LOOKUP_START_CUTOFF_MS = 30_000;
export const LOOKUP_CONCURRENCY = 3;
/** A call is not started with less than this left before the deadline. */
export const MIN_CALL_MS = 1_000;
/**
 * Roles that name a business that may have a public listing. Never 'buyer' (a public office), never 'site' (an address), and never
 * 'awardee' (review 2, P2-3): a federal award record stores no recipient address (lib/signals/adapters/usaspending.ts), and the card's
 * place is the place of performance, not where the company is. Bring awardees back when the adapter stores the recipient's own ZIP.
 */
export const LOOKUP_ROLES: ReadonlySet<string> = new Set(['business', 'contractor']);

const DAY_MS = 86_400_000;
const KM_PER_MI = 1.609344;

// ---- names ----------------------------------------------------------------------------------------------------------------------------

/** Legal forms, removed from the END of a name only ("Acme Roofing Co Inc" -> "acme roofing"). */
const LEGAL_SUFFIXES = new Set(['llc', 'lc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'lp', 'llp', 'lllp', 'pllc', 'pc', 'pa', 'plc']);

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

/** The words of a business name, in order, with trailing legal forms removed. */
export function nameTokens(raw: string): string[] {
  const w = words(raw);
  let end = w.length;
  while (end > 0 && LEGAL_SUFFIXES.has(w[end - 1])) end--;
  return w.slice(0, end);
}

/** Cache key of a name: its words joined by one space. Null when nothing is left. */
export function nameKey(raw: string): string | null {
  const t = nameTokens(raw);
  return t.length > 0 ? t.join(' ').slice(0, 120) : null;
}

/** The name as sent in `title`: the original spelling without the trailing legal form ("Peachtree Roofing, L.L.C." -> "Peachtree Roofing"). */
export function titleForRequest(raw: string): string {
  const parts = raw.replace(/\s+/g, ' ').trim().split(' ');
  while (parts.length > 1 && LEGAL_SUFFIXES.has(words(parts[parts.length - 1]).join(''))) parts.pop();
  return parts.join(' ').replace(/[\s,;:.-]+$/, '').slice(0, 200);
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

/** Name similarity, 0 to 1 (Dice coefficient of the word sets). Diagnostic only: a match needs equal sets (namesMatch). */
export function nameScore(query: string, listing: string): number {
  const a = new Set(nameTokens(query));
  const b = new Set(nameTokens(listing));
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return (2 * common) / (a.size + b.size);
}

/** True only when the two names have the same word set after trailing legal forms are removed. */
export function namesMatch(query: string, listing: string): boolean {
  const a = new Set(nameTokens(query));
  const b = new Set(nameTokens(listing));
  if (a.size === 0 || a.size !== b.size) return false;
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

/**
 * Placeholders that name nobody. A name holding any of these words, or equal to one of these phrases, is never sent and never attached.
 * The owner may extend both lists.
 */
export const PLACEHOLDER_WORDS: ReadonlySet<string> = new Set([
  'tbd', 'tba', 'unknown', 'various', 'self', 'owner', 'owners', 'homeowner', 'homeowners', 'applicant', 'tenant', 'none', 'pending', 'same',
  'see', 'no', 'na', 'nil', 'null', 'unlisted', 'unassigned', 'undetermined', 'test',
]);
export const PLACEHOLDER_PHRASES: ReadonlySet<string> = new Set(['general contractor', 'home daycare', 'not applicable', 'to be determined', 'n a', 'owner builder']);

/**
 * Trade and descriptor words. A name made ONLY of these (and of the lookup place's own city or state words) has no distinctive word and is
 * never looked up: "Roofing Contractor", "Family Child Care Home", "Property Management", "Handyman Services", "Atlanta Roofing".
 */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'of', 'at', 'in', 'on', 'for', 'by', 'to', 'all', 'general', 'contractor', 'contractors', 'contracting', 'licensed',
  'insured', 'bonded', 'certified', 'professional', 'professionals', 'pro', 'pros', 'expert', 'experts', 'specialist', 'specialists', 'quality',
  'best', 'premier', 'reliable', 'affordable', 'local', 'american', 'national', 'usa', 'us', 'city', 'county', 'state', 'new', 'roofing',
  'roofer', 'roofers', 'roof', 'plumbing', 'plumber', 'plumbers', 'electrical', 'electric', 'electrician', 'electricians', 'mechanical', 'hvac',
  'heating', 'cooling', 'air', 'conditioning', 'home', 'homes', 'house', 'family', 'child', 'children', 'care', 'daycare', 'day', 'learning',
  'center', 'property', 'properties', 'management', 'handyman', 'services', 'service', 'construction', 'builder', 'builders', 'building',
  'department', 'residential', 'commercial', 'maintenance', 'repair', 'repairs', 'remodeling', 'remodel', 'renovation', 'renovations',
  'restoration', 'improvement', 'improvements', 'painting', 'painter', 'painters', 'landscaping', 'landscape', 'lawn', 'cleaning', 'cleaners',
  'janitorial', 'siding', 'gutters', 'gutter', 'windows', 'window', 'doors', 'glass', 'concrete', 'masonry', 'flooring', 'fencing', 'fence',
  'tree', 'trees', 'pest', 'control', 'pool', 'pools', 'solar', 'drywall', 'insulation', 'paving', 'asphalt', 'excavation', 'demolition',
  'installation', 'installers', 'supply', 'rentals', 'rental', 'moving', 'movers', 'towing', 'auto', 'carpentry', 'cabinets', 'kitchen',
  'bath', 'bathroom', 'design', 'engineering', 'environmental', 'energy', 'systems', 'solutions', 'group', 'team', 'enterprises',
  'industries', 'company', 'co', 'inc', 'llc', 'corp', 'business', 'store', 'shop', 'restaurant', 'cafe', 'salon', 'barber',
  // Shop and food words (review 2, P2-2): licences and food inspections name shops like "Coin Laundry", "Currency Exchange", "Food Mart".
  'food', 'foods', 'mart', 'market', 'grocery', 'groceries', 'liquor', 'liquors', 'laundry', 'laundromat', 'coin', 'wash', 'car', 'cars',
  'dry', 'nail', 'nails', 'hair', 'beauty', 'spa', 'pizza', 'pizzeria', 'coffee', 'gas', 'station', 'dollar', 'mini', 'currency',
  'exchange', 'tobacco', 'smoke', 'vape', 'pet', 'pets', 'grooming', 'parts', 'academy', 'dental', 'dentist', 'animal', 'hospital',
  'clinic', 'development', 'convenience', 'fast', 'bakery', 'deli', 'grill', 'kitchen', 'bar', 'lounge', 'tavern', 'chinese', 'mexican',
  'thai', 'italian', 'soul', 'tire', 'tires', 'cell', 'phone', 'phones', 'wireless', 'check', 'cashing', 'pawn', 'jewelry', 'fashion',
  'boutique', 'shoes', 'furniture', 'discount', 'super', 'express', 'one', 'stop', 'plus', 'outlet', 'depot', 'wholesale', 'retail',
  'school', 'preschool', 'early', 'kids', 'daycares', 'nursery', 'medical', 'health', 'pharmacy', 'drugs', 'optical', 'fitness', 'gym',
  'tattoo', 'body', 'massage', 'lash', 'brow', 'braiding', 'barbershop', 'shoe', 'repair', 'storage', 'self',
]);

export interface NamePlace {
  city?: string | null;
  state?: string | null;
  /** The lookup ZIP: its own city's words are place words too (review 2, P3-D). */
  zip?: string | null;
  /** The record's job city (review 2, P3-D): "Atlanta Roofing" on an Atlanta permit is generic wherever the contractor is. */
  jobCity?: string | null;
}

/**
 * True when a name is a placeholder or has no distinctive word. Place words (the lookup city, the ZIP's own city, the job city, the state
 * name and code) count as generic too.
 */
export function isGenericName(raw: string, place?: NamePlace): boolean {
  const all = words(raw);
  if (all.length === 0) return true;
  if (PLACEHOLDER_PHRASES.has(all.join(' ')) || all.some((w) => PLACEHOLDER_WORDS.has(w))) return true;
  if (/\bn\s*\/\s*a\b/i.test(raw)) return true;
  const zipCity = place?.zip && zip5(place.zip) ? (lookupZip(zip5(place.zip)!)?.city ?? '') : '';
  const placeWords = new Set([
    ...words(place?.city ?? ''),
    ...words(zipCity),
    ...words(place?.jobCity ?? ''),
    ...words(stateByCode(place?.state ?? '')?.name ?? ''),
  ]);
  const st = stateCode(place?.state ?? null);
  if (st) placeWords.add(st.toLowerCase());
  return nameTokens(raw).every((w) => GENERIC_WORDS.has(w) || placeWords.has(w));
}

// ---- place ----------------------------------------------------------------------------------------------------------------------------

export interface LookupPlace {
  city: string;
  state: string;
  lat: number;
  lon: number;
  /** Set when the point is a ZIP code's (the business's own ZIP, or the site's). */
  zip: string | null;
  /** Search radius and acceptance distance, km. */
  radiusKm: number;
  /** A business at its site: the listing must carry the same street address (house number and street) in the same ZIP. */
  strict: boolean;
  /** A business at its site: the site's street line from the record ("200 W Addison St"). */
  street?: string | null;
}

function zip5(v: unknown): string | null {
  // A JSON number loses leading zeros (2134 is 02134): pad it back (review 2, P3-K).
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v <= 99999 ? String(v).padStart(5, '0') : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(v);
  return m ? m[1] : null;
}

// ---- street addresses (a business at its site) ---------------------------------------------------------------------------------------

const STREET_SUFFIX: Record<string, string> = {
  street: 'st', st: 'st', str: 'st', avenue: 'ave', ave: 'ave', av: 'ave', road: 'rd', rd: 'rd', boulevard: 'blvd', blvd: 'blvd',
  drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln', court: 'ct', ct: 'ct', place: 'pl', pl: 'pl', parkway: 'pkwy', pkwy: 'pkwy', highway: 'hwy',
  hwy: 'hwy', terrace: 'ter', ter: 'ter', circle: 'cir', cir: 'cir', square: 'sq', sq: 'sq', trail: 'trl', trl: 'trl', way: 'way',
  plaza: 'plz', plz: 'plz', expressway: 'expy', expy: 'expy', freeway: 'fwy', fwy: 'fwy', pike: 'pike', alley: 'aly', aly: 'aly',
};
const DIRECTION: Record<string, string> = { north: 'n', n: 'n', south: 's', s: 's', east: 'e', e: 'e', west: 'w', w: 'w', northeast: 'ne', ne: 'ne', northwest: 'nw', nw: 'nw', southeast: 'se', se: 'se', southwest: 'sw', sw: 'sw' };
const UNIT_WORD = /^(?:ste|suite|unit|apt|apartment|fl|floor|bldg|building|rm|room|#.*|no)$/;

/**
 * A street line as house number plus normalised street words: "200 West Addison Street, Suite 3" -> { number: '200', street: 'w addison st' }.
 * Only the first comma part is read; a unit and anything after it is dropped; suffixes and directions are written one way. Null when the
 * line does not start with a house number.
 */
export function parseStreet(raw: string | null | undefined): { number: string; street: string } | null {
  if (typeof raw !== 'string') return null;
  const first = raw.split(',')[0];
  const toks = foldName(first).replace(/['.]/g, '').replace(/#/g, ' # ').split(/[^a-z0-9#]+/).filter(Boolean);
  const m = toks.length > 1 && /^\d{1,6}[a-z]?$/.test(toks[0]) ? toks[0] : null;
  if (!m) return null;
  const rest: string[] = [];
  for (const t of toks.slice(1)) {
    if (UNIT_WORD.test(t)) break;
    rest.push(DIRECTION[t] ?? STREET_SUFFIX[t] ?? t);
  }
  return rest.length ? { number: m, street: rest.join(' ') } : null;
}

/** Same house number and the same normalised street words. */
export function sameStreet(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = parseStreet(a);
  const y = parseStreet(b);
  return !!x && !!y && x.number === y.number && x.street === y.street;
}

/**
 * The lookup point. A valid ZIP whose state is `state` gives the ZIP's point; a ZIP that is unknown or in another state gives null (doubt).
 * Without a ZIP, the city list by name and state. Null when neither is known.
 */
export function resolvePlace(
  city: string | null | undefined,
  state: string | null | undefined,
  zip?: string | null,
  opts: { strict?: boolean; street?: string | null } = {},
): LookupPlace | null {
  const st = stateCode(state);
  if (!st) return null;
  const strict = !!opts.strict;
  const radiusKm = strict ? SITE_DISTANCE_KM : MAX_DISTANCE_KM;
  const z = zip5(zip);
  if (zip != null && String(zip).trim() !== '') {
    if (!z) return null;
    const info = lookupZip(z);
    if (!info || info.state !== st) return null;
    const name = typeof city === 'string' && city.trim() ? city.trim() : info.city;
    if (strict && !parseStreet(opts.street)) return null; // a business at its site needs the site's street address too
    return { city: name, state: st, lat: info.lat, lon: info.lon, zip: z, radiusKm, strict, street: strict ? (opts.street ?? null) : null };
  }
  if (strict) return null; // a business at its site needs the site's ZIP: a city-wide search is not close enough
  const ck = cityKey(city);
  if (!ck || typeof city !== 'string') return null;
  const hit = CITIES.find((c) => c.state === st && cityKey(c.name) === ck);
  return hit ? { city: city.trim(), state: st, lat: hit.lat, lon: hit.lon, zip: null, radiusKm, strict } : null;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineMi(lat1, lon1, lat2, lon2) * KM_PER_MI;
}

/** Cache key of a place: the city, plus the ZIP when the point is a ZIP's, plus " site" for a business at its site. */
export function placeKey(place: LookupPlace): string | null {
  const ck = cityKey(place.city);
  if (!ck) return null;
  const st = place.strict ? parseStreet(place.street) : null;
  return `${ck}${place.zip ? ` ${place.zip}` : ''}${place.strict ? ` site ${st ? `${st.number} ${st.street}` : ''}`.trimEnd() : ''}`.slice(0, 80);
}

// ---- response parser ------------------------------------------------------------------------------------------------------------------

/** One listing as read from the documented item fields. address_info.region is not read (a DMA region, not a state). */
export interface ListingItem {
  title: string;
  phone: string | null;
  url: string | null;
  domain: string | null;
  address: string | null;
  /** address_info.address: "street address of the business entity" ("30 Portland St"). */
  street: string | null;
  city: string | null;
  zip: string | null;
  countryCode: string | null;
  /** work_time.work_hours.current_status: "open", "close", "temporarily_closed" or "closed_forever" (sourced). */
  status: string | null;
  lat: number | null;
  lon: number | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const fin = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Items and total_count of a Business Listings search task (dfsCall's task): task.result[0]. Anything not shaped like the documented
 * response gives no items, which reads as "not found". totalCount is null when the result does not carry it.
 */
export function parseListingResult(task: { result?: unknown } | null | undefined): { items: ListingItem[]; totalCount: number | null } {
  const result = task && Array.isArray(task.result) ? task.result : [];
  const out: ListingItem[] = [];
  let totalCount: number | null = null;
  for (const r of result) {
    if (!r || typeof r !== 'object') continue;
    const tc = fin((r as { total_count?: unknown }).total_count);
    if (tc !== null) totalCount = (totalCount ?? 0) + tc;
    const items = Array.isArray((r as { items?: unknown }).items) ? (r as { items: unknown[] }).items : [];
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const o = it as Record<string, unknown>;
      const title = str(o.title);
      if (!title) continue;
      const ai = o.address_info && typeof o.address_info === 'object' ? (o.address_info as Record<string, unknown>) : {};
      const wt = o.work_time && typeof o.work_time === 'object' ? (o.work_time as { work_hours?: unknown }).work_hours : null;
      const wh = wt && typeof wt === 'object' ? (wt as Record<string, unknown>) : {};
      out.push({
        title,
        phone: str(o.phone),
        url: str(o.url),
        domain: str(o.domain),
        address: str(o.address),
        street: str(ai.address),
        city: str(ai.city),
        zip: typeof ai.zip === 'number' ? zip5(ai.zip) : str(ai.zip),
        countryCode: str(ai.country_code),
        status: str(wh.current_status),
        lat: fin(o.latitude),
        lon: fin(o.longitude),
      });
      if (out.length >= 200) return { items: out, totalCount };
    }
  }
  return { items: out, totalCount };
}

/** Items only (see parseListingResult). */
export function parseListingItems(task: { result?: unknown } | null | undefined): ListingItem[] {
  return parseListingResult(task).items;
}

/**
 * The listing's state and ZIP, from address_info.zip, else from a "ST 12345" ending of `address` (whose letters must agree with the ZIP
 * table). Null when no readable US ZIP is there: the state is then unknown and nothing is attached.
 */
export function listingState(item: Pick<ListingItem, 'zip' | 'address' | 'countryCode'>): { state: string; zip: string } | null {
  if (item.countryCode && item.countryCode.toUpperCase() !== 'US') return null;
  const z = zip5(item.zip);
  if (z) {
    const info = lookupZip(z);
    return info ? { state: info.state, zip: z } : null;
  }
  const m = item.address ? /\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:\s*,\s*(?:USA|US|United States(?: of America)?))?\s*$/.exec(item.address) : null;
  if (!m) return null;
  const info = lookupZip(m[2]);
  return info && info.state === m[1] ? { state: info.state, zip: m[2] } : null;
}

export type PlaceRefusal = 'no_state' | 'state_mismatch' | 'address_mismatch' | 'too_far';

/**
 * Null when the listing is in the place, else why not. State from the listing's ZIP. A business at its site (strict): same ZIP and the
 * same street address (house number and normalised street words), and not absurdly far (25 km) when it has a point. Otherwise: within the
 * radius of the lookup point by its coordinates, or, with no coordinates, by its ZIP's own point (review 2, P3-F).
 */
export function placeRefusal(item: ListingItem, place: LookupPlace): PlaceRefusal | null {
  const ls = listingState(item);
  if (!ls) return 'no_state';
  if (ls.state !== place.state) return 'state_mismatch';
  const hasPoint = item.lat !== null && item.lon !== null;
  if (place.strict) {
    if (!place.zip || ls.zip !== place.zip) return 'address_mismatch';
    const line = item.street ?? (item.address ? item.address.split(',')[0] : null);
    if (!sameStreet(line, place.street)) return 'address_mismatch';
    return !hasPoint || distanceKm(place.lat, place.lon, item.lat!, item.lon!) <= MAX_DISTANCE_KM ? null : 'too_far';
  }
  if (hasPoint) return distanceKm(place.lat, place.lon, item.lat!, item.lon!) <= place.radiusKm ? null : 'too_far';
  const zi = lookupZip(ls.zip);
  return zi && distanceKm(place.lat, place.lon, zi.lat, zi.lon) <= place.radiusKm ? null : 'too_far';
}

/** True when the listing is in the place (placeRefusal is null). */
export function placeMatches(item: ListingItem, place: LookupPlace): boolean {
  return placeRefusal(item, place) === null;
}

/** "temporarily_closed" and "closed_forever" (sourced values of work_time.work_hours.current_status). "close" only means outside hours. */
export function isClosed(item: Pick<ListingItem, 'status'>): boolean {
  return item.status === 'closed_forever' || item.status === 'temporarily_closed';
}

export interface ListingChoice {
  listing: ListingInfo & { name: string };
  candidates: number;
}

const hostOf = (url: string | null): string | null => (url ? new URL(url).hostname.replace(/^www\./, '') : null);

/**
 * A listing's website as it may be stored and shown: the card's own check (https, real host, no port, no punycode). safeWebsite cuts its
 * input at 200 characters, so a longer value is refused here rather than shortened into a different address.
 */
function listingWebsite(raw: string | null): string | null {
  if (!raw || raw.trim().length > 200) return null;
  const w = safeWebsite(raw);
  return w && w.length <= 300 ? w : null;
}

/**
 * The one listing to attach, or null with the reason:
 *  - truncated: total_count larger than the items read, or no total_count and a full page (review 2, P3-A);
 *  - no_listing / no_match: nothing with the same name;
 *  - closed: every same-named listing is closed (temporarily or for good); closed listings never count as a match (decision 1);
 *  - ambiguous: more than one open same-named listing that do not all carry the same phone AND the same website host;
 *  - shared_phone: the phone is also on a listing with another name in the same answer (a call-tracking or directory number, P3-E);
 *  - state_mismatch / address_mismatch / too_far / no_state: the place check (placeRefusal);
 *  - no_contact_detail: neither a valid US phone nor a usable website.
 * With several listings of one business on different pages of one host, the stored website is the host's home page (P3-C).
 */
export function chooseListing(
  name: string,
  place: LookupPlace,
  items: readonly ListingItem[],
  totalCount: number | null = null,
): { choice: ListingChoice | null; reason: string } {
  if (totalCount === null ? items.length >= LOOKUP_LIMIT : totalCount > items.length) return { choice: null, reason: 'truncated' };
  const sameName = items.filter((it) => namesMatch(name, it.title));
  if (sameName.length === 0) return { choice: null, reason: items.length === 0 ? 'no_listing' : 'no_match' };
  const named = sameName.filter((it) => !isClosed(it));
  if (named.length === 0) return { choice: null, reason: 'closed' };
  const cleaned = named.map((it) => ({ it, phone: usPhone(it.phone), website: listingWebsite(it.url ?? it.domain) }));
  if (cleaned.length > 1) {
    const phones = new Set(cleaned.map((c) => c.phone));
    const hosts = new Set(cleaned.map((c) => hostOf(c.website)));
    if (phones.size !== 1 || hosts.size !== 1 || phones.has(null) || hosts.has(null)) return { choice: null, reason: 'ambiguous' };
  }
  for (const c of cleaned) {
    const why = placeRefusal(c.it, place);
    if (why) return { choice: null, reason: why };
  }
  const best = cleaned[0];
  if (!best.phone && !best.website) return { choice: null, reason: 'no_contact_detail' };
  if (best.phone && items.some((it) => !namesMatch(name, it.title) && usPhone(it.phone) === best.phone)) return { choice: null, reason: 'shared_phone' };
  let website = best.website;
  if (website && new Set(cleaned.map((c) => c.website)).size > 1) website = `https://${new URL(website).hostname}/`;
  return {
    choice: { listing: { phone: best.phone, website, name: best.it.title.slice(0, 200) }, candidates: cleaned.length },
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

/** Per database client: until when the cache table is known to be missing (so a page load does not query a missing table each time). */
const missingUntil = new WeakMap<object, number>();
const MISSING_MEMO_MS = 10 * 60_000;
function knownMissing(db: object, nowMs: number): boolean {
  const until = missingUntil.get(db);
  return typeof until === 'number' && until > nowMs;
}
function markMissing(db: object, nowMs: number): void {
  missingUntil.set(db, nowMs + MISSING_MEMO_MS);
}

export type CacheStatus = 'found' | 'not_found' | 'retry' | 'truncated';

export interface CacheEntry {
  status: CacheStatus;
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

const TTL_MS: Record<CacheStatus, number> = {
  found: FOUND_TTL_DAYS * DAY_MS,
  not_found: NOT_FOUND_TTL_DAYS * DAY_MS,
  retry: RETRY_TTL_HOURS * 3_600_000,
  truncated: TRUNCATED_TTL_DAYS * DAY_MS,
};
const isCacheStatus = (v: unknown): v is CacheStatus => v === 'found' || v === 'not_found' || v === 'retry' || v === 'truncated';

/**
 * A stored row as an entry, or null when it is malformed or stale (found 90 days, not_found 30 days, truncated 7 days, retry 6 hours) or
 * dated more than 10 minutes in the future (a wrong clock must not block a business for longer than its own TTL).
 */
function entryOf(r: CacheRow, nowMs: number): CacheEntry | null {
  if (!r || !isCacheStatus(r.status) || typeof r.checked_at !== 'string') return null;
  const at = Date.parse(r.checked_at);
  if (!Number.isFinite(at)) return null;
  if (nowMs - at > TTL_MS[r.status] || at - nowMs > FUTURE_SKEW_MS) return null;
  if (r.status !== 'found') return { status: r.status, listing: null, checkedAt: r.checked_at };
  const phone = usPhone(r.phone);
  const website = typeof r.website === 'string' ? listingWebsite(r.website) : null;
  if (!phone && !website) return null;
  return { status: 'found', listing: { phone, website, name: typeof r.listing_name === 'string' ? r.listing_name : null }, checkedAt: r.checked_at };
}

const CACHE_COLUMNS = 'name_key, city_key, state, status, phone, website, listing_name, checked_at';

type CacheKey = { name: string; city: string; state: string };
type CacheRead = { state: 'hit'; entry: CacheEntry } | { state: 'miss' } | { state: 'off' } | { state: 'error' };

export async function readCache(db: Db, key: CacheKey, now: Date): Promise<CacheRead> {
  if (knownMissing(db, now.getTime())) return { state: 'off' };
  try {
    const { data, error } = await db
      .from(LOOKUP_TABLE)
      .select(CACHE_COLUMNS)
      .eq('name_key', key.name)
      .eq('city_key', key.city)
      .eq('state', key.state)
      .limit(1);
    if (error) {
      if (isMissingCache(error)) {
        markMissing(db, now.getTime());
        return { state: 'off' };
      }
      return { state: 'error' };
    }
    const row = Array.isArray(data) ? (data[0] as CacheRow | undefined) : undefined;
    const entry = row ? entryOf(row, now.getTime()) : null;
    return entry ? { state: 'hit', entry } : { state: 'miss' };
  } catch {
    return { state: 'error' };
  }
}

type CacheValue = { status: 'found'; listing: ListingInfo & { name: string } } | { status: 'not_found' } | { status: 'retry' } | { status: 'truncated' };

/** Upsert on (name_key, city_key, state), every column written (postgrest-js merges duplicates by default). */
async function writeCache(db: Db, key: CacheKey, value: CacheValue, costUsd: number, now: Date): Promise<boolean> {
  const found = value.status === 'found' ? value.listing : null;
  const row = {
    name_key: key.name,
    city_key: key.city,
    state: key.state,
    status: value.status,
    phone: found ? found.phone : null,
    website: found ? found.website : null,
    listing_name: found ? found.name : null,
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

/** Removes this run's 'retry' claim when the call was never sent (refused by a cap after the claim), so nothing is blocked for 6 hours. */
async function dropClaim(db: Db, key: CacheKey): Promise<void> {
  try {
    await db.from(LOOKUP_TABLE).delete().eq('name_key', key.name).eq('city_key', key.city).eq('state', key.state).eq('status', 'retry');
  } catch {
    // the claim expires by itself after RETRY_TTL_HOURS
  }
}

export interface BreakerState {
  /** True when the first BREAKER_SAMPLE answers of the UTC day hold no found listing: no more lookups today. */
  tripped: boolean;
  /** Answers recorded today (found, not_found, truncated), up to 100. */
  tried: number;
  /** The owner line for the health email and the notify JSON, when tripped. */
  message: string | null;
}

export function breakerMessage(tried: number): string {
  return `Business lookups returned no usable match today (${tried} tried). Run the lookup probe.`;
}

/**
 * Decision 4b: reads today's answers (cache rows written by a call today: found, not_found, truncated) in time order. Tripped when the first
 * BREAKER_SAMPLE of them are all not found or truncated. Null on a read error or a missing table (the caller treats null as "do not call").
 */
export async function lookupBreaker(db: Db, now: Date): Promise<BreakerState | null> {
  try {
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const { data, error } = await db
      .from(LOOKUP_TABLE)
      .select('status, checked_at')
      .gte('checked_at', dayStart)
      .in('status', ['found', 'not_found', 'truncated'])
      .order('checked_at', { ascending: true })
      .limit(100);
    if (error || !Array.isArray(data)) return null;
    const rows = data as { status: string }[];
    const first = rows.slice(0, BREAKER_SAMPLE);
    const tripped = first.length >= BREAKER_SAMPLE && first.every((r) => r.status !== 'found');
    return { tripped, tried: rows.length, message: tripped ? breakerMessage(rows.length) : null };
  } catch {
    return null;
  }
}

// ---- settings and budget --------------------------------------------------------------------------------------------------------------

/** Empty means the default; a value that is set but not a non-negative integer means 0 (off): a typo never turns spend on. */
function intEnv(raw: string | undefined, fallback: number): number {
  const s = raw?.trim();
  if (!s) return fallback;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : 0;
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

/** Per-run counters. One budget per notify run. */
export interface LookupBudget {
  runLeft: number;
  maxPerDay: number;
  /** Lookup wall time left in this run, ms (LOOKUP_RUN_BUDGET_MS at the start). */
  msLeft: number;
  calls: number;
  spentUsd: number;
  found: number;
  notFound: number;
  cacheHits: number;
  timedOut: number;
  skipped: Record<string, number>;
  /** Why answers from the API were not attached, per reason (truncated, ambiguous, closed, address_mismatch ...). */
  refused: Record<string, number>;
  /** The circuit breaker's line when it stopped lookups this run (decision 4b), else null. */
  breaker: string | null;
}

export function newBudget(settings: Pick<LookupSettings, 'maxPerRun' | 'maxPerDay'>, msLeft: number = LOOKUP_RUN_BUDGET_MS): LookupBudget {
  return { runLeft: settings.maxPerRun, maxPerDay: settings.maxPerDay, msLeft, calls: 0, spentUsd: 0, found: 0, notFound: 0, cacheHits: 0, timedOut: 0, skipped: {}, refused: {}, breaker: null };
}

function dayStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/**
 * Lookup calls booked today (UTC) in the DataForSEO ledger, refused reservations excluded; with `upToId`, only rows up to and including
 * that id (the admission count). Reads at most maxPerDay + 1 rows. Null on error.
 */
export async function lookupsToday(db: Db, now: Date, maxPerDay: number, upToId?: number | string): Promise<number | null> {
  try {
    let q = db
      .from('holler_dataforseo_spend')
      .select('id')
      .eq('endpoint', LOOKUP_PATH)
      .gte('created_at', dayStartIso(now))
      .neq('status', 'refused');
    if (upToId !== undefined) q = q.lt('id', Number(upToId) + 1);
    const { data, error } = await q.limit(maxPerDay + 1);
    if (error || !Array.isArray(data)) return null;
    return data.length;
  } catch {
    return null;
  }
}

// ---- lookup ---------------------------------------------------------------------------------------------------------------------------

export type SkipReason =
  | 'not_business'
  | 'generic_name'
  | 'short_name'
  | 'no_place'
  | 'no_database'
  | 'cache_missing'
  | 'cache_error'
  | 'retry_later'
  | 'not_configured'
  | 'dry_run'
  | 'run_cap'
  | 'day_cap'
  | 'breaker'
  | 'spend_unavailable'
  | 'cap_reached'
  | 'deadline'
  | 'api_error';

export type LookupOutcome =
  | { status: 'found'; source: 'cache' | 'api'; listing: ListingInfo & { name: string | null }; costUsd: number; candidates?: number }
  | { status: 'not_found'; source: 'cache' | 'api'; costUsd: number; reason?: string }
  | { status: 'skipped'; reason: SkipReason; estimateUsd?: number; request?: Record<string, unknown>; message?: string };

export interface LookupInput {
  name: string;
  city: string | null | undefined;
  state: string | null | undefined;
  zip?: string | null;
  /** A business at its site (role 'business'): the site's ZIP and street address must both match. */
  strict?: boolean;
  /** A business at its site: the site's street line from the record. */
  street?: string | null;
  /** The record's job city: a place word for the generic-name rule. */
  jobCity?: string | null;
}

export interface LookupDeps {
  /** Service-role client; null means no database (nothing is looked up). */
  db: Db | null;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Per call timeout, ms. Default LOOKUP_CALL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Absolute time (ms since epoch) by which lookupForCards returns, whatever is still in flight. */
  deadline?: number;
}

export interface LookupOptions {
  /** Shared per-run counters (the notify run). Absent: a single lookup that is still held to the day and month caps. */
  budget?: LookupBudget;
  /**
   * The owner probe: no cache read and no cache write, so it works BEFORE migration 0026 is applied (decision 4c: apply 0026 only after
   * the probe has returned `found` for known businesses). It needs only the ledger (0011). The circuit breaker does not apply to it.
   */
  probe?: boolean;
  /** No call at all (also when HOLLER_LOOKUP_DRY_RUN is set). */
  dryRun?: boolean;
}

export const ESTIMATE_PER_LOOKUP_USD = estimateUsd(LOOKUP_KIND, LOOKUP_LIMIT);

const coord = (n: number) => n.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');

/** The task body sent for one lookup: the name without its legal form, the lookup point and radius, the page size. */
export function lookupRequest(name: string, place: LookupPlace): Record<string, unknown> {
  return { title: titleForRequest(name), location_coordinate: `${coord(place.lat)},${coord(place.lon)},${place.radiusKm}`, limit: LOOKUP_LIMIT };
}

function skip(budget: LookupBudget | undefined, reason: SkipReason, extra: Partial<Extract<LookupOutcome, { status: 'skipped' }>> = {}): LookupOutcome {
  if (budget) budget.skipped[reason] = (budget.skipped[reason] ?? 0) + 1;
  return { status: 'skipped', reason, ...extra };
}

/** The checks every name passes before anything is read or sent. Null when it may be looked up, else the reason. */
export function nameRefusal(name: string, place?: NamePlace): SkipReason | null {
  if (!name || !isOrganisationName(name)) return 'not_business';
  if (isGenericName(name, place)) return 'generic_name';
  if (nameTokens(name).length < MIN_NAME_TOKENS) return 'short_name';
  return null;
}

/** The name, the place and the cache key of one lookup input, or the reason it is not looked up. */
function prepare(input: LookupInput): { name: string; place: LookupPlace; key: CacheKey } | { refusal: SkipReason } {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  const refusal = nameRefusal(name, { city: input.city, state: input.state, zip: input.zip, jobCity: input.jobCity });
  if (refusal) return { refusal };
  const nk = nameKey(name);
  const place = resolvePlace(input.city, input.state, input.zip, { strict: input.strict, street: input.street });
  const pk = place ? placeKey(place) : null;
  if (!nk || !place || !pk) return { refusal: 'no_place' };
  return { name, place, key: { name: nk, city: pk, state: place.state } };
}

/** The cache key of a lookup input, or null when it is not looked up. */
export function lookupKey(input: LookupInput): string | null {
  const p = prepare(input);
  return 'refusal' in p ? null : `${p.key.name}|${p.key.city}|${p.key.state}`;
}

/**
 * Looks up one business. Never throws. Order: name checks (person, placeholder, generic), place, cache (not for the probe), credentials,
 * dry run, run cap, day cap, the day's circuit breaker and the month cap (read again before every call), a 'retry' claim row, then ONE
 * request through dfsCall with the day-cap admission. A found, not-found or truncated answer replaces the claim (unless probe); a timeout
 * or error leaves it for 6 hours; a call refused before it was sent removes it.
 */
export async function lookupBusiness(input: LookupInput, deps: LookupDeps, opts: LookupOptions = {}): Promise<LookupOutcome> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? (() => new Date()))();
  const budget = opts.budget;
  const prep = prepare(input);
  if ('refusal' in prep) return skip(budget, prep.refusal);
  const { name, place, key } = prep;
  const db = deps.db;
  if (!db) return skip(budget, 'no_database');

  if (!opts.probe) {
    const cached = await readCache(db, key, now);
    if (cached.state === 'off') return skip(budget, 'cache_missing');
    if (cached.state === 'error') return skip(budget, 'cache_error');
    if (cached.state === 'hit') {
      if (budget) budget.cacheHits++;
      if (cached.entry.status === 'retry') return skip(budget, 'retry_later');
      return cached.entry.status === 'found' && cached.entry.listing
        ? { status: 'found', source: 'cache', listing: cached.entry.listing, costUsd: 0 }
        : { status: 'not_found', source: 'cache', costUsd: 0, reason: cached.entry.status === 'truncated' ? 'truncated' : undefined };
    }
  }

  const settings = lookupSettings(env);
  if (!settings.configured) return skip(budget, 'not_configured');
  const request = lookupRequest(name, place);
  if (opts.dryRun || settings.dryRun) return skip(budget, 'dry_run', { estimateUsd: ESTIMATE_PER_LOOKUP_USD, request });
  const maxPerDay = budget?.maxPerDay ?? settings.maxPerDay;
  if (maxPerDay <= 0) return skip(budget, 'day_cap');
  // Take the run slot now, with no await between the check and the take: parallel lookups of one run never pass the run cap. Every way
  // out below that makes no call gives the slot back.
  if (budget) {
    if (budget.runLeft <= 0) return skip(budget, 'run_cap');
    budget.runLeft--;
  }
  const giveBack = (reason: SkipReason, extra: { message?: string } = {}): LookupOutcome => {
    if (budget) budget.runLeft++;
    return skip(budget, reason, extra);
  };

  // Cheap reads first, so a full day, a tripped breaker or a full month does not book a refused ledger row every run.
  const used = await lookupsToday(db, now, maxPerDay);
  if (used === null) return giveBack('spend_unavailable');
  if (used >= maxPerDay) return giveBack('day_cap');
  if (!opts.probe) {
    const breaker = await lookupBreaker(db, now);
    if (!breaker) return giveBack('cache_error');
    if (breaker.tripped) {
      if (budget) budget.breaker = breaker.message;
      return giveBack('breaker', { message: breaker.message ?? undefined });
    }
  }
  try {
    const spent = await monthSpendUsd(db, monthKey(now));
    if (spent + ESTIMATE_PER_LOOKUP_USD > monthlyCapUsd(env) + 1e-9) return giveBack('cap_reached');
  } catch {
    return giveBack('spend_unavailable');
  }

  const timeoutMs = Math.max(1, Math.min(deps.timeoutMs ?? LOOKUP_CALL_TIMEOUT_MS, deps.deadline !== undefined ? deps.deadline - Date.now() : Infinity));
  if (timeoutMs < MIN_CALL_MS && deps.deadline !== undefined) return giveBack('deadline');
  // The claim: a call that hangs or fails is not repeated for RETRY_TTL_HOURS. No claim, no call.
  if (!opts.probe && !(await writeCache(db, key, { status: 'retry' }, 0, now))) return giveBack('cache_error');
  if (budget) budget.calls++;

  const dfsDeps: DfsDeps = { db, env, now: () => now, timeoutMs, retry5xx: false };
  if (deps.fetch) dfsDeps.fetch = deps.fetch;
  if (deps.sleep) dfsDeps.sleep = deps.sleep;
  const admit = async (d: Db, reservationId: number | string) => {
    const n = await lookupsToday(d, now, maxPerDay, reservationId);
    return n !== null && n <= maxPerDay;
  };
  const res = await dfsCall(LOOKUP_PATH, request, { kind: LOOKUP_KIND, items: LOOKUP_LIMIT, admit }, dfsDeps);
  if (!res.ok) {
    const unsent: Partial<Record<string, SkipReason>> = { not_configured: 'not_configured', cap_reached: 'cap_reached', admit_refused: 'day_cap', spend_unavailable: 'spend_unavailable' };
    const reason = unsent[res.reason];
    if (reason) {
      // Nothing was sent: give the slot back and remove the claim, so the business is not blocked for 6 hours for nothing.
      if (budget) budget.calls--;
      if (!opts.probe) await dropClaim(db, key);
      return giveBack(reason);
    }
    if (budget && res.reason === 'network_error') budget.timedOut++;
    return skip(budget, 'api_error');
  }
  if (budget) budget.spentUsd = Math.round((budget.spentUsd + res.cost) * 100_000) / 100_000;
  const parsed = parseListingResult(res.task);
  const { choice, reason } = chooseListing(name, place, parsed.items, parsed.totalCount);
  if (!choice) {
    if (budget) {
      budget.notFound++;
      budget.refused[reason] = (budget.refused[reason] ?? 0) + 1;
    }
    if (!opts.probe) await writeCache(db, key, { status: reason === 'truncated' ? 'truncated' : 'not_found' }, res.cost, now);
    return { status: 'not_found', source: 'api', costUsd: res.cost, reason };
  }
  if (budget) budget.found++;
  if (!opts.probe) await writeCache(db, key, { status: 'found', listing: choice.listing }, res.cost, now);
  return { status: 'found', source: 'api', listing: choice.listing, costUsd: res.cost, candidates: choice.candidates };
}

// ---- contacts -------------------------------------------------------------------------------------------------------------------------

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * True when this contact may get a listing: a business or contractor whose name the classifier accepts and that is neither a placeholder
 * nor generic, and that has neither a phone nor a website of its own on the record.
 */
export function mayLookUp(c: Pick<ContactRecord, 'role' | 'name' | 'phone' | 'website'> | null | undefined): boolean {
  if (!c || !LOOKUP_ROLES.has(c.role)) return false;
  if (clean(c.phone) || clean(c.website)) return false;
  return nameRefusal(clean(c.name)) === null;
}

export type SignalPlace = { city?: string | null; state?: string | null };
export type SignalPlaces = ReadonlyMap<number, SignalPlace>;

/**
 * Where a contact is looked up (see the header). Null when it is not looked up: not a lookup role, the record places the business somewhere
 * it cannot be found (another state with no city or ZIP, an unreadable state or ZIP), or a business at its site without the site's ZIP and
 * street address. `list` is the record's contacts: a business at its site uses the site row's address.
 */
export function lookupInputFor(c: ContactRecord, list: readonly ContactRecord[] | null | undefined, signal: SignalPlace | undefined): LookupInput | null {
  if (!c || !LOOKUP_ROLES.has(c.role)) return null;
  const name = clean(c.name);
  const ownState = clean(c.state);
  const cs = stateCode(ownState);
  if (ownState && !cs) return null;
  const ss = stateCode(clean(signal?.state));
  const jobCity = clean(signal?.city) || null;
  if (c.role === 'business') {
    // A business on a licence or inspection is AT the site: its own address line, else the site row's, with that line's ZIP.
    const site = (list ?? []).find((x) => x && x.role === 'site' && zip5(x.zip) && clean(x.address));
    const ownLine = clean(c.address) && zip5(c.zip) ? c : null;
    const at = ownLine ?? site ?? null;
    const z = at ? zip5(at.zip) : null;
    const st = at ? (stateCode(clean(at.state)) ?? (z ? (lookupZip(z)?.state ?? null) : null)) : null;
    if (!at || !z || !st || !clean(at.address)) return null;
    return { name, city: clean(at.city) || jobCity, state: st, zip: z, strict: true, street: clean(at.address), jobCity };
  }
  const z = zip5(c.zip);
  if (z) {
    // The business's own ZIP: search there, wherever the job is.
    const st = cs ?? lookupZip(z)?.state ?? null;
    return st ? { name, city: clean(c.city) || null, state: st, zip: z, jobCity } : null;
  }
  if (clean(c.zip)) return null; // a ZIP we cannot read: doubt
  if (clean(c.city) && cs) return { name, city: clean(c.city), state: cs, zip: null, jobCity };
  if (cs && ss && cs !== ss) return null; // another state and no city or ZIP for it
  return { name, city: jobCity, state: ss, zip: null, jobCity };
}

/** The cache key a contact's lookup uses, or null when it is not looked up. */
function contactKey(c: ContactRecord, list: readonly ContactRecord[], signal: SignalPlace | undefined): CacheKey | null {
  const input = lookupInputFor(c, list, signal);
  if (!input) return null;
  const p = prepare(input);
  return 'refusal' in p ? null : p.key;
}

/**
 * Display side (no call ever): marks each eligible contact from the cache. A fresh "found" row attaches `listing` (phone, website); a fresh
 * not-found, truncated or retry row sets `listing: null` (shown as nothing, and the alert run does not read the cache again for it).
 * Without DataForSEO credentials, with 0026 not applied, on any error or for a contact that fails mayLookUp the contact is left exactly as
 * it was. Returns a new map; the input is not changed.
 */
export async function attachCachedListings(
  db: Db | null | undefined,
  contacts: ReadonlyMap<number, ContactRecord[]>,
  places: SignalPlaces,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<Map<number, ContactRecord[]>> {
  const out = new Map(contacts);
  if (!db || !credentials(env) || knownMissing(db, now.getTime())) return out;
  const wanted: { signalId: number; idx: number; key: CacheKey }[] = [];
  for (const [signalId, list] of contacts) {
    if (!Array.isArray(list)) continue;
    list.forEach((c, idx) => {
      if (!mayLookUp(c) || c.listing !== undefined) return;
      const key = contactKey(c, list, places.get(signalId));
      if (key) wanted.push({ signalId, idx, key });
    });
  }
  if (wanted.length === 0) return out;
  try {
    const names = [...new Set(wanted.map((w) => w.key.name))].slice(0, 100);
    const { data, error } = await db.from(LOOKUP_TABLE).select(CACHE_COLUMNS).in('name_key', names).limit(500);
    if (error) {
      if (isMissingCache(error)) markMissing(db, now.getTime());
      return out;
    }
    if (!Array.isArray(data)) return out;
    const byKey = new Map<string, CacheEntry>();
    for (const r of data as CacheRow[]) {
      if (!r || typeof r.name_key !== 'string' || typeof r.city_key !== 'string' || typeof r.state !== 'string') continue;
      const e = entryOf(r, now.getTime());
      if (e) byKey.set(`${r.name_key}|${r.city_key}|${r.state}`, e);
    }
    for (const w of wanted) {
      const e = byKey.get(`${w.key.name}|${w.key.city}|${w.key.state}`);
      if (!e) continue;
      const list = [...(out.get(w.signalId) ?? [])];
      const listing: ListingInfo | null = e.status === 'found' && e.listing ? { phone: e.listing.phone, website: e.listing.website } : null;
      list[w.idx] = { ...list[w.idx], listing };
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

/** Reasons that stop every further lookup in the run. */
const STOP_REASONS = new Set<string>(['cache_missing', 'cache_error', 'day_cap', 'breaker', 'cap_reached', 'spend_unavailable', 'api_error', 'not_configured', 'deadline']);

/**
 * Notify side: for the cards about to be emailed, looks up the named contact when it may be looked up and the cache has nothing for it
 * yet (`listing` undefined), within the budget: one lookup per business (cards naming the same business share it, review 2 P3-H), at most
 * LOOKUP_CONCURRENCY at a time, and never past the deadline (deps.deadline, else now + budget.msLeft). At the deadline it returns with
 * whatever has finished; anything still in flight is not waited for (its own timeout ends it, and its 'retry' claim stops the next run
 * from repeating it). Returns the contacts map with any found listing attached (a new map; the input is not changed). Without credentials,
 * with a cap at 0, in a dry run or with no database it returns at once: no read, no call.
 */
export async function lookupForCards(
  contacts: ReadonlyMap<number, ContactRecord[]>,
  cards: readonly CardForLookup[],
  budget: LookupBudget,
  deps: LookupDeps,
): Promise<Map<number, ContactRecord[]>> {
  const out = new Map(contacts);
  const settings = lookupSettings(deps.env ?? process.env);
  if (!settings.configured || settings.dryRun || !deps.db || budget.runLeft <= 0 || budget.maxPerDay <= 0 || budget.msLeft <= 0) return out;
  const started = Date.now();
  const deadline = Math.min(deps.deadline ?? Infinity, started + budget.msLeft);
  // One job per business: cards naming the same business (same cache key) share one lookup.
  const jobs = new Map<string, { input: LookupInput; cards: { signalId: number; contact: ContactRecord }[] }>();
  for (const card of cards) {
    const c = card.contact;
    if (!c || c.signalId !== card.signalId || c.listing !== undefined || !mayLookUp(c)) continue;
    const input = lookupInputFor(c, contacts.get(card.signalId), card);
    const key = input ? lookupKey(input) : null;
    if (!input || !key) {
      budget.skipped.no_place = (budget.skipped.no_place ?? 0) + 1;
      continue;
    }
    const job = jobs.get(key) ?? { input, cards: [] };
    job.cards.push({ signalId: card.signalId, contact: c });
    jobs.set(key, job);
  }
  const queue = [...jobs.values()];
  if (queue.length === 0) return out;
  const found: { cards: { signalId: number; contact: ContactRecord }[]; listing: ListingInfo }[] = [];
  let stop = false;
  const worker = async () => {
    while (!stop) {
      const job = queue.shift();
      if (!job) return;
      if (budget.runLeft <= 0 || deadline - Date.now() < MIN_CALL_MS || Object.keys(budget.skipped).some((r) => STOP_REASONS.has(r))) {
        stop = true;
        return;
      }
      const r = await lookupBusiness(job.input, { ...deps, deadline }, { budget });
      if (r.status === 'found') found.push({ cards: job.cards, listing: { phone: r.listing.phone, website: r.listing.website } });
      if (r.status === 'skipped' && STOP_REASONS.has(r.reason)) stop = true;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const all = Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, worker));
  const wait = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
  });
  try {
    await Promise.race([all, wait]);
  } catch {
    // a worker never throws (lookupBusiness does not); keep what has finished
  } finally {
    if (timer) clearTimeout(timer);
    stop = true;
    budget.msLeft = Math.max(0, budget.msLeft - (Date.now() - started));
  }
  for (const f of [...found]) {
    for (const { signalId, contact } of f.cards) {
      const list = out.get(signalId);
      if (!Array.isArray(list)) continue;
      out.set(signalId, list.map((x) => (x === contact ? { ...x, listing: f.listing } : x)));
    }
  }
  return out;
}
