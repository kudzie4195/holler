import { createHash } from 'node:crypto';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import type { CategoryId } from '@/lib/signals/categories';
import type { Db } from '@/lib/signals/store';
import type { OpportunityLabel } from '@/lib/signals/lead-rules';
import { env } from '@/lib/env';
import { HOLLER_UA } from '@/lib/user-agent';
import { BIDS_FLAG, LOCAL_BIDS_FLAG, bidsEnabled, localBidsEnabled } from '@/lib/signals/bid-sources';
import { bidTrades, GOODS_CATEGORY, PAPER_WORK, SUPPLY_WORDS, WORK_VERBS, type BidText } from '@/lib/signals/bid-trades';
import { looksLikeFullPersonName } from '@/lib/contacts/org';
import { sanitizeHealthError } from '@/lib/signals/health';
import { cleanText, localDay, tidyBuyer } from './city-bids';
import { checkRobots, crawlDelayWaitMs, HOLLER_AGENTS, noteFetch } from '@/lib/firecrawl/robots';
import { parseDue } from '@/lib/firecrawl/extract';
import { placeOf, type LocalBidSource } from '@/lib/firecrawl/local-sources';
import { lastScanRun, rowsWereStored } from '@/lib/firecrawl/ledger';
import { runLocalBidSource, type PipelineDeps } from '@/lib/firecrawl/pipeline';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { accessCleared, PAGE_WATCH_DATASETS, type PageWatchDataset } from './page-watch-datasets';
import {
  listingArea,
  ParseTimeoutError,
  parseBonfire,
  parseCsv,
  parseHtmlLinks,
  parseHtmlTable,
  parseRss,
  parseTextBlocks,
  textOf,
  tickUntil,
  type ParseResult,
  type RawBidRow,
  type Tick,
} from './page-watch-parse';

/**
 * ROUND 20 WATCH: the $0 "page-watch" adapter. One adapter per public bid page in page-watch-datasets.ts, every one ON PROBATION.
 *
 *   0. gates    NOTHING is requested (no robots.txt, no page, no Firecrawl) unless the owner has recorded the source's robots and terms check
 *               (accessCleared: termsChecked + robotsUrl + termsUrl + checkedOn, and for a Bonfire endpoint the vendor's permission) AND the
 *               master switch HOLLER_PAGE_WATCH_ENABLED is on. Both default off. Enforced in enabled(), fetch(), runPageWatch (which the
 *               coverage probe uses) and lib/firecrawl/probe.ts.
 *   1. robots   the host's robots.txt (cached 1 h) is obeyed for the product token "Holler" (Firecrawl's groups never count here). It fails
 *               closed: 401, 403, 429, 5xx, an HTML answer or a redirect to another host means the page is not read this run. A
 *               Crawl-delay is honoured: the run is skipped when it is not met since the last page read of that origin.
 *   2. fetch    one plain GET as HOLLER_UA, no browser-only header, redirects followed by hand (two hops, only to the dataset's own
 *               domains, each target checked against robots.txt), the body read up to a size limit.
 *   3. hash     the listing area's visible text is hashed; when it equals the last hash whose rows the scan stored (`_pw:<id>` marker rows
 *               in holler_scan_runs), nothing is parsed or returned.
 *   4. parse    the platform parser, with a 2 s time limit (`parse_timeout`), then validation: open, not past due, a readable due date, a
 *               trade in the title, a public link, no person's name, phone or e-mail in any stored field.
 *   5. Firecrawl only where a page needs a browser (`firecrawl: 'only'`) or as a per-source opt-in fallback, with HOLLER_LOCAL_BIDS_ENABLED
 *               and FIRECRAWL_API_KEY too, never called again after two zero-row runs until the page's hash changes.
 *
 * Urgency (proposed label, round 20 review P1-2): urgent only when the row's status is explicitly open, or when the source has no status
 * at all, and the due date is 3 or more days out. A closed, awarded, cancelled, evaluation, complete, under-review or similar word in the
 * status, another column or the title makes the row feed-only; any other status text is a heads-up at most.
 */

/** The master switch. Off (the default): no page-watch request of any kind. */
export const PAGE_WATCH_FLAG = 'HOLLER_PAGE_WATCH_ENABLED';
/** The user agent of every page-watch request (the same as every Holler request). */
export const PW_UA = HOLLER_UA;
export const PW_ROBOTS_TIMEOUT_MS = 4000;
export const PW_PAGE_TIMEOUT_MS = 7000;
/** Whole source, ms: inside run.ts PROBATION_TIMEOUT_MS (12 s). */
export const PW_BUDGET_MS = 11_000;
/** Most raw rows read from one page per run; the rest are left (probation note "row cap reached"). */
export const PW_ROW_CAP = 150;
/** Parse time limit per page, ms (the parsers run on the event loop: a long parse would hold the whole scan). */
export const PW_PARSE_MS = 2000;
/** Largest body parsed: an HTML page, and a JSON, feed or CSV answer (bytes). */
export const PW_MAX_HTML = 1_000_000;
export const PW_MAX_DATA = 2_000_000;
export const PW_MARKER_PREFIX = '_pw:';
/** A due date further out than this is a placeholder, not a deadline. */
const PLACEHOLDER_DAYS = 730;

const ON = /^(?:1|true|on|yes)$/i;
/** Is the master switch on? Read at call time. */
export function pageWatchOn(value: string | undefined = env.HOLLER_PAGE_WATCH_ENABLED ?? process.env[PAGE_WATCH_FLAG]): boolean {
  return ON.test((value ?? '').trim());
}

export type PageWatchCheck =
  | 'ok'
  | 'unchanged'
  | 'empty'
  | 'row_cap'
  | 'terms_not_checked'
  | 'page_watch_off'
  | 'crawl_delay'
  | 'robots_disallowed'
  | 'robots_unreachable'
  | 'not_html'
  | 'not_json'
  | 'parser_mismatch'
  | 'parse_timeout'
  | 'http_error'
  | 'timeout'
  | 'firecrawl'
  | 'skipped';

export const PAGE_WATCH_ERROR_CHECKS: readonly PageWatchCheck[] = ['robots_disallowed', 'robots_unreachable', 'not_html', 'not_json', 'parser_mismatch', 'parse_timeout', 'http_error', 'timeout'];

export interface PageWatchCounts {
  read: number;
  kept: number;
  closed: number;
  /** Kept, but feed-only: the status, another column or the title says closed, awarded, evaluation ...; or read outside the listing area. */
  notOpen: number;
  noTrade: number;
  noDue: number;
  /** Dropped: the due cell holds a date the reader cannot read. */
  badDue: number;
  /** Kept as a heads-up at most: a status that is neither open nor closed. */
  unknownStatus: number;
  /** Dropped: the title names a private person (an honorific). */
  personText: number;
  duplicates: number;
  noTitle: number;
}

export interface PageWatchReport {
  source: string;
  check: PageWatchCheck;
  detail: string | null;
  httpStatus: number | null;
  hash: string | null;
  counts: PageWatchCounts;
  kept: SignalInput[];
  notes: string[];
  via: 'fetch' | 'firecrawl' | null;
  /** Firecrawl credits estimated (0 for a plain fetch). */
  credits: number;
  /** Requests sent to the source's hosts (robots.txt and pages; Firecrawl calls are not counted here). */
  requests: number;
}

export interface PageWatchDeps {
  fetch: typeof fetch;
  now: Date;
  env?: Record<string, string | undefined>;
  db?: Db | null;
  dry?: boolean;
  /** Owner probe: never reads or writes markers, never calls Firecrawl. */
  probe?: boolean;
  log?: (m: string) => void;
  clock?: () => number;
  budgetMs?: number;
  /** Parse time limit (tests). */
  parseMs?: number;
  makeClient?: PipelineDeps['makeClient'];
}

const zeroCounts = (): PageWatchCounts => ({ read: 0, kept: 0, closed: 0, notOpen: 0, noTrade: 0, noDue: 0, badDue: 0, unknownStatus: 0, personText: 0, duplicates: 0, noTitle: 0 });

function report(ds: PageWatchDataset, over: Partial<PageWatchReport>): PageWatchReport {
  const r: PageWatchReport = { source: ds.id, check: 'ok', detail: null, httpStatus: null, hash: null, counts: zeroCounts(), kept: [], notes: [], via: null, credits: 0, requests: 0, ...over };
  // Every detail passes the health clean-up (no e-mail, no phone, no quoted value) before it is logged or returned.
  r.detail = r.detail ? sanitizeHealthError(r.detail) : null;
  return r;
}

function pick(deps: Pick<PageWatchDeps, 'env'>, k: string): string | undefined {
  return deps.env?.[k] ?? (env as Record<string, string | undefined>)[k] ?? process.env[k];
}

/** Why nothing may be requested from this source now (null: go). */
export function pageWatchGate(ds: PageWatchDataset, e: Record<string, string | undefined> = {}): { check: 'terms_not_checked' | 'page_watch_off'; detail: string } | null {
  if (!accessCleared(ds)) return { check: 'terms_not_checked', detail: `terms not checked: record evidence.robotsUrl, termsUrl and checkedOn${ds.parser === 'bonfire' ? ' and endpointAllowed' : ''}, then set termsChecked` };
  if (!pageWatchOn(pick({ env: e }, PAGE_WATCH_FLAG))) return { check: 'page_watch_off', detail: `${PAGE_WATCH_FLAG} is off` };
  return null;
}

// ---- trades and the proposed label -------------------------------------------------------------------------------------------------

/** Building work the shared bid table has no word for (renovations, remodels, demolition, job order contracts, build-outs). */
const GC_WORK = /(?<![a-z0-9])(?:renovations?|remodel(?:s|ing)?|new construction|general contractor|general construction|job order contract(?:s|ing)?|demolition|build-?outs?|tenant improvements?|site improvements?)(?![a-z0-9])/i;
/** Words that make a GC-looking title something else (a website, a loan, legal or financial work, a study, a survey). */
const NOT_BUILDING = /(?<![a-z0-9])(?:website|web site|hosting|loan|loans|servicing|legal|counsel|attorney|study|studies|survey|audit|compensation|insurance|financing|marketing|management services|program management|prequalification|pre-qualification|consult\w*)(?![a-z0-9])/i;

/**
 * Trades of a page-watch bid: the shared bid table (lib/signals/bid-trades.ts, unchanged) plus general-contractor when the TITLE names
 * building work (renovation, remodel, demolition, job order, build-out) and nothing that makes it paper work. A category alone never adds
 * it. Only page-watch rows use the addition.
 */
export function pageWatchTrades(t: BidText): CategoryId[] {
  const base = bidTrades(t);
  const title = t.title.toLowerCase();
  if (t.category && GOODS_CATEGORY.test(t.category)) return base;
  if (PAPER_WORK.test(title) || NOT_BUILDING.test(title) || (SUPPLY_WORDS.test(title) && !WORK_VERBS.test(title))) return base;
  return GC_WORK.test(title) && !base.includes('general-contractor') ? [...base, 'general-contractor'] : base;
}

export type StatusClass = 'open' | 'none' | 'empty' | 'other' | 'closed';

/** The label proposed for a page-watch bid (lib/signals/proposed-labels.ts). */
export function proposedPageWatchLabel(
  dueIso: string | null | undefined,
  now: Date,
  opts: { status?: StatusClass; feedOnly?: boolean } = {},
): Extract<OpportunityLabel, 'act_now' | 'coming_soon' | 'context'> {
  const status = opts.status ?? 'none';
  if (opts.feedOnly || status === 'closed') return 'context';
  const t = dueIso ? Date.parse(dueIso) : NaN;
  const farEnough = Number.isFinite(t) && t - now.getTime() >= 3 * 86_400_000;
  return farEnough && (status === 'open' || status === 'none') ? 'act_now' : 'coming_soon';
}

// ---- privacy clean-up ----------------------------------------------------------------------------------------------------------------

const PHONE = /(?:\+?1[\s.-]*)?\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b|(?<![\d-])\b\d{3}[\s.-]\d{4}\b(?![\d-])|\b\d{7}\b|\+1\b/g;
const EXT = /\b(?:ext|extension)\.?\s*\d{1,5}\b/gi;
const EMAIL = /\S+@\S+\.\S+/g;
const EMAIL_SPELLED = /\b[\w.-]+\s+(?:at|\[at\])\s+[\w-]+\s+(?:dot|\[dot\])\s+\w+\b/gi;
/** A word that introduces a person: the rest of the text is cut (at the very start only with a colon, so "Call Center ..." survives). */
const PERSON_LEAD = /(?:^|[\s,;:|(\-–—]+)(contact|buyer|attn|attention|poc|c\/o|questions?(?:\s+to)?|call|prepared by|project manager|requested by|coordinator|e-?mail|phone)\b[\s:,.-]*/i;
const HONORIFIC = /\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|MR|MRS|MS)\.?\s+[A-Z][A-Za-z]+/;
/** Words that make a name-shaped segment a place ("Thomas Alva Edison High School", "Cuney Homes"). */
const PLACE_WORDS = /\b(?:school|elementary|middle|high|academy|college|university|center|centre|hall|park|library|station|homes|apartments|village|towers?|manor|plaza|courts|gardens?|terrace|building|street|st|avenue|ave|road|rd|boulevard|blvd|drive|lane|way|bridge|facility|field|stadium|museum|campus|house|community|recreation|pool|lake|creek|square|place|heights|estates|commons|memorial|airport|port|terminal|plant|yard|garage)\b/i;

/** Text with e-mails, phones, extensions and anything after a person-introducing word removed, and name-shaped segments dropped. */
export function cleanPersonText(raw: string): { text: string; removedName: boolean } {
  let t = cleanText(raw).replace(EMAIL, ' ').replace(EMAIL_SPELLED, ' ').replace(EXT, ' ').replace(PHONE, ' ').replace(/https?:\/\/\S+|\bwww\.\S+/gi, ' ');
  const lead = PERSON_LEAD.exec(t);
  if (lead) {
    const atStart = lead.index === 0 && !/^\s*[,;:|(\-–—]/.test(lead[0]);
    if (!atStart || /:/.test(lead[0])) t = t.slice(0, lead.index);
  }
  let removedName = false;
  const pieces = t.split(/(\s*[(),;|]\s*|\s+[-–—]\s+)/);
  for (let i = 0; i < pieces.length; i += 2) {
    const seg = pieces[i].trim();
    const words = seg.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 4 && looksLikeFullPersonName(seg) && !PLACE_WORDS.test(seg)) {
      pieces[i] = '';
      removedName = true;
    }
  }
  t = pieces
    .join('')
    .replace(/\(\s*[,;|]?\s*\)/g, ' ')
    .replace(/\s+([,;)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .replace(/(?:\s*[,;:|\-–—(]\s*)+$/g, '')
    .replace(/^\s*[,;:|\-–—)]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { text: t, removedName };
}

/** Title clean-up: person details removed, the number prefix and an addendum tail removed, at most 140 characters. */
export function cleanBidTitle(raw: string, number?: string): string {
  let t = cleanPersonText(raw).text;
  if (number) {
    const esc = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\s*${esc}\\s*[:\\-\\u2013\\u2014|]?\\s*`, 'i'), '');
  }
  const noAdd = t.replace(/\s*(?:ADDENDUM|ADD\.)\s*(?:NO\.?|#)?\s*\d+.*$/i, '').trim();
  t = (noAdd || t).replace(/\s+/g, ' ').trim();
  return t.length <= 140 ? t : `${t.slice(0, 137).trimEnd()}...`;
}

// ---- dates ---------------------------------------------------------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNo = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;

/** Written forms rewritten to m/d/yyyy: 12-10-2026, 12.10.2026, 10-Dec-2026, 10 December 2026, 12/10/26. */
function normalizeDates(t: string): string {
  return t
    .replace(/(?<![\d-])(\d{1,2})-([A-Za-z]{3,9})-(\d{4}|\d{2})(?!\d)/g, (m, d: string, mon: string, y: string) => (monthNo(mon) ? `${monthNo(mon)}/${d}/${y.length === 2 ? `20${y}` : y}` : m))
    .replace(/(?<![\d/.-])(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})(?!\d)/g, (m, d: string, mon: string, y: string) => (monthNo(mon) ? `${monthNo(mon)}/${d}/${y}` : m))
    .replace(/(?<![\d/.-])(\d{1,2})[-.](\d{1,2})[-.](\d{4})(?!\d)/g, '$1/$2/$3')
    .replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{2})(?![\d/])/g, '$1/$2/20$3');
}

const DATE_SNIPPET = /(\d{1,2}\/\d{1,2}\/\d{4}(?:[^|\n/]{0,20}?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?)|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:[^|\n]{0,20}?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?)|(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?)/gi;

/**
 * A printed date as an instant in `tz`: "08/31/23 2:00 pm", "Dec 10, 2026 2:00 PM", "2026-12-10 20:00:00", "12-10-2026", "10-Dec-2026",
 * "10 December 2026", "Proposal due: 12/10/2026". When the text says a date was extended or revised, the LAST date in it is the one.
 */
export function parseDateText(raw: string | undefined, tz: string): string | null {
  if (!raw) return null;
  const t = normalizeDates(cleanText(raw));
  const snippets = [...t.matchAll(DATE_SNIPPET)].map((m) => m[0]);
  if (/\b(?:extend\w*|revised|new date|postponed|rescheduled|changed to)\b/i.test(t) && snippets.length > 1) {
    const last = parseDue(snippets[snippets.length - 1], tz);
    if (last) return last.iso;
  }
  const direct = parseDue(t, tz);
  if (direct) return direct.iso;
  for (const s of snippets) {
    const p = parseDue(s, tz);
    if (p) return p.iso;
  }
  return null;
}

// ---- rows ----------------------------------------------------------------------------------------------------------------------------

const AGENCY_CODES: Record<string, string> = { CTA: 'Chicago Transit Authority' };

/** The row's buying department (an agency or office column), cleaned of any person; the dataset's agency when nothing safe is left. */
function rowAgency(raw: string | undefined, ds: PageWatchDataset): string {
  const t = cleanText(raw ?? '');
  if (!t || /^(?:city|county|district|n\/?a|-)$/i.test(t)) return ds.agency;
  if (AGENCY_CODES[t.toUpperCase()]) return AGENCY_CODES[t.toUpperCase()];
  const c = cleanPersonText(t).text;
  if (!c || c.length > 80 || /\d{7,}|@/.test(c) || (looksLikeFullPersonName(c) && !PLACE_WORDS.test(c))) return ds.agency;
  return tidyBuyer(c);
}

const hostOk = (host: string, ds: PageWatchDataset) => {
  const h = host.toLowerCase().replace(/^w+\./, '');
  return ds.linkDomains.some((d) => h === d || h.endsWith(`.${d}`));
};

function linkFor(raw: string | undefined, ds: PageWatchDataset): { url: string; kind: 'solicitation' | 'list' } {
  const t = (raw ?? '').trim();
  if (t) {
    try {
      const u = new URL(t, ds.parser !== 'bonfire' ? ds.url : ds.pageUrl);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && hostOk(u.hostname, ds)) {
        u.protocol = 'https:';
        // SEPTA prints its own host as "wwww.septa.org" [O]; the working host is www.
        if (/^w{4,}\./i.test(u.hostname)) u.hostname = u.hostname.replace(/^w+\./i, 'www.');
        return { url: u.toString(), kind: 'solicitation' };
      }
    } catch {
      /* fall back to the list page */
    }
  }
  return { url: ds.pageUrl, kind: 'list' };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Closed words in a status cell. */
const CLOSED_STATUS = /\b(?:award(?:ed|s)?|cancel(?:l?ed|lation)|closed|rejected|withdrawn|archived|expired|complete(?:d)?|evaluat\w*|under review|in review|pending|opened|unsealed|intent to award|bid tab(?:ulation)?|tabulation|no longer accepting|selection|board approval|on hold|suspended|notice of award)\b/i;
/** Closed words in a title or another column (narrower: no "complete", "pending" or "opened" there). */
const CLOSED_TEXT = /\b(?:awarded|notice of award|intent to award|cancel(?:l?ed|lation)|closed(?![- ]circuit)|bid closed|under evaluation|no longer accepting|bid tab(?:ulation)?|archived|expired)\b/i;
const OPEN_STATUS = /^\s*(?:open|active|accepting|posted|published|current|advertis\w*|bidding|issued|amended|re-?bid|new|available)\b/i;

export function statusClassOf(r: Pick<RawBidRow, 'status' | 'statusKnown' | 'otherText'>, title: string): StatusClass {
  const status = cleanText(r.status ?? '');
  if (CLOSED_TEXT.test(title) || (status && CLOSED_STATUS.test(status)) || (r.otherText && CLOSED_TEXT.test(r.otherText))) return 'closed';
  if (status && OPEN_STATUS.test(status)) return 'open';
  if (status) return 'other';
  return r.statusKnown ? 'empty' : 'none';
}

const STATUS_NOTE: Record<StatusClass, string> = { open: '', none: '', empty: '', other: 'status not stated as open', closed: 'listed as closed, awarded or under evaluation' };

/** Raw rows to records. Pure: pass the clock. Rows past their due date, with an unreadable due date, no trade or no title are dropped. */
export function rowsToSignals(rows: readonly RawBidRow[], ds: PageWatchDataset, now: Date, via: 'fetch' | 'firecrawl' = 'fetch'): { items: SignalInput[]; counts: PageWatchCounts } {
  const counts = zeroCounts();
  counts.read = rows.length;
  const items: SignalInput[] = [];
  const place = placeOf(ds);
  if (!place) return { items, counts };
  const nowMs = now.getTime();
  const seen = new Set<string>();
  const notOpenRe = ds.notOpenStatus ? new RegExp(ds.notOpenStatus, 'i') : null;
  const dueTz = ds.dueZone === 'utc' ? 'UTC' : ds.tz;
  for (const r of rows) {
    const number = cleanText(r.number ?? '').replace(/\s+/g, ' ').slice(0, 60);
    if (HONORIFIC.test(r.title ?? '')) {
      counts.personText++;
      continue;
    }
    const title = cleanBidTitle(r.title ?? '', number || undefined);
    if (title.length < 4) {
      counts.noTitle++;
      continue;
    }
    let due = parseDateText(r.due, dueTz);
    if (!due && /\d/.test(r.due ?? '')) {
      counts.badDue++;
      continue;
    }
    if (due && Date.parse(due) <= nowMs) {
      counts.closed++;
      continue;
    }
    if (due && Date.parse(due) - nowMs > PLACEHOLDER_DAYS * 86_400_000) due = null;
    const category = cleanPersonText(r.category ?? '').text;
    const trades = pageWatchTrades({ title, category: category && !/^(?:none|bid|rfp|rfq|rfql|itb|ifb|quote|rfi)$/i.test(category) ? category : null });
    if (!trades.length) {
      counts.noTrade++;
      continue;
    }
    const link = linkFor(r.link, ds);
    const key = norm(number).length >= 3 ? `n:${norm(number)}` : `h:${createHash('sha1').update(`${norm(title)}|${due ?? ''}`).digest('hex').slice(0, 16)}`;
    if (seen.has(key)) {
      counts.duplicates++;
      continue;
    }
    seen.add(key);
    let status = statusClassOf(r, title);
    if (status !== 'closed' && notOpenRe && notOpenRe.test(cleanText(r.status ?? ''))) status = 'closed';
    if (status === 'closed' || r.feedOnly) counts.notOpen++;
    else if (status === 'other') counts.unknownStatus++;
    if (!due) counts.noDue++;
    const agency = rowAgency(r.agency, ds);
    const posted = parseDateText(r.posted, ds.tz);
    const dueDay = due ? localDay(due, ds.tz) : null;
    const note = r.feedOnly ? 'read outside the open list' : STATUS_NOTE[status];
    const summary = [agency, category, number, dueDay ? `due ${dueDay}` : 'no due date published', note].filter(Boolean).join(' | ').slice(0, 280);
    items.push({
      source: ds.id,
      externalId: `${ds.id}:${key.slice(2)}`,
      kind: 'contract',
      title: `Bid: ${title} (${agency})`,
      summary,
      url: link.url,
      lat: place.lat,
      lon: place.lon,
      city: place.city,
      state: place.state,
      zip: place.zip,
      categories: trades,
      severity: 2,
      occurredAt: posted && Date.parse(posted) < nowMs ? posted : now.toISOString(),
      expiresAt: due,
      data: {
        subtype: 'bid',
        solicitationId: number || null,
        buyer: agency,
        category: category || null,
        dueDate: dueDay,
        noDueDate: !due,
        statusClass: status,
        ...(r.feedOnly ? { feedOnly: true } : {}),
        linkKind: link.kind,
        tz: ds.tz,
        // The position is the agency's office ZIP centroid, not a job site: the matcher reads radius + 15 miles and no screen shows a distance.
        loc: 'approx',
        approxLocation: true,
        via: via === 'fetch' ? 'page-watch' : 'firecrawl',
        platform: ds.platform,
        parser: ds.parser,
        domain: new URL(ds.pageUrl).hostname,
        proposedLabel: proposedPageWatchLabel(due, now, { status, feedOnly: r.feedOnly }),
      },
    });
  }
  counts.kept = items.length;
  return { items, counts };
}

// ---- fetch, hash, markers ----------------------------------------------------------------------------------------------------------

function withTimeout(f: typeof fetch, ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const t = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, t]) : t;
    return f(input, { ...(init ?? {}), signal });
  }) as typeof fetch;
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

export function hashText(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

/** What is hashed: the visible text of the listing area (markup, tokens and scripts do not count), or the body of a JSON/feed/CSV source. */
export function areaFingerprint(body: string, ds: PageWatchDataset, tick: Tick = () => {}): string {
  if (ds.parser === 'html-table' || ds.parser === 'html-links' || ds.parser === 'text-blocks' || ds.parser === 'none') return textOf(listingArea(body, ds).html, tick);
  return body;
}

/** At most `max` bytes of the body, without reading the rest. */
export async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    n += value.byteLength;
    if (n >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  const all = new Uint8Array(Math.min(n, max));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, all.length - o);
    all.set(c.subarray(0, take), o);
    o += take;
    if (o >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

export interface Marker {
  at: string;
  /** parsed: rows were handed to the scan; unchanged: the same listing as a stored run; zero: a Firecrawl run that kept no row. */
  state: 'parsed' | 'unchanged' | 'zero';
  hash: string;
  kept: number;
}

/** The newest `_pw:<id>` marker rows (newest first). Throws on a database error. */
export async function readMarkers(db: Db, id: string, limit = 1): Promise<Marker[]> {
  const { data, error } = await db.from('holler_scan_runs').select('started_at, inserted, error').eq('source', `${PW_MARKER_PREFIX}${id}`).order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`page-watch marker read failed: ${error.message}`);
  const out: Marker[] = [];
  for (const r of (data ?? []) as Array<{ started_at?: string | null; inserted?: number | null; error?: string | null }>) {
    const m = /^(parsed|unchanged|zero):([0-9a-f]{8,64})$/.exec(r.error ?? '');
    if (r.started_at && m) out.push({ at: r.started_at, state: m[1] as Marker['state'], hash: m[2], kept: r.inserted ?? 0 });
  }
  return out;
}

export async function readMarker(db: Db, id: string): Promise<Marker | null> {
  return (await readMarkers(db, id, 1))[0] ?? null;
}

export async function writeMarker(db: Db, id: string, at: Date, state: Marker['state'], hash: string, read: number, kept: number): Promise<void> {
  const iso = at.toISOString();
  const { error } = await db.from('holler_scan_runs').insert({ source: `${PW_MARKER_PREFIX}${id}`, started_at: iso, finished_at: iso, fetched: read, inserted: kept, matched: 0, error: `${state}:${hash}` });
  if (error) throw new Error(`page-watch marker write failed: ${error.message}`);
}

/**
 * Is this hash already handled? Yes when the newest marker is an `unchanged` with the same hash (its rows were confirmed stored earlier),
 * or a `parsed` with the same hash whose rows the scan really stored (lib/firecrawl/ledger.ts rowsWereStored). Anything else: parse again.
 */
export async function alreadyHandled(db: Db, id: string, hash: string): Promise<{ handled: boolean; since: string | null }> {
  const m = await readMarker(db, id);
  if (!m || m.hash !== hash) return { handled: false, since: null };
  if (m.state === 'unchanged') return { handled: true, since: m.at };
  if (m.state !== 'parsed') return { handled: false, since: null };
  const run = await lastScanRun(db, id);
  return { handled: rowsWereStored(run, m.at, m.kept), since: m.at };
}

/** Two Firecrawl runs in a row kept no row at this page hash: do not call Firecrawl again until the page changes (round 20 review P1-6). */
export async function firecrawlStalled(db: Db, id: string, hash: string): Promise<boolean> {
  const ms = await readMarkers(db, id, 2);
  return ms.length === 2 && ms.every((m) => m.state === 'zero' && m.hash === hash);
}

function parseBody(body: string, ds: PageWatchDataset, tick: Tick): ParseResult | 'not_json' {
  switch (ds.parser) {
    case 'bonfire': {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return 'not_json';
      }
      return parseBonfire(json, ds, tick);
    }
    case 'html-table':
      return parseHtmlTable(listingArea(body, ds).html, ds, tick);
    case 'html-links':
      return parseHtmlLinks(body, ds, tick);
    case 'text-blocks':
      return parseTextBlocks(body, ds, tick);
    case 'rss':
      return parseRss(body, ds, tick);
    case 'csv':
      return parseCsv(body, ds, tick);
    default:
      return { rows: [], structure: false, empty: false, problem: 'no parser' };
  }
}

const HTML_PARSERS = new Set(['html-table', 'html-links', 'text-blocks', 'none']);

function looksHtml(contentType: string, body: string): boolean {
  if (/html|xhtml/i.test(contentType)) return true;
  if (contentType && !/text\/plain|octet-stream/i.test(contentType)) return false;
  return /<(?:!doctype html|html|body|table)\b/i.test(body.slice(0, 5000));
}

// ---- Firecrawl -----------------------------------------------------------------------------------------------------------------------

/** The dataset as a Firecrawl agency source (lib/firecrawl/local-sources.ts shape). Every row may fall back to the list page. */
export function asLocalBidSource(ds: PageWatchDataset): LocalBidSource {
  return {
    id: ds.id, label: ds.label, placeLabel: ds.agency, agency: ds.agency, listUrl: ds.url, domains: ds.linkDomains, tz: ds.tz,
    zip: ds.zip, city: ds.city, state: ds.state, address: null, listFallback: true, hint: ds.firecrawlHint ?? '', pageName: ds.label,
  };
}

/** Firecrawl may be called for this source now: the page-watch gate (terms + switch) AND the Firecrawl switch and key. */
export function firecrawlAllowed(ds: PageWatchDataset, e: Record<string, string | undefined> = {}): boolean {
  return !pageWatchGate(ds, e) && localBidsEnabled(pick({ env: e }, LOCAL_BIDS_FLAG)) && !!pick({ env: e }, 'FIRECRAWL_API_KEY');
}

async function viaFirecrawl(ds: PageWatchDataset, deps: PageWatchDeps, startedMs: number, hash: string | null, base: Partial<PageWatchReport> = {}): Promise<PageWatchReport> {
  if (deps.probe) return report(ds, { ...base, check: 'skipped', detail: `rows come from Firecrawl: probe with /api/admin/firecrawl-probe?source=${ds.id}` });
  if (!firecrawlAllowed(ds, deps.env)) return report(ds, { ...base, check: 'skipped', detail: `Firecrawl needs ${LOCAL_BIDS_FLAG} and FIRECRAWL_API_KEY` });
  const useMarkers = !!deps.db && !deps.dry && !!hash;
  if (useMarkers) {
    try {
      if (await firecrawlStalled(deps.db as Db, ds.id, hash as string)) {
        return report(ds, { ...base, check: 'unchanged', detail: 'two Firecrawl runs kept no row at this page; not called again until the page changes' });
      }
    } catch {
      return report(ds, { ...base, check: 'skipped', detail: 'markers unreadable: Firecrawl not called' });
    }
  }
  const e: Record<string, string | undefined> = { ...(deps.env ?? {}) };
  for (const k of [LOCAL_BIDS_FLAG, 'FIRECRAWL_API_KEY', 'FIRECRAWL_RUN_CREDIT_CAP', 'FIRECRAWL_DAILY_CREDIT_CAP', 'FIRECRAWL_MONTHLY_CREDIT_CAP', 'FIRECRAWL_MIN_REMAINING']) e[k] = pick(deps, k);
  const clock = deps.clock ?? Date.now;
  const r = await runLocalBidSource(asLocalBidSource(ds), {
    fetch: deps.fetch, env: e, now: deps.now, log: deps.log ?? (() => {}), db: deps.db ?? null, dry: deps.dry,
    // While on probation the bids flag is not required (samples only); the page-watch switch, the terms record, the Firecrawl switch and
    // the key were all checked above (firecrawlAllowed).
    ignoreBidsFlag: true,
    budgetMs: Math.max(0, (deps.budgetMs ?? PW_BUDGET_MS) - (clock() - startedMs)),
    ...(deps.makeClient ? { makeClient: deps.makeClient } : {}),
  });
  // Rows come back titled "Open bid in <agency>: <title>"; page-watch rows read "Bid: <title> (<agency>)", cleaned like any row.
  const kept: SignalInput[] = [];
  for (const s of r.kept) {
    const raw = s.title.replace(/^Open bid in .+?: /, '');
    if (HONORIFIC.test(raw)) continue;
    const t = cleanBidTitle(raw);
    if (t.length < 4) continue;
    const due = s.expiresAt ?? null;
    kept.push({
      ...s,
      title: `Bid: ${t} (${ds.agency})`,
      categories: pageWatchTrades({ title: t }).length ? pageWatchTrades({ title: t }) : s.categories,
      data: { ...(s.data ?? {}), buyer: ds.agency, via: 'firecrawl', platform: ds.platform, parser: ds.parser, statusClass: 'none', proposedLabel: proposedPageWatchLabel(due, deps.now) },
    });
  }
  const counts = zeroCounts();
  counts.read = r.rowsExtracted;
  counts.kept = kept.length;
  if (useMarkers && r.calls > 0) {
    try {
      await writeMarker(deps.db as Db, ds.id, deps.now, kept.length ? 'parsed' : 'zero', hash as string, r.rowsExtracted, kept.length);
    } catch {
      /* the next run re-checks */
    }
  }
  const check: PageWatchCheck =
    r.status === 'unchanged' ? 'unchanged' : r.status === 'error' ? 'http_error' : r.status === 'skipped' ? (r.reason === 'robots_disallowed' ? 'robots_disallowed' : r.reason === 'crawl_delay' ? 'crawl_delay' : 'skipped') : 'firecrawl';
  return report(ds, { ...base, check, detail: r.reason ?? null, via: 'firecrawl', kept, counts, credits: r.creditsEstimated, notes: r.notes });
}

// ---- one source, start to finish -----------------------------------------------------------------------------------------------------

interface Page {
  body: string;
  status: number;
  contentType: string;
  hash: string;
}

/** robots.txt (fail closed, Crawl-delay) and the page, redirects followed by hand. A report when it cannot go on. */
async function fetchPage(ds: PageWatchDataset, deps: PageWatchDeps, left: () => number, tick: Tick, counter: { n: number }): Promise<Page | PageWatchReport> {
  const counted: typeof fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    counter.n++;
    return deps.fetch(input, init);
  }) as typeof fetch;
  const clock = deps.clock ?? Date.now;
  const robotsFor = async (url: string) => {
    try {
      return await checkRobots(url, withTimeout(counted, Math.min(PW_ROBOTS_TIMEOUT_MS, Math.max(1000, left()))), deps.now.getTime(), { agents: HOLLER_AGENTS });
    } catch {
      return { allowed: false as const, reason: 'unreachable' as const, why: 'robots.txt: no answer' };
    }
  };
  const robots = await robotsFor(ds.url);
  if (!robots.allowed) {
    const disallowed = robots.reason === 'disallowed';
    return report(ds, {
      check: disallowed ? 'robots_disallowed' : 'robots_unreachable',
      detail: disallowed ? `robots.txt disallows ${new URL(ds.url).pathname}` : `${'why' in robots && robots.why ? robots.why : 'robots.txt could not be read'}: not fetched this run`,
    });
  }
  const wait = crawlDelayWaitMs(ds.url, robots.crawlDelaySec, clock());
  if (wait > 0) return report(ds, { check: 'crawl_delay', detail: `Crawl-delay ${robots.crawlDelaySec} s not met since the last read of this host (${Math.ceil(wait / 1000)} s left)` });

  const accept = ds.parser === 'bonfire' ? 'application/json' : ds.parser === 'rss' ? 'application/rss+xml, application/atom+xml, application/xml, text/xml' : ds.parser === 'csv' ? 'text/csv, text/plain' : 'text/html, application/xhtml+xml';
  // Never a browser-only header: a vendor list endpoint is called only when the owner recorded that the vendor's terms allow it
  // (accessCleared requires evidence.endpointAllowed for Bonfire), and then as a plain client.
  const headers: Record<string, string> = { 'User-Agent': PW_UA, Accept: accept };
  let url = ds.url;
  let res: Response | null = null;
  for (let hop = 0; hop <= 2; hop++) {
    const ms = Math.min(PW_PAGE_TIMEOUT_MS, left());
    if (ms < 1500) return report(ds, { check: 'timeout', detail: 'no time left for the page' });
    try {
      noteFetch(url, clock());
      res = await withTimeout(counted, ms)(url, { headers, redirect: 'manual' });
    } catch (e) {
      return report(ds, { check: isTimeout(e) ? 'timeout' : 'http_error', detail: isTimeout(e) ? `no answer in ${ms} ms` : 'request failed' });
    }
    if (res.status < 300 || res.status >= 400) break;
    const loc = res.headers.get('location');
    let next: URL | null = null;
    try {
      next = loc ? new URL(loc, url) : null;
    } catch {
      next = null;
    }
    if (!next || hop === 2) return report(ds, { check: 'http_error', httpStatus: res.status, detail: next ? 'too many redirects' : `HTTP ${res.status} without a location` });
    if (next.protocol !== 'https:' || !hostOk(next.hostname, ds)) return report(ds, { check: 'http_error', httpStatus: res.status, detail: `redirect to ${next.hostname}: not followed` });
    // The target is checked against ITS host's robots.txt (cached when it is the same origin).
    const r2 = await robotsFor(next.toString());
    if (!r2.allowed) {
      return report(ds, { check: r2.reason === 'disallowed' ? 'robots_disallowed' : 'robots_unreachable', detail: `redirect to ${next.hostname}${next.pathname}: its robots.txt ${r2.reason === 'disallowed' ? 'disallows the page' : 'could not be read'}` });
    }
    url = next.toString();
  }
  if (!res) return report(ds, { check: 'http_error', detail: 'no answer' });
  if (!res.ok) return report(ds, { check: 'http_error', httpStatus: res.status, detail: `HTTP ${res.status}` });
  const contentType = res.headers.get('content-type') ?? '';
  let body: string;
  try {
    body = await readCapped(res, HTML_PARSERS.has(ds.parser) ? PW_MAX_HTML : PW_MAX_DATA);
  } catch (e) {
    return report(ds, { check: isTimeout(e) ? 'timeout' : 'http_error', httpStatus: res.status, detail: 'body could not be read' });
  }
  if (HTML_PARSERS.has(ds.parser) && !looksHtml(contentType, body)) return report(ds, { check: 'not_html', httpStatus: res.status, detail: `content-type ${contentType.split(';')[0] || 'none'}` });
  return { body, status: res.status, contentType, hash: hashText(areaFingerprint(body, ds, tick)) };
}

/** One page, start to finish. Used by the adapter and by the owner probe (probe: no markers, no Firecrawl). Never throws. */
export async function runPageWatch(ds: PageWatchDataset, deps: PageWatchDeps): Promise<PageWatchReport> {
  const clock = deps.clock ?? Date.now;
  const startedMs = clock();
  const budget = deps.budgetMs ?? PW_BUDGET_MS;
  const left = () => budget - (clock() - startedMs);
  const counter = { n: 0 };
  const withRequests = (r: PageWatchReport): PageWatchReport => ({ ...r, requests: counter.n });
  try {
    // 0. gates: no request of any kind before the owner's terms record and the master switch.
    const gate = pageWatchGate(ds, deps.env);
    if (gate) return report(ds, gate);
    if (ds.firecrawl === 'only' && (deps.probe || !firecrawlAllowed(ds, deps.env))) return await viaFirecrawl(ds, deps, startedMs, null);

    const tick = tickUntil(performance.now() + (deps.parseMs ?? PW_PARSE_MS));
    // 1-2. robots.txt and the page
    const page = await fetchPage(ds, deps, left, tick, counter);
    if ('check' in page) return withRequests(page);
    const base = { httpStatus: page.status, hash: page.hash };

    if (ds.firecrawl === 'only') return withRequests(await viaFirecrawl(ds, deps, startedMs, page.hash, base));

    // 3. unchanged listing: nothing more
    const useMarkers = !!deps.db && !deps.dry && !deps.probe;
    if (useMarkers) {
      try {
        const h = await alreadyHandled(deps.db as Db, ds.id, page.hash);
        if (h.handled) {
          try {
            await writeMarker(deps.db as Db, ds.id, deps.now, 'unchanged', page.hash, 0, 0);
          } catch {
            /* the next run re-checks */
          }
          return withRequests(report(ds, { ...base, check: 'unchanged', detail: h.since ? `same listing as ${h.since.slice(0, 10)}` : null }));
        }
      } catch {
        // Markers unreadable: parse (free) rather than skip.
      }
    }

    // 4. parse, inside the time limit
    const parsed = parseBody(page.body, ds, tick);
    if (parsed === 'not_json') return withRequests(report(ds, { ...base, check: 'not_json', detail: `expected JSON, content-type ${page.contentType.split(';')[0] || 'none'}` }));
    const notes: string[] = [];
    let rows = parsed.rows;
    let check: PageWatchCheck = 'ok';
    if (rows.length === 0 && parsed.empty) check = 'empty';
    else if (rows.length === 0) check = 'parser_mismatch';
    if (rows.length > PW_ROW_CAP) {
      notes.push(`row cap reached: ${rows.length} rows on the page, the first ${PW_ROW_CAP} read`);
      rows = rows.slice(0, PW_ROW_CAP);
      check = 'row_cap';
    }
    const { items, counts } = rowsToSignals(rows, ds, deps.now);
    let detail: string | null = null;
    if (check === 'parser_mismatch') detail = parsed.problem ?? (parsed.structure ? 'zero rows from a page that has the structure' : 'the page has none of the structure the parser reads');
    if (counts.read > 0 && counts.badDue === counts.read) {
      check = 'parser_mismatch';
      detail = `every due date was unreadable (${counts.badDue} rows)`;
    }
    if (rows.some((r) => r.feedOnly)) notes.push('listing area not found: rows read from the whole page are feed-only');

    // 5. Firecrawl fallback (opt-in) when the parser read nothing
    if (check === 'parser_mismatch' && ds.firecrawl === 'fallback' && !deps.probe) {
      const fc = await viaFirecrawl(ds, deps, startedMs, page.hash, base);
      if (fc.via === 'firecrawl' || fc.check === 'unchanged') return withRequests(fc);
    }

    if (useMarkers && check !== 'parser_mismatch') {
      try {
        await writeMarker(deps.db as Db, ds.id, deps.now, 'parsed', page.hash, counts.read, counts.kept);
      } catch {
        notes.push('marker write skipped');
      }
    }
    return withRequests(report(ds, { ...base, check, counts, kept: items, notes, via: 'fetch', detail }));
  } catch (e) {
    if (e instanceof ParseTimeoutError) return withRequests(report(ds, { check: 'parse_timeout', detail: `parsing took over ${deps.parseMs ?? PW_PARSE_MS} ms: page too large or malformed` }));
    return withRequests(report(ds, { check: isTimeout(e) ? 'timeout' : 'http_error', detail: `unexpected ${e instanceof Error ? e.name : 'failure'}` }));
  }
}

/** The run-log lines of one report. Errors start with "error:" (run.ts turns them into the source's error); notes with the probation prefix. */
export function pageWatchLogLines(ds: PageWatchDataset, r: PageWatchReport): string[] {
  const c = r.counts;
  const tally =
    `${c.read} rows read, ${c.kept} kept (${c.notOpen} feed-only, ${c.unknownStatus} status not open, ${c.noDue} without a due date); ` +
    `dropped ${c.closed} past due, ${c.badDue} unreadable due date, ${c.noTrade} no trade, ${c.personText} naming a person, ${c.duplicates} duplicates`;
  const lines: string[] = [];
  if (PAGE_WATCH_ERROR_CHECKS.includes(r.check)) lines.push(`error: ${ds.id}: ${r.check}${r.detail ? ` (${r.detail})` : ''}`);
  else if (r.check === 'unchanged') {
    lines.push(`${ds.id}: listing unchanged${r.detail ? `, ${r.detail}` : ''}; nothing parsed${r.credits ? `, ${r.credits} credits` : ''}`);
    if (ds.probation) lines.push(`${PROBATION_NOTE_PREFIX} unchanged: the listing is the same as on the last stored run`);
  } else if (r.check === 'empty') lines.push(`${ds.id}: the page lists no open solicitations`);
  else if (r.check === 'crawl_delay') lines.push(`${ds.id}: skipped, ${r.detail ?? 'Crawl-delay not met'}`);
  else if (r.check === 'skipped' || r.check === 'terms_not_checked' || r.check === 'page_watch_off') lines.push(`${ds.id}: skipped, ${r.detail ?? r.check}`);
  else lines.push(`${ds.id}: ${r.via === 'firecrawl' ? 'Firecrawl: ' : ''}${tally}${r.credits ? `, ${r.credits} credits` : ''}`);
  for (const n of r.notes) lines.push(/^row cap reached/.test(n) ? `${PROBATION_NOTE_PREFIX} ${n}` : `${ds.id}: ${n}`);
  return lines;
}

export function buildPageWatchAdapter(ds: PageWatchDataset, over: Pick<PageWatchDeps, 'makeClient'> = {}): Adapter {
  const firecrawlOnly = ds.firecrawl === 'only';
  return {
    id: ds.id,
    label: ds.label,
    kind: 'contract',
    cadenceMinutes: ds.cadenceMinutes,
    sourceUrl: ds.pageUrl,
    // Nothing runs before the owner's terms record and the master switch. On probation the plain fetch then collects samples without the
    // bids flag ($0, no member ever sees them); promoted, it runs only while HOLLER_BIDS_ENABLED is on, like every other bid source.
    enabled: () => accessCleared(ds) && pageWatchOn() && (ds.probation === true || bidsEnabled()),
    // Read at call time: the first missing gate is the one named (missingEnvFor, the health email, /api/admin/sources).
    get flag() {
      return !accessCleared(ds) ? 'termsChecked (page-watch-datasets.ts)' : !pageWatchOn() ? PAGE_WATCH_FLAG : BIDS_FLAG;
    },
    // Firecrawl spend: the agency feeds' own switch and the key, exactly as the Atlanta Firecrawl pages need them.
    ...(firecrawlOnly ? { requiresEnv: ['FIRECRAWL_API_KEY'], extraFlags: [{ name: LOCAL_BIDS_FLAG, on: () => localBidsEnabled() }] } : {}),
    ...(ds.probation ? { probation: true } : {}),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
        // Defence in depth: run.ts already skips a disabled adapter, but a direct call must not request anything either.
        if (!accessCleared(ds)) {
          ctx.log(`${ds.id}: skipped, terms not checked`);
          return [];
        }
        if (!pageWatchOn(ctx.env[PAGE_WATCH_FLAG] ?? env.HOLLER_PAGE_WATCH_ENABLED ?? process.env[PAGE_WATCH_FLAG])) {
          ctx.log(`${ds.id}: skipped, ${PAGE_WATCH_FLAG} is off`);
          return [];
        }
        if (!ds.probation && !bidsEnabled(ctx.env[BIDS_FLAG] ?? env.HOLLER_BIDS_ENABLED ?? process.env[BIDS_FLAG])) {
          ctx.log(`${ds.id}: skipped, ${BIDS_FLAG} is off`);
          return [];
        }
        const r = await runPageWatch(ds, { fetch: ctx.fetch, now: ctx.now ?? new Date(), env: ctx.env, db: ctx.db ?? null, dry: ctx.dry, log: ctx.log, ...over });
        for (const l of pageWatchLogLines(ds, r)) ctx.log(l);
        return r.kept;
      } catch (err) {
        ctx.log(`error: ${ds.id}: unexpected ${err instanceof Error ? err.name : 'failure'}`);
        return [];
      }
    },
  };
}

/** Registered page-watch adapters (verified entries). All on probation; none runs before its terms record and the master switch. */
export const adapters: Adapter[] = PAGE_WATCH_DATASETS.filter((d) => d.verified).map((d) => buildPageWatchAdapter(d));
