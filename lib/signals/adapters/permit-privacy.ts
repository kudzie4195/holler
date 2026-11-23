import { NEW_HOME_RE } from './socrata-datasets';
import { givenNameThenWord, isVocabularyWord, looksLikeFullPersonName, looksLikePersonName } from '@/lib/contacts/org';
import type { CategoryId } from '@/lib/signals/categories';

/**
 * Public-text hygiene for open-data rows. holler_signals is publicly readable and shown on public pages, and city permit
 * descriptions are free text typed by applicants: they hold homeowner names, phone numbers, emails and links.
 *
 * Rules (simple and safe beats clever; when unsure the text is dropped):
 *  - Free text may be READ to classify trades. It is never copied into a title, and anything stored (summary) goes through scrubText.
 *  - A permit title is built from a short work-type label: the dataset's own type or class column when its value is short and code-like,
 *    otherwise the matched trade ("Roof permit in Chicago"), otherwise "Permit in Chicago".
 */

export const MAX_TITLE_CHARS = 60;
export const MAX_SUMMARY_CHARS = 140;
export const MIN_SUMMARY_CHARS = 15;

const PH = '';

const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|gov|us|io|co|edu|info|biz)\b(?:\/\S*)?/gi;
// 10 digits with any of ( ) space . - between the groups, optional +1; then 7 digits with - or . only; then "ph 813 0256" with a space.
const PHONE10_RE = /(?<![\w-])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}(?![\w-])/g;
const PHONE7_RE = /(?<![\w-])\d{3}[-.]\d{4}(?![\w-])/g;
const PHONE7_SPACE_RE = /(?<=\b(?:ph|phone|tel|cell|mobile|call|text|fax)\b[\s.:#]*)\d{3}\s\d{4}(?![\w-])/gi;
const PHONE_LABEL_RE = /\b(?:ph|phone|tel|telephone|cell|mobile|fax|call|text)\b[\s.:#]*(?=)/gi;

const TRIGGERS = new Set([
  'for', 'owner', 'owners', 'homeowner', 'homeowners', 'customer', 'client', 'contact', 'applicant', 'c/o', 'attn', 'attention',
  'mr', 'mrs', 'ms', 'miss', 'name',
]);
/** Words that never start or continue a person's name in these records (business suffixes, places, streets, work terms). */
const NOT_NAME = new Set(
  (
    'inc llc ltd lp llp corp corporation co company companies group holdings partners enterprises associates properties realty construction ' +
    'builders building buildings contractors contracting services service solutions systems industries development developers homes ' +
    'roofing plumbing electric electrical hvac heating cooling mechanical church school university college hospital bank store ' +
    'restaurant hotel motel apartments apartment center centre authority district county city state department dept office plaza mall ' +
    'street st avenue ave road rd drive dr boulevard blvd lane ln court ct way place pl highway hwy parkway pkwy circle cir terrace ter ' +
    'north south east west floor unit suite ste lot bldg the a an of and or to on in at by with new existing residential commercial ' +
    'single family multi house home residence dwelling garage roof roofing install installation replace replacement repair remodel ' +
    'renovation interior exterior addition construct demolition permit system unit units tenant ' +
    'filing herewith customer wants use eplans'
  ).split(' '),
);
const BUSINESS_WORD = new Set(
  (
    'inc llc ltd lp llp corp corporation co company companies group holdings partners enterprises associates properties realty construction ' +
    'builders contractors contracting services solutions industries development developers homes roofing plumbing electric heating ' +
    'church school university college hospital bank store restaurant hotel apartments center authority'
  ).split(' '),
);
const DANGLING = new Set([...TRIGGERS, 'call', 'ph', 'phone', 'tel', 'cell', 'mobile', 'fax', 'text', 'at', 'and', '&']);

function core(token: string): string {
  return token.replace(/^[^A-Za-z&]+|[^A-Za-z&./]+$/g, '');
}
function isCapWord(token: string): boolean {
  return /^[A-Z][A-Za-z'’-]*\.?$/.test(core(token)) && !/\d/.test(token);
}
function isNameToken(token: string): boolean {
  const c = core(token);
  return isCapWord(token) && !NOT_NAME.has(c.replace(/\.$/, '').toLowerCase());
}
function isBusinessToken(token: string): boolean {
  return BUSINESS_WORD.has(core(token).replace(/\.$/, '').toLowerCase());
}

function removePhonesAndLinks(text: string): string {
  return text
    .replace(EMAIL_RE, ' ')
    .replace(URL_RE, ' ')
    .replace(PHONE10_RE, ` ${PH} `)
    .replace(PHONE7_RE, ` ${PH} `)
    .replace(PHONE7_SPACE_RE, ` ${PH} `)
    .replace(PHONE_LABEL_RE, '');
}

/**
 * Walks `tokens` and blanks name segments: capitalized words after a trigger word ("for", "owner", "customer", "c/o", ...), and up to three
 * capitalized words directly before or after a (removed) phone number. A run that touches a business word ("for ABC Roofing LLC") is kept.
 */
function removeNames(tokens: string[]): string[] {
  const out = [...tokens];
  const blank = (i: number) => {
    out[i] = '';
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    const bare = core(t).toLowerCase().replace(/[:]+$/, '');
    if (!TRIGGERS.has(bare) && !TRIGGERS.has(t.toLowerCase().replace(/[:,.]+$/, ''))) continue;
    // Gather the run that follows: capitalized words, with "&" / "and" joining two names.
    const run: number[] = [];
    let sawBusiness = false;
    for (let j = i + 1; j < tokens.length && run.length < 6; j++) {
      const w = tokens[j];
      if (!w) break;
      const c = core(w);
      if (c === '&' || c.toLowerCase() === 'and') {
        if (run.length && tokens[j + 1] && isCapWord(tokens[j + 1])) {
          run.push(j);
          continue;
        }
        break;
      }
      if (!isCapWord(w)) break;
      if (isBusinessToken(w)) {
        sawBusiness = true;
        break;
      }
      const honorific = run.length === 0 && /^(?:Dr|Mr|Mrs|Ms)\.$/.test(w);
      if (!honorific && !isNameToken(w)) break;
      run.push(j);
      if (/[.;]$/.test(w) && !/^[A-Z]\.$/.test(w) && !honorific) break; // sentence end
    }
    const names = run.filter((j) => core(tokens[j]) !== '&' && core(tokens[j]).toLowerCase() !== 'and');
    if (!names.length || sawBusiness) continue;
    const end = names[Math.min(names.length, 4) - 1];
    blank(i);
    for (const j of run) if (j <= end) blank(j);
  }

  // Names next to a phone number: up to three capitalized words on either side.
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== PH) continue;
    let j = i - 1;
    while (j >= 0 && (out[j] === '' || DANGLING.has(core(tokens[j]).toLowerCase()) || /^[-–:#,]+$/.test(tokens[j]))) j--;
    const back: number[] = [];
    while (j >= 0 && back.length < 3 && out[j] !== '' && (isNameToken(tokens[j]) || (core(tokens[j]) === '&' && back.length))) {
      back.push(j);
      j--;
    }
    // A single capitalized word is only a name when it is the first word or follows a sentence break / separator.
    for (const k of back) blank(k);
    let f = i + 1;
    while (f < tokens.length && (out[f] === '' || /^[-–:,]+$/.test(tokens[f]))) f++;
    let n = 0;
    while (f < tokens.length && n < 3 && isNameToken(tokens[f])) {
      blank(f);
      f++;
      n++;
    }
  }
  return out;
}

function tidy(text: string): string {
  let t = text
    .replace(new RegExp(PH, 'g'), ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // Drop leading / trailing separators and dangling trigger words ("... for", "Call").
  for (let guard = 0; guard < 6; guard++) {
    const before = t;
    t = t.replace(/^[\s,;:|\-–&]+|[\s,;:|\-–&]+$/g, '');
    const m = t.match(/(?:^|\s)([A-Za-z/]+)[.:]?$/);
    if (m && DANGLING.has(m[1].toLowerCase())) t = t.slice(0, t.length - m[0].length).trim();
    const first = t.match(/^([A-Za-z/]+)[.:]?(?:\s|$)/);
    if (first && DANGLING.has(first[1].toLowerCase()) && first[1].toLowerCase() !== 'and') t = t.slice(first[0].length).trim();
    if (t === before) break;
  }
  return t;
}

/** Removes emails, links, phone numbers and likely personal names. Never throws. */
export function scrubText(raw: string): string {
  if (!raw) return '';
  try {
    const stripped = removePhonesAndLinks(raw.replace(/\s+/g, ' ').trim()).replace(new RegExp(PH, 'g'), ` ${PH} `);
    const tokens = stripped.split(/\s+/).filter(Boolean);
    const kept = removeNames(tokens).filter((x) => x !== '');
    return tidy(kept.join(' '));
  } catch {
    return '';
  }
}

/** Cuts at a word boundary so the result (with "...") is at most `max` characters. */
export function truncateWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 3);
  const sp = cut.lastIndexOf(' ');
  const base = (sp > 0 ? cut.slice(0, sp) : cut).replace(/[\s,;:|\-–.]+$/, '');
  return `${base}...`;
}

/**
 * The stored summary: every part scrubbed, joined, cut to 140 characters. Returns null when `forceMin` and what is left is shorter than
 * 15 characters (a permit row's remaining fragment says nothing).
 */
export function publicSummary(parts: string[], opts: { max?: number; minChars?: number } = {}): string | null {
  const max = opts.max ?? MAX_SUMMARY_CHARS;
  const cleaned = [...new Set(parts.map((p) => scrubText(p)).filter(Boolean))];
  const joined = truncateWords(cleaned.join(' | '), max);
  if (opts.minChars != null && joined.length < opts.minChars) return null;
  return joined || null;
}

/** Summary columns that hold a money amount (job cost, valuation). Square footage, scores and zip codes are not money. */
const MONEY_FIELD_RE = /cost|valuation|value|constrval/i;

/** The money columns among some field names (the project value the dataset publishes), in the given order. */
export function moneyFields(fields: readonly string[]): string[] {
  return fields.filter((f) => MONEY_FIELD_RE.test(f));
}

/**
 * One summary part for display. Money columns become "$3,149 job value" (0 or unparseable is dropped);
 * long float noise such as 7807.6999999999998 in any numeric column is rounded.
 */
export function summaryPart(field: string, raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const num = /^-?\d+(?:\.\d+)?$/.test(v) ? Number(v) : NaN;
  if (MONEY_FIELD_RE.test(field)) {
    if (!Number.isFinite(num) || num <= 0) return '';
    return `$${Math.round(num).toLocaleString('en-US')} job value`;
  }
  if (Number.isFinite(num) && /\.\d{3,}$/.test(v)) return String(Math.round(num * 100) / 100);
  return v;
}

// ---- Permit titles ----------------------------------------------------------------------------------------------------------------

/** Column names that hold a type or class (a short code-like value) rather than a description. */
export function permitTypeFields(titleFields: string[]): string[] {
  return titleFields.filter((f) => /type|class|categor/i.test(f));
}

/**
 * Short work-type label from a dataset's own permit type value, or null. Accepted: at most 4 words and 30 letters-only characters
 * (spaces, "&", "/" and "-" allowed), no digits, none of the trigger words. "PERMIT - ROOFING" becomes "Roofing"; the word "permit" is removed.
 */
export function typeLabel(value: string): string | null {
  const v = value
    .replace(/\bpermits?\b/gi, ' ')
    .replace(/[\s_]+/g, ' ')
    .replace(/^[\s\-–:/&]+|[\s\-–:/&]+$/g, '')
    .trim();
  if (!v || v.length > 30 || /[^A-Za-z &/-]/.test(v)) return null;
  const words = v.split(' ').filter(Boolean);
  if (words.length > 4) return null;
  if (words.some((w) => TRIGGERS.has(w.toLowerCase()) || /^(?:wants?|call|phone)$/i.test(w))) return null;
  const letters = v.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return null;
  const t = letters === letters.toUpperCase() || letters === letters.toLowerCase()
    ? v.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    : v;
  return t;
}

/** City-internal process names that say nothing about the work. */
const JARGON_RE = /\b(?:express|program|post card|supplemental|combo|loop|otc|over the counter|e-?plans?|walk-?thru|misc(?:ellaneous)?)\b/i;

/** Tidies a type label for the public title, or drops it when it is process jargon. */
export function plainType(label: string | null): string | null {
  if (!label) return null;
  if (/^(?:new|construct|construction|general|other|residential|commercial)$/i.test(label)) {
    return /^(?:new|construct|construction)$/i.test(label) ? 'New construction' : null;
  }
  const cleaned = label.replace(/\b(?:otc|over the counter)\b\s*/gi, '').trim();
  if (!cleaned || JARGON_RE.test(cleaned)) return null;
  return cleaned;
}

/** Trade label used in "<label> permit in <city>". Order matters: the first match wins. */
const TRADE_LABELS: [CategoryId, string][] = [
  ['roofing', 'Roof'],
  ['hvac', 'HVAC'],
  ['plumbing', 'Plumbing'],
  ['electrical', 'Electrical'],
  ['solar', 'Solar'],
  ['pool-spa', 'Pool'],
  ['fencing', 'Fence'],
  ['windows-doors', 'Window and door'],
  ['siding-gutters', 'Siding and gutter'],
  ['flooring', 'Flooring'],
  ['concrete-paving', 'Concrete'],
  ['signs-printing', 'Sign'],
  ['painting', 'Painting'],
  ['general-contractor', 'Building'],
];

/** Work-type label from the matched trades and the (still unscrubbed) classifier text; null when nothing matches. */
export function tradeLabel(categories: CategoryId[], text: string): string | null {
  if (NEW_HOME_RE.test(text)) return 'New home';
  const set = new Set(categories);
  for (const [id, label] of TRADE_LABELS) if (set.has(id)) return label;
  if (/\bdemolition\b|\bdemo\b|wrecking/i.test(text)) return 'Demolition';
  return null;
}

/**
 * "<Type> permit in <City>". Never contains permit free text. `typeValues` are the values of the dataset's type or class columns;
 * the first one that is short and code-like names the work, else the matched trade, else plain "Permit in <City>".
 */
export function permitTitle(city: string, typeValues: string[], categories: CategoryId[], classifierText: string): string {
  // A matched trade reads better than a city's internal permit code ("Roof" beats "Express Program"), so it wins when present.
  const candidates = [tradeLabel(categories, classifierText), ...typeValues.map(typeLabel).map(plainType)].filter((x): x is string => Boolean(x));
  for (const label of candidates) {
    const t = `${label} permit in ${city}`;
    if (t.length <= MAX_TITLE_CHARS) return t;
  }
  const plain = `Permit in ${city}`;
  return plain.length <= MAX_TITLE_CHARS ? plain : plain.slice(0, MAX_TITLE_CHARS);
}

// ---- Violation and 311 text, and street addresses (round 7 fix-a, review r1 P2) ------------------------------------------------------

/**
 * A 311 or violation value that reads like prose a person typed, not a category from the portal's list: more than 12 words, a phone
 * number or a house number inside text, or words about who reported it ("reported by", "tenant", "caller", "John Doe reports"). Such a value is
 * never printed: the title uses the fixed label instead (civicLabel). The name scrubber only removes a name next to a trigger word, so
 * "John Doe reports roof leak" would otherwise keep "John Doe".
 */
export function looksLikeProse(value: string): boolean {
  const v = value.replace(/\s+/g, ' ').trim();
  if (!v) return false;
  // A plain number (a ZIP code, a count) is not prose.
  if (/^[\d\s.,$-]+$/.test(v)) return false;
  if (v.split(' ').length > 12) return true;
  // A phone number, or a house number inside text.
  if (/\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}|\b\d{3,}\b.*[A-Za-z]|[A-Za-z].*\b\d{3,}\b/.test(v)) return true;
  // Words that only appear when someone describes who reported what. "Illegal Dumping Reports" is a category; "John Doe reports" is not.
  if (/\breported\s+by\b|\bcaller\b|\bcomplainant\b|\btenants?\b|\blandlord\b|\bneighbou?rs?\b|\bhomeowner\b/i.test(v)) return true;
  return /\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:reports|reported|says|called|states)\b/.test(v);
}

const NAME_SEPARATOR_RE = /\s+[-\u2013\u2014]+\s*|\s*[-\u2013\u2014]+\s+|[,;:()[\]]/;
const RESIDENCE_RE = /\b([A-Za-z][A-Za-z'\u2019-]+)\s+(?:residence|res|family|household|home|house|property)\b/gi;
const plainWord = (w: string) => NOT_NAME.has(w.toLowerCase()) || isVocabularyWord(w);

/**
 * Does a short category or type value (a 311 type, a violation description column, a permit type) carry what looks like a person's
 * name? Commander decision 7 (verify-v1 finding 8): such a value is never printed. Uses the existing name guards:
 *  - the scrubber's own rule (scrubText): a capitalized word it removes (a name after "for", "owner", "c/o", next to a phone), or an
 *    email or link;
 *  - a name after a separator ("Roof leak - John Doe", "Tree down, Doe, John"): a segment, or everything after the first separator,
 *    that the contact classifier reads as a full personal name, or a one-word segment that is a listed given name or surname;
 *  - a listed given name followed by a word on no vocabulary ("Roof leak John Doe");
 *  - a word on no vocabulary before "residence", "family", "home", "house" ("Roof leak Garcia residence").
 * Pure; when unsure it answers true (the value is withheld and the title uses fixed words).
 */
export function categoryValueHasName(value: string): boolean {
  const v = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return false;
  if (new RegExp(EMAIL_RE.source).test(v) || new RegExp(URL_RE.source, 'i').test(v)) return true;
  const wordsOf = (t: string) => t.match(/[A-Za-z][A-Za-z'\u2019-]*/g) ?? [];
  const kept = new Set(wordsOf(scrubText(v)).map((w) => w.toLowerCase()));
  if (wordsOf(v).some((w) => !kept.has(w.toLowerCase()) && isCapWord(w) && !DANGLING.has(w.toLowerCase()))) return true;
  // A plural marker ("Violation(s)") is not a separator.
  const sv = v.replace(/\((?:s|es)\)/gi, '');
  const parts = sv.split(NAME_SEPARATOR_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const rest = sv.slice(sv.search(NAME_SEPARATOR_RE)).replace(/^[\s\-\u2013\u2014,;:()[\]]+/, '');
    if (rest.replace(/[^A-Za-z]/g, '').length >= 3 && looksLikeFullPersonName(rest)) return true;
    for (const seg of parts.slice(1)) {
      const n = seg.split(' ').length;
      if (n === 1 ? seg.replace(/[^A-Za-z]/g, '').length >= 2 && looksLikePersonName(seg) && !plainWord(seg) : n <= 4 && looksLikeFullPersonName(seg)) return true;
    }
  }
  if (givenNameThenWord(v, (w) => plainWord(w))) {
    // only when the pair is written like a name (both capitalized), so "will", "grant", "mark" in plain text do not count
    const ws = v.split(' ');
    for (let i = 0; i < ws.length - 1; i++) {
      if (isCapWord(ws[i]) && isCapWord(ws[i + 1]) && !plainWord(ws[i + 1].replace(/[^A-Za-z'-]/g, '')) && looksLikeFullPersonName(`${ws[i]} ${ws[i + 1]}`)) return true;
    }
  }
  for (const m of v.matchAll(RESIDENCE_RE)) if (!plainWord(m[1]) && isCapWord(m[1])) return true;
  return false;
}

/** Fixed words for a 311 or violation title, by trade (first match wins; at most two are joined). Never text from the record. */
const CIVIC_LABELS: [CategoryId, string][] = [
  ['roofing', 'roof'],
  ['plumbing', 'plumbing or leak'],
  ['hvac', 'heating or cooling'],
  ['electrical', 'electrical'],
  ['pest-control', 'pests'],
  ['junk-removal', 'trash or debris'],
  ['lawn-care', 'overgrown yard'],
  ['landscaping', 'overgrown yard'],
  ['tree-service', 'trees'],
  ['windows-doors', 'windows or doors'],
  ['siding-gutters', 'siding or gutters'],
  ['fencing', 'fence'],
  ['painting', 'paint or graffiti'],
  ['concrete-paving', 'pavement'],
  ['flooring', 'floors'],
  ['pool-spa', 'pool'],
  ['restoration', 'water or fire damage'],
  ['towing', 'vehicle'],
  ['general-contractor', 'building condition'],
  ['handyman', 'building condition'],
];

/** "roof", "roof and plumbing or leak", or the fallback when no trade has a word. */
export function civicLabel(categories: readonly string[], fallback: string): string {
  const set = new Set(categories);
  const words: string[] = [];
  for (const [c, w] of CIVIC_LABELS) if (set.has(c) && !words.includes(w)) words.push(w);
  return words.length ? words.slice(0, 2).join(' and ') : fallback;
}

const STREET_SUFFIX_RE =
  /^(?:st|street|dr|drive|rd|road|ln|lane|ave|av|avenue|blvd|boulevard|ct|court|cir|circle|pkwy|parkway|trl|trail|ter|terrace|hwy|highway|pl|place|way|row|pike|sq|square|loop|xing|crossing|cv|cove|pt|point|path|walk|bnd|bend|plz|plaza|aly|alley|expy|expressway|fwy|freeway|tpke|turnpike)\.?,?$/i;
const DIRECTIONAL_RE = /^(?:ne|nw|se|sw|n|s|e|w|north|south|east|west)\.?,?$/i;
const UNIT_RE = /^(?:#\s*\w+|(?:apt|unit|ste|suite|bldg|fl)\.?)$/i;
/** ", CITY ST 12345" or ", CITY, ST 12345-6789" after the street. */
const CITY_TAIL_RE = /^,?\s*[A-Za-z][A-Za-z .'-]{1,40},?\s+[A-Za-z]{2}\.?(?:\s+\d{5}(?:-\d{4})?)?$/;

/**
 * A street address cut right after its street suffix (and a directional, and a unit number): anything a portal appended after it, such
 * as " - SMITH RESIDENCE" or a person's name in the street-name column ("MEMORIAL DR JOHN DOE"), is dropped. A trailing ", CITY ST ZIP"
 * is kept. An address with no recognised suffix (Chicago's "100 N STATE") is returned as given.
 */
export function cutAfterStreetSuffix(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return t;
  const tokens = t.split(' ');
  // The suffix must follow a house number (or "<n> block of") and at least one street word.
  let start = 1;
  if (/^block$/i.test(tokens[1] ?? '') && /^of$/i.test(tokens[2] ?? '')) start = 3;
  if (DIRECTIONAL_RE.test(tokens[start] ?? '')) start++;
  let cut = -1;
  for (let i = start + 1; i < tokens.length; i++) {
    if (STREET_SUFFIX_RE.test(tokens[i])) {
      cut = i;
      break;
    }
  }
  if (cut < 0) {
    // No recognised suffix ("100 N STATE"): returned as given, unless it ends with what reads as a person's full name ("45 SMITH JOHN",
    // "100 N STATE JOHN DOE"), which drops the whole address (verify-v1 finding 8).
    const last2 = tokens.slice(Math.max(start, tokens.length - 2)).join(' ').replace(/,/g, ' ');
    const lastTok = tokens[tokens.length - 1] ?? '';
    if (tokens.length - start >= 2 && !DIRECTIONAL_RE.test(lastTok) && !UNIT_RE.test(lastTok) && looksLikeFullPersonName(last2)) return '';
    return t;
  }
  let end = cut;
  if (DIRECTIONAL_RE.test(tokens[end + 1] ?? '')) end++;
  if (UNIT_RE.test(tokens[end + 1] ?? '') && /^[\w-]{1,6},?$/.test(tokens[end + 2] ?? '')) end += 2;
  else if (/^#\w{1,6},?$/.test(tokens[end + 1] ?? '')) end++;
  const head = tokens.slice(0, end + 1).join(' ');
  const rest = tokens.slice(end + 1).join(' ');
  const cleanHead = head.replace(/,$/, '');
  if (!rest) return cleanHead;
  // Keep a city tail only when it is plainly one: after a comma, or ending in a ZIP code, with a real state code.
  const commaBefore = /,$/.test(head) || rest.startsWith(',');
  const m = CITY_TAIL_RE.exec(rest);
  const state = m ? (/\s([A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?$/.exec(rest)?.[1] ?? '').toUpperCase() : '';
  const hasZip = /\d{5}(?:-\d{4})?$/.test(rest);
  // A "city" that reads as a person's full name ("JOHN DOE GA 30303", ", JOHN DOE, GA") is not a city: the tail is cut.
  const cityPart = rest.replace(/^,\s*/, '').replace(/,?\s+[A-Za-z]{2}\.?(?:\s+\d{5}(?:-\d{4})?)?$/, '').replace(/,/g, ' ').trim();
  if (cityPart.split(/\s+/).length >= 2 && !PLACE_PREFIX_RE.test(cityPart) && looksLikeFullPersonName(cityPart)) return cleanHead;
  return m && US_STATES.has(state) && (commaBefore || hasZip) ? t : cleanHead;
}

/** City names that start like a place, not a person ("SAN FRANCISCO", "ST PAUL", "FORT WORTH"): never read as a name. */
const PLACE_PREFIX_RE = /^(?:san|santa|santo|saint|st|ste|fort|ft|los|las|la|el|le|new|port|mount|mt|lake|east|west|north|south|point|palm|glen|grand|cape)\.?\s/i;

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI AS MP'.split(' '),
);
