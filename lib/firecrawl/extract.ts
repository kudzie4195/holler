import { createHash } from 'node:crypto';
import type { SignalInput } from '@/lib/signals/types';
import { bidTrades } from '@/lib/signals/bid-trades';
import { cleanText, localDay, tidyBuyer } from '@/lib/signals/adapters/city-bids';
import { toIso } from '@/lib/signals/adapters/socrata';
import { placeOf, type LocalBidSource } from './local-sources';

/**
 * The JSON extraction schema Firecrawl is asked for, and the validation every extracted row must pass before it can become a signal.
 *
 * The extraction is an LLM reading a web page, so nothing it returns is trusted:
 *   1. title, due date and a link on the agency's own domain must all be present (a link may fall back to the agency's list page only for
 *      sources whose page has no per-row link, see LocalBidSource.listFallback);
 *   2. the due date must parse and be in the future (a past or placeholder date is a closed or broken row);
 *   3. a row the page marks awarded, cancelled or closed is dropped;
 *   4. the solicitation number or the title must appear in the page text that Firecrawl returned alongside (guards against invented rows);
 *   5. duplicates collapse on the solicitation number, else the link, else title + due date;
 *   6. the title must match a Holler trade (bid-trades.ts), exactly as city bids do, or the row is not stored.
 * Nothing here reads or keeps a contact person, e-mail or phone.
 */
export const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    solicitations: {
      type: 'array',
      description: 'Every open solicitation (bid, RFP, RFQ, quote request) listed on the page. Do not include anything that is not on the page.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Title of the solicitation exactly as printed' },
          agency: { type: 'string', description: 'Department or buyer named for this solicitation, empty when none is named' },
          solicitationNumber: { type: 'string', description: 'Solicitation number exactly as printed, for example "RFP #26-28"; empty when none' },
          category: { type: 'string', description: 'Type or commodity as printed (Bid, RFP, RFQ, Construction...), empty when none' },
          dueDate: { type: 'string', description: 'Submission or opening deadline as a LOCAL date-time without a zone, YYYY-MM-DDTHH:mm (24 hour), or YYYY-MM-DD when no time is printed' },
          postedDate: { type: 'string', description: 'Date it was issued or opened, YYYY-MM-DD, empty when not printed' },
          detailUrl: { type: 'string', description: 'Absolute URL of this solicitation\'s own page or document, empty when there is none' },
          status: { type: 'string', enum: ['open', 'closed', 'awarded', 'cancelled', 'unknown'], description: 'As the page shows it' },
        },
        required: ['title', 'dueDate'],
      },
    },
  },
  required: ['solicitations'],
} as const;

const BASE_PROMPT =
  'List the solicitations on this page. Copy text exactly as printed; never guess, never add a solicitation that is not on the page, and leave a field empty when the page does not show it. ' +
  'Do not return contact names, e-mail addresses or phone numbers. ';

export function extractionPrompt(src: LocalBidSource): string {
  return `${BASE_PROMPT}${src.hint}`;
}

/** The change-tracking tag: one history per source and purpose, so another use of the same URL never shares it. */
export function changeTag(src: LocalBidSource): string {
  return `holler-${src.id}`;
}

export interface RawRow {
  title?: unknown;
  agency?: unknown;
  solicitationNumber?: unknown;
  category?: unknown;
  dueDate?: unknown;
  postedDate?: unknown;
  detailUrl?: unknown;
  status?: unknown;
}

export type DropReason =
  | 'not_an_object'
  | 'no_title'
  | 'no_due_date'
  | 'bad_due_date'
  | 'due_date_passed'
  | 'due_date_placeholder'
  | 'no_link'
  | 'link_off_domain'
  | 'not_open'
  | 'not_on_page'
  | 'due_not_on_page'
  | 'duplicate'
  | 'no_trade'
  | 'no_place';

export interface DroppedRow {
  title: string;
  number: string;
  reason: DropReason;
}

export interface ValidationReport {
  items: SignalInput[];
  rows: number;
  dropped: DroppedRow[];
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/** Email addresses and bare links are never copied into a public title or summary. */
function noContactBits(t: string): string {
  return t.replace(/https?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ').replace(/\S+@\S+\.\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

function trunc(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n: number) => String(n).padStart(2, '0');

/** A clock time like "2:00 PM", "2 p.m.", "14:30" to "HH:mm", or null. */
function clock(text: string): string | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\b\.?/i.exec(text);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/p/i.test(m[3])) h += 12;
    const min = Number(m[2] ?? '0');
    return h > 23 || min > 59 ? null : `${p2(h)}:${p2(min)}`;
  }
  const m24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  return m24 ? `${p2(Number(m24[1]))}:${m24[2]}` : null;
}

/**
 * The due date as an instant plus whether the source gave a time. Accepts the requested "YYYY-MM-DDTHH:mm", a bare "YYYY-MM-DD" (the
 * deadline is the end of that day in the page's zone), a value with a zone, and the common written forms the model sometimes returns
 * ("December 10, 2026, at 2:00 PM", "12/10/2026 2:00 p.m."). Null when nothing reads as a date.
 */
export function parseDue(raw: string, tz: string): { iso: string; hasTime: boolean } | null {
  const t = cleanText(raw);
  if (!t) return null;
  const withZone = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(t);
  if (withZone) {
    const d = new Date(t.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : { iso: d.toISOString(), hasTime: true };
  }
  let date: string | null = null;
  let time: string | null = null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(t);
  if (m) {
    date = `${m[1]}-${m[2]}-${m[3]}`;
    time = m[4] ?? null;
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b(.*)$/.exec(t))) {
    date = `${m[3]}-${p2(Number(m[1]))}-${p2(Number(m[2]))}`;
    time = clock(m[4]);
  } else if ((m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(.*)$/.exec(t))) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mon) {
      date = `${m[3]}-${p2(mon)}-${p2(Number(m[2]))}`;
      time = clock(m[4]);
    }
  }
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return null;
  const iso = toIso(`${date}T${time ?? '23:59'}:00`, tz);
  return iso ? { iso, hasTime: time !== null } : null;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Does the page text print this calendar day (YYYY-MM-DD) in a form people write? Forms: 2026-12-17, 12/17/2026, 12/17/26, 12-17-2026,
 * "December 17, 2026" and "Dec. 17th, 2026", "17 December 2026". The extraction is an LLM: it must not be able to "correct" a printed
 * date (a typo on the agency's page, an old date) into one the page never shows.
 */
export function dayAppearsOn(markdown: string, ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const text = markdown.replace(/\s+/g, ' ');
  const zeroOpt = (n: number) => `0?${n}`; // an optional leading zero
  const year = `(?:${y}|${String(y).slice(2)})`;
  const sep = '[\\/.-]';
  const forms = [
    `(?<!\\d)${y}-${p2(mo)}-${p2(d)}(?!\\d)`,
    `(?<!\\d)${zeroOpt(mo)}${sep}${zeroOpt(d)}${sep}${year}(?!\\d)`,
  ];
  const name = MONTH_NAMES[mo - 1];
  const nameRe = `${name.slice(0, 3)}(?:${name.slice(3)}|\\.)?`;
  forms.push(`${nameRe}\\s*${zeroOpt(d)}(?:st|nd|rd|th)?,?\\s*${y}(?!\\d)`);
  forms.push(`(?<!\\d)${zeroOpt(d)}(?:st|nd|rd|th)?\\s+${nameRe},?\\s*${y}(?!\\d)`);
  return new RegExp(forms.join('|'), 'i').test(text);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "RFP #26-28" -> "RFP2628"; a trailing code the source says is not part of the number is dropped first. */
export function normalizeNumber(raw: string, suffix?: RegExp): string {
  const t = cleanText(raw);
  return norm(suffix ? t.replace(suffix, '') : t);
}

function linkFor(raw: string, src: LocalBidSource): { url: string; kind: 'solicitation' | 'list' } | 'off_domain' | null {
  const t = raw.trim();
  if (t) {
    try {
      const u = new URL(t, src.listUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return src.listFallback ? { url: src.listUrl, kind: 'list' } : 'off_domain';
      const host = u.hostname.toLowerCase();
      // A page that has no link per row sends bidders to the agency's own list page when a row's link is somewhere else (a portal's
      // vendor-registration link the model copied): the link is always on the agency's domain.
      if (!src.domains.some((d) => host === d || host === `www.${d}` || host.endsWith(`.${d}`))) return src.listFallback ? { url: src.listUrl, kind: 'list' } : 'off_domain';
      u.protocol = 'https:';
      return { url: u.toString(), kind: 'solicitation' };
    } catch {
      return src.listFallback ? { url: src.listUrl, kind: 'list' } : 'off_domain';
    }
  }
  return src.listFallback ? { url: src.listUrl, kind: 'list' } : null;
}

const CANCELLED = /\bcancel(?:l?ed|lation)\b/i;
/** A due date further out than this is a placeholder, not a deadline. */
const PLACEHOLDER_DAYS = 730;

/**
 * Validates and converts the extracted rows of one source. Pure: pass the clock and the page text. `markdown` null skips the on-page
 * check (a probe that has no page text); the scheduled path always passes it.
 */
export function validateRows(raw: unknown, src: LocalBidSource, opts: { now: Date; markdown: string | null }): ValidationReport {
  const rows = isRows(raw) ? raw : [];
  const report: ValidationReport = { items: [], rows: rows.length, dropped: [] };
  const place = placeOf(src);
  const page = opts.markdown === null ? null : norm(opts.markdown);
  const seen = new Set<string>();
  const nowMs = opts.now.getTime();
  const drop = (title: string, number: string, reason: DropReason) => report.dropped.push({ title: trunc(title, 100), number: trunc(number, 40), reason });

  for (const item of rows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      drop('', '', 'not_an_object');
      continue;
    }
    const r = item as RawRow;
    const titleRaw = noContactBits(cleanText(str(r.title)));
    const number = cleanText(str(r.solicitationNumber));
    if (titleRaw.length < 4) {
      drop(titleRaw, number, 'no_title');
      continue;
    }
    const dueText = str(r.dueDate).trim();
    if (!dueText) {
      drop(titleRaw, number, 'no_due_date');
      continue;
    }
    const due = parseDue(dueText, src.tz);
    if (!due) {
      drop(titleRaw, number, 'bad_due_date');
      continue;
    }
    const dueMs = Date.parse(due.iso);
    if (dueMs <= nowMs) {
      drop(titleRaw, number, 'due_date_passed');
      continue;
    }
    if (dueMs - nowMs > PLACEHOLDER_DAYS * 86_400_000) {
      drop(titleRaw, number, 'due_date_placeholder');
      continue;
    }
    const status = str(r.status).trim().toLowerCase();
    if (['closed', 'awarded', 'cancelled', 'canceled'].includes(status) || CANCELLED.test(titleRaw)) {
      drop(titleRaw, number, 'not_open');
      continue;
    }
    const link = linkFor(str(r.detailUrl), src);
    if (link === null) {
      drop(titleRaw, number, 'no_link');
      continue;
    }
    if (link === 'off_domain') {
      drop(titleRaw, number, 'link_off_domain');
      continue;
    }
    if (page !== null) {
      const nn = normalizeNumber(number, src.numberSuffix);
      const onPage = (nn.length >= 4 && page.includes(nn)) || (norm(titleRaw).length >= 8 && page.includes(norm(titleRaw).slice(0, 60)));
      if (!onPage) {
        drop(titleRaw, number, 'not_on_page');
        continue;
      }
    }
    const dueLocalDay = localDay(due.iso, src.tz);
    let dueOnPage: boolean | null = null;
    if (opts.markdown !== null) {
      dueOnPage = !!dueLocalDay && dayAppearsOn(opts.markdown, dueLocalDay);
      if (!dueOnPage) {
        drop(titleRaw, number, 'due_not_on_page');
        continue;
      }
    }
    const nn = normalizeNumber(number, src.numberSuffix);
    const dedupeKey = nn.length >= 3 ? `n:${nn}` : link.kind === 'solicitation' ? `u:${link.url}` : `t:${norm(titleRaw)}|${due.iso}`;
    if (seen.has(dedupeKey)) {
      drop(titleRaw, number, 'duplicate');
      continue;
    }

    const category = cleanText(str(r.category));
    const trades = bidTrades({ title: titleRaw, category: /^(none|bid|rfp|rfq|itb|ifb|quote)$/i.test(category) ? null : category });
    if (trades.length === 0) {
      drop(titleRaw, number, 'no_trade');
      seen.add(dedupeKey);
      continue;
    }
    if (!place) {
      drop(titleRaw, number, 'no_place');
      continue;
    }
    seen.add(dedupeKey);

    const buyer = tidyBuyer(str(r.agency)) || src.agency;
    const title = trunc(titleRaw.replace(/\s*(?:ADDENDUM|ADD\.?)\s*(?:NO\.?|#)?\s*\d+.*$/i, '').trim() || titleRaw, 140);
    const dueLocal = localDay(due.iso, src.tz);
    const posted = parseDue(str(r.postedDate), src.tz);
    const idPart = nn.length >= 3 ? nn : createHash('sha1').update(`${link.url}|${norm(titleRaw)}|${due.iso}`).digest('hex').slice(0, 16);
    const summary = trunc([buyer, category && !/^none$/i.test(category) ? category : '', number, `due ${dueLocal ?? due.iso.slice(0, 10)}`].filter(Boolean).join(' | '), 280);
    report.items.push({
      source: src.id,
      externalId: `${src.id}:${idPart}`,
      kind: 'contract',
      title: `Open bid in ${src.placeLabel}: ${title}`,
      summary,
      url: link.url,
      lat: place.lat,
      lon: place.lon,
      city: place.city,
      state: place.state,
      zip: place.zip,
      categories: trades,
      severity: 2,
      // A posted date is a calendar day: a bare day read as end-of-day must not land in the future, so it is capped at now.
      occurredAt: posted && Date.parse(posted.iso) < nowMs ? posted.iso : opts.now.toISOString(),
      expiresAt: due.iso,
      data: {
        subtype: 'bid',
        domain: new URL(src.listUrl).hostname,
        solicitationId: number || null,
        buyer,
        dueDate: dueLocal,
        noDueDate: false,
        // true: the due day is printed on the page text. null: no page text was available to check it against.
        dueOnPage,
        linkKind: link.kind,
        tz: src.tz,
        // The position is the agency's ZIP centroid, not a job site: the matcher reads radius + 15 miles and no screen shows a distance.
        loc: 'approx',
        approxLocation: true,
        agencyAddress: src.address,
        via: 'firecrawl',
      },
    });
  }
  return report;
}

function isRows(raw: unknown): raw is unknown[] {
  return Array.isArray(raw);
}

/** Pulls the row array out of Firecrawl's json value: { solicitations: [...] }. Anything else is an empty list. */
export function rowsFromJson(json: unknown): unknown[] {
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const s = (json as { solicitations?: unknown }).solicitations;
    if (Array.isArray(s)) return s;
  }
  return [];
}
