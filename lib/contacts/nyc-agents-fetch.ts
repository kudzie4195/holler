/**
 * Batched Socrata lookups for the NYC managing-agent join (lib/contacts/nyc-agents.ts). Public HPD data only.
 *  - tesw-yqqr (registrations) by BBL tuples, chunks of 50;
 *  - feu5-w2e2 (contacts) by registrationid with type 'Agent', chunks of 50.
 * Calls are bounded per run (maxCalls). A complaint whose lookup was not made (cap reached) or failed (HTTP error, bad body) is NOT in
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
const LIMIT = 5000;

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
}

export interface NycJoinReport {
  byKey: Map<string, NycJoin>;
  /** Socrata calls made */
  calls: number;
  /** keys left out because a call was refused by the cap or failed */
  skipped: string[];
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

const DIGITS = /^\d+$/;

/** $where on boroid, block and lot for up to one chunk of BBLs: `boroid IN (...)` plus one exact (boroid, block, lot) clause per BBL. */
export function buildRegistrationsQuery(bbls: readonly Bbl[]): URLSearchParams {
  const ok = bbls.filter((b) => DIGITS.test(b.boroid) && DIGITS.test(b.block) && DIGITS.test(b.lot));
  const boros = [...new Set(ok.map((b) => b.boroid))].map((b) => `'${b}'`).join(',');
  const tuples = ok.map((b) => `(boroid='${b.boroid}' AND block='${b.block}' AND lot='${b.lot}')`).join(' OR ');
  const p = new URLSearchParams();
  p.set('$select', 'registrationid,boroid,block,lot,housenumber,lowhousenumber,highhousenumber,streetname,zip');
  p.set('$where', `boroid IN (${boros}) AND (${tuples})`);
  p.set('$limit', String(LIMIT));
  return p;
}

/** $where registrationid IN (...) AND type='Agent'; selects no person column. */
export function buildAgentsQuery(ids: readonly string[]): URLSearchParams {
  const list = ids.filter((i) => DIGITS.test(i)).map((i) => `'${i}'`).join(',');
  const p = new URLSearchParams();
  p.set('$select', 'registrationid,type,corporationname,businesscity,businessstate,businesszip');
  p.set('$where', `registrationid IN (${list}) AND type='Agent'`);
  p.set('$limit', String(LIMIT));
  return p;
}

const bblKey = (b: Bbl) => `${b.boroid}:${b.block}:${b.lot}`;

export async function joinNycComplaints(complaints: readonly NycComplaint[], opts: NycFetchOptions): Promise<NycJoinReport> {
  const maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
  const size = opts.chunkSize ?? CHUNK_SIZE;
  const log = opts.log ?? (() => {});
  const report: NycJoinReport = { byKey: new Map(), calls: 0, skipped: [] };
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Holler/1.0 (+https://holler.app/about; contact@holler)' };
  if (opts.appToken) headers['X-App-Token'] = opts.appToken;

  const run = async (id: string, qs: URLSearchParams): Promise<Record<string, unknown>[] | null> => {
    if (report.calls >= maxCalls) return null;
    report.calls += 1;
    try {
      const res = await opts.fetch(`https://${NYC_DOMAIN}/resource/${id}.json?${qs.toString()}`, { headers, signal: AbortSignal.timeout(15000) });
      if (!res.ok) {
        log(`nyc-agents: ${id} HTTP ${res.status}`);
        return null;
      }
      const body: unknown = await res.json();
      return Array.isArray(body) ? (body as Record<string, unknown>[]) : null;
    } catch (e) {
      log(`nyc-agents: ${id} ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  // Chunks of one phase run a few at a time; the cap is checked inside run(), so it is never exceeded.
  const runAll = async (id: string, qss: URLSearchParams[]): Promise<(Record<string, unknown>[] | null)[]> => {
    const out: (Record<string, unknown>[] | null)[] = [];
    for (const group of chunk(qss, CONCURRENCY)) out.push(...(await Promise.all(group.map((q) => run(id, q)))));
    return out;
  };

  // Phase 1: registrations of every distinct BBL.
  const parsed = complaints.map((c) => ({ c, bbl: parseBbl(c.bbl) }));
  const bbls = new Map<string, Bbl>();
  for (const p of parsed) if (p.bbl) bbls.set(bblKey(p.bbl), p.bbl);
  const bblChunks = chunk([...bbls.values()], size);
  const regResults = await runAll(REGISTRATIONS_ID, bblChunks.map(buildRegistrationsQuery));
  const regsByBbl = new Map<string, HpdRegistration[]>();
  const bblOk = new Set<string>();
  bblChunks.forEach((ch, i) => {
    const rows = regResults[i];
    if (!rows) return;
    for (const b of ch) {
      bblOk.add(bblKey(b));
      regsByBbl.set(bblKey(b), []);
    }
    for (const r of rows as HpdRegistration[]) {
      const k = `${r.boroid}:${Number(r.block)}:${Number(r.lot)}`;
      regsByBbl.get(k)?.push(r);
    }
  });

  // Phase 2: agent rows of every registration that could still matter (all registrations of the answered BBLs).
  const regIds = new Set<string>();
  for (const rows of regsByBbl.values()) for (const r of rows) if (r.registrationid) regIds.add(String(r.registrationid));
  const idChunks = chunk([...regIds], size);
  const agentResults = await runAll(CONTACTS_ID, idChunks.map(buildAgentsQuery));
  const contactsById = new Map<string, HpdContact[]>();
  const idOk = new Set<string>();
  idChunks.forEach((ch, i) => {
    const rows = agentResults[i];
    if (!rows) return;
    for (const id of ch) {
      idOk.add(id);
      contactsById.set(id, []);
    }
    for (const r of rows as HpdContact[]) contactsById.get(String(r.registrationid))?.push(r);
  });

  for (const { c, bbl } of parsed) {
    if (!bbl) {
      report.byKey.set(c.key, joinComplaint(c.bbl, c.incidentAddress, () => [], () => []));
      continue;
    }
    if (!bblOk.has(bblKey(bbl))) {
      report.skipped.push(c.key);
      continue;
    }
    const regs = regsByBbl.get(bblKey(bbl)) ?? [];
    // Only the chosen registration's own agent lookup must have succeeded.
    const choice = chooseRegistration(c.incidentAddress, regs);
    const chosenId = choice.status === 'matched' ? String(choice.registration?.registrationid ?? '') : '';
    if (chosenId && !idOk.has(chosenId)) {
      report.skipped.push(c.key);
      continue;
    }
    report.byKey.set(c.key, joinComplaint(c.bbl, c.incidentAddress, () => regs, (id) => contactsById.get(id) ?? []));
  }
  if (report.skipped.length) log(`nyc-agents: ${report.skipped.length} complaints not joined (call cap ${maxCalls} or a failed call)`);
  return report;
}
