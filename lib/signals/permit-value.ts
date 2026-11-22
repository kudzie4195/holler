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
/** Above this a value is a data-entry error (a phone number or an id typed into the cost column). */
export const MAX_JOB_VALUE = 5_000_000_000;

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
const NOT_ADDRESS_RE = /\bjob value\b|\bblock of\b|^\d+(?:\.\d+)?$|\bsq\.?\s?ft\b|\bunits?\b\s*$/i;
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
    const tailMatch = /^(.*?)(?:,\s*|\s+)((?:[A-Za-z][A-Za-z .'-]{1,30}),?\s+[A-Z]{2}\s+\d{5}(?:-\d{4})?)$/.exec(part);
    if (tailMatch && /^\d/.test(tailMatch[1]) && tailMatch[1].split(' ').length >= 2) return { address: tailMatch[1].replace(/,$/, '').trim(), tail: tailMatch[2].trim() };
    if (part.length > 90 || part.split(' ').length > 9) continue;
    return { address: part.replace(/,$/, '').trim(), tail: null };
  }
  return null;
}

/** PostgREST select alias for data.jobValue (the same pattern as DEADLINE_SELECT in lead-rules.ts). */
export const VALUE_SELECT = 'jobValue:data->>jobValue';
