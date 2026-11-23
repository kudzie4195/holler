/**
 * Batched Socrata lookups for the NYC managing-agent join (lib/contacts/nyc-agents.ts). Public HPD data only.
 *  - tesw-yqqr (registrations) by BBL tuples, chunks of 50;
 *  - feu5-w2e2 (contacts) by registrationid with type 'Agent', chunks of 50.
 * Calls are bounded per run (maxCalls) and by a clock: once `deadlineAt` has passed no new request is issued (the complaints that needed
 * one are reported in notAttempted) and no request may outlive `hardDeadlineAt`.
 * Agent rows are fetched ONLY for the registration chosen for each complaint, never for every registration on the lot.
 * A batch that comes back with exactly the row limit is split in halves and re-queried instead of being used truncated. A complaint whose lookup was not made (cap reached) or failed (HTTP error, bad body) is NOT in
 * the result map: it is neither "no registration" nor "no agent", and the caller skips it so the hit rate is not polluted.
 * The contacts query $selects only registrationid, type, corporationname and the business city/state/zip: first and last names and the
 * business street never leave the portal.
 */
import { chooseRegistration, joinComplaint, parseBbl, type Bbl, type HpdContact, type HpdRegistration, type NycJoin } from './nyc-agents';

export const NYC_DOMAIN = 'data.cityofnewyork.us';
export const REGISTRATIONS_ID = 'tesw-yqqr';
export const CONTACTS_ID = 'feu5-w2e2';
export const CHUNK_SIZE = 50;
export const DEFAULT_MAX_CALLS = 24;
const CONCURRENCY = 4;
/** Rows per query. A batch that returns this many rows may be truncated, so it is split and re-queried (see lookup). */
export const ROW_LIMIT = 5000;
const CALL_TIMEOUT_MS = 15_000;

export interface NycComplaint {
  /** caller's key (the 311 unique_key) */
  key: string;
  bbl: unknown;
  incidentAddress: unknown;
}

export interface NycFetchOptions {
  fetch: typeof fetch;
  appToken?: string;
  maxCalls?: number;
  chunkSize?: number;
  log?: (m: string) => void;
  /** the scan's clock for registration expiry (default: now) */
  now?: Date;
  /** ms clock (default Date.now) */
  clock?: () => number;
  /** absolute clock time after which no new request is issued (default: none) */
  deadlineAt?: number;
  /** absolute clock time no request may outlive; each call's timeout is cut to fit (default: none) */
  hardDeadlineAt?: number;
  /** rows per query (default 5000; tests lower it) */
  rowLimit?: number;
}

export interface NycJoinReport {
  byKey: Map<string, NycJoin>;
  /** Socrata calls made */
  calls: number;
  /** keys left out because a call was refused by the cap or failed */
  skipped: string[];
  /** keys whose lookups were not made because the deadline passed */
  notAttempted: string[];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

const DIGITS = /^\d+$/;

/** $where on boroid, block and lot for up to one chunk of BBLs: `boroid IN (...)` plus one exact (boroid, block, lot) clause per BBL. Ordered by registrationid. */
export function buildRegistrationsQuery(bbls: readonly Bbl[], limit: number = ROW_LIMIT): URLSearchParams {
  const ok = bbls.filter((b) => DIGITS.test(b.boroid) && DIGITS.test(b.block) && DIGITS.test(b.lot));
  const boros = [...new Set(ok.map((b) => b.boroid))].sort().map((b) => `'${b}'`).join(',');
  const tuples = ok.map((b) => `(boroid='${b.boroid}' AND block='${b.block}' AND lot='${b.lot}')`).join(' OR ');
  const p = new URLSearchParams();
  p.set('$select', 'registrationid,boroid,block,lot,housenumber,lowhousenumber,highhousenumber,streetname,zip,registrationenddate');
  p.set('$where', `boroid IN (${boros}) AND (${tuples})`);
  p.set('$order', 'registrationid');
  p.set('$limit', String(limit));
  return p;
}

/** $where registrationid IN (...) AND type='Agent'; selects no person column. */
export function buildAgentsQuery(ids: readonly string[], limit: number = ROW_LIMIT): URLSearchParams {
  const list = ids.filter((i) => DIGITS.test(i)).map((i) => `'${i}'`).join(',');
  const p = new URLSearchParams();
  p.set('$select', 'registrationid,type,corporationname,businesscity,businessstate,businesszip');
  p.set('$where', `registrationid IN (${list}) AND type='Agent'`);
  p.set('$order', 'registrationcontactid');
  p.set('$limit', String(limit));
  return p;
}

const bblKey = (b: Bbl) => `${b.boroid}:${b.block}:${b.lot}`;
type Row = Record<string, unknown>;
type Fail = 'failed' | 'deadline';
type Lookup<T> = { rows: Row[]; ok: T[]; failed: T[]; deadline: T[] };

export async function joinNycComplaints(complaints: readonly NycComplaint[], opts: NycFetchOptions): Promise<NycJoinReport> {
  const maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
  const size = opts.chunkSize ?? CHUNK_SIZE;
  const limit = opts.rowLimit ?? ROW_LIMIT;
  const log = opts.log ?? (() => {});
  const clock = opts.clock ?? Date.now;
  const now = opts.now ?? new Date();
  const report: NycJoinReport = { byKey: new Map(), calls: 0, skipped: [], notAttempted: [] };
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Holler/1.0 (+https://holler.app/about; contact@holler)' };
  if (opts.appToken) headers['X-App-Token'] = opts.appToken;

  const run = async (id: string, qs: URLSearchParams): Promise<Row[] | Fail> => {
    if (opts.deadlineAt != null && clock() >= opts.deadlineAt) return 'deadline';
    if (report.calls >= maxCalls) return 'failed';
    report.calls += 1;
    const timeout = opts.hardDeadlineAt != null ? Math.max(1000, Math.min(CALL_TIMEOUT_MS, opts.hardDeadlineAt - clock())) : CALL_TIMEOUT_MS;
    try {
      const res = await opts.fetch(`https://${NYC_DOMAIN}/resource/${id}.json?${qs.toString()}`, { headers, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) {
        log(`nyc-agents: ${id} HTTP ${res.status}`);
        return 'failed';
      }
      const body: unknown = await res.json();
      return Array.isArray(body) ? (body as Row[]) : 'failed';
    } catch (e) {
      log(`nyc-agents: ${id} ${e instanceof Error ? e.message : String(e)}`);
      return 'failed';
    }
  };

  /** One batch. A full page (rows.length >= limit) may be truncated: split the batch and ask again; a single item that still fills a page is failed. */
  const lookup = async <T,>(id: string, items: T[], build: (items: T[]) => URLSearchParams): Promise<Lookup<T>> => {
    const res = await run(id, build(items));
    if (res === 'deadline') return { rows: [], ok: [], failed: [], deadline: items };
    if (res === 'failed') return { rows: [], ok: [], failed: items, deadline: [] };
    if (res.length < limit) return { rows: res, ok: items, failed: [], deadline: [] };
    if (items.length < 2) {
      log(`nyc-agents: ${id} returned the row limit (${limit}) for a single item, not used`);
      return { rows: [], ok: [], failed: items, deadline: [] };
    }
    log(`nyc-agents: ${id} returned the row limit (${limit}) for ${items.length} items, splitting`);
    const mid = Math.ceil(items.length / 2);
    const a = await lookup(id, items.slice(0, mid), build);
    const b = await lookup(id, items.slice(mid), build);
    return { rows: [...a.rows, ...b.rows], ok: [...a.ok, ...b.ok], failed: [...a.failed, ...b.failed], deadline: [...a.deadline, ...b.deadline] };
  };
  // Chunks of one phase run a few at a time; the cap and the deadline are checked inside run(), so neither is exceeded.
  const lookupAll = async <T,>(id: string, items: T[], build: (items: T[]) => URLSearchParams): Promise<Lookup<T>> => {
    const out: Lookup<T> = { rows: [], ok: [], failed: [], deadline: [] };
    for (const group of chunk(chunk(items, size), CONCURRENCY)) {
      for (const r of await Promise.all(group.map((ch) => lookup(id, ch, build)))) {
        out.rows.push(...r.rows);
        out.ok.push(...r.ok);
        out.failed.push(...r.failed);
        out.deadline.push(...r.deadline);
      }
    }
    return out;
  };

  // Phase 1: registrations of every distinct BBL, in a fixed order (sorted by key) so the same input makes the same queries.
  const parsed = complaints.map((c) => ({ c, bbl: parseBbl(c.bbl) }));
  const bbls = new Map<string, Bbl>();
  for (const p of parsed) if (p.bbl) bbls.set(bblKey(p.bbl), p.bbl);
  const sortedBbls = [...bbls.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, b]) => b);
  const reg = await lookupAll(REGISTRATIONS_ID, sortedBbls, (b) => buildRegistrationsQuery(b, limit));
  const regsByBbl = new Map<string, HpdRegistration[]>();
  for (const b of reg.ok) regsByBbl.set(bblKey(b), []);
  for (const r of reg.rows as HpdRegistration[]) regsByBbl.get(`${r.boroid}:${Number(r.block)}:${Number(r.lot)}`)?.push(r);
  const bblFailed = new Set(reg.failed.map(bblKey));
  const bblDeadline = new Set(reg.deadline.map(bblKey));

  // Choose each complaint's registration, then fetch agent rows for those registrations only.
  const chosen = new Map<string, string>(); // complaint key -> registrationid
  for (const { c, bbl } of parsed) {
    if (!bbl || !regsByBbl.has(bblKey(bbl))) continue;
    const choice = chooseRegistration(c.incidentAddress, regsByBbl.get(bblKey(bbl)) ?? [], now);
    const id = choice.status === 'matched' ? String(choice.registration?.registrationid ?? '') : '';
    if (DIGITS.test(id)) chosen.set(c.key, id);
  }
  const ids = [...new Set(chosen.values())].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ag = await lookupAll(CONTACTS_ID, ids, (i) => buildAgentsQuery(i, limit));
  const contactsById = new Map<string, HpdContact[]>();
  for (const id of ag.ok) contactsById.set(id, []);
  for (const r of ag.rows as HpdContact[]) contactsById.get(String(r.registrationid))?.push(r);
  const idDeadline = new Set(ag.deadline);

  for (const { c, bbl } of parsed) {
    if (!bbl) {
      report.byKey.set(c.key, joinComplaint(c.bbl, c.incidentAddress, () => [], () => [], now));
      continue;
    }
    const k = bblKey(bbl);
    if (bblDeadline.has(k)) {
      report.notAttempted.push(c.key);
      continue;
    }
    if (bblFailed.has(k) || !regsByBbl.has(k)) {
      report.skipped.push(c.key);
      continue;
    }
    const id = chosen.get(c.key);
    if (id && idDeadline.has(id)) {
      report.notAttempted.push(c.key);
      continue;
    }
    if (id && !contactsById.has(id)) {
      report.skipped.push(c.key);
      continue;
    }
    const regs = regsByBbl.get(k) ?? [];
    report.byKey.set(c.key, joinComplaint(c.bbl, c.incidentAddress, () => regs, (i) => contactsById.get(i) ?? [], now));
  }
  if (report.skipped.length) log(`nyc-agents: ${report.skipped.length} complaints not joined (call cap ${maxCalls} or a failed call)`);
  if (report.notAttempted.length) log(`nyc-agents: ${report.notAttempted.length} complaints not attempted (run budget reached)`);
  return report;
}
