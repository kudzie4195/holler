import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { env } from '@/lib/env';
import { bidTrades } from '@/lib/signals/bid-trades';
import { BIDS_FLAG, bidsEnabled } from '@/lib/signals/bid-sources';
import { findCity } from './usaspending';
import { toFloatingLocal, toIso } from './socrata';

/**
 * Open city bids from Socrata open-data portals: a solicitation with a due date, from a city that publishes its open bids as data.
 * Rows are kind 'contract' with data.subtype 'bid' (no new kind, so no migration; intent.ts and the cards key off the subtype).
 * The flag HOLLER_BIDS_ENABLED (lib/signals/bid-sources.ts) is off by default: the adapters are registered, but run.ts skips them and
 * fetch() returns nothing while it is off.
 *
 * Every dataset id, column name, licence and date below was read on 2026-11-21 through WebFetch (the shell here has no outbound network):
 *   metadata  https://<domain>/api/views/<id>.json or the data.gov catalog page,
 *   sample    https://<domain>/resource/<id>.json?$limit=20  (saved under gates/r13/logs/C-sample-*.json).
 * Label key: sourced = seen in the portal's metadata or a live sample row; assumed = inferred, stated next to the value.
 *
 * What a row says, and what it does not: a solicitation is open, with this buyer, this title and this due date. It says nothing about
 * who may bid, what the work is worth, or who will be chosen. Holler never reads the buyer's contact columns (names, phones, emails).
 * Place: the row names a buyer, not a job site, so the position is the city's centre (findCity), marked data.loc = 'approx'. That
 * makes the matcher use radius + 15 miles and every screen say "no distance is shown" (approx-location.ts).
 */

export interface BidDataset {
  /** Adapter id and signal `source`. Listed in lib/signals/bid-sources.ts BID_SOURCE_IDS. */
  id: string;
  /** City whose centre is the row's position (must be in findCity's table). */
  city: string;
  state: string;
  /** How the place reads in a title: "Los Angeles area" for a regional portal. */
  placeLabel: string;
  domain: string;
  datasetId: string;
  /** IANA zone of the portal's floating (zoneless) timestamps. */
  tz: string;
  tzSource: 'sourced' | 'assumed';
  /** Zone whose calendar day is printed as the due date. Defaults to tz; differs where tz is UTC (a 5 PM Pacific close is next day UTC). */
  displayTz?: string;
  fields: {
    id: string;
    title: string;
    buyer: string;
    category?: string;
    /** Column whose text names the kind of solicitation (RFI, IFB ...); read only to drop requests for information. */
    type?: string;
    status?: string;
    posted?: string;
    due: string;
    /** A separate text column holding the time of day of `due` ("2:00 PM"), when `due` is a date only. */
    dueTime?: string;
    /** Column holding extra text that may say a bid is cancelled. */
    note?: string;
  };
  /** Status values that mean the solicitation is open. A row with another status value is dropped. */
  openStatuses?: RegExp;
  /** Type values that are not a bid (request for information or interest): dropped. */
  notABid: RegExp;
  /** Drops leading agency-code segments of a title ("EXT AIR | OCA PUC | Landscaping" becomes "Landscaping"). */
  stripCodePrefix?: boolean;
  /** Extra SoQL appended with AND. */
  extraWhere?: string;
  /** A due date further out than this many days is a placeholder ("2099-12-31"), not a real deadline. */
  placeholderDays: number;
  /** The page for one solicitation. Receives the raw row; returns null when the row has none. */
  rowLink: (row: Record<string, unknown>) => { url: string; kind: 'solicitation' | 'portal' } | null;
  cadenceMinutes: number;
  /** Disabled sources are configured and tested but not registered. `why` says what is missing. */
  verified: boolean;
  /** On probation (Adapter.probation): rows go to holler_source_samples only, never to holler_signals, until a person checks the samples. */
  probation?: boolean;
  why?: string;
  license: { name: string; url: string | null };
  updated: string;
  fieldSource: 'sourced' | 'assumed';
}

type Row = Record<string, unknown>;

const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);

function sv(row: Row, field?: string): string {
  if (!field) return '';
  const v = row[field];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

/** Control characters (the portals have U+001A where a curly quote was), replacement characters and runs of spaces. */
export function cleanText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f�]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Email addresses and bare links are never copied into a public title or summary. */
function noContactBits(t: string): string {
  return t.replace(/https?:\/\/\S+/gi, ' ').replace(/\bwww\.\S+/gi, ' ').replace(/\S+@\S+\.\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

function trunc(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 3).trimEnd()}...`;
}

/** "EXT AIR | OCA PUC | TM3 - StarDB Renewal" -> "TM3 - StarDB Renewal". Only short all-caps code segments at the start are dropped. */
export function stripCodePrefix(title: string): string {
  const parts = title.split('|').map((p) => p.trim()).filter(Boolean);
  let i = 0;
  while (i < parts.length - 1 && /^[A-Z]{2,5}(?: [A-Z]{2,5})?$/.test(parts[i])) i++;
  return parts.slice(i).join(' | ');
}

/** ALL CAPS buyer names read as Title Case; mixed-case names are left alone. "TRANSPORTATION AND DRAINAGE" -> "Transportation and Drainage". */
export function tidyBuyer(raw: string): string {
  const t = cleanText(raw);
  if (!t || t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  const small = new Set(['and', 'of', 'the', 'for', 'to', 'in', 'on']);
  return t
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** "2:00 PM" or "11:00 AM" to "14:00:00"; null for anything else. */
export function clockTime(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}:00`;
}

/** The first 10 characters of a floating timestamp are its calendar date: "2026-12-10T14:30:00.000" -> "2026-12-10". */
function localDate(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/** Calendar day (YYYY-MM-DD) of an instant in a zone. */
export function localDay(iso: string, tz: string): string | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The title text of a column that may hold a paragraph (Baton Rouge puts the project, then addenda and portal text, in `description`):
 * the lines up to the first one that starts addenda or portal boilerplate, joined with a space.
 */
export function firstBlock(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      if (out.length) break;
      continue;
    }
    if (/^(?:addendum|add\b|for bidding|bid documents|bids can)/i.test(t)) break;
    out.push(t);
  }
  return out.join(' ');
}

export interface BidParseReport {
  items: SignalInput[];
  /** raw rows received */
  rows: number;
  /** rows that had an id, a title and a buyer: the shape the config expects */
  shapeOk: number;
  /** open rows with no usable due date (none published, or a placeholder far in the future), whether or not a trade matched. */
  noDue: number;
  /** the part of noDue that was kept: they carry data.noDueDate and expiresAt null. */
  keptNoDue: number;
  /** rows dropped because the due date has passed */
  closed: number;
  /** rows dropped because their status is not open, they are a request for information, or the notice says cancelled */
  notOpen: number;
  /** rows dropped because no trade matched (bid-trades.ts) */
  noTrade: number;
  /** rows dropped because an earlier row had the same solicitation id */
  duplicates: number;
}

function dueIsoFor(row: Row, ds: BidDataset): string | null {
  const f = ds.fields;
  const dueRaw = sv(row, f.due);
  if (!dueRaw) return null;
  if (f.dueTime) {
    const date = localDate(dueRaw);
    const time = clockTime(sv(row, f.dueTime));
    // A date with no readable time closes at the end of that day.
    return date ? toIso(`${date}T${time ?? '23:59:00'}`, ds.tz) : null;
  }
  return toIso(dueRaw, ds.tz);
}

/** Pure parser. `now` decides what is closed and what is a placeholder date. Never throws: malformed input gives an empty report. */
export function parseBids(raw: unknown, ds: BidDataset, now: Date = new Date()): BidParseReport {
  const report: BidParseReport = { items: [], rows: 0, shapeOk: 0, noDue: 0, keptNoDue: 0, closed: 0, notOpen: 0, noTrade: 0, duplicates: 0 };
  if (!Array.isArray(raw)) return report;
  report.rows = raw.length;
  const f = ds.fields;
  const seen = new Set<string>();
  const place = findCity(ds.city, ds.state);
  const nowMs = now.getTime();
  for (const item of raw) {
    try {
      if (!isObj(item)) continue;
      const solicitationId = sv(item, f.id);
      const titleRaw = noContactBits(cleanText(firstBlock(sv(item, f.title))));
      const buyer = tidyBuyer(sv(item, f.buyer));
      if (!solicitationId || !titleRaw || !buyer) continue;
      report.shapeOk += 1;
      if (seen.has(solicitationId)) {
        report.duplicates += 1;
        continue;
      }

      const status = sv(item, f.status);
      const type = sv(item, f.type);
      const note = sv(item, f.note);
      const cancelled = /\bcancel(?:l?ed|lation)\b/i.test(`${titleRaw} ${note}`);
      if ((ds.openStatuses && status && !ds.openStatuses.test(status)) || (type && ds.notABid.test(type)) || cancelled) {
        report.notOpen += 1;
        continue;
      }

      const dueIso = dueIsoFor(item, ds);
      const dueMs = dueIso ? Date.parse(dueIso) : NaN;
      if (Number.isFinite(dueMs) && dueMs <= nowMs) {
        report.closed += 1;
        continue;
      }
      const placeholder = Number.isFinite(dueMs) && dueMs - nowMs > ds.placeholderDays * 86_400_000;
      const due = Number.isFinite(dueMs) && !placeholder ? (dueIso as string) : null;
      if (!due) report.noDue += 1;

      const titleBase = ds.stripCodePrefix ? stripCodePrefix(titleRaw) : titleRaw;
      const title = trunc(titleBase.replace(/\*\*[^*]*\*\*/g, ' ').replace(/\s*(?:ADDENDUM|ADD\.?)\s*(?:NO\.?|#)?\s*\d+.*$/i, '').replace(/\s+/g, ' ').trim() || titleBase, 140);
      const category = sv(item, f.category);
      const trades = bidTrades({ title, category: /^(none|personal services)$/i.test(category) ? null : category });
      if (trades.length === 0) {
        report.noTrade += 1;
        continue;
      }

      seen.add(solicitationId);

      const link = ds.rowLink(item);
      if (!link) continue; // a bid without a page to open is not shown: every card links to its public source
      const postedIso = f.posted ? toIso(sv(item, f.posted), ds.tz) : null;
      const dueLocal = due ? localDay(due, ds.displayTz ?? ds.tz) : null;
      const categoryText = category && !/^none$/i.test(category) ? category : '';
      const summary = trunc(
        [buyer, categoryText, type && !/^none$/i.test(type) ? type : '', due ? `due ${dueLocal ?? due.slice(0, 10)}` : 'no due date published']
          .filter(Boolean)
          .join(' | '),
        280,
      );

      if (!due) report.keptNoDue += 1;
      report.items.push({
        source: ds.id,
        externalId: solicitationId,
        kind: 'contract',
        title: `Open bid in ${ds.placeLabel}: ${title}`,
        summary,
        url: link.url,
        lat: place?.lat ?? null,
        lon: place?.lon ?? null,
        city: place?.name ?? ds.city,
        state: ds.state,
        zip: null,
        categories: trades,
        severity: 2,
        occurredAt: postedIso ?? now.toISOString(),
        expiresAt: due,
        data: {
          subtype: 'bid',
          dataset: ds.datasetId,
          domain: ds.domain,
          solicitationId,
          buyer,
          bidType: type && !/^none$/i.test(type) ? type : null,
          dueDate: dueLocal,
          noDueDate: !due,
          ...(placeholder ? { dueDateNote: 'placeholder date in the source, not a deadline' } : {}),
          linkKind: link.kind,
          tz: ds.tz,
          // The position is the city centre, not a job site: the matcher reads radius + 15 miles and no screen shows a distance.
          loc: 'approx',
          approxLocation: true,
        },
      });
    } catch {
      // skip malformed row
    }
  }
  return report;
}

/** The dataset's own page, the fallback source link and the adapter's sourceUrl. */
export function bidDatasetPageUrl(ds: Pick<BidDataset, 'domain' | 'datasetId'>): string {
  return `https://${ds.domain}/d/${ds.datasetId}`;
}

const first = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const urlOf = (row: Row, field: string): string => {
  const v = row[field];
  return isObj(v) ? first(v.url) : first(v);
};
const httpsOnly = (u: string): string | null => (/^https:\/\/[^\s]+$/i.test(u) ? u : null);

export const BID_DATASETS: BidDataset[] = [
  {
    // sourced: metadata https://data.sf.gov/api/views/eshn-8t3a/columns.json, sample https://data.sf.gov/resource/eshn-8t3a.json (2026-11-21)
    id: 'bids-sf', city: 'San Francisco', state: 'CA', placeLabel: 'San Francisco', domain: 'data.sf.gov', datasetId: 'eshn-8t3a',
    tz: 'America/Los_Angeles', tzSource: 'assumed',
    fields: { id: 'event_id', title: 'title', buyer: 'department', category: 'category', type: 'type', status: 'status', posted: 'open_date', due: 'due_date' },
    openStatuses: /^(open|amended)$/i,
    notABid: /information|interest|\bRFI\b|\bRFEI\b/i,
    stripCodePrefix: true,
    placeholderDays: 365,
    // sourced: every sample row carries sfcitypartner_link.url, the city's own page for that bidding event
    rowLink: (row) => {
      const u = httpsOnly(urlOf(row, 'sfcitypartner_link'));
      return u ? { url: u, kind: 'solicitation' } : null;
    },
    cadenceMinutes: 720,
    verified: true,
    license: { name: 'Open Data Commons Public Domain Dedication and License 1.0', url: 'http://opendatacommons.org/licenses/pddl/1.0/' },
    updated: 'catalog modified 2026-11-18; rows data_as_of 2026-11-15; the page says "updated on a weekly basis"',
    fieldSource: 'sourced',
  },
  {
    // sourced: sample https://data.lacity.org/resource/hf3r-utnq.json (2026-11-21, newest row posted 2026-11-21T20:45Z); the data.gov catalog page
    // says "Data Last Modified 2025-09-20", which the live rows contradict, so the rows are what is trusted here.
    id: 'bids-la', city: 'Los Angeles', state: 'CA', placeLabel: 'Los Angeles area', domain: 'data.lacity.org', datasetId: 'hf3r-utnq',
    // RAMP is regional (City departments, LA County, LAUSD): a Los Angeles centre is a stand-in for "somewhere in the Los Angeles area".
    // closedate is UTC: titles that print "Closing: 12/9/2026 12:00 PM" carry closedate 2026-12-09T20:00 (12:00 PST).
    tz: 'UTC', tzSource: 'sourced', displayTz: 'America/Los_Angeles',
    fields: { id: 'rampid', title: 'title', buyer: 'department', category: 'category', type: 'type', status: 'stagename', posted: 'bidpost', due: 'closedate' },
    openStatuses: /^(open|amended)$/i,
    notABid: /information|interest|\bRFI\b|\bRFEI\b/i,
    placeholderDays: 730,
    rowLink: (row) => {
      const u = httpsOnly(urlOf(row, 'url'));
      return u ? { url: u, kind: 'solicitation' } : null;
    },
    cadenceMinutes: 360,
    verified: true,
    license: { name: 'Creative Commons CC0 1.0 Universal (per the data.gov catalog page)', url: 'http://creativecommons.org/publicdomain/zero/1.0/legalcode' },
    updated: 'Socrata catalog updatedAt 2026-11-21T21:30:03Z',
    fieldSource: 'sourced',
  },
  {
    // sourced: metadata https://data.brla.gov/api/views/u9zk-8nix.json, sample https://data.brla.gov/resource/u9zk-8nix.json (2026-11-21)
    id: 'bids-batonrouge', city: 'Baton Rouge', state: 'LA', placeLabel: 'Baton Rouge', domain: 'data.brla.gov', datasetId: 'u9zk-8nix',
    // bid_date is a date and bid_time is text ("2:00 PM"): the opening time in the City-Parish's local time.
    tz: 'America/Chicago', tzSource: 'assumed',
    fields: { id: 'unique_id', title: 'description', buyer: 'department_name', due: 'bid_date', dueTime: 'bid_time', note: 'note' },
    notABid: /information|interest|\bRFI\b/i,
    placeholderDays: 730,
    // The row has no page of its own. Many rows name the City-Parish bid portal in note or description; the rest use the dataset page.
    rowLink: (row) => {
      const text = `${sv(row, 'note')} ${sv(row, 'description')}`;
      const m = text.match(/https:\/\/www\.centralauctionhouse\.com\/[^\s*]+/i);
      if (m) return { url: m[0].replace(/[.,;)]+$/, ''), kind: 'portal' };
      return { url: bidDatasetPageUrl({ domain: 'data.brla.gov', datasetId: 'u9zk-8nix' }), kind: 'portal' };
    },
    cadenceMinutes: 720,
    verified: true,
    license: { name: 'Public Domain (Socrata licenseId PUBLIC_DOMAIN; the portal gives no license URL)', url: null },
    updated: 'catalog updatedAt 2026-11-21T11:03Z; the portal says "Daily"; upcoming rows seen through 2026-12-15',
    fieldSource: 'sourced',
  },
  {
    // sourced: metadata https://data.cityofnewyork.us/api/views/3khw-qi8f.json and sample rows (2026-11-21, newest start_date 2026-11-20).
    // Row page confirmed 2026-11-22: https://a856-cityrecord.nyc.gov/RequestDetail/20261116019 opens the City Record notice for that row
    // (title "HWXPRATT - RECONSTRUCTION OF PRATT AVENUE RETAINING WALL, THE BRONX", due 12/16/2026 2:00 PM), matching the dataset row.
    // The notice points bidders to PASSPort for documents, so the link is the public notice, not the bid package.
    // ON PROBATION: rows go to holler_source_samples until the samples are checked. The portal metadata says rows updated 2026-10-25 while
    // rows dated 2026-11-20 are served, so its "updated" date cannot be trusted.
    id: 'bids-nyc', city: 'New York', state: 'NY', placeLabel: 'New York City', domain: 'data.cityofnewyork.us', datasetId: '3khw-qi8f',
    tz: 'America/New_York', tzSource: 'assumed',
    fields: { id: 'request_id', title: 'short_title', buyer: 'agency_name', category: 'category_description', type: 'selection_method_description', posted: 'start_date', due: 'due_date' },
    notABid: /information|interest|\bRFI\b|\bRFEI\b/i,
    extraWhere: "type_of_notice_description = 'Solicitation'",
    placeholderDays: 730,
    rowLink: (row) => {
      const id = sv(row, 'request_id');
      return /^\d{8,14}$/.test(id) ? { url: `https://a856-cityrecord.nyc.gov/RequestDetail/${id}`, kind: 'solicitation' } : null;
    },
    cadenceMinutes: 720,
    verified: true,
    probation: true,
    license: { name: 'Public Domain (Socrata licenseId PUBLIC_DOMAIN, attribution DCAS)', url: null },
    updated: 'metadata rowsUpdatedAt 2026-10-25 (contradicted by rows from 2026-11-20)',
    fieldSource: 'sourced',
  },
];

/** SoQL for one dataset: due after now, or no due date but posted in the last 60 days. Newest due date last; one page of 1000. */
export function buildBidQuery(ds: BidDataset, now: Date = new Date()): URLSearchParams {
  const f = ds.fields;
  const nowStr = toFloatingLocal(now, ds.tz);
  // Date-only due columns (Baton Rouge) compare against the local calendar day: today's bids are still open until their time passes.
  const dueFloor = f.dueTime ? `${nowStr.slice(0, 10)}T00:00:00` : nowStr;
  const open = f.posted
    ? `(${f.due} > '${dueFloor}' OR (${f.due} IS NULL AND ${f.posted} > '${toFloatingLocal(new Date(now.getTime() - 60 * 86_400_000), ds.tz)}'))`
    : `${f.due} >= '${dueFloor}'`;
  const clauses = [open];
  if (ds.extraWhere) clauses.push(`(${ds.extraWhere})`);
  const p = new URLSearchParams();
  p.set('$where', clauses.join(' AND '));
  p.set('$order', `${f.due} ASC`);
  p.set('$limit', '1000');
  return p;
}

export function buildBidAdapter(ds: BidDataset): Adapter {
  return {
    id: ds.id,
    label: `${ds.city} open data: open bids`,
    kind: 'contract',
    cadenceMinutes: ds.cadenceMinutes,
    sourceUrl: bidDatasetPageUrl(ds),
    enabled: () => bidsEnabled(),
    flag: BIDS_FLAG,
    ...(ds.probation ? { probation: true } : {}),
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      // Defence in depth: run.ts already skips a disabled adapter, but a direct call (a probe, a test) must not fetch either.
      if (!bidsEnabled(ctx.env[BIDS_FLAG] ?? env.HOLLER_BIDS_ENABLED ?? process.env[BIDS_FLAG])) {
        ctx.log(`${ds.id}: skipped, ${BIDS_FLAG} is off`);
        return [];
      }
      try {
        const now = ctx.now ?? new Date();
        const url = `https://${ds.domain}/resource/${ds.datasetId}.json?${buildBidQuery(ds, now).toString()}`;
        const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Holler/1.0 (+https://holler.app/about; contact@holler)' };
        const token = ctx.env.SOCRATA_APP_TOKEN ?? env.SOCRATA_APP_TOKEN;
        if (token) headers['X-App-Token'] = token;
        const res = await ctx.fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          ctx.log(`${ds.id}: HTTP ${res.status}`);
          return [];
        }
        const body: unknown = await res.json();
        if (!Array.isArray(body)) {
          ctx.log(`error: ${ds.id} returned a non-array response, shape may have changed`);
          return [];
        }
        const report = parseBids(body, ds, now);
        if (report.rows > 0 && report.shapeOk === 0) ctx.log(`error: parsed 0 of ${report.rows} rows, shape may have changed (${ds.id})`);
        else
          ctx.log(
            `${ds.id}: ${report.rows} rows, ${report.items.length} kept, ${report.noTrade} no trade, ${report.closed} closed, ${report.notOpen} not open, ${report.noDue} without a due date (${report.keptNoDue} kept), ${report.duplicates} duplicates`,
          );
        return report.items;
      } catch (e) {
        ctx.log(`${ds.id}: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      }
    },
  };
}

/** Only verified datasets are registered. Registered adapters still do nothing while HOLLER_BIDS_ENABLED is off. */
export const adapters: Adapter[] = BID_DATASETS.filter((d) => d.verified).map(buildBidAdapter);
