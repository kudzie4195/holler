import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Small typed DataForSEO client with a hard monthly spend cap.
 *
 * - Credentials: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (HTTP Basic). Never logged, never stored, never put in an error detail.
 *   Either one missing: every call returns { ok: false, reason: 'not_configured' } and nothing throws.
 * - Cap: DATAFORSEO_MONTHLY_CAP_USD (default 30). Before each call a reservation row for the estimated cost is written to
 *   holler_dataforseo_spend, the month total (that row included) is read, and the call is refused with 'cap_reached' when the
 *   total would pass the cap. After the call the row is settled to the real `cost` from the response. A reservation that was never
 *   settled (process died) keeps its estimate, so the books err on the high side. Spend that cannot be read or written fails closed
 *   ('spend_unavailable'): no money is spent without a record.
 * - Retry: one retry on an HTTP 5xx, none on a 4xx. A timeout or network error is not retried (the request may have been billed);
 *   it is booked at the estimate with status 'unknown'.
 * - Env is read from process.env on purpose: lib/env.ts is not in this unit's file list.
 */

export type Db = SupabaseClient;

export const DFS_BASE = 'https://api.dataforseo.com';
export const DEFAULT_MONTHLY_CAP_USD = 30;

export type PriceKind = 'searchVolumeLive' | 'llmMentionsSearch' | 'businessListingsSearch';

/**
 * The one table of per-task prices (USD), used only to ESTIMATE a call before it is made. The real cost is always the `cost` field
 * of the response, which is what gets recorded.
 * - searchVolumeLive: 0.075 per task, any keyword count up to 1000. Verified: the sample response on the live endpoint page shows
 *   "cost": 0.075 for a 3 keyword task, and the page says "the price for 1 or 1000 keywords will be the same".
 *   https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/
 * - searchVolumeStandard (task_post + task_get, not used here): the overview page says Standard "is more affordable" but the
 *   price page was not reachable, so 0.05 is UNVERIFIED and only documents the comparison.
 *   https://docs.dataforseo.com/v3/keywords_data/google_ads/overview
 * - llmMentionsSearch: UNVERIFIED. The docs give no figure ("can be calculated on the Pricing page",
 *   https://dataforseo.com/pricing/ai-optimization/llm-mentions). The sample responses show cost 0.103 for limit 3
 *   (search_mentions/live) and 0.101 (target_metrics/live), so the model here is 0.10 per task plus 0.001 per item returned.
 *   https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live/
 * - businessListingsSearch (round 18, lib/enrich/business-lookup.ts): 0.012 per task plus 0.00036 per item returned. Verified
 *   2026-11-22 on the pricing page ("Each Live request costs $0.012, plus $0.00036 for each returned item",
 *   https://dataforseo.com/pricing/business-data/business-listings-api). The sample response on the endpoint page shows cost 0.0109
 *   for 3 items (an older 0.01 + 0.0003 rate), so the estimate from the current page is the higher, safer figure.
 *   https://docs.dataforseo.com/v3/business_data/business_listings/search/live/
 */
export const PRICE_TABLE = {
  searchVolumeLive: {
    path: '/v3/keywords_data/google_ads/search_volume/live',
    perTaskUsd: 0.075,
    perItemUsd: 0,
    verified: true,
    doc: 'https://docs.dataforseo.com/v3/keywords_data/google_ads/search_volume/live/',
  },
  searchVolumeStandard: {
    path: '/v3/keywords_data/google_ads/search_volume/task_post',
    perTaskUsd: 0.05,
    perItemUsd: 0,
    verified: false,
    doc: 'https://docs.dataforseo.com/v3/keywords_data/google_ads/overview',
  },
  llmMentionsSearch: {
    path: '/v3/ai_optimization/llm_mentions/search_mentions/live',
    perTaskUsd: 0.1,
    perItemUsd: 0.001,
    verified: false,
    doc: 'https://docs.dataforseo.com/v3/ai_optimization/llm_mentions/search_mentions/live/',
  },
  businessListingsSearch: {
    path: '/v3/business_data/business_listings/search/live',
    perTaskUsd: 0.012,
    perItemUsd: 0.00036,
    verified: true,
    doc: 'https://docs.dataforseo.com/v3/business_data/business_listings/search/live/',
  },
} as const;

/** Upper-bound estimate for one call. `items` is the number of keywords or the row limit. */
export function estimateUsd(kind: PriceKind, items = 0): number {
  const p = PRICE_TABLE[kind];
  return Math.round((p.perTaskUsd + p.perItemUsd * Math.max(0, items)) * 100_000) / 100_000;
}

export type DfsFailure = 'not_configured' | 'cap_reached' | 'admit_refused' | 'spend_unavailable' | 'http_error' | 'network_error' | 'api_error' | 'bad_shape';

export interface DfsTask {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: unknown;
}

export type DfsResult =
  | { ok: true; task: DfsTask; cost: number }
  | { ok: false; reason: DfsFailure; detail?: string; httpStatus?: number; spentUsd?: number; capUsd?: number };

export interface DfsDeps {
  /** Service-role client. Undefined means "create the admin client"; null means "no database" (calls fail closed). */
  db?: Db | null;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Per request timeout. Default 30 s. */
  timeoutMs?: number;
  /** One retry on an HTTP 5xx (default true). The business lookup passes false: one lookup is one request. */
  retry5xx?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function monthlyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DATAFORSEO_MONTHLY_CAP_USD?.trim();
  if (!raw) return DEFAULT_MONTHLY_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_CAP_USD;
}

export function credentials(env: Record<string, string | undefined> = process.env): { login: string; password: string } | null {
  const login = env.DATAFORSEO_LOGIN?.trim();
  const password = env.DATAFORSEO_PASSWORD?.trim();
  return login && password ? { login, password } : null;
}

export async function getDb(deps: DfsDeps): Promise<Db | null> {
  if (deps.db !== undefined) return deps.db;
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    return createAdminClient();
  } catch {
    return null;
  }
}

export const MAX_PLAUSIBLE_COST_USD = 1000;

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** A reported cost is believed only between 0 and 1000 USD (the column is numeric(10,5)). Anything else is booked at the estimate, with a warning. */
function plausible(c: number | null, estimate: number): number | null {
  if (c === null) return null;
  if (c >= 0 && c <= MAX_PLAUSIBLE_COST_USD) return c;
  console.warn(`[dataforseo] reported cost outside 0 to ${MAX_PLAUSIBLE_COST_USD} USD, booking the estimate of ${estimate}`);
  return estimate;
}

/** Cost from a response body: the top level `cost`, else the first task's. Null when the body carries none. */
export function costOf(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { cost?: unknown; tasks?: unknown };
  const top = num(b.cost);
  if (top !== null) return top;
  if (Array.isArray(b.tasks)) {
    let sum = 0;
    let any = false;
    for (const t of b.tasks) {
      const c = num((t as { cost?: unknown } | null)?.cost);
      if (c !== null) {
        sum += c;
        any = true;
      }
    }
    return any ? sum : null;
  }
  return null;
}

/** Sum of cost_usd for a month, read in pages. Throws on a read error. */
export async function monthSpendUsd(db: Db, month: string): Promise<number> {
  let total = 0;
  for (let page = 0; page < 50; page++) {
    const { data, error } = await db
      .from('holler_dataforseo_spend')
      .select('cost_usd')
      .eq('month', month)
      .order('id', { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { cost_usd: number | string | null }[];
    for (const r of rows) total += Number(r.cost_usd) || 0;
    if (rows.length < 1000) break;
  }
  return Math.round(total * 100_000) / 100_000;
}

async function settle(db: Db, id: number | string, patch: { cost_usd: number; status: string; detail?: string | null }): Promise<void> {
  try {
    await db
      .from('holler_dataforseo_spend')
      .update({ ...patch, detail: patch.detail ? patch.detail.slice(0, 300) : null, updated_at: new Date().toISOString() })
      .eq('id', id);
  } catch {
    // The reservation keeps its estimate, which is the safe side for a cap.
  }
}

/**
 * POST one task to DataForSEO. `path` starts with /v3/. `body` is the task object; the API wants it inside an array and this wraps it.
 * Never throws.
 */
export async function dfsCall(
  path: string,
  task: Record<string, unknown>,
  opts: {
    kind: PriceKind;
    items?: number;
    /**
     * Optional extra gate, asked AFTER this call's reservation row is booked and the monthly cap passed, with the reservation's id. False
     * refuses the call (the row is settled as refused, cost 0) with reason 'admit_refused'. The business lookup uses it to hold its daily
     * cap under overlapping runs: book first, then count the booked rows up to and including this one.
     */
    admit?: (db: Db, reservationId: number | string) => Promise<boolean>;
  },
  deps: DfsDeps = {},
): Promise<DfsResult> {
  const env = deps.env ?? process.env;
  const creds = credentials(env);
  if (!creds) return { ok: false, reason: 'not_configured' };

  const db = await getDb(deps);
  if (!db) return { ok: false, reason: 'spend_unavailable', detail: 'database not available' };

  const now = (deps.now ?? (() => new Date()))();
  const month = monthKey(now);
  const cap = monthlyCapUsd(env);
  const estimate = estimateUsd(opts.kind, opts.items ?? 0);

  // 1. Reserve, then read the total including the reservation. Used for the first attempt and again before a retry.
  const reserve = async (): Promise<{ id: number | string } | { fail: DfsResult }> => {
    let rid: number | string;
    try {
      const ins = await db
        .from('holler_dataforseo_spend')
        .insert({ month, endpoint: path, units: opts.items ?? 0, estimated_usd: estimate, cost_usd: estimate, status: 'reserved' })
        .select('id');
      if (ins.error) return { fail: { ok: false, reason: 'spend_unavailable', detail: 'could not record spend' } };
      const got = (ins.data as { id: number | string }[] | null)?.[0]?.id;
      if (got === undefined || got === null) return { fail: { ok: false, reason: 'spend_unavailable', detail: 'no reservation id' } };
      rid = got;
    } catch {
      return { fail: { ok: false, reason: 'spend_unavailable', detail: 'could not record spend' } };
    }
    let total: number;
    try {
      total = await monthSpendUsd(db, month);
    } catch {
      await settle(db, rid, { cost_usd: 0, status: 'refused', detail: 'spend read failed' });
      return { fail: { ok: false, reason: 'spend_unavailable', detail: 'could not read spend' } };
    }
    if (total > cap + 1e-9) {
      await settle(db, rid, { cost_usd: 0, status: 'refused', detail: 'cap_reached' });
      return { fail: { ok: false, reason: 'cap_reached', spentUsd: Math.round((total - estimate) * 100_000) / 100_000, capUsd: cap } };
    }
    if (opts.admit) {
      let admitted = false;
      try {
        admitted = await opts.admit(db, rid);
      } catch {
        admitted = false;
      }
      if (!admitted) {
        await settle(db, rid, { cost_usd: 0, status: 'refused', detail: 'admit_refused' });
        return { fail: { ok: false, reason: 'admit_refused' } };
      }
    }
    return { id: rid };
  };
  const first = await reserve();
  if ('fail' in first) return first.fail;
  let id = first.id;

  // 2. The request. One retry on 5xx only.
  const f = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const auth = 'Basic ' + Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(DFS_BASE + path, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify([task]),
        signal: AbortSignal.timeout(deps.timeoutMs ?? 30_000),
      });
    } catch (e) {
      // Could have been billed: book the estimate.
      await settle(db, id, { cost_usd: estimate, status: 'unknown', detail: `network: ${e instanceof Error ? e.name : 'error'}` });
      return { ok: false, reason: 'network_error', detail: e instanceof Error ? e.name : 'error' };
    }
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const reported = plausible(costOf(json), estimate);

    if (res.status >= 500 && attempt === 0 && deps.retry5xx !== false) {
      // Book what this attempt really cost, then reserve a fresh estimate for the retry so the cap sees both.
      await settle(db, id, { cost_usd: reported ?? 0, status: 'error', detail: `http ${res.status}, retried` });
      await sleep(1000);
      const again = await reserve();
      if ('fail' in again) return again.fail;
      id = again.id;
      continue;
    }
    if (res.status >= 400) {
      await settle(db, id, { cost_usd: reported ?? 0, status: 'error', detail: `http ${res.status}` });
      return { ok: false, reason: 'http_error', httpStatus: res.status, detail: `http ${res.status}` };
    }

    const top = json as { status_code?: unknown; status_message?: unknown; tasks?: unknown } | null;
    if (!top || typeof top !== 'object' || !Array.isArray(top.tasks) || top.tasks.length === 0 || typeof top.tasks[0] !== 'object' || top.tasks[0] === null) {
      // A 200 we cannot read may still have been billed: book the estimate.
      await settle(db, id, { cost_usd: reported ?? estimate, status: 'unknown', detail: 'unexpected response shape' });
      return { ok: false, reason: 'bad_shape', detail: 'unexpected response shape' };
    }
    const t = top.tasks[0] as DfsTask;
    const cost = reported;
    if (top.status_code !== 20000 || t.status_code !== 20000) {
      const code = t.status_code ?? top.status_code;
      await settle(db, id, { cost_usd: cost ?? 0, status: 'error', detail: `api ${String(code)}` });
      return { ok: false, reason: 'api_error', detail: `${String(code)} ${String(t.status_message ?? top.status_message ?? '')}`.trim() };
    }
    const real = cost ?? estimate;
    await settle(db, id, { cost_usd: real, status: 'ok' });
    return { ok: true, task: t, cost: real };
  }
}
