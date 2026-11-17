import { NEW_HOME_RE } from './socrata-datasets';
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
  const candidates = [...typeValues.map(typeLabel), tradeLabel(categories, classifierText)].filter((x): x is string => Boolean(x));
  for (const label of candidates) {
    const t = `${label} permit in ${city}`;
    if (t.length <= MAX_TITLE_CHARS) return t;
  }
  const plain = `Permit in ${city}`;
  return plain.length <= MAX_TITLE_CHARS ? plain : plain.slice(0, MAX_TITLE_CHARS);
}
