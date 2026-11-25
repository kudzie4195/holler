import { HOLLER_UA } from '@/lib/user-agent';
import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { BIDS_FLAG, ERATE_FLAG, bidsEnabled, erateEnabled } from '@/lib/signals/bid-sources';
import { isServedZip } from '@/lib/check/coverage';
import { lookupZip } from '@/lib/geo';
import { hasContactShape, looksLikeFullPersonName } from '@/lib/contacts/org';
import {
  ERATE_CADENCE_MINUTES,
  ERATE_DATASET_ID,
  ERATE_DOMAIN,
  ERATE_ENDPOINT,
  ERATE_FIELDS,
  ERATE_ID,
  ERATE_LABEL,
  ERATE_PAGE_URL,
  ERATE_ROUTES,
  ERATE_ROW_CAP,
  ERATE_SUMMARY_KIND,
  erateTitle,
  erateUntilPart,
  routeFor,
  whoFor,
  type ErateWork,
} from './erate-config';

/**
 * USAC E-Rate FCC Form 470 requests from schools and libraries, as Open bid cards for electrical and low-voltage firms (round 33). What the
 * source is, what it holds, the privacy rules and the trade routing are written in erate-config.ts; read that first.
 *
 * A card says what the record says: a school or library posted a request for bids on network cabling, and bids are accepted until the
 * allowable contract date (the earliest day a contract may be signed). It does not say who may bid. E-Rate service providers are registered with
 * USAC, and the request does not say whether a given firm is; the brief says so ("who may respond is not known").
 *
 * Place: the institution's public ZIP. The position is the ZIP's centre (lib/geo), marked data.loc = 'approx' so no screen shows a distance
 * and the matcher reaches a little further (approx-location.ts). The street address is never requested, so it cannot be stored: this is
 * coarser than a block. Only ZIPs inside a served area are kept (lib/check/coverage.ts isServedZip: a ZIP in a state Holler reads with an enabled
 * local feed within 25 miles).
 *
 * Switches: HOLLER_ERATE_ENABLED and HOLLER_BIDS_ENABLED must both be on (run.ts skips the adapter naming whichever is off, and fetch() makes no
 * request without both). Off by default.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** A date-only deadline is open until the end of that day in every US time zone (UTC-10 is the latest), as lib/signals/bid-sources.ts says. */
const DAY_MS = 86_400_000;
const END_OF_DAY_GRACE_MS = 34 * 3_600_000;

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

const INSTITUTION_WORD =
  /\b(?:schools?|academy|academies|library|libraries|district|college|university|boces|county|city|township|charter|institute|consortium|prep|preparatory|seminary|foundation|authority|system|isd|cisd|usd|diocese|archdiocese|catholic|christian|lutheran|baptist|montessori|church|public|education|educational|learning|center|centre|day|kindergarten|elementary|middle|high|ccsd|cusd|esd|csd|ufsd|pta)\b/i;

/**
 * The institution's name as a card may print it, or null. It must read as an institution (a school, library, district ...), carry no phone,
 * email or link, and not be a bare personal name. A name that fails is left off the card; the card still says "A school in <city>".
 */
export function institutionName(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < 4 || clean.length > 90) return null;
  if (hasContactShape(clean) || /@|https?:|www\./i.test(clean)) return null;
  if (!INSTITUTION_WORD.test(clean)) return null;
  if (looksLikeFullPersonName(clean)) return null;
  return tidyPlace(clean).replace(/\b(Isd|Cisd|Usd|Boces|Ccsd|Cusd|Esd|Csd|Ufsd|Pta)\b/g, (w) => w.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and');
}

/** The public copy of the form, on USAC's own host. Anything else (a different host, http, a script URL) is not used. */
export function formLink(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    if (u.hostname !== 'publicdata.usac.org' && !u.hostname.endsWith('.usac.org')) return null;
    return u.toString();
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
  /** applications dropped: status is not Certified (cancelled) */
  notOpen: number;
  /** applications dropped: the allowable contract date has passed, or there is none */
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

/** The instant a request stops taking bids: the end of its allowable contract date, in the latest US zone. */
export function closesAt(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) + END_OF_DAY_GRACE_MS;
}

/** The earliest allowable date worth asking the portal for (a day of slack so the code, not the query, decides what is closed). */
export function queryFloorDay(now: Date): string {
  return new Date(now.getTime() - 36 * 3_600_000).toISOString().slice(0, 10);
}

/** Pure parser: raw SODA rows in, cards out. Never throws. */
export function parseErate(raw: unknown, opts: ParseOptions = {}): ErateReport {
  const report: ErateReport = { items: [], rows: 0, applications: 0, notOpen: 0, closed: 0, noTrade: 0, notServed: 0 };
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
      if (String(head.fcc_form_470_status ?? '').toLowerCase() !== 'certified') {
        report.notOpen += 1;
        continue;
      }
      const day = dayOf(head.allowable_contract_date);
      // A request more than 120 days out is not a real 28 day window; a missing date has no deadline to show.
      if (!day || closesAt(day) <= now.getTime()) {
        report.closed += 1;
        continue;
      }
      if (closesAt(day) - now.getTime() > 120 * DAY_MS) {
        report.closed += 1;
        continue;
      }

      const routes = lines.map((l) => routeFor(l)).filter((r): r is NonNullable<typeof r> => r !== null);
      if (routes.length === 0) {
        report.noTrade += 1;
        continue;
      }
      const work: ErateWork = routes.some((r) => r.work === 'cabling') ? 'cabling' : 'cabling_upkeep';
      const trades = [...new Set(routes.flatMap((r) => r.trades))];

      const zip5 = String(head.billed_entity_zip ?? '').slice(0, 5);
      const z = /^\d{5}$/.test(zip5) ? zipOf(zip5) : null;
      const state = String(head.billed_entity_state ?? '').trim().toUpperCase();
      if (!z || z.state !== state || !served({ lat: z.lat, lon: z.lon, state: z.state })) {
        report.notServed += 1;
        continue;
      }

      const city = tidyPlace(String(head.billed_entity_city ?? '')) || tidyPlace(z.city);
      const who = whoFor(head.applicant_type);
      const buyer = institutionName(typeof head.billed_entity_name === 'string' ? head.billed_entity_name : undefined);
      const link = formLink(typeof head.form_pdf === 'string' ? head.form_pdf : undefined);
      const certified = typeof head.certified_date_time === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(head.certified_date_time) ? `${head.certified_date_time.slice(0, 19)}Z` : null;

      report.items.push({
        source: ERATE_ID,
        externalId: id,
        kind: 'contract',
        title: erateTitle(who, city, work),
        summary: [buyer, ERATE_SUMMARY_KIND, erateUntilPart(day)].filter(Boolean).join(' | '),
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
          buyer,
          bidType: 'E-Rate Form 470',
          applicantType: typeof head.applicant_type === 'string' ? head.applicant_type : null,
          work,
          fundingYear: typeof head.funding_year === 'string' ? head.funding_year : null,
          dueDate: day,
          noDueDate: false,
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

/** The SoQL query: certified requests with a mapped function and an allowable contract date that is not over. Built from ERATE_ROUTES. */
export function buildErateQuery(now: Date = new Date()): URLSearchParams {
  const functions = [...new Set(ERATE_ROUTES.map((r) => r.functionName))];
  const types = [...new Set(ERATE_ROUTES.map((r) => r.serviceType))];
  const list = (xs: string[]) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');
  const p = new URLSearchParams();
  p.set('$select', ERATE_FIELDS.join(','));
  p.set(
    '$where',
    `fcc_form_470_status='Certified' AND function in(${list(functions)}) AND service_type in(${list(types)}) AND allowable_contract_date>='${queryFloorDay(now)}T00:00:00'`,
  );
  p.set('$order', 'allowable_contract_date');
  p.set('$limit', String(ERATE_ROW_CAP));
  return p;
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
      const url = `${ERATE_ENDPOINT}?${buildErateQuery(now).toString()}`;
      const res = await ctx.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': HOLLER_UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        ctx.log(`error: ${ERATE_ID} HTTP ${res.status}`);
        return [];
      }
      const body: unknown = await res.json();
      if (!Array.isArray(body)) {
        ctx.log(`error: ${ERATE_ID} returned a non-array response, shape may have changed`);
        return [];
      }
      const report = parseErate(body, { now });
      if (report.rows > 0 && report.applications === 0) ctx.log(`error: ${ERATE_ID} parsed 0 of ${report.rows} rows, shape may have changed`);
      else
        ctx.log(
          `${ERATE_ID}: ${report.rows} rows, ${report.applications} requests, ${report.items.length} kept, ${report.notServed} outside served areas, ${report.noTrade} no trade, ${report.closed} closed, ${report.notOpen} not open${report.rows >= ERATE_ROW_CAP ? ' (row cap reached)' : ''}`,
        );
      return report.items;
    } catch (e) {
      // The class of failure is enough; never log a message that could carry request detail.
      ctx.log(`error: ${ERATE_ID}: ${e instanceof Error ? e.name : 'failure'}`);
      return [];
    }
  },
};

export const adapters: Adapter[] = [erate];
