import { createHash } from 'node:crypto';
import zipcodes from 'zipcodes';
import { cityBySlug, lookupPlaceByName, lookupZip } from '@/lib/geo';
import { isServedZip } from '@/lib/check/coverage';
import { looksLikeFullPersonName } from '@/lib/contacts/org';
import { zoneFor } from '@/lib/storms/zones';
import { parseDue } from '@/lib/firecrawl/extract';
import { bidTrades } from '@/lib/signals/bid-trades';
import { cleanText, localDay } from '@/lib/signals/adapters/city-bids';
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
 * The description is read only to pick the trade and is never stored. Title, agency and solicitation number are stored exactly as typed
 * (spaces tidied): a field that looks like it holds a phone number, an e-mail address, a link, a street address or a person's name after
 * "contact" / "attn" is REFUSED with a plain reason, never edited (review 2 P1-1), and a title or agency that is only a person-like name
 * is refused (review P2-2).
 *
 * Every field is cut to its maximum length BEFORE any pattern runs (review P2-4), and a leading = + - @ (a spreadsheet formula) is
 * removed from every stored text as the LAST step (review P2-5, review 2 P2-A).
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
  | 'no_trade'
  | 'person_name'
  | 'short_link'
  | 'terms_host'
  | 'too_long'
  | 'contact_title'
  | 'contact_agency'
  | 'contact_sol';

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
  person_name: 'Title or agency reads like a private person\'s name, not a bid and a government buyer',
  too_long: 'Title is over 200 characters or agency over 120: shorten it',
  contact_title: 'The title looks like it contains contact details, please remove them',
  contact_agency: 'The agency looks like it contains contact details, please remove them',
  contact_sol: 'The solicitation number looks like it contains contact details, please remove them',
  short_link: 'Link shorteners are not accepted: paste the agency\'s own page',
  terms_host: 'This portal\'s terms ban commercial use: check it by hand only, do not enter its bids',
  duplicate_in_file: 'Duplicate of an earlier row in this file',
  already_in_holler: 'Already in Holler (same link and title, or same agency and solicitation number)',
};

/** More than this far ahead is a placeholder date, as for the city bid feeds. */
export const MAX_DUE_DAYS = 365;

export interface ManualBidKeys {
  /**
   * The link, normalized, plus the title: one bid. The link alone is not used (review 2: many bids can share an agency's list page, on
   * any portal), so a second bid from the same page with another title is a new bid.
   */
  urlKey: string;
  /** The title, normalized (letters and digits only). */
  titleKey: string;
  /** agency + solicitation number, normalized; null without a number. */
  solKey: string | null;
}

export interface ManualBidReady {
  ok: true;
  signal: SignalInput;
  keys: ManualBidKeys;
  /** For the preview table. */
  view: { title: string; agency: string; dueDate: string; place: string; trades: CategoryId[]; solicitationId: string | null; url: string; host: string; notes: string[] };
}

export type ManualBidResult = ManualBidReady | { ok: false; problem: ManualBidProblem; detail?: string };

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
 * "Inside the areas Holler serves": exactly the site's own test (lib/check/coverage.ts isServedZip: an enabled local feed within 25 miles),
 * the one /check, the waitlist and the city pages use. A place it refuses is "coming to your area" everywhere else, so no bid goes there
 * either (review P2-1: the metro circles are a scorecard grouping, not coverage).
 */
export function servedPlace(p: { lat: number; lon: number; state: string }): boolean {
  return isServedZip(p);
}

/** Longest text read from each field. Applied before any pattern runs, so one huge cell cannot hold the request (review P2-4). */
export const FIELD_MAX = {
  url: 600,
  title: 300,
  agency: 200,
  dueDate: 40,
  place: 80,
  zip: 10,
  city: 80,
  state: 40,
  solicitationId: 80,
  description: 2000,
  trade: 40,
} as const;

/** Every field cut to its maximum, first thing. */
export function capFields(f: ManualBidFields): ManualBidFields {
  const out: ManualBidFields = {};
  for (const k of Object.keys(FIELD_MAX) as Array<keyof typeof FIELD_MAX>) {
    const v = f[k];
    if (typeof v === 'string') out[k] = v.slice(0, FIELD_MAX[k]);
  }
  return out;
}

/**
 * A leading = + - @ (or space, tab, CR or separator before one) makes a spreadsheet run the cell as a formula when the text is exported
 * later: removed. Run LAST on every stored text field, after all other processing (review 2 P2-A).
 */
export function defuseFormula(text: string): string {
  return text.replace(/^[\s=+\-@|;,:&'"]+/, '');
}

// ---- Contact details: refused, never edited (review 2 P1-1) ---------------------------------------------------------------------
// The owner types or pastes these fields, so nothing is rewritten. A field that looks like it holds a phone number, an e-mail address,
// a link, a street address or a person's name after "contact" / "attn" is refused with what was found, and the owner retypes it. Bid
// titles are full of "for", "owner", "call" ("Call for Artists", "Services for Water and Sewer Mains"): those words are never read.

const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/;
const LINK_RE = /\bhttps?:\/\/|\bwww\./i;
// 10 digits with any of ( ) space . - between the groups ("(404) 555-0147", "404.555.0147", "+1 404 555 0147").
const PHONE10_RE = /(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.\u2010-\u2015-]*\d{3}[\s.\u2010-\u2015-]*\d{4}(?![\w-])/;
// 7 digits written as a local phone ("555-0147"), only after a phone word: bid numbers such as "026-2600" are not phones.
const PHONE7_RE = /\b(?:ph|phone|tel|telephone|cell|mobile|fax)\b[\s.:#]*\d{3}[\s.-]\d{4}(?![\w-])/i;
// The solicitation number field: a phone only when written like one, with a separator or brackets ("404-555-0147", "(404) 5550147").
// A 10-digit bid id ("4400012345", "SFGOV~0000007082", "RFP 2026000123") is not a phone (review 3 P2-2).
const PHONE10_FORMATTED_RE = /(?<![\w~-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s*\d{3}[\s.\u2010-\u2015-]?\d{4}|\d{3}[\s.\u2010-\u2015/-]+\d{3}[\s.\u2010-\u2015-]+\d{4})(?![\w~-])/;
const STREET_WORDS = 'street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|lane|ln|court|ct|way|place|pl|parkway|pkwy|circle|cir|terrace|ter|trail|trl|pike|square|sq|crossing|xing|cove|loop';
// A house number (not a year, not after Hwy / Route / SR / Phase / No. / a dash), one to three name words (no "at", "of", "and"), then a
// street word: "1423 Oak Hollow Dr", "88 Pine St". "LA Hwy 64 Port Hudson Pride Rd", "2026 Main Street", "ITB 2026-08 Whitlock Avenue"
// and "40 LED Fixtures at Parkway Place" are not addresses.
const STREET_RE = new RegExp(
  `(?<!\\b(?:hwy|highway|route|rte|sr|us|i|la|ga|tx|nc|fm|cr|phase|package|no|station|lot|unit|building|bldg|suite|ste|lots?|number|#)\\.?[\\s-]*)(?<![\\w-])(?!(?:19|20)\\d\\d\\b)\\d{1,6}[A-Za-z]?\\s+(?:[NSEW]\\.?\\s+)?(?:(?!(?:at|of|and|the|for|to|in|on|with|from|&)\\b)[A-Za-z0-9'.]+\\s+){1,3}(?:${STREET_WORDS})\\b`,
  'i',
);
// A house number from 1900 to 2099 looks like a year, so it counts only when the street phrase ends the text or is followed by a comma,
// bracket, dash or unit word: "2015 Oak Hollow Dr" and "at 2015 Oak Hollow Dr, Marietta" are addresses; "2026 LMIG Road Resurfacing" and
// "FY 2027 Street Resurfacing Program" are not (review 3).
const YEAR_STREET_RE = new RegExp(
  `(?<![\\w-])(?:19|20)\\d\\d\\s+(?:[NSEW]\\.?\\s+)?(?:(?!(?:at|of|and|the|for|to|in|on|with|from|&)\\b)[A-Za-z0-9'.]+\\s+){1,3}(?:${STREET_WORDS})\\b\\.?(?=\\s*(?:$|[,;()\\u2013-]|(?:apt|unit|suite|ste)\\b))`,
  'i',
);
// "PO Box 12", "P.O. Box 12", "P.O.Box 12", "POB 12", "Post Office Box 12" (review 3).
const PO_BOX_RE = /\b(?:P\.?\s*O\.?\s*Box|POB|Post\s+Office\s+Box)\s*#?\s*\d+/i;
// "contact John Smith", "Attn: Mary Jones", "c/o J. Doe", "POC Robert Brown": a person's name right after the word.
const NAME_TRIGGER_RE = /\b(?:[Cc]ontact|CONTACT|[Aa]ttn|ATTN|[Aa]ttention|ATTENTION|[Cc]\/[Oo]|POC|[Pp]oc)\b[\s.:-]*((?:[A-Z][A-Za-z'.-]*\s*){2,4})/g;

export type ContactKind = 'phone number' | 'e-mail address' | 'link' | 'street address' | "person's name";

/** What contact detail the text seems to hold, or null. Never edits anything. Run on text already capped (FIELD_MAX). */
export function contactFound(text: string, opts: { numberField?: boolean } = {}): ContactKind | null {
  if (!text) return null;
  if (EMAIL_RE.test(text)) return 'e-mail address';
  if (LINK_RE.test(text)) return 'link';
  if (opts.numberField ? PHONE10_FORMATTED_RE.test(text) || PHONE7_RE.test(text) : PHONE10_RE.test(text) || PHONE7_RE.test(text)) return 'phone number';
  if (STREET_RE.test(text) || YEAR_STREET_RE.test(text) || PO_BOX_RE.test(text)) return 'street address';
  for (const m of text.matchAll(NAME_TRIGGER_RE)) if (looksLikeFullPersonName(m[1].trim())) return "person's name";
  return null;
}

/** The plain reason shown to the owner: "The title looks like it contains a phone number, please remove it." */
export function contactText(field: 'title' | 'agency' | 'solicitation number', kind: ContactKind): string {
  return `The ${field} looks like it contains ${kind === 'e-mail address' ? 'an' : 'a'} ${kind}, please remove it.`;
}

const placeKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/\b(?:st|ste)\.?\s+/g, 'saint ')
    .replace(/\bft\.?\s+/g, 'fort ')
    .replace(/\bmt\.?\s+/g, 'mount ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
let placeNames: Set<string> | null = null;
/**
 * A bare place name the app's geo data knows (every town in the ZIP dataset, any state), optionally followed by a state code or the word
 * County / Parish: "Chapel Hill", "Wake Forest", "Villa Rica", "St. George", "Marietta GA" (review 3 P2-1). Never a person.
 */
export function knownPlaceName(text: string): boolean {
  placeNames ??= new Set(Object.values(zipcodes.codes).map((r) => placeKey(r.city)));
  const k = placeKey(text.replace(/,?\s+(?:[A-Z]{2})$/, '').replace(/\s+(?:county|parish|city|town|village)$/i, ''));
  return k.length > 0 && placeNames.has(k);
}

/** Words that make a name-shaped text a public body, a place or a thing, not a private person (review 2: "Georgia DOT", "Jackson EMC"). */
const PUBLIC_WORD =
  /\b(?:city|county|town|township|village|parish|borough|state|department|dept|dot|isd|emc|authority|district|schools?|board|commission|government|agency|purchasing|procurement|office|port|ports|transit|housing|university|college|institute|tech|metro|utilities|utility|water|energy|power|electric|gas|parks?|recreation|airport|aviation|hospital|health|medical|library|libraries|conservancy|center|centre|museum|zoo|garden|gardens|greenway|trail|bridge|street|road|avenue|highway|mountain|lake|river|beltline|works|services|police|fire|sheriff|court|courts|jail|corrections|restroom|concert|series|festival|stadium|arena|plaza|square|hall|building|campus|station|courthouse|terminal|tollway|field|cids?|biomedical|springs|hills|beach|grove|branch|estates|forest|cave)\b|^(?:san|santa|saint|st\.?)\s/i;

/**
 * Text that is only a private person's name (review P2-2, narrowed in review 2): two to four words, every word capitalized, holding a
 * given name or an initial (lib/contacts/org.ts looksLikeFullPersonName), with no public-body or place word, and (a title) naming no
 * trade. "John Q. Smith" and "SMITH, JOHN" are; "Georgia DOT", "Jackson EMC", "Raleigh Parks", "Laurel Park Restroom" are not. A title
 * is not tested when the owner picked a trade himself.
 */
export function onlyPersonName(text: string, kind: 'title' | 'agency'): boolean {
  if (knownPlaceName(text)) return false;
  const words = text.split(/[\s,]+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (!words.every((w) => /^[A-Z]/.test(w))) return false;
  if (PUBLIC_WORD.test(text)) return false;
  if (!looksLikeFullPersonName(text)) return false;
  if (kind === 'title') return bidTrades({ title: text }).length === 0;
  return true;
}

/** Hosts that only redirect somewhere else: the owner must paste the agency's own page. */
export const SHORTENER_HOSTS: ReadonlySet<string> = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 't.ly', 'bl.ink', 'lnkd.in', 's.id', 'tiny.one', 'shorte.st', 'adf.ly', 'qrco.de', 'urlz.fr', 'x.co', 'trib.al',
]);

/** Portal families whose terms ban commercial use (gates/r32/PORTALS.md: Bonfire/Euna, IonWave, DemandStar): hand-check only, never entered. */
export const TERMS_BARRED_HOSTS: readonly string[] = ['bonfirehub.com', 'ionwave.net', 'demandstar.com'];

const onHost = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

/** The host a link points to, for the preview ("mariettaga.gov"). */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

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
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
  // Punycode look-alike hosts are refused: a government page is not on one.
  if (/(?:^|\.)xn--/i.test(u.hostname)) return null;
  u.hash = '';
  return u.toString();
}

/** Comparison form of a link: host lower-cased without "www.", no trailing slash, the query kept (Bids.aspx?bidID=12 is one bid). */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    // Tracking parameters are dropped and the rest sorted with lower-case names, so two spellings of one link compare equal (review P2-3c).
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !/^(?:utm_.*|fbclid|gclid|mc_cid|mc_eid|_ga)$/i.test(k))
      .map(([k, v]) => [k.toLowerCase(), v] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1));
    const q = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${host}${path}${q}`;
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
    // A CivicPlus bid list: Bids.aspx with no bid id (bare, or a category list such as ?CatID=17). One bid's page carries bidID.
    if (!/\/bids\.aspx$/i.test(u.pathname)) return false;
    return ![...u.searchParams.keys()].some((k) => k.toLowerCase() === 'bidid');
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

/** Longest title and agency accepted; longer ones are refused, not cut (nothing is rewritten). */
export const MAX_TITLE = 200;
export const MAX_AGENCY = 120;
export const MAX_SOL = 60;

/** A title compared without case, spaces or punctuation, and without a feed's "Open bid in <place>: " prefix. */
export function titleKeyOf(title: string): string {
  return norm(title.replace(/^Open bid in [^:]{1,80}: /, '')).slice(0, 120);
}

function idPart(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}

/** Checks one hand-added bid and builds its signal. Pure apart from the geo lookup and the coverage test. */
export function buildManualBid(input: ManualBidFields, deps: RecordDeps): ManualBidResult {
  const now = deps.now;
  const f = capFields(input);
  const url = cleanUrl(f.url);
  if (!url) return { ok: false, problem: 'bad_url' };
  const host = linkHost(url);
  if (SHORTENER_HOSTS.has(host)) return { ok: false, problem: 'short_link' };
  if (TERMS_BARRED_HOSTS.some((b) => onHost(host, b))) return { ok: false, problem: 'terms_host' };
  // Text is kept exactly as typed (spaces tidied); a field with contact details is refused, never edited (review 2 P1-1).
  const titleText = cleanText(f.title ?? '');
  const agencyText = cleanText(f.agency ?? '');
  const solText = cleanText(f.solicitationId ?? '');
  if (titleText.length > MAX_TITLE || agencyText.length > MAX_AGENCY) return { ok: false, problem: 'too_long' };
  for (const [field, text, problem] of [
    ['title', titleText, 'contact_title'],
    ['agency', agencyText, 'contact_agency'],
    ['solicitation number', solText, 'contact_sol'],
  ] as const) {
    const kind = contactFound(text, { numberField: field === 'solicitation number' });
    if (kind) return { ok: false, problem, detail: contactText(field, kind) };
  }
  if (solText.length > MAX_SOL) return { ok: false, problem: 'too_long', detail: `The solicitation number is over ${MAX_SOL} characters: shorten it.` };
  // The formula strip runs last, after every other step (review 2 P2-A). Whatever it removes is listed in `notes`, which the preview
  // shows: nothing is changed silently (review 3 P2-4).
  const notes: string[] = [];
  const strip = (label: string, text: string): string => {
    const out = defuseFormula(text);
    if (out !== text) notes.push(`${label}: leading "${text.slice(0, text.length - out.length).trim()}" removed (spreadsheet formula characters).`);
    return out;
  };
  const title = strip('Title', titleText);
  if (title.length < 4) return { ok: false, problem: 'no_title' };
  const agency = strip('Agency', agencyText);
  if (agency.length < 2) return { ok: false, problem: 'no_agency' };
  const hint = (f.trade ?? '').trim();
  if (!hint && onlyPersonName(title, 'title')) return { ok: false, problem: 'person_name' };
  // An agency that reads like a person's name is a warning in the preview, not a refusal: real public bodies are often named after
  // people ("Ben Taub", "Lyndon B. Johnson Hospital") (review 3 P2-1).
  if (onlyPersonName(agency, 'agency')) notes.push('Agency reads like a person\'s name: check it is the government buyer.');
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

  let trades: CategoryId[];
  if (hint) {
    if (!isCategoryId(hint)) return { ok: false, problem: 'bad_trade' };
    trades = [hint];
  } else {
    // Same routing as every bid source: the title decides; the description only adds trades the title's own filters allow.
    trades = bidTrades({ title, description: f.description ? cleanText(f.description).slice(0, 2000) : null });
    if (trades.length === 0) return { ok: false, problem: 'no_trade' };
  }

  const solicitationId = strip('Solicitation number', solText) || null;
  const list = isListPage(url);
  const urlKey = normalizeUrl(url);
  const titleKey = titleKeyOf(title);
  const agencyKey = norm(agency).slice(0, 60);
  const solKey = solicitationId && norm(solicitationId).length >= 2 ? `${agencyKey}|${norm(solicitationId)}` : null;
  const externalId = solKey ? `manual:${agencyKey}:${norm(solicitationId as string).slice(0, 60)}` : `manual:t:${idPart(`${urlKey}|${titleKey}`)}`;
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
    keys: { urlKey, titleKey, solKey },
    view: { title, agency, dueDate: due.day, place: `${place.city}, ${place.state}${place.zip ? ` ${place.zip}` : ''}`, trades, solicitationId, url, host, notes },
  };
}
