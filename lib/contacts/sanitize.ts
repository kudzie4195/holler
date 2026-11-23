import { contactNameFor } from './names';
import { hasLegalSuffix } from './trade-name';
import { violationOwnersEnabled } from './owner-switch';
import {
  STREET_SUFFIX_WORDS,
  foldName,
  givenNameThenWord,
  hasContactShape,
  hasRoleWord,
  holdsGivenName,
  looksLikeFullPersonName,
} from './org';
import type { ContactInput, ContactRole } from './types';

/** Most contacts kept for one record (site first, then organizations in the order the record lists them). */
export const MAX_CONTACTS_PER_SIGNAL = 6;

/** Column limits, the same as the check constraints in supabase/migrations/0006_holler_contacts.sql. */
export const CONTACT_LIMITS = {
  name: 120,
  attn: 120,
  address: 200,
  city: 80,
  state: 30,
  zip: 10,
  phone: 20,
  email: 254,
  website: 300,
  license: 40,
} as const;

const ROLES = new Set<ContactRole>(['site', 'business', 'contractor', 'awardee', 'buyer', 'owner']);

function text(v: unknown, max: number): string {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** A plausible US phone number as 312-555-0100, or null. NANP: area code and exchange start with 2-9, no extension kept. */
export function usPhone(v: unknown): string | null {
  const raw = text(v, 40);
  if (!raw) return null;
  // An extension or a second number makes the value ambiguous: keep only the first 10 or 11 digit run.
  const m = raw.match(/^\s*(?:\+?1[\s.-]?)?\(?(\d{3})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})(?:\s*(?:x|ext\.?)\s*\d{1,6})?\s*$/i);
  if (!m) return null;
  const [, a, b, c] = m;
  if (!/^[2-9]\d\d$/.test(a) || !/^[2-9]\d\d$/.test(b)) return null;
  if (/^(\d)\1{9}$/.test(a + b + c)) return null;
  if (/^[2-9]11$/.test(a) || /^[2-9]11$/.test(b)) return null;
  return `${a}-${b}-${c}`;
}

/**
 * A contractor licence number as it may be stored: 3 to 40 characters of letters, digits, space, "-", "/", "." or "#", with at least one
 * digit and no phone, e-mail or link shape. "Not Applicable", a name or a sentence is null. Licence numbers are public registry ids of
 * the business; a nine-digit run (SSN shape) is refused outright.
 */
export function cleanLicense(v: unknown): string | null {
  const s = text(v, CONTACT_LIMITS.license + 1);
  if (!s || s.length > CONTACT_LIMITS.license || s.length < 3) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ./#-]*$/.test(s) || !/\d/.test(s)) return null;
  // Driver-licence shapes ("D1234567", "DL 1234567", "A1234567B") and a nine-digit run with separators ("1234-56-789") are never a contractor board number.
  if (/^[A-Za-z]{1,2}[\s-]?\d{7,8}[A-Za-z]?$/.test(s) || (/^[\d\s./-]+$/.test(s) && s.replace(/\D/g, '').length === 9)) return null;
  if (CONTACT_DETAIL_RE.test(s) || /^\d{3}[- ]?\d{2}[- ]?\d{4}$/.test(s) || /^\d{9}$/.test(s)) return null;
  return s;
}

/** A plausible email address in lower case, or null. */
export function plainEmail(v: unknown): string | null {
  const s = text(v, CONTACT_LIMITS.email + 1).toLowerCase();
  if (!s || s.length > CONTACT_LIMITS.email) return null;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/.test(s) &&
    !s.includes('..')
    ? s
    : null;
}

/** An http(s) address for a website, or null. A bare domain gets https://. */
export function plainWebsite(v: unknown): string | null {
  const s = text(v, CONTACT_LIMITS.website + 1);
  if (!s || s.length > CONTACT_LIMITS.website || /\s/.test(s)) return null;
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!/^https?:$/.test(u.protocol) || !/\.[a-z]{2,24}$/i.test(u.hostname) || u.username || u.password) return null;
    const out = u.toString();
    return out.length <= CONTACT_LIMITS.website ? out : null;
  } catch {
    return null;
  }
}

function zip5(v: unknown): string | null {
  const s = text(v, 20);
  const m = s.match(/^(\d{5})(?:-?(\d{4}))?$/);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}

/** An email, or a phone number in any common layout (also glued to letters or an extension). */
const CONTACT_DETAIL_RE = /@|(?<!\d)(?:\+?1[\s./_-]?)?\(?\d{3}\)?[\s./_-]*\d{3}[\s./_-]*\d{4}(?!\d)|(?<![\d-])\d{3}[\s.-]\d{4}(?!\d)/;

/** Role words in an address line: "c/o", "attn", "care of", "%" (care of). */
const ADDRESS_ROLE_RE = /%|\bc\s*\/\s*o\b|\bcare\s+of\b|\battn\b|\battention\b/i;

const DIRECTIONALS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']);
/** The one unit that may follow the street suffix: the word and one short token ("STE 100", "APT 4B", "#5B"). */
const UNIT_WORDS = new Set(['ste', 'suite', 'unit', 'apt', '#', 'fl', 'floor', 'bldg', 'rm']);
/** A unit token: holds a digit, or is at most 2 letters, or is a position word (review4 P2-11). Never a name ("APT JOHN", "#MARIA"). */
function unitTokenOk(t: string | undefined): boolean {
  if (!t || !/^[A-Za-z0-9-]{1,6}$/.test(t)) return false;
  return /\d/.test(t) || /^[A-Za-z]{1,2}$/.test(t) || /^(?:rear|front|bsmt|uppr|lowr)$/i.test(t);
}
const HOUSE_RE = /^(\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?)\s+(.+)$/;
const STREET_WORD_RE = /^[A-Za-z0-9][A-Za-z0-9'.-]*$/;
/** Most street-name words before the suffix, after an optional leading direction (review4 P2-5, P2-11). */
const MAX_STREET_WORDS = 3;

const key = (w: string): string => foldName(w).replace(/\.+$/, '');

/** A street word that may be stored: letters, digits, "'", "-", a final period only; no 3+ digit run unless it is an ordinal (P2-12). */
function streetWordOk(w: string): boolean {
  if (!STREET_WORD_RE.test(w)) return false;
  if (/\.\S/.test(w)) return false; // an inner period ("john.smith.gmail.com")
  return !/\d{3,}/.test(w) || /^\d+(?:st|nd|rd|th)$/i.test(w);
}

/**
 * An address line as it may be stored (round 5 FIX-E, review3 P1-1; FIX-F, review4 P2-11, P2-12), every role. It must START with a house
 * number (digits, an optional letter, an optional range: "12", "12B", "12-14") or "PO BOX <digits>"; nothing before it is allowed. Then at
 * most three street-name words (after an optional leading direction), each letters and digits with no inner period and no 3+ digit run
 * unless an ordinal, and the line is CUT right after the street suffix word ("ST", "AVE", "BLVD" ...), plus at most one unit ("STE|SUITE|
 * UNIT|APT|#|FL|FLOOR|BLDG|RM" and one token that holds a digit, has at most 2 letters, or is REAR FRONT BSMT UPPR LOWR; or "#5B").
 * Everything after that is dropped: a name, a phone, a city. A street written type-first ("4812 AVENUE H") ends at the token after the
 * type word, which must hold a digit or be one letter. No street suffix: null, except one street word after an optional direction
 * ("2150 N DAMEN") with at most a unit after it. The kept line must also pass the cleanAddressPart checks (no phone, email, link or role
 * word). "PO BOX 12 SMITH JOHN" gives "PO BOX 12".
 */
export function cleanAddress(raw: unknown): string | null {
  const a = text(raw, CONTACT_LIMITS.address).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a) return null;
  const po = a.match(/^p\.?\s?o\.?\s*box\s+#?(\d{1,6})(?=\s|$)/i);
  if (po) return `PO BOX ${po[1]}`;
  const m = a.match(HOUSE_RE);
  if (!m) return null;
  const house = m[1].replace(/\s+/g, '');
  if ((house.match(/\d/g) ?? []).length > 6) return null; // review4 P2-12: a phone hidden in a house range ("12-555019")
  const words = m[2].split(' ');
  const d = DIRECTIONALS.has(key(words[0] ?? '')) && words.length > 1 ? 1 : 0;
  let end = -1;
  for (let i = d; i < words.length && i <= d + MAX_STREET_WORDS; i++) {
    if (!streetWordOk(words[i])) break; // an odd token before a suffix: only the one-word form below can still pass
    if (!STREET_SUFFIX_WORDS.has(key(words[i]))) continue;
    if (i > d) {
      end = i;
      break;
    }
    // Type first: "4812 AVENUE H", "100 ROAD 12": the next token holds a digit or is one letter.
    const next = words[i + 1];
    if (next && (/^[A-Za-z]$/.test(next) || /^(?=.*\d)[A-Za-z0-9]{1,4}$/.test(next)) && streetWordOk(next)) {
      end = i + 1;
      break;
    }
  }
  let out: string[];
  if (end < 0) {
    // No street suffix: allowed ONLY as one street word of letters or an ordinal after an optional single direction word ("2150 N DAMEN",
    // "4410 W ADDISON", "2318 W 47TH"; Chicago permits keep the suffix in no column), then nothing but an optional unit.
    // Two or more street words still need a suffix ("12 SMITH JOHN", "2318 W LOPEZ MARIA" stay null).
    const one = words[d];
    if (!one || !/^(?:[A-Za-z]+|\d+(?:st|nd|rd|th))$/i.test(one)) return null;
    const rest = words.slice(d + 1);
    const unitOk =
      rest.length === 0 ||
      (rest.length === 1 && rest[0].startsWith('#') && unitTokenOk(rest[0].slice(1))) ||
      (rest.length === 2 && UNIT_WORDS.has(key(rest[0])) && unitTokenOk(rest[1]));
    if (!unitOk) return null;
    out = words;
  } else {
    out = words.slice(0, end + 1);
    const u = words[end + 1];
    if (u && u.startsWith('#') && u.length > 1 && unitTokenOk(u.slice(1))) out.push(u);
    else if (u && UNIT_WORDS.has(key(u)) && unitTokenOk(words[end + 2])) out.push(u, words[end + 2]);
  }
  const kept = `${house} ${out.join(' ')}`;
  // review4 P2-12: the cleanAddressPart checks run on the kept line too ("100 312-555-0199 MAIN ST").
  return cleanAddressPart(kept) === kept ? kept : null;
}

/** Words that name a part of a building or a pad, never part of a street a block form may carry. */
const BLOCK_UNIT_RE = /#|\b(?:apt|apartment|unit|ste|suite|fl|flr|floor|rm|room|bldg|lot|space|spc|trailer|trlr|ph|penthouse|bsmt|basement)\b/i;

/**
 * Round 20 (NEXT, owner decision: a 311 request gives at most a block-level site). A BLOCK-level address and nothing else: "2300 block of
 * W 47TH ST", "0-99 block of MAIN ST". The street after "block of" must be exactly what cleanAddress keeps when a house number is put in
 * front of it ("100 W 47TH ST"), so its street-word, phone, role and person-name checks apply and nothing typed into a street column
 * rides along; no unit, pad or building-part word is allowed. Returns the block form as written (spaces folded), or null.
 */
export function blockSiteAddress(raw: unknown): string | null {
  const t = text(raw, CONTACT_LIMITS.address).replace(/\s+/g, ' ').trim();
  const m = /^(0-99|[1-9]\d{0,4}00) block of (\S.*)$/i.exec(t);
  if (!m) return null;
  const street = m[2];
  if (BLOCK_UNIT_RE.test(street)) return null;
  const probe = `100 ${street}`;
  if (cleanAddress(probe) !== probe) return null;
  return `${m[1]} block of ${street}`;
}

/**
 * One address part before parts are joined (extract.ts), so a bad second line cannot ride on a good first line: '' when it holds a phone,
 * an email, a link or a role word. With `names` (an organization's address lines), a part with no digit must not read as a personal name
 * either ("JOHN SMITH"). The joined line then goes through cleanAddress, which cuts it after the street suffix and unit.
 */
export function cleanAddressPart(raw: string, opts: { names?: boolean } = {}): string {
  const a = text(raw, CONTACT_LIMITS.address);
  if (!a) return '';
  if (CONTACT_DETAIL_RE.test(a) || hasContactShape(a) || ADDRESS_ROLE_RE.test(a) || hasRoleWord(a)) return '';
  if (opts.names && !/\d/.test(a) && (givenNameThenWord(a) || looksLikeFullPersonName(a) || holdsGivenName(a))) return '';
  return a;
}

/** US state and territory codes, and full names normalized to the code. */
const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR', guam: 'GU',
  'virgin islands': 'VI', 'us virgin islands': 'VI', 'american samoa': 'AS', 'northern mariana islands': 'MP',
};
const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

/** A 2-letter US state or territory code, or a full state name normalized to its code; anything else is null. */
export function cleanState(v: unknown): string | null {
  const t = text(v, 40).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return STATE_CODES.has(t.toUpperCase()) ? t.toUpperCase() : null;
  return STATE_NAME_TO_CODE[t.toLowerCase()] ?? null;
}

/**
 * A city as it may be stored: ONLY the dataset's own configured city (case-insensitive, `datasetCity`). Anything else is null (FIX-F,
 * review4 P2-13: a lone surname such as "Moore" or "Rivera" is also a city word, so no place vocabulary is trusted).
 */
export function cleanCity(v: unknown, datasetCity?: string | null): string | null {
  const s = text(v, CONTACT_LIMITS.city);
  if (!s || !datasetCity) return null;
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, ' ').trim();
  return norm(s) === norm(datasetCity) ? s : null;
}

export interface SanitizeOptions {
  /** The dataset's own configured city ("Chicago"): a city column equal to it is kept whatever its words. */
  datasetCity?: string | null;
}

/**
 * One contact, trimmed and limited to the column sizes, or null when it must not be stored:
 *  - an unknown role, or role 'buyer' (no adapter produces buyers yet: the bids unit must add its own reviewed rules first);
 *  - a business, contractor, awardee or owner whose name the role's rule does not accept (names.ts contactNameFor: contractor ->
 *    trade-name rule, owner -> registered-company rule, the others -> the strict organization rule of org.ts);
 *  - an owner company keeps its name only: address, city, state, zip, phone, email and licence are always null;
 *  - a contractor's own address (address, city, state, zip) is kept only when the name ends with a legal form (redo 1, rule 5): a sole
 *    trader's street address is often a home;
 *  - a site whose address does not pass cleanAddress. A site never carries a name, a phone, an email or a website: it is a place.
 * Every role: `address` through cleanAddress (house number or PO BOX first, cut after the street suffix and one unit), `state` a US code
 * (cleanState), `city` through cleanCity (the dataset's own city or place words only), `zip` 5 digits or ZIP+4, `attn` and `website`
 * always null. A phone that is not a plausible US number and an email that is not a plausible address are dropped (the rest stays).
 */
export function sanitizeContact(c: ContactInput | null | undefined, opts: SanitizeOptions = {}): ContactInput | null {
  if (!c || typeof c !== 'object' || !ROLES.has(c.role)) return null;
  // No adapter produces buyers today; the bids unit must add its own reviewed rules before any buyer is stored.
  if (c.role === 'buyer') return null;
  const base = {
    city: cleanCity(c.city, opts.datasetCity),
    state: cleanState(c.state),
    zip: zip5(c.zip),
  };
  if (c.role === 'site') {
    // Round 20 (NEXT): a block-level site ("2300 block of W 47TH ST", a 311 request) is kept as written when it is nothing but the block
    // form (blockSiteAddress); cleanAddress reads "block of" as street words and would drop most of them. Anything else as before.
    const raw = typeof c.address === 'string' ? c.address : '';
    const address = blockSiteAddress(raw) ?? cleanAddress(raw);
    if (!address) return null;
    return { role: 'site', name: '', attn: null, address, ...base, phone: null, email: null, website: null };
  }
  // A business name was checked against its row at extraction (trade-name.ts rule L3); here only its shape can be re-checked.
  const cleaned = contactNameFor(c.role, typeof c.name === 'string' ? c.name : '', { shapeOnly: true });
  if (!cleaned) return null;
  if (c.role === 'owner') {
    // Redo 2 (review P3-4): the switch is checked here too, so no caller can store an owner row while it is off.
    if (!violationOwnersEnabled()) return null;
    return { role: 'owner', name: cleaned.slice(0, CONTACT_LIMITS.name), attn: null, address: null, city: null, state: null, zip: null, phone: null, email: null, website: null };
  }
  const license = cleanLicense(c.license);
  const ownAddress = c.role !== 'contractor' || hasLegalSuffix(cleaned);
  return {
    role: c.role,
    name: cleaned.slice(0, CONTACT_LIMITS.name),
    attn: null,
    address: ownAddress ? cleanAddress(typeof c.address === 'string' ? c.address : '') : null,
    ...(ownAddress ? base : { city: null, state: null, zip: null }),
    phone: usPhone(c.phone),
    email: plainEmail(c.email),
    ...(license ? { license } : {}),
    // No adapter supplies a website, and a URL path or query can carry a person: the bids unit must add its own reviewed rules first.
    website: null,
  };
}

/** Sanitised, de-duplicated (role + name + address) and capped list. Sites come first. */
export function sanitizeContacts(list: readonly (ContactInput | null | undefined)[] | null | undefined, opts: SanitizeOptions = {}): ContactInput[] {
  if (!Array.isArray(list)) return [];
  const out: ContactInput[] = [];
  const seen = new Set<string>();
  const clean = list.map((c) => sanitizeContact(c, opts)).filter((c): c is ContactInput => c !== null);
  clean.sort((a, b) => Number(b.role === 'site') - Number(a.role === 'site'));
  for (const c of clean) {
    const k = `${c.role}\u0000${c.name.toLowerCase()}\u0000${(c.address ?? '').toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= MAX_CONTACTS_PER_SIGNAL) break;
  }
  return out;
}
