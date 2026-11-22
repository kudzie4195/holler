/**
 * Project value and job-site address of a permit (PLAN-2.0 item 1.3). Pure and client-safe: no server imports, no clock, no network.
 *
 * Two places read the same facts:
 *  - the ingest (adapters) calls parseMoney on the dataset's own value column and stores the number as data.jobValue;
 *  - the read path (feed, app, email) calls jobValueOf / siteAddressFromSummary on a STORED row, so rows written before this change
 *    benefit with no backfill write: the public summary of a permit already holds "$12,500 job value" and its street address.
 *
 * Nothing here ever reads an owner, applicant or contractor column. The value is a number a city published on the permit; it says what
 * the permit declared, never what the work costs or that anyone has been hired.
 */

/** Below this a declared value is a placeholder ("$1" on a counter permit), not a job value. */
export const MIN_JOB_VALUE = 10;
/**
 * Above this a value is a data-entry error: a US phone number typed into the cost column is 2,000,000,000 or more ("$4,045,551,212"), and no
 * single permit in these feeds is a real $500M job. Review HSK G-P2-1.
 */
export const MAX_JOB_VALUE = 500_000_000;

/**
 * A money amount from a portal column: a number, "12500", "12,500.00", "$12,500", " $ 12 500 ". Returns whole dollars, or null for
 * anything that is not a plausible declared value (empty, zero, negative, below MIN_JOB_VALUE, above MAX_JOB_VALUE, not a number).
 */
export function parseMoney(raw: unknown): number | null {
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string') {
    const t = raw.trim().replace(/^\$\s*/, '').replace(/[,\s]/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
    n = Number(t);
  } else return null;
  if (!Number.isFinite(n)) return null;
  const whole = Math.round(n);
  return whole >= MIN_JOB_VALUE && whole <= MAX_JOB_VALUE ? whole : null;
}

/** The first plausible value among the given raw values, in order. */
export function firstMoney(values: readonly unknown[]): number | null {
  for (const v of values) {
    const m = parseMoney(v);
    if (m !== null) return m;
  }
  return null;
}

/** "$12,500". Whole dollars with thousands separators, en-US, no cents. */
export function formatMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** The summary part the ingest writes for a money column (adapters/permit-privacy.ts summaryPart): "$3,149 job value". */
const SUMMARY_VALUE_RE = /(?:^|\s\|\s)\$([0-9][0-9,]*(?:\.\d+)?) job value(?=\s\||$)/;

export interface ValueSource {
  /** data.jobValue (a number, or the text Postgres returns for data->>jobValue). */
  jobValue?: unknown;
  /** The stored public summary. */
  summary?: string | null;
}

/**
 * The permit's declared project value in whole dollars, or null. data.jobValue (set at ingest) wins; a stored row without it falls back
 * to the "$N job value" part of its public summary. Never throws.
 */
export function jobValueOf(src: ValueSource | null | undefined): number | null {
  if (!src) return null;
  const direct = parseMoney(src.jobValue);
  if (direct !== null) return direct;
  const s = typeof src.summary === 'string' ? src.summary : '';
  const m = SUMMARY_VALUE_RE.exec(s);
  return m ? parseMoney(m[1]) : null;
}

/** The card line: "Job value on the permit: $12,500". Null when the record has no value. */
export function jobValueLine(src: ValueSource | null | undefined): string | null {
  const v = jobValueOf(src);
  return v === null ? null : `Job value on the permit: ${formatMoney(v)}`;
}

// ---- job-site address ---------------------------------------------------------------------------------------------------------------

const HOUSE_START_RE = /^\d{1,6}[A-Za-z]?(?:\s*-\s*\d{1,6}[A-Za-z]?)?\s+\S/;
/** A summary part that is not an address even though it starts with a number. */
const NOT_ADDRESS_RE =
  /\bjob value\b|\bblock of\b|^\d+(?:\.\d+)?$|\bsq\.?\s?ft\b|\b(?:stories|story|floors?|levels?|units?|bed(?:room)?s?|baths?|rooms?|buildings?|acres?|lots?|sf|sqft|feet|ft|years?|months?|days?|hours?|permits?|stalls?|spaces?|seats?|dwellings?)\b\s*$/i;
/** Words that are never part of a street name in a permit summary: counts, work words, durations ("30 DAYS ST", "1 Lot Line Adjustment ST"). */
const NOT_STREET_WORDS = new Set(
  'stories story floors floor levels level units unit bedroom bedrooms bed beds bath baths room rooms building buildings acre acres lot lots days day months month years year hours hour permit permits repair repairs install installation addition remodel replace replacement adjustment window windows roof reroof demolition inspection construction radio ordered'.split(' '),
);
const SUFFIX_WORDS = new Set(
  'st street ave avenue av blvd boulevard bv rd road dr drive ln lane ct court pl place way pkwy parkway pky hwy highway cir circle ter terrace trl trail sq square pk park loop run row aly alley xing crossing pass path walk cv cove pt point ridge bnd bend expy fwy plz plaza'.split(' '),
);
const DIR_ABBR = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);
const DIR_FULL = new Set(['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']);
const UNIT_WORD = new Set(['ste', 'suite', 'unit', 'apt', 'fl', 'floor', 'bldg', 'rm']);
const kw = (w: string | undefined) => (w ?? '').toLowerCase().replace(/[.,]+$/g, '');
const nameWordOk = (w: string) => /^#?[A-Za-z0-9'-]+[.,]?$/.test(w) && (!/\d{3,}/.test(w) || /^\d+(?:st|nd|rd|th)[.,]?$/i.test(w));
const unitTokenOk = (t: string | undefined) => !!t && /^[A-Za-z0-9-]{1,6}$/.test(t) && (/\d/.test(t) || /^[A-Za-z]{1,2}$/.test(t));

/**
 * The street of one summary part, cut after the street suffix (plus a trailing direction and one unit), or null when the part is not a
 * street ("10 stories", "30 DAYS ST", "2 Way Radio Install", "4 SOUTH WINDOWS"). Trailing words (a name, a city) are never returned:
 * "123 MAIN ST APT 4 JOHN SMITH" gives "123 MAIN ST APT 4". Without a suffix only "N DAMEN" (abbreviated direction and one word, as Chicago
 * prints it) or "SHARON NW" (one word and an abbreviated direction) is a street.
 */
function cutStreet(part: string): string | null {
  const tokens = part.split(/\s+/);
  const house = tokens[0];
  const rest = tokens.slice(1);
  if (rest.length < 2 || rest.length > 8 || !rest.every(nameWordOk)) return null;
  if (rest.some((w, i) => i < 5 && NOT_STREET_WORDS.has(kw(w)))) return null;
  const lead = DIR_ABBR.has(kw(rest[0])) || DIR_FULL.has(kw(rest[0])) ? 1 : 0;
  // 1. with a suffix: up to three name words before it (type-first "AVENUE H" ends at the next token)
  for (let i = lead; i < rest.length && i <= lead + 3; i++) {
    if (!SUFFIX_WORDS.has(kw(rest[i]))) continue;
    let end = i;
    if (i === lead) {
      if (lead === 1 && DIR_FULL.has(kw(rest[0]))) end = i; // "9541 SOUTH BV": the full direction word is the street name
      else if (/^(?:[A-Za-z]|\d{1,3})[.,]?$/.test(rest[i + 1] ?? '')) end = i + 1;
      else continue; // "2 Way Radio Install": a suffix word with no street name before it
    }
    const out = rest.slice(0, end + 1);
    if (DIR_ABBR.has(kw(rest[end + 1])) && (rest.length === end + 2 || UNIT_WORD.has(kw(rest[end + 2])))) out.push(rest[end + 1]);
    const u = rest[out.length];
    if (u?.startsWith('#') && unitTokenOk(u.slice(1))) out.push(u);
    else if (u && UNIT_WORD.has(kw(u)) && unitTokenOk(rest[out.length + 1])) out.push(u, rest[out.length + 1]);
    return `${house} ${out.join(' ').replace(/,$/, '')}`;
  }
  // 2. no suffix: "N DAMEN" / "W 47TH" or "SHARON NW" (abbreviated direction, one street word)
  if (rest.length === 2 && DIR_ABBR.has(kw(rest[0])) && /^(?:[A-Za-z]+|\d+(?:st|nd|rd|th))[.,]?$/i.test(rest[1])) return `${house} ${rest.join(' ').replace(/,$/, '')}`;
  if (rest.length === 2 && DIR_ABBR.has(kw(rest[1])) && /^[A-Za-z]+$/.test(rest[0]) && !DIR_ABBR.has(kw(rest[0]))) return `${house} ${rest.join(' ').replace(/,$/, '')}`;
  return null;
}
const PHONE_OR_MAIL_RE = /@|(?<!\d)\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/;

export interface SiteFromSummary {
  /** Street part, e.g. "1584 ABNER NW". */
  address: string;
  /** City, state and ZIP when the summary printed them after the street, else null. */
  tail: string | null;
}

/**
 * The job-site street address inside a stored permit summary, or null. The summary is public already (adapters cut it after the street
 * suffix and scrub names, permit-privacy.ts), so this reads nothing new: it finds the part that starts with a house number, drops the
 * money part and any part that holds a phone or e-mail, and splits a printed ", CITY, ST 12345" tail from the street. A part that
 * starts with a number but is not an address (a count, a square footage) gives null.
 */
export function siteAddressFromSummary(summary: string | null | undefined): SiteFromSummary | null {
  if (typeof summary !== 'string' || !summary.trim()) return null;
  for (const raw of summary.split(' | ')) {
    const part = raw.replace(/\s+/g, ' ').trim();
    if (!part || NOT_ADDRESS_RE.test(part) || PHONE_OR_MAIL_RE.test(part) || !HOUSE_START_RE.test(part)) continue;
    // "1431 SHARON NW, ATLANTA, GA 30314" or "245 First St, Cambridge, MA 02142" or "9541 SOUTH BV CHARLOTTE NC 28273".
    // With a comma the city may have several words; without one the city is the single word before the state ("9541 SOUTH BV CHARLOTTE NC 28273").
    const tailMatch =
      /^(.*?),\s*((?:[A-Za-z][A-Za-z .'-]{1,30}),?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/.exec(part) ??
      /^(.*\S)\s+([A-Za-z][A-Za-z'-]{1,24},?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/.exec(part);
    if (tailMatch && /^\d/.test(tailMatch[1])) {
      const street = cutStreet(tailMatch[1].replace(/,$/, '').trim());
      if (street) return { address: street, tail: tailMatch[2].trim() };
      continue;
    }
    if (part.length > 90 || part.split(' ').length > 12) continue;
    const street = cutStreet(part);
    if (street) return { address: street, tail: null };
  }
  return null;
}

/** PostgREST select alias for data.jobValue (the same pattern as DEADLINE_SELECT in lead-rules.ts). */
export const VALUE_SELECT = 'jobValue:data->>jobValue';
