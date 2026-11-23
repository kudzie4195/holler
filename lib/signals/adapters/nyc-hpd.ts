import type { Adapter, AdapterContext, SignalInput } from '@/lib/signals/types';
import { buildSocrataAdapter } from './socrata';
import { SOCRATA_DATASETS, type SocrataDataset } from './socrata-datasets';
import {
  MAX_REGISTRATIONS_PER_BBL,
  isResidentialHeatTitle,
  managerForBuilding,
  managerForRegistration,
  type HpdContactRow,
  type Manager,
} from '@/lib/signals/managed-by';

/**
 * NYC HPD managing agent / corporate owner company for no-heat cards (PLAN-2.0 item 2.6).
 *
 * Endpoints (NYC Open Data, Socrata SODA 2.x, read 2026-11-21 with WebFetch; the shell proxy refuses data.cityofnewyork.us):
 *   registrations  https://data.cityofnewyork.us/resource/tesw-yqqr.json   "Multiple Dwelling Registrations"
 *                  columns used: registrationid, boroid, block, lot (all text, unpadded: boroid "3", block "1610", lot "2")
 *   contacts       https://data.cityofnewyork.us/resource/feu5-w2e2.json   "Registration Contacts"
 *                  columns used: registrationid, type (CorporateOwner, Agent, SiteManager, HeadOfficer, Officer, Shareholder, IndividualOwner,
 *                  JointOwner, Lessee), corporationname. Never requested: firstname, lastname, title, business address.
 *   311 rows       erm2-nwe9 carries `bbl` (10 digits: borough 1, block 5, lot 4), which is the join key.
 *
 * DESIGN (no new table): at ingest, for the NEW heat / hot-water rows of the NYC 311 scan, one bounded lookup by BBL adds
 * data.managerName and data.managerRole to the signal. The cards read them (lib/signals/brief.ts cardBrief). A lookup that fails or is
 * skipped leaves the row exactly as it was before, so the card simply has no "Managed by" line.
 *
 * Bounds per scan run: MAX_BBLS_PER_RUN distinct BBLs, at most ceil(n / BBLS_PER_QUERY) registration requests and ceil(regs / REGS_PER_QUERY)
 * contact requests, only rows newer than ENRICH_WINDOW_HOURS (older rows were stored by an earlier run; the store never overwrites a
 * stored signal), and a per-process cache (24 h) so a repeated BBL costs nothing.
 *
 * TIME (the NYC 311 run must never be at risk, review K-P1-2): the scan gives one adapter 40 s (lib/signals/run.ts) and the 311 fetch itself
 * can use 15 s. The lookups run at most POOL_SIZE requests at a time, each with a CALL_TIMEOUT_MS timeout that is also cut to what is left
 * of the budget, inside a total LOOKUP_BUDGET_MS (12 s) that also ends by ADAPTER_DEADLINE_MS (25 s) after the adapter started. The whole
 * enrichment is raced against that budget: when it runs out (a slow or hung API, a fetch that ignores its abort signal), the 311 rows are
 * returned as the plain adapter returned them, without a company. Lookups that finished by then stay in the cache.
 *
 * Terms: NYC Open Data Terms of Use (data is public, no attribution field required, API usable without a key; an app token only raises
 * rate limits). The card says where the name comes from: "(from the city's building registration)". Registrations can be out of date.
 */

export const HPD_DOMAIN = 'data.cityofnewyork.us';
export const HPD_REGISTRATIONS_ID = 'tesw-yqqr';
export const HPD_CONTACTS_ID = 'feu5-w2e2';
export const NYC_311_SOURCE_ID = 'socrata-nyc-311';

export const MAX_BBLS_PER_RUN = 100;
export const BBLS_PER_QUERY = 20;
export const REGS_PER_QUERY = 100;
export const ENRICH_WINDOW_HOURS = 24;
const CACHE_TTL_MS = 24 * 3_600_000;
const CACHE_MAX = 5000;
/** Per request. */
export const CALL_TIMEOUT_MS = 6000;
/** Requests in flight at once. */
export const POOL_SIZE = 4;
/** Total time the lookups may take, from the start of the enrichment. */
export const LOOKUP_BUDGET_MS = 12_000;
/** The lookups end by this long after the adapter started, whatever the budget says. */
export const ADAPTER_DEADLINE_MS = 25_000;
const UA = 'Holler/1.0 (+https://holler.app/about; contact@holler)';

export interface Bbl {
  boro: string;
  block: string;
  lot: string;
}

/** "3016100002" to { boro: "3", block: "1610", lot: "2" } (block and lot without leading zeros, as the registrations print them). Null for anything else. */
export function parseBbl(v: unknown): Bbl | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!/^[1-5]\d{9}$/.test(s)) return null;
  const block = String(parseInt(s.slice(1, 6), 10));
  const lot = String(parseInt(s.slice(6), 10));
  if (block === '0' || lot === '0') return null;
  return { boro: s[0], block, lot };
}

export const bblKey = (b: Bbl): string => `${b.boro}-${b.block}-${b.lot}`;

/** SoQL for registrations of a set of lots. Values are digits only (parseBbl), so nothing can be injected. */
export function registrationsQuery(bbls: readonly Bbl[]): URLSearchParams {
  const where = bbls.map((b) => `(boroid='${b.boro}' AND block='${b.block}' AND lot='${b.lot}')`).join(' OR ');
  const p = new URLSearchParams();
  p.set('$select', 'registrationid,boroid,block,lot,registrationenddate');
  p.set('$where', where);
  p.set('$limit', '2000');
  return p;
}

/** SoQL for the company contacts of a set of registrations. Only the three columns; only the three types that can name a managing or owning company. */
export function contactsQuery(registrationIds: readonly string[]): URLSearchParams {
  const ids = registrationIds.filter((r) => /^\d{1,9}$/.test(r)).map((r) => `'${r}'`).join(',');
  const p = new URLSearchParams();
  p.set('$select', 'registrationid,type,corporationname');
  p.set('$where', `type in ('Agent','SiteManager','CorporateOwner') AND registrationid in (${ids})`);
  p.set('$limit', '5000');
  return p;
}

interface RegRow {
  registrationid?: unknown;
  boroid?: unknown;
  block?: unknown;
  lot?: unknown;
  registrationenddate?: unknown;
}

/**
 * True when the row has a readable registrationenddate before `nowMs`: an expired registration names no current manager. A missing or
 * unreadable date is not expired. Round 19 UNIFY: taken from the other branch's isExpiredRegistration (kept unchanged in reference/r10-engine/nyc-agents/lib/contacts/nyc-agents.ts)
 * (their recon of 2026-11-22 saw a registration that ended 2026-09-01 still listed on its lot).
 */
export function isExpiredRegistration(r: { registrationenddate?: unknown }, nowMs: number): boolean {
  const t = typeof r.registrationenddate === 'string' ? Date.parse(r.registrationenddate.trim()) : NaN;
  return Number.isFinite(t) && t < nowMs;
}

/**
 * Registration rows to BBL key -> registration ids. Rows whose key is not in `wanted` are ignored (the server filter is trusted, not
 * relied on). With `nowMs`, an expired registration (isExpiredRegistration) is left out before the lot's majority is taken.
 */
export function groupRegistrations(rows: unknown, wanted: ReadonlySet<string>, nowMs?: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows as RegRow[]) {
    if (!r || typeof r !== 'object') continue;
    if (nowMs !== undefined && isExpiredRegistration(r, nowMs)) continue;
    const id = typeof r.registrationid === 'string' || typeof r.registrationid === 'number' ? String(r.registrationid) : '';
    if (!/^\d{1,9}$/.test(id)) continue;
    const b = parseBbl(`${String(r.boroid ?? '')}${String(r.block ?? '').padStart(5, '0')}${String(r.lot ?? '').padStart(4, '0')}`);
    if (!b) continue;
    const k = bblKey(b);
    if (!wanted.has(k)) continue;
    const list = out.get(k) ?? [];
    if (!list.includes(id)) list.push(id);
    out.set(k, list);
  }
  return out;
}

/** Contact rows to registration id -> that registration's contact rows. */
export function groupContacts(rows: unknown): Map<string, HpdContactRow[]> {
  const out = new Map<string, HpdContactRow[]>();
  if (!Array.isArray(rows)) return out;
  for (const r of rows as HpdContactRow[]) {
    if (!r || typeof r !== 'object') continue;
    const id = typeof r.registrationid === 'string' || typeof r.registrationid === 'number' ? String(r.registrationid) : '';
    if (!id) continue;
    // Only the three fields the lookup asked for are kept, whatever else the response carries.
    const keep: HpdContactRow = { registrationid: id, type: r.type, corporationname: r.corporationname };
    const list = out.get(id) ?? [];
    list.push(keep);
    out.set(id, list);
  }
  return out;
}

/** Pure join: lots, their registrations and the registrations' contacts to one company per lot (or null). */
export function resolveManagers(
  lots: ReadonlyMap<string, string[]>,
  contacts: ReadonlyMap<string, HpdContactRow[]>,
  keys: readonly string[],
): Map<string, Manager | null> {
  const out = new Map<string, Manager | null>();
  for (const k of keys) {
    const regs = lots.get(k) ?? [];
    out.set(k, managerForBuilding(regs.map((id) => managerForRegistration(contacts.get(id) ?? []))));
  }
  return out;
}

// ---- per-process cache ----------------------------------------------------------------------------------------------------------------

const cache = new Map<string, { m: Manager | null; at: number }>();
export function clearManagerCache(): void {
  cache.clear();
}
function cachePut(k: string, m: Manager | null, now: number): void {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(k, { m, at: now });
}

export interface LookupOptions {
  fetch: typeof fetch;
  log?: (m: string) => void;
  appToken?: string;
  now?: number;
  maxBbls?: number;
  /** Absolute time (ms since epoch, Date.now() clock) after which no request is started and a running one is cut. Absent: no deadline. */
  deadline?: number;
  /** Requests in flight at once (default POOL_SIZE). */
  pool?: number;
  /** Per request timeout (default CALL_TIMEOUT_MS). */
  callTimeoutMs?: number;
}

/** Runs the tasks with at most `size` in flight; a task that throws is the caller's to catch (the tasks here never throw). */
async function runPool<T>(tasks: readonly (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, tasks.length)) }, worker));
  return out;
}

async function getJson(url: string, o: LookupOptions): Promise<unknown | null> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
  if (o.appToken) headers['X-App-Token'] = o.appToken;
  const left = o.deadline === undefined ? Infinity : o.deadline - Date.now();
  if (left <= 0) {
    o.log?.('nyc-hpd: budget used up, request skipped');
    return null;
  }
  try {
    const res = await o.fetch(url, { headers, signal: AbortSignal.timeout(Math.max(1, Math.min(o.callTimeoutMs ?? CALL_TIMEOUT_MS, left))) });
    if (!res.ok) {
      o.log?.(`nyc-hpd: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch (e) {
    o.log?.(`nyc-hpd: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Company per BBL. Bounded (see the file header). A BBL whose lookup failed is absent from the result (and not cached) so the next run tries
 * again; a BBL with no company is present with null (and cached). Never throws.
 */
export async function lookupManagers(bblValues: readonly unknown[], o: LookupOptions): Promise<Map<string, Manager | null>> {
  const now = o.now ?? Date.now();
  const result = new Map<string, Manager | null>();
  const wanted: Bbl[] = [];
  const seen = new Set<string>();
  for (const v of bblValues) {
    const b = parseBbl(v);
    if (!b) continue;
    const k = bblKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    const hit = cache.get(k);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      result.set(k, hit.m);
      continue;
    }
    if (wanted.length < (o.maxBbls ?? MAX_BBLS_PER_RUN)) wanted.push(b);
  }
  if (wanted.length === 0) return result;

  // 1. registrations of each lot (concurrent, bounded)
  const lots = new Map<string, string[]>();
  const failedKeys = new Set<string>();
  const chunksOf = <T,>(list: readonly T[], n: number): T[][] => {
    const parts: T[][] = [];
    for (let i = 0; i < list.length; i += n) parts.push(list.slice(i, i + n));
    return parts;
  };
  const size = o.pool ?? POOL_SIZE;
  await runPool(
    chunksOf(wanted, BBLS_PER_QUERY).map((part) => async () => {
      const body = await getJson(`https://${HPD_DOMAIN}/resource/${HPD_REGISTRATIONS_ID}.json?${registrationsQuery(part).toString()}`, o);
      if (body === null) {
        for (const b of part) failedKeys.add(bblKey(b));
        return;
      }
      for (const [k, ids] of groupRegistrations(body, new Set(part.map(bblKey)), now)) lots.set(k, ids);
    }),
    size,
  );

  // 2. contacts of the registrations of lots that are small enough to name a company for
  const regIds: string[] = [];
  for (const ids of lots.values()) if (ids.length <= MAX_REGISTRATIONS_PER_BBL) regIds.push(...ids);
  const uniqueRegs = [...new Set(regIds)];
  const contacts = new Map<string, HpdContactRow[]>();
  const failedRegs = new Set<string>();
  await runPool(
    chunksOf(uniqueRegs, REGS_PER_QUERY).map((part) => async () => {
      const body = await getJson(`https://${HPD_DOMAIN}/resource/${HPD_CONTACTS_ID}.json?${contactsQuery(part).toString()}`, o);
      if (body === null) {
        for (const id of part) failedRegs.add(id);
        return;
      }
      for (const [id, rows] of groupContacts(body)) contacts.set(id, rows);
    }),
    size,
  );

  const keys = wanted.map(bblKey);
  const resolved = resolveManagers(lots, contacts, keys);
  for (const k of keys) {
    if (failedKeys.has(k)) continue;
    const regs = lots.get(k) ?? [];
    if (regs.some((id) => failedRegs.has(id))) continue;
    const m = resolved.get(k) ?? null;
    result.set(k, m);
    cachePut(k, m, now);
  }
  return result;
}

// ---- the NYC 311 adapter with the lookup ------------------------------------------------------------------------------------------------

/** Adds data.managerName / data.managerRole to the heat rows that have a company. New objects; the input is not changed. Never throws. */
export interface EnrichOptions extends LookupOptions {
  /** Total time for the lookups (default LOOKUP_BUDGET_MS). */
  budgetMs?: number;
  /** Date.now() when the adapter started: the lookups end by this plus ADAPTER_DEADLINE_MS (default: now). */
  startedAt?: number;
}

export async function enrichHeatRows(
  items: readonly SignalInput[],
  bblByExternalId: ReadonlyMap<string, string>,
  o: EnrichOptions,
): Promise<SignalInput[]> {
  const now = o.now ?? Date.now();
  const cutoff = now - ENRICH_WINDOW_HOURS * 3_600_000;
  const plain = [...items];
  try {
    const targets = items.filter(
      (s) => isResidentialHeatTitle(s.title) && bblByExternalId.has(s.externalId) && Date.parse(s.occurredAt) >= cutoff,
    );
    if (targets.length === 0) return plain;
    const t0 = Date.now();
    const budget = o.budgetMs ?? LOOKUP_BUDGET_MS;
    const deadline = Math.min(t0 + budget, (o.startedAt ?? t0) + ADAPTER_DEADLINE_MS, o.deadline ?? Infinity);
    // The lookups carry the deadline themselves; the race below is for a fetch that ignores its abort signal and never settles.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exhausted = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()) + 250);
    });
    const found = await Promise.race([lookupManagers(targets.map((s) => bblByExternalId.get(s.externalId)), { ...o, deadline }), exhausted]).finally(() => {
      if (timer) clearTimeout(timer);
    });
    if (found === null) {
      o.log?.('nyc-hpd: lookup budget used up, heat rows kept without a company');
      return plain;
    }
    return items.map((s) => {
      if (!targets.includes(s)) return s;
      const b = parseBbl(bblByExternalId.get(s.externalId));
      const m = b ? found.get(bblKey(b)) : null;
      return m ? { ...s, data: { ...(s.data ?? {}), managerName: m.name, managerRole: m.role } } : s;
    });
  } catch {
    return plain;
  }
}

export function buildNycHeatAdapter(ds: SocrataDataset, tuning: Pick<EnrichOptions, 'budgetMs' | 'pool' | 'callTimeoutMs'> = {}): Adapter {
  const base = buildSocrataAdapter(ds);
  return {
    ...base,
    async fetch(ctx: AdapterContext): Promise<SignalInput[]> {
      const startedAt = Date.now();
      const bblById = new Map<string, string>();
      // Reads the 311 rows the base adapter fetches (it parses them into signals that carry no BBL) without changing the response.
      const wrapped: typeof fetch = async (input, init) => {
        const res = await ctx.fetch(input, init);
        try {
          if (res.ok && typeof input === 'string' && input.includes(`/resource/${ds.datasetId}.json`)) {
            const rows: unknown = await res.clone().json();
            if (Array.isArray(rows)) {
              for (const r of rows as Record<string, unknown>[]) {
                if (r && typeof r.unique_key === 'string' && typeof r.bbl === 'string') bblById.set(r.unique_key, r.bbl);
              }
            }
          }
        } catch {
          // the base adapter parses the same body itself; a failure here only means no lookup
        }
        return res;
      };
      const items = await base.fetch({ ...ctx, fetch: wrapped });
      return enrichHeatRows(items, bblById, {
        fetch: ctx.fetch,
        log: ctx.log,
        appToken: ctx.env.SOCRATA_APP_TOKEN,
        now: (ctx.now ?? new Date()).getTime(),
        startedAt,
        ...tuning,
      });
    },
  };
}

const NYC_311 = SOCRATA_DATASETS.find((d) => d.id === NYC_311_SOURCE_ID);
export const adapters: Adapter[] = NYC_311 && NYC_311.verified ? [buildNycHeatAdapter(NYC_311)] : [];
