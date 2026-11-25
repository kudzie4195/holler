import { HOLLER_UA } from '@/lib/user-agent';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { BIDS_FLAG, ERATE_FLAG, bidsEnabled, erateEnabled } from '@/lib/signals/bid-sources';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { hasContactShape } from '@/lib/contacts/org';
import {
  ERATE_CADENCE_MINUTES,
  ERATE_DATASET_ID,
  ERATE_DOMAIN,
  ERATE_ENDPOINT,
  ERATE_FIELDS,
  ERATE_ID,
  ERATE_LABEL,
  ERATE_MAX_PAGES,
  ERATE_PAGE_PAUSE_MS,
  ERATE_PAGE_SIZE,
  ERATE_PAGE_TIMEOUT_MS,
  ERATE_PAGE_URL,
  ERATE_ROUTES,
  ERATE_SUMMARY_KIND,
  ERATE_TIME_BUDGET_MS,
  erateFromPart,
  erateTitle,
  fundingYearOf,
  routeFor,
  whoFor,
  type ErateWork,
} from './erate-config';

/**
 * USAC E-Rate FCC Form 470 requests from schools and libraries, as Open bid cards for electrical and low-voltage firms (round 33). What the
 * source is, what it holds, the privacy rules and the trade routing are written in erate-config.ts; read that first.
 *
 * A card says what the record says: a school or library posted a request for bids on network cabling, and a contract may be signed from the
 * allowable contract date (the earliest day, not a deadline: the request may set a later bid deadline of its own). It does not say who may
 * bid. E-Rate pays only providers registered with USAC (a SPIN); the card says so.
 *
 * Names: the card never prints, and the record never stores, the institution's name or the city the applicant typed (review 2, owner decision):
 * neither column is requested. The title says "A school in <city>" with the city always read from the ZIP table (lib/geo), so no applicant text
 * reaches a card. The form link carries the request.
 *
 * Place: the institution's public ZIP. The position is the ZIP's centre (lib/geo), marked data.loc = 'approx' so no screen shows a distance
 * and the matcher reaches a little further (approx-location.ts). The street address is never requested, so it cannot be stored: this is
 * coarser than a block. Only ZIPs inside a served area are kept (lib/check/coverage.ts isServedZip: a ZIP in a state Holler reads with an enabled
 * local feed within 25 miles).
 *
 * Switches: HOLLER_ERATE_ENABLED and HOLLER_BIDS_ENABLED must both be on (run.ts skips the adapter naming whichever is off, and fetch() makes no
 * request without both). Off by default. HOLLER_ERATE_ENABLED also hides the stored rows when it is emptied (bid-sources.ts bidHidden), so a
 * rollback takes the cards down at once, not at their expiry.
 *
 * Cancelled forms: the same request asks for Canceled forms too. A stored card whose form was cancelled after it was first read is closed on
 * the next run (its expires_at is set to now; store.ts never updates a stored row, so this is the one write), which hides it everywhere.
 * Not re-checked: a request whose 28 day period USAC restarts (a new RFP attached) gets a later allowable date; the stored card keeps the
 * first date and closes on it, which is the cautious side (it leaves the feed early, never late), and the next scan does not add it again.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

const DAY_MS = 86_400_000;
/** A request is kept only while its contract date is at least this many days away (review 2 finding 6). */
export const MIN_DAYS_AHEAD = 2;

/** One row of the portal reduced to the allowed columns. Nothing else survives this function. */
export type ErateLine = Partial<Record<(typeof ERATE_FIELDS)[number], string | boolean>>;

/** Copies the allowed keys out of a raw row (strings and booleans only; form_pdf may be {url}). Anything else in the row is dropped here. */
export function pickAllowed(row: Obj): ErateLine {
  const out: ErateLine = {};
  for (const k of ERATE_FIELDS) {
    const v = row[k];
    if (k === 'form_pdf') {
      const url = typeof v === 'string' ? v : isObj(v) && typeof v.url === 'string' ? v.url : '';
      if (url.trim()) out[k] = url.trim();
    } else if (typeof v === 'string') {
      if (v.trim()) out[k] = v.trim();
    } else if (typeof v === 'boolean') {
      out[k] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = String(v);
    }
  }
  return out;
}

/** "ASTORIA" and "mount vernon" become "Astoria" and "Mount Vernon". Digits, hyphens and apostrophes are kept. */
export function tidyPlace(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/(^|[\s\-'.(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

/**
 * The public copy of the form, on USAC's own host, rebuilt from host and path only (review P1-3): https required, no user info, no port, no
 * query string, no fragment, and a path of plain file-name characters. Anything else is not used and the card links to the dataset page.
 */
export function formLink(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.port !== '') return null;
    if (u.hostname !== 'publicdata.usac.org' && !u.hostname.endsWith('.usac.org')) return null;
    if (!/^\/[A-Za-z0-9._~\-/]{1,200}$/.test(u.pathname)) return null;
    if (hasContactShape(u.pathname)) return null;
    return `https://${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

export interface ErateReport {
  items: SignalInput[];
  /** raw rows received */
  rows: number;
  /** distinct applications among rows that had a number */
  applications: number;
  /** applications dropped: status is not Certified (cancelled or anything else) */
  notOpen: number;
  /** application numbers whose form is Canceled: a stored card for one is closed (retireCancelled) */
  cancelled: string[];
  /** applications dropped: the allowable contract date is less than MIN_DAYS_AHEAD days away, more than 120 days out, or missing */
  closed: number;
  /** applications dropped: no line routes to a trade (erate-config.ts ERATE_ROUTES) */
  noTrade: number;
  /** applications dropped: the ZIP is missing, unknown, in another state than the row says, or outside every served area */
  notServed: number;
}

export interface ParseOptions {
  now?: Date;
  /** Served-area test. Default: lib/check/coverage.ts isServedZip. */
  served?: (place: { lat: number; lon: number; state: string }) => boolean;
  /** ZIP lookup. Default: lib/geo lookupZip. */
  zip?: (zip: string) => { zip: string; city: string; state: string; lat: number; lon: number } | null;
}

/** The first 10 characters of a floating timestamp are its calendar date. */
function dayOf(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * The instant a request stops being a heads-up: the START of its allowable contract date (00:00 UTC), with no grace. From that day a contract
 * may be signed, so the window to send a bid first is over. A day that is today or past is never ingested (parseErate).
 */
export function closesAt(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The earliest allowable date worth asking the portal for: today (UTC). The code, not the query, decides what is over. */
export function queryFloorDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Pure parser: raw SODA rows in, cards out. Never throws. */
export function parseErate(raw: unknown, opts: ParseOptions = {}): ErateReport {
  const report: ErateReport = { items: [], rows: 0, applications: 0, notOpen: 0, cancelled: [], closed: 0, noTrade: 0, notServed: 0 };
  if (!Array.isArray(raw)) return report;
  const now = opts.now ?? new Date();
  const served = opts.served ?? isServedZip;
  const zipOf = opts.zip ?? lookupZip;
  report.rows = raw.length;

  // Group the lines of each application. Only allowed columns are copied out of the raw row, before anything else looks at it.
  const apps = new Map<string, ErateLine[]>();
  for (const item of raw) {
    if (!isObj(item)) continue;
    const line = pickAllowed(item);
    const id = typeof line.application_number === 'string' ? line.application_number : '';
    if (!/^\d{6,12}$/.test(id)) continue;
    const list = apps.get(id);
    if (list) list.push(line);
    else apps.set(id, [line]);
  }
  report.applications = apps.size;

  for (const [id, lines] of apps) {
    try {
      const head = lines[0];
      const status = String(head.fcc_form_470_status ?? '').toLowerCase();
      if (status !== 'certified') {
        report.notOpen += 1;
        if (status === 'canceled' || status === 'cancelled') report.cancelled.push(id);
        continue;
      }
      const day = dayOf(head.allowable_contract_date);
      // A heads-up needs room to act: the date must be at least MIN_DAYS_AHEAD days away (a card for a date that is tomorrow would be emailed and
      // pushed hours before its window closes, and on the first run after the switch is set every request on day 27 of 28 would arrive at once).
      // A request more than 120 days out is not a real 28 day window; a missing date has none.
      if (!day || closesAt(day) - now.getTime() < MIN_DAYS_AHEAD * DAY_MS || closesAt(day) - now.getTime() > 120 * DAY_MS) {
        report.closed += 1;
        continue;
      }

      const routes = lines.map((l) => routeFor(l)).filter((r): r is NonNullable<typeof r> => r !== null);
      if (routes.length === 0) {
        report.noTrade += 1;
        continue;
      }
      const work: ErateWork = 'cabling';
      const trades = [...new Set(routes.flatMap((r) => r.trades))];

      const zip5 = String(head.billed_entity_zip ?? '').slice(0, 5);
      const z = /^\d{5}$/.test(zip5) ? zipOf(zip5) : null;
      const state = String(head.billed_entity_state ?? '').trim().toUpperCase();
      if (!z || z.state !== state || !served({ lat: z.lat, lon: z.lon, state: z.state })) {
        report.notServed += 1;
        continue;
      }

      // The city is always the ZIP table's, never the applicant's text.
      const city = tidyPlace(z.city);
      const who = whoFor(head.applicant_type);
      const link = formLink(typeof head.form_pdf === 'string' ? head.form_pdf : undefined);
      const certified = typeof head.certified_date_time === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(head.certified_date_time) ? `${head.certified_date_time.slice(0, 19)}Z` : null;

      report.items.push({
        source: ERATE_ID,
        externalId: id,
        kind: 'contract',
        title: erateTitle(who, city, work),
        summary: [ERATE_SUMMARY_KIND, erateFromPart(day)].join(' | '),
        url: link ?? ERATE_PAGE_URL,
        lat: z.lat,
        lon: z.lon,
        city,
        state: z.state,
        zip: z.zip,
        categories: trades,
        severity: 2,
        occurredAt: certified && !Number.isNaN(Date.parse(certified)) ? new Date(certified).toISOString() : now.toISOString(),
        expiresAt: new Date(closesAt(day)).toISOString(),
        data: {
          subtype: 'bid',
          dataset: ERATE_DATASET_ID,
          domain: ERATE_DOMAIN,
          solicitationId: id,
          bidType: 'E-Rate Form 470',
          // Only mapped values are stored: the who the card says, and a four-digit year.
          who,
          work,
          fundingYear: fundingYearOf(head.funding_year),
          // The earliest day a contract may be signed. NOT a deadline: never stored as dueDate (the deadline chip and the closing text read that).
          contractFrom: day,
          noDueDate: true,
          linkKind: link ? 'solicitation' : 'portal',
          // The position is the ZIP's centre, not the building: the matcher reads radius + 15 miles and no screen shows a distance.
          loc: 'approx',
          approxLocation: true,
        },
      });
    } catch {
      // skip a malformed application
    }
  }
  return report;
}

/**
 * The SoQL query for one page: certified or canceled requests with a mapped function and service type and an allowable contract date that is
 * not over, newest date first (so a full last page drops the requests closest to their contract date, never the newest).
 */
export function buildErateQuery(now: Date = new Date(), offset = 0): URLSearchParams {
  const functions = [...new Set(ERATE_ROUTES.map((r) => r.functionName))];
  const types = [...new Set(ERATE_ROUTES.map((r) => r.serviceType))];
  const list = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');
  const p = new URLSearchParams();
  p.set('$select', ERATE_FIELDS.join(','));
  p.set(
    '$where',
    `fcc_form_470_status in('Certified','Canceled') AND function in(${list(functions)}) AND service_type in(${list(types)}) AND allowable_contract_date>='${queryFloorDay(now)}T00:00:00'`,
  );
  // :id last, so two rows with the same date and application (one row per line and per attached file) have one fixed order across pages.
  p.set('$order', 'allowable_contract_date DESC,application_number DESC,:id');
  p.set('$limit', String(ERATE_PAGE_SIZE));
  if (offset > 0) p.set('$offset', String(offset));
  return p;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Closes the stored cards of forms the portal now lists as Canceled: expires_at is set to now, so bidClosed hides them from every feed, email,
 * push and public page. store.ts never updates a stored row (ignoreDuplicates), so this is the one write the adapter makes. It needs the
 * scan's service-role client (absent on a dry run and in unit tests: nothing is written then). Never throws; returns how many ids it tried.
 */
export async function retireCancelled(ctx: Pick<AdapterContext, 'db' | 'dry' | 'log'>, ids: string[], now: Date): Promise<number> {
  const db = ctx.db;
  if (!db || ctx.dry || ids.length === 0) return 0;
  const stamp = now.toISOString();
  let tried = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    try {
      const { error } = await db.from('holler_signals').update({ expires_at: stamp }).eq('source', ERATE_ID).in('external_id', part).gt('expires_at', stamp);
      if (error) ctx.log(`error: ${ERATE_ID} could not close cancelled forms: ${error.message}`);
      else tried += part.length;
    } catch (e) {
      ctx.log(`error: ${ERATE_ID} could not close cancelled forms: ${e instanceof Error ? e.name : 'failure'}`);
    }
  }
  return tried;
}

const erate: Adapter = {
  id: ERATE_ID,
  label: ERATE_LABEL,
  kind: 'contract',
  cadenceMinutes: ERATE_CADENCE_MINUTES,
  sourceUrl: ERATE_PAGE_URL,
  enabled: () => bidsEnabled(),
  flag: BIDS_FLAG,
  extraFlags: [{ name: ERATE_FLAG, on: () => erateEnabled() }],
  async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
    // Defence in depth: run.ts already skips an adapter with a switch off, but a direct call (a probe, a test) must not fetch either.
    const bidsOn = bidsEnabled(ctx.env[BIDS_FLAG] ?? env.HOLLER_BIDS_ENABLED ?? process.env[BIDS_FLAG]);
    const erateOn = erateEnabled(ctx.env[ERATE_FLAG] ?? env.HOLLER_ERATE_ENABLED ?? process.env[ERATE_FLAG]);
    if (!bidsOn || !erateOn) {
      ctx.log(`${ERATE_ID}: skipped, ${!erateOn ? ERATE_FLAG : BIDS_FLAG} is off`);
      return [];
    }
    try {
      const now = ctx.now ?? new Date();
      // Page through the open rows, a second apart (the portal's Crawl-delay), inside the adapter's own time budget. A page that is not full is the
      // last one. Before another page: stop when what is left of the budget (after the pause) is under one request's timeout.
      const t0 = Date.now();
      const body: unknown[] = [];
      let pages = 0;
      let full = false;
      let outOfTime = false;
      for (let offset = 0; pages < ERATE_MAX_PAGES; offset += ERATE_PAGE_SIZE) {
        if (pages > 0) {
          if (ERATE_TIME_BUDGET_MS - (Date.now() - t0) - ERATE_PAGE_PAUSE_MS < ERATE_PAGE_TIMEOUT_MS) {
            outOfTime = true;
            break;
          }
          await sleep(ERATE_PAGE_PAUSE_MS);
        }
        const url = `${ERATE_ENDPOINT}?${buildErateQuery(now, offset).toString()}`;
        const res = await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': HOLLER_UA }, signal: AbortSignal.timeout(ERATE_PAGE_TIMEOUT_MS) });
        pages += 1;
        if (!res.ok) {
          // The status only: a 400 body could echo the query, and nothing in it is needed.
          ctx.log(`error: ${ERATE_ID} HTTP ${res.status}`);
          return [];
        }
        const part: unknown = await res.json();
        if (!Array.isArray(part)) {
          ctx.log(`error: ${ERATE_ID} returned a non-array response, shape may have changed`);
          return [];
        }
        body.push(...part);
        full = part.length >= ERATE_PAGE_SIZE;
        if (!full) break;
      }
      const report = parseErate(body, { now });
      if (report.rows > 0 && report.applications === 0) ctx.log(`error: ${ERATE_ID} parsed 0 of ${report.rows} rows, shape may have changed`);
      else
        ctx.log(
          `${ERATE_ID}: ${report.rows} rows in ${pages} page${pages === 1 ? '' : 's'}, ${report.applications} applications, ${report.items.length} kept, ${report.notServed} outside served areas, ${report.noTrade} no trade, ${report.closed} not in the window, ${report.notOpen} not open (${report.cancelled.length} cancelled)`,
        );
      // Loud, not quiet: the pages ran out while the portal still had rows, so some open requests are missing from this run.
      if (outOfTime) ctx.log(`${ERATE_ID}: WARNING time budget reached after ${pages} page${pages === 1 ? '' : 's'}; the oldest-dated open requests may be missing`);
      else if (full) ctx.log(`${ERATE_ID}: WARNING page limit reached (${ERATE_MAX_PAGES} pages of ${ERATE_PAGE_SIZE} rows); the oldest-dated open requests may be missing`);
      // The scan gives up on an adapter at 40 s and moves on; a write sent after that would run with nobody waiting for it.
      let closed = 0;
      if (Date.now() - t0 < ERATE_TIME_BUDGET_MS) closed = await retireCancelled(ctx, report.cancelled, now);
      else if (report.cancelled.length > 0) ctx.log(`${ERATE_ID}: time budget spent, cancelled forms left for the next run`);
      if (closed > 0) ctx.log(`${ERATE_ID}: asked to close stored cards for ${closed} cancelled form${closed === 1 ? '' : 's'}`);
      return report.items;
    } catch (e) {
      // The class of failure is enough; never log a message that could carry request detail.
      ctx.log(`error: ${ERATE_ID}: ${e instanceof Error ? e.name : 'failure'}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [erate];
