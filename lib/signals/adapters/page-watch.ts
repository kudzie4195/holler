import { createHash } from 'node:crypto';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import type { CategoryId } from '@/lib/signals/categories';
import type { Db } from '@/lib/signals/store';
import type { OpportunityLabel } from '@/lib/signals/lead-rules';
import { env } from '@/lib/env';
import { BIDS_FLAG, LOCAL_BIDS_FLAG, bidsEnabled, localBidsEnabled } from '@/lib/signals/bid-sources';
import { bidTrades, GOODS_CATEGORY, PAPER_WORK, SUPPLY_WORDS, WORK_VERBS, type BidText } from '@/lib/signals/bid-trades';
import { cleanText, localDay, tidyBuyer } from './city-bids';
import { checkRobots } from '@/lib/firecrawl/robots';
import { parseDue } from '@/lib/firecrawl/extract';
import { placeOf, type LocalBidSource } from '@/lib/firecrawl/local-sources';
import { lastScanRun, rowsWereStored } from '@/lib/firecrawl/ledger';
import { runLocalBidSource, type PipelineDeps } from '@/lib/firecrawl/pipeline';
import { PROBATION_NOTE_PREFIX } from '@/lib/signals/probation-note';
import { PAGE_WATCH_DATASETS, type PageWatchDataset } from './page-watch-datasets';
import { listingArea, parseBonfire, parseCsv, parseHtmlLinks, parseHtmlTable, parseRss, parseTextBlocks, textOf, type ParseResult, type RawBidRow } from './page-watch-parse';

/**
 * ROUND 20 WATCH: the $0 "page-watch" adapter. One adapter per public bid page in page-watch-datasets.ts, every one ON PROBATION.
 * The architecture is the one recommended in gates/r19/TOOLS-research.md section 7 (pull, not push):
 *
 *   1. robots   the host's robots.txt is fetched (cached 1 h) and obeyed (lib/firecrawl/robots.ts). A disallowed path is never fetched:
 *               the run logs `robots_disallowed` and the owner's source list shows that state.
 *   2. fetch    one plain GET with a clear user agent (PW_UA) and a short timeout, inside the scan's 12 s probation budget.
 *   3. hash     the listing area's visible text is hashed. When it equals the last hash whose rows the scan stored (marker rows `_pw:<id>`
 *               in holler_scan_runs, the same no-migration trick as the Firecrawl ledger), nothing is parsed or returned: an unchanged
 *               page costs one fetch.
 *   4. parse    the dataset's platform parser (page-watch-parse.ts) gives raw rows; this file validates them: open, not past due, a Holler
 *               trade in the title (bid-trades.ts plus a small general-contractor rule), a public link, no person's name or contact detail.
 *   5. Firecrawl only where a page needs a browser (`firecrawl: 'only'`) or as a per-source opt-in fallback when the parser reads nothing
 *               (`'fallback'`): lib/firecrawl/pipeline.ts with its budget caps unchanged, and only with HOLLER_LOCAL_BIDS_ENABLED and
 *               FIRECRAWL_API_KEY set.
 *
 * Check states (the run log, the scan_runs error column and GET /api/admin/sources): robots_disallowed, robots_unreachable, not_html,
 * not_json, parser_mismatch (zero rows from a page that has the structure), http_error, timeout (errors); unchanged, row_cap (probation
 * notes); empty (the page says nothing is open); ok.
 *
 * Rows: kind 'contract', data.subtype 'bid', title "Bid: <title> (<agency>)", position = the agency office ZIP centroid (data.loc 'approx').
 */

export const PW_UA = 'Holler/1.0 page-watch (+https://localholler.com/about)';
export const PW_ROBOTS_TIMEOUT_MS = 4000;
export const PW_PAGE_TIMEOUT_MS = 7000;
/** Whole source, ms: inside run.ts PROBATION_TIMEOUT_MS (12 s). */
export const PW_BUDGET_MS = 11_000;
/** Most raw rows read from one page per run; the rest are left (probation note "row cap reached"). */
export const PW_ROW_CAP = 150;
/** Largest body read, characters. */
const MAX_BODY = 3_000_000;
export const PW_MARKER_PREFIX = '_pw:';
/** A due date further out than this is a placeholder, not a deadline. */
const PLACEHOLDER_DAYS = 730;

export type PageWatchCheck =
  | 'ok'
  | 'unchanged'
  | 'empty'
  | 'row_cap'
  | 'robots_disallowed'
  | 'robots_unreachable'
  | 'not_html'
  | 'not_json'
  | 'parser_mismatch'
  | 'http_error'
  | 'timeout'
  | 'firecrawl'
  | 'skipped';

export const PAGE_WATCH_ERROR_CHECKS: readonly PageWatchCheck[] = ['robots_disallowed', 'robots_unreachable', 'not_html', 'not_json', 'parser_mismatch', 'http_error', 'timeout'];

export interface PageWatchCounts {
  read: number;
  kept: number;
  closed: number;
  notOpen: number;
  noTrade: number;
  noDue: number;
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
  makeClient?: PipelineDeps['makeClient'];
}

const zeroCounts = (): PageWatchCounts => ({ read: 0, kept: 0, closed: 0, notOpen: 0, noTrade: 0, noDue: 0, duplicates: 0, noTitle: 0 });

function report(ds: PageWatchDataset, over: Partial<PageWatchReport>): PageWatchReport {
  return { source: ds.id, check: 'ok', detail: null, httpStatus: null, hash: null, counts: zeroCounts(), kept: [], notes: [], via: null, credits: 0, ...over };
}

// ---- trades and the proposed label -------------------------------------------------------------------------------------------------

/** General-contractor work the shared bid table has no word for (renovations, remodels, demolition, job order contracts, build-outs). */
const GC_WORK = /(?<![a-z0-9])(?:renovations?|remodel(?:s|ing)?|new construction|general contractor|general construction|job order contract(?:s|ing)?|demolition|build-?outs?|tenant improvements?|site improvements?)(?![a-z0-9])/i;

/**
 * Trades of a page-watch bid: the shared bid table (lib/signals/bid-trades.ts, unchanged) plus general-contractor for renovation,
 * remodel, demolition and job-order work, or a "Construction" category, under the same purchase and paper-work guards. Only page-watch
 * rows use the addition; folding it into bid-trades.ts is a promotion decision (it would change the live city bids too).
 */
export function pageWatchTrades(t: BidText): CategoryId[] {
  const base = bidTrades(t);
  const title = t.title.toLowerCase();
  if (t.category && GOODS_CATEGORY.test(t.category)) return base;
  if (PAPER_WORK.test(title) || (SUPPLY_WORDS.test(title) && !WORK_VERBS.test(title))) return base;
  const gc = GC_WORK.test(title) || /^\s*construction\s*$/i.test(t.category ?? '');
  return gc && !base.includes('general-contractor') ? [...base, 'general-contractor'] : base;
}

/** The label proposed for a page-watch bid (lib/signals/proposed-labels.ts): urgent when it is due 3 or more days out, else heads-up. */
export function proposedPageWatchLabel(dueIso: string | null | undefined, now: Date): Extract<OpportunityLabel, 'act_now' | 'coming_soon'> {
  const t = dueIso ? Date.parse(dueIso) : NaN;
  return Number.isFinite(t) && t - now.getTime() >= 3 * 86_400_000 ? 'act_now' : 'coming_soon';
}

// ---- row validation ----------------------------------------------------------------------------------------------------------------

const NOT_OPEN = /\b(?:award(?:ed)?|cancel(?:l?ed|lation)|closed|rejected|withdrawn|archived|expired|intent to award|bid tab(?:ulation)?|no longer accepting)\b/i;

/** Title text with links, e-mail addresses, phone numbers and anything after a "Contact:"/"Buyer:" label removed. */
export function cleanBidTitle(raw: string, number?: string): string {
  let t = cleanText(raw)
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, ' ')
    .replace(/\b(?:contact|buyer|attn|attention|questions to|prepared by)\s*:.*$/i, '');
  if (number) {
    const esc = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`^\\s*${esc}\\s*[:\\-\\u2013\\u2014|]?\\s*`, 'i'), '');
  }
  const noAdd = t.replace(/\s*(?:ADDENDUM|ADD\.)\s*(?:NO\.?|#)?\s*\d+.*$/i, '').trim();
  t = (noAdd || t).replace(/\s+/g, ' ').trim();
  return t.length <= 140 ? t : `${t.slice(0, 137).trimEnd()}...`;
}

const DATE_SNIPPET = /(\d{1,2}\/\d{1,2}\/\d{2,4}(?:[^|\n]{0,20}?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?)|((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:[^|\n]{0,20}?\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)?)|(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?)/i;

/** A printed date ("08/31/23 2:00 pm", "Dec 2, 2026 2:00 PM", "2026-12-02 20:00:00", "Proposal due: 12/10/2026") as an instant in `tz`. */
export function parseDateText(raw: string | undefined, tz: string): string | null {
  if (!raw) return null;
  const t = cleanText(raw).replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b(?!\/)/, (_m, a: string, b: string, y: string) => `${a}/${b}/20${y}`);
  const direct = parseDue(t, tz);
  if (direct) return direct.iso;
  const m = DATE_SNIPPET.exec(t);
  if (!m) return null;
  const again = parseDue(m[0].replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b(?!\/)/, (_x, a: string, b: string, y: string) => `${a}/${b}/20${y}`), tz);
  return again ? again.iso : null;
}

const AGENCY_CODES: Record<string, string> = { CTA: 'Chicago Transit Authority' };

/** The row's buying department (an agency or office column, never a person); the dataset's agency when the cell says only "City". */
function rowAgency(raw: string | undefined, ds: PageWatchDataset): string {
  const t = cleanText(raw ?? '');
  if (!t || /^(?:city|county|district|n\/?a|-)$/i.test(t)) return ds.agency;
  if (AGENCY_CODES[t.toUpperCase()]) return AGENCY_CODES[t.toUpperCase()];
  const tidy = tidyBuyer(t);
  return tidy.length > 80 ? ds.agency : tidy;
}

function linkFor(raw: string | undefined, ds: PageWatchDataset): { url: string; kind: 'solicitation' | 'list' } {
  const t = (raw ?? '').trim();
  if (t) {
    try {
      const u = new URL(t, ds.url.startsWith('https://') && ds.parser !== 'bonfire' ? ds.url : ds.pageUrl);
      const host = u.hostname.toLowerCase().replace(/^w+\./, '');
      const ok = (u.protocol === 'https:' || u.protocol === 'http:') && ds.linkDomains.some((d) => host === d || host.endsWith(`.${d}`) || u.hostname.toLowerCase() === d);
      if (ok) {
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

/** Raw rows to records. Pure: pass the clock. Rows past their due date, not open, with no trade or no title are counted and left out. */
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
    const title = cleanBidTitle(r.title ?? '', number || undefined);
    if (title.length < 4) {
      counts.noTitle++;
      continue;
    }
    const status = cleanText(r.status ?? '');
    if (NOT_OPEN.test(status) || (notOpenRe && notOpenRe.test(status)) || /\bcancel(?:l?ed|lation)\b/i.test(title)) {
      counts.notOpen++;
      continue;
    }
    let due = parseDateText(r.due, dueTz);
    if (due && Date.parse(due) <= nowMs) {
      counts.closed++;
      continue;
    }
    if (due && Date.parse(due) - nowMs > PLACEHOLDER_DAYS * 86_400_000) due = null;
    const category = cleanText(r.category ?? '');
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
    if (!due) counts.noDue++;
    const agency = rowAgency(r.agency, ds);
    const posted = parseDateText(r.posted, ds.tz);
    const dueDay = due ? localDay(due, ds.tz) : null;
    const summary = [agency, category, number, dueDay ? `due ${dueDay}` : 'no due date published'].filter(Boolean).join(' | ').slice(0, 280);
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
        linkKind: link.kind,
        tz: ds.tz,
        // The position is the agency's office ZIP centroid, not a job site: the matcher reads radius + 15 miles and no screen shows a distance.
        loc: 'approx',
        approxLocation: true,
        via: via === 'fetch' ? 'page-watch' : 'firecrawl',
        platform: ds.platform,
        parser: ds.parser,
        domain: new URL(ds.pageUrl).hostname,
        proposedLabel: proposedPageWatchLabel(due, now),
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
export function areaFingerprint(body: string, ds: PageWatchDataset): string {
  if (ds.parser === 'html-table' || ds.parser === 'html-links' || ds.parser === 'text-blocks') return textOf(listingArea(body, ds));
  return body;
}

export interface Marker {
  at: string;
  state: 'parsed' | 'unchanged';
  hash: string;
  kept: number;
}

/** The newest `_pw:<id>` marker row, or null. Throws on a database error. */
export async function readMarker(db: Db, id: string): Promise<Marker | null> {
  const { data, error } = await db.from('holler_scan_runs').select('started_at, inserted, error').eq('source', `${PW_MARKER_PREFIX}${id}`).order('started_at', { ascending: false }).limit(1);
  if (error) throw new Error(`page-watch marker read failed: ${error.message}`);
  const r = (data ?? [])[0] as { started_at?: string | null; inserted?: number | null; error?: string | null } | undefined;
  const m = /^(parsed|unchanged):([0-9a-f]{8,64})$/.exec(r?.error ?? '');
  if (!r?.started_at || !m) return null;
  return { at: r.started_at, state: m[1] as Marker['state'], hash: m[2], kept: r.inserted ?? 0 };
}

export async function writeMarker(db: Db, id: string, at: Date, state: Marker['state'], hash: string, read: number, kept: number): Promise<void> {
  const iso = at.toISOString();
  const { error } = await db.from('holler_scan_runs').insert({ source: `${PW_MARKER_PREFIX}${id}`, started_at: iso, finished_at: iso, fetched: read, inserted: kept, matched: 0, error: `${state}:${hash}` });
  if (error) throw new Error(`page-watch marker write failed: ${error.message}`);
}

/**
 * Is this hash already handled? Yes when the newest marker is an `unchanged` with the same hash (its rows were confirmed stored earlier),
 * or a `parsed` with the same hash whose rows the scan really stored (its own scan_runs row is newer, error free and saw as many rows:
 * lib/firecrawl/ledger.ts rowsWereStored). Anything else: parse again.
 */
export async function alreadyHandled(db: Db, id: string, hash: string): Promise<{ handled: boolean; since: string | null }> {
  const m = await readMarker(db, id);
  if (!m || m.hash !== hash) return { handled: false, since: null };
  if (m.state === 'unchanged') return { handled: true, since: m.at };
  const run = await lastScanRun(db, id);
  return { handled: rowsWereStored(run, m.at, m.kept), since: m.at };
}

function parseBody(body: string, ds: PageWatchDataset): ParseResult | 'not_json' {
  switch (ds.parser) {
    case 'bonfire': {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        return 'not_json';
      }
      return parseBonfire(json, ds);
    }
    case 'html-table':
      return parseHtmlTable(listingArea(body, ds), ds);
    case 'html-links':
      return parseHtmlLinks(listingArea(body, ds), ds);
    case 'text-blocks':
      return parseTextBlocks(listingArea(body, ds), ds);
    case 'rss':
      return parseRss(body, ds);
    case 'csv':
      return parseCsv(body, ds);
    default:
      return { rows: [], structure: false, empty: false, problem: 'no parser' };
  }
}

const HTML_PARSERS = new Set(['html-table', 'html-links', 'text-blocks']);

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

function pick(deps: PageWatchDeps, k: string): string | undefined {
  return deps.env?.[k] ?? (env as Record<string, string | undefined>)[k] ?? process.env[k];
}

async function viaFirecrawl(ds: PageWatchDataset, deps: PageWatchDeps, startedMs: number, base: Partial<PageWatchReport> = {}): Promise<PageWatchReport> {
  if (deps.probe) return report(ds, { ...base, check: 'skipped', detail: 'rows come from Firecrawl: probe with /api/admin/firecrawl-probe?source=' + ds.id });
  if (!localBidsEnabled(pick(deps, LOCAL_BIDS_FLAG)) || !pick(deps, 'FIRECRAWL_API_KEY')) {
    return report(ds, { ...base, check: 'skipped', detail: `Firecrawl needs ${LOCAL_BIDS_FLAG} and FIRECRAWL_API_KEY` });
  }
  const e: Record<string, string | undefined> = { ...(deps.env ?? {}) };
  for (const k of [LOCAL_BIDS_FLAG, 'FIRECRAWL_API_KEY', 'FIRECRAWL_RUN_CREDIT_CAP', 'FIRECRAWL_DAILY_CREDIT_CAP', 'FIRECRAWL_MONTHLY_CREDIT_CAP', 'FIRECRAWL_MIN_REMAINING']) e[k] = pick(deps, k);
  const clock = deps.clock ?? Date.now;
  const r = await runLocalBidSource(asLocalBidSource(ds), {
    fetch: deps.fetch, env: e, now: deps.now, log: deps.log ?? (() => {}), db: deps.db ?? null, dry: deps.dry,
    // The bids flag is not required while on probation (samples only); the Firecrawl switch and key were checked above.
    ignoreBidsFlag: true,
    budgetMs: Math.max(0, (deps.budgetMs ?? PW_BUDGET_MS) - (clock() - startedMs)),
    ...(deps.makeClient ? { makeClient: deps.makeClient } : {}),
  });
  // Rows come back titled "Open bid in <agency>: <title>"; page-watch rows read "Bid: <title> (<agency>)".
  const kept = r.kept.map((s) => {
    const t = s.title.replace(/^Open bid in .+?: /, '');
    const due = s.expiresAt ?? null;
    return {
      ...s,
      title: `Bid: ${t} (${ds.agency})`,
      categories: pageWatchTrades({ title: t }).length ? pageWatchTrades({ title: t }) : s.categories,
      data: { ...(s.data ?? {}), via: 'firecrawl', platform: ds.platform, parser: ds.parser, proposedLabel: proposedPageWatchLabel(due, deps.now) },
    };
  });
  const counts = zeroCounts();
  counts.read = r.rowsExtracted;
  counts.kept = kept.length;
  const check: PageWatchCheck = r.status === 'unchanged' ? 'unchanged' : r.status === 'error' ? 'http_error' : r.status === 'skipped' ? (r.reason === 'robots_disallowed' ? 'robots_disallowed' : 'skipped') : 'firecrawl';
  return report(ds, { ...base, check, detail: r.reason ?? null, via: 'firecrawl', kept, counts, credits: r.creditsEstimated, notes: r.notes });
}

// ---- one source, start to finish -----------------------------------------------------------------------------------------------------

/** One page, start to finish. Used by the adapter and by the owner probe (probe: no markers, no Firecrawl). Never throws. */
export async function runPageWatch(ds: PageWatchDataset, deps: PageWatchDeps): Promise<PageWatchReport> {
  const clock = deps.clock ?? Date.now;
  const startedMs = clock();
  const budget = deps.budgetMs ?? PW_BUDGET_MS;
  const left = () => budget - (clock() - startedMs);
  try {
    if (ds.firecrawl === 'only') return await viaFirecrawl(ds, deps, startedMs);

    // 1. robots.txt
    let robots;
    try {
      robots = await checkRobots(ds.url, withTimeout(deps.fetch, Math.min(PW_ROBOTS_TIMEOUT_MS, Math.max(1000, left()))), deps.now.getTime());
    } catch {
      robots = { allowed: false as const, reason: 'unreachable' as const };
    }
    if (!robots.allowed) {
      const disallowed = robots.reason === 'disallowed';
      return report(ds, { check: disallowed ? 'robots_disallowed' : 'robots_unreachable', detail: disallowed ? `robots.txt disallows ${new URL(ds.url).pathname}` : 'robots.txt could not be read (5xx or no answer): not fetched this run' });
    }

    // 2. the page
    const ms = Math.min(PW_PAGE_TIMEOUT_MS, left());
    if (ms < 1500) return report(ds, { check: 'timeout', detail: 'no time left after robots.txt' });
    const accept = ds.parser === 'bonfire' ? 'application/json, text/javascript, */*;q=0.1' : ds.parser === 'rss' ? 'application/rss+xml, application/atom+xml, application/xml, text/xml' : ds.parser === 'csv' ? 'text/csv, text/plain' : 'text/html, application/xhtml+xml';
    const headers: Record<string, string> = { 'User-Agent': PW_UA, Accept: accept };
    if (ds.parser === 'bonfire') headers['X-Requested-With'] = 'XMLHttpRequest';
    let res: Response;
    try {
      res = await withTimeout(deps.fetch, ms)(ds.url, { headers, redirect: 'follow' });
    } catch (e) {
      return report(ds, { check: isTimeout(e) ? 'timeout' : 'http_error', detail: isTimeout(e) ? `no answer in ${ms} ms` : 'request failed' });
    }
    if (!res.ok) return report(ds, { check: 'http_error', httpStatus: res.status, detail: `HTTP ${res.status}` });
    let body: string;
    try {
      body = (await res.text()).slice(0, MAX_BODY);
    } catch (e) {
      return report(ds, { check: isTimeout(e) ? 'timeout' : 'http_error', httpStatus: res.status, detail: 'body could not be read' });
    }
    const ctype = res.headers.get('content-type') ?? '';
    if (HTML_PARSERS.has(ds.parser) && !looksHtml(ctype, body)) {
      return report(ds, { check: 'not_html', httpStatus: res.status, detail: `content-type ${ctype.split(';')[0] || 'none'}` });
    }

    // 3. hash of the listing area; unchanged costs nothing more
    const hash = hashText(areaFingerprint(body, ds));
    const useMarkers = !!deps.db && !deps.dry && !deps.probe;
    if (useMarkers) {
      try {
        const h = await alreadyHandled(deps.db as Db, ds.id, hash);
        if (h.handled) {
          try {
            await writeMarker(deps.db as Db, ds.id, deps.now, 'unchanged', hash, 0, 0);
          } catch {
            /* the next run re-checks */
          }
          return report(ds, { check: 'unchanged', httpStatus: res.status, hash, detail: h.since ? `same listing as ${h.since.slice(0, 10)}` : null });
        }
      } catch {
        // Markers unreadable: parse (free) rather than skip.
      }
    }

    // 4. parse
    const parsed = parseBody(body, ds);
    if (parsed === 'not_json') return report(ds, { check: 'not_json', httpStatus: res.status, hash, detail: `expected JSON, content-type ${ctype.split(';')[0] || 'none'}` });
    const notes: string[] = [];
    let rows = parsed.rows;
    let check: PageWatchCheck = 'ok';
    if (rows.length === 0 && parsed.empty) check = 'empty';
    // Zero rows from a page that has the structure (a table, numbered links, a projects list) is a mismatch; so is a page without it.
    else if (rows.length === 0) check = 'parser_mismatch';
    if (rows.length > PW_ROW_CAP) {
      notes.push(`row cap reached: ${rows.length} rows on the page, the first ${PW_ROW_CAP} read`);
      rows = rows.slice(0, PW_ROW_CAP);
      check = 'row_cap';
    }
    const { items, counts } = rowsToSignals(rows, ds, deps.now);

    // 5. Firecrawl fallback (opt-in) when the parser read nothing from a page that has content
    if (check === 'parser_mismatch' && ds.firecrawl === 'fallback' && !deps.probe) {
      const fc = await viaFirecrawl(ds, deps, startedMs, { hash, httpStatus: res.status });
      if (fc.via === 'firecrawl' && fc.check !== 'skipped') return fc;
    }

    if (useMarkers && check !== 'parser_mismatch') {
      try {
        await writeMarker(deps.db as Db, ds.id, deps.now, 'parsed', hash, counts.read, counts.kept);
      } catch {
        notes.push('marker write skipped');
      }
    }
    return report(ds, {
      check,
      httpStatus: res.status,
      hash,
      counts,
      kept: items,
      notes,
      via: 'fetch',
      detail: check === 'parser_mismatch' ? parsed.problem ?? (parsed.structure ? 'zero rows from a page that has the structure' : `the page has no ${ds.parser === 'html-table' ? 'table' : ds.parser === 'bonfire' ? 'projects list' : 'numbered rows'}`) : null,
    });
  } catch (e) {
    return report(ds, { check: isTimeout(e) ? 'timeout' : 'http_error', detail: `unexpected ${e instanceof Error ? e.name : 'failure'}` });
  }
}

/** The run-log lines of one report. Errors start with "error:" (run.ts turns them into the source's error); notes with the probation prefix. */
export function pageWatchLogLines(ds: PageWatchDataset, r: PageWatchReport): string[] {
  const c = r.counts;
  const tally = `${c.read} rows read, ${c.kept} kept (${c.closed} past due, ${c.notOpen} not open, ${c.noTrade} no trade, ${c.duplicates} duplicates; ${c.noDue} kept without a due date)`;
  const lines: string[] = [];
  if (PAGE_WATCH_ERROR_CHECKS.includes(r.check)) lines.push(`error: ${ds.id}: ${r.check}${r.detail ? ` (${r.detail})` : ''}`);
  else if (r.check === 'unchanged') {
    lines.push(`${ds.id}: listing unchanged${r.detail ? `, ${r.detail}` : ''}; nothing parsed${r.credits ? `, ${r.credits} credits` : ''}`);
    if (ds.probation) lines.push(`${PROBATION_NOTE_PREFIX} unchanged: the listing is the same as on the last stored run`);
  } else if (r.check === 'empty') lines.push(`${ds.id}: the page lists no open solicitations`);
  else if (r.check === 'skipped') lines.push(`${ds.id}: skipped, ${r.detail ?? 'not run'}`);
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
    // On probation the plain fetch collects samples without the bids flag ($0, no member ever sees them). Promoted, it runs only while
    // HOLLER_BIDS_ENABLED is on, like every other bid source.
    enabled: () => ds.probation === true || bidsEnabled(),
    flag: BIDS_FLAG,
    // Firecrawl spend: the agency feeds' own switch and the key, exactly as the Atlanta Firecrawl pages need them.
    ...(firecrawlOnly ? { requiresEnv: ['FIRECRAWL_API_KEY'], extraFlags: [{ name: LOCAL_BIDS_FLAG, on: () => localBidsEnabled() }] } : {}),
    ...(ds.probation ? { probation: true } : {}),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      try {
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

/** Registered page-watch adapters (verified entries). All on probation. */
export const adapters: Adapter[] = PAGE_WATCH_DATASETS.filter((d) => d.verified).map((d) => buildPageWatchAdapter(d));
