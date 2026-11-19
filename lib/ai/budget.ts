import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Monthly spend cap for every model call Holler makes (holler_ai_spend, migration 0014): the cron classification step and the reply
 * drafts a member asks for share one month total.
 *
 * - Cap: AI_MONTHLY_CAP_USD (default 10). Read from process.env on purpose: lib/env.ts is a shared file.
 * - Prices: MODEL_PRICES, one table keyed by model id. A model id that is not in the table is never called (unknown_model_price), so
 *   the cap is always checked with real prices. Every id in the table is an Anthropic model: the privacy page and the terms say the
 *   model is from Anthropic, and tests/legal/r3-legal.test.ts fails if a non-Anthropic id is added here or set as AI_CLASSIFY_MODEL.
 * - Before each model call a reservation row with the WORST-CASE cost is inserted (input tokens estimated from characters, output
 *   tokens = the maxOutputTokens set on the call, priced with that model's own prices, times a scale the caller may raise when a
 *   settled cost came in above its reservation), then the month total, that row included, is read. When the total passes the cap
 *   the row is marked refused (cost 0) and the call is refused with cap_reached. Insert-then-sum is the same pattern as
 *   lib/dataforseo/client.ts: two overlapping runs both see each other's reservations, so together they can never pass the cap
 *   (at worst both refuse, which is the safe side).
 * - After the call the row is settled to the token usage the response reports, or the gateway's reported cost when that is higher.
 *   A call that timed out, or that answered without usage numbers or a gateway cost, keeps its worst-case estimate, so the books
 *   err high. A call that failed before any response (connection error, error status) is settled at 0.
 * - The month total is summed in SQL (holler_ai_month_spend, service role only). Before 0014 the code reads every page instead.
 * - Spend that cannot be written or read fails closed: no model call without a spend row. The one exception is a reply draft while
 *   0014 is not applied at all (see lib/ai/draft.ts): it runs under the per-user hourly limit only.
 * - Alerts: when the month's spend first reaches 80% of the cap, and when the cap is hit, the route emails the admin once per month
 *   per threshold. claimAlert() inserts a kind alert_80 / alert_100 row (cost 0); a unique index makes the second claim fail.
 *   A model with no price raises alert_price, once per day (unique per day).
 */

export type Db = SupabaseClient;

export const DEFAULT_AI_MONTHLY_CAP_USD = 10;

export interface ModelPrice {
  /** USD per million input tokens. */
  inputPerM: number;
  /** USD per million output tokens. */
  outputPerM: number;
}

/**
 * The only place prices live. anthropic/claude-haiku-5.5 on the Vercel AI Gateway, USD per million tokens, as given for this round
 * (gateway catalog, checked 2026-11-19): input 0.10, output 0.50, for requests up to 100k tokens. Every call here stays far below
 * 100k tokens. To use another model, add its id and real prices here first; an id that is missing here never runs.
 * Keep every id an Anthropic one (anthropic/...): the legal pages say the model is from Anthropic (tests/legal/r3-legal.test.ts).
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'anthropic/claude-haiku-5.5': { inputPerM: 0.1, outputPerM: 0.5 },
};

const DEFAULT_PRICE: ModelPrice = MODEL_PRICES['anthropic/claude-haiku-5.5'];

/** The price for a model id, or null when the id is not in MODEL_PRICES (the caller must not call that model). */
export function priceFor(modelId: string): ModelPrice | null {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICES, modelId) ? MODEL_PRICES[modelId] : null;
}

/** Conservative characters-per-token for the estimate. English prose runs near 4; JSON and short fields run lower, so 3 errs high. */
export const CHARS_PER_TOKEN = 3;

export const ALERT_THRESHOLD = 0.8;

export type SpendKind = 'reserved' | 'classify' | 'draft' | 'error' | 'unknown' | 'refused';
/** One cost-0 row per run carrying the volume counts (signals written, cache hits, cache misses, skipped). */
export type RunKind = 'run';
export type AlertKind = 'alert_80' | 'alert_100' | 'alert_price';

/** UTC day, for the once-a-day alert. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function monthlyCapUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.AI_MONTHLY_CAP_USD?.trim();
  if (!raw) return DEFAULT_AI_MONTHLY_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_AI_MONTHLY_CAP_USD;
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

export function estimateInputTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

/** Cost of a call at a model's prices. The price defaults to the default model's, for estimates and tests only. */
export function costUsd(inputTokens: number, outputTokens: number, price: ModelPrice = DEFAULT_PRICE): number {
  return round6((Math.max(0, inputTokens) * price.inputPerM + Math.max(0, outputTokens) * price.outputPerM) / 1_000_000);
}

/** Worst case for one call: every input character estimated high, every allowed output token used. */
export function worstCaseUsd(inputChars: number, maxOutputTokens: number, price: ModelPrice = DEFAULT_PRICE): number {
  return costUsd(estimateInputTokens(inputChars), maxOutputTokens, price);
}

/** Pages the fallback month read may take before it gives up (and the caller fails closed). */
const SPEND_MAX_PAGES = 5000;

/**
 * Sum of cost_usd for a month. One SQL call (holler_ai_month_spend, 0014). When that function is missing or fails, every row is read
 * in pages: a page shorter than asked for does NOT end the read (the project's max-rows may be below 1000), only an empty page does.
 * Throws on a read error.
 */
export async function monthSpendUsd(db: Db, month: string): Promise<number> {
  try {
    const { data, error } = await db.rpc('holler_ai_month_spend', { p_month: month });
    if (!error) {
      const v = Array.isArray(data) ? (data[0] as unknown) : (data as unknown);
      const raw = v !== null && typeof v === 'object' ? Object.values(v as Record<string, unknown>)[0] : v;
      const n = raw === null || raw === undefined ? 0 : Number(raw);
      if (Number.isFinite(n) && n >= 0) return round6(n);
    }
  } catch {
    // fall through to the paged read
  }
  let total = 0;
  let offset = 0;
  for (let page = 0; page < SPEND_MAX_PAGES; page++) {
    const { data, error } = await db
      .from('holler_ai_spend')
      .select('id,cost_usd')
      .eq('month', month)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { cost_usd: number | string | null }[];
    if (rows.length === 0) return round6(total);
    for (const r of rows) total += Number(r.cost_usd) || 0;
    offset += rows.length;
  }
  throw new Error('spend_too_many_rows');
}

/** True when a database error means migration 0014 is not applied (the table or function does not exist). */
export function isMissingRelation(message: string | null | undefined): boolean {
  return /does not exist|schema cache|PGRST20[25]|42P01|42883/i.test(message ?? '');
}

export type Reservation =
  | { ok: true; id: number | string; estimateUsd: number; monthTotalUsd: number }
  | { ok: false; reason: 'cap_reached'; spentUsd: number; capUsd: number }
  | { ok: false; reason: 'spend_unavailable'; detail: string; /** True when holler_ai_spend itself is missing (0014 not applied). */ missing?: boolean };

/** Insert the worst-case reservation, then read the month total including it. Refuses when the total would pass the cap. */
export async function reserve(
  db: Db,
  opts: {
    month: string;
    capUsd: number;
    signals: number;
    inputChars: number;
    maxOutputTokens: number;
    /** The called model's prices (MODEL_PRICES). Defaults to the default model's. */
    price?: ModelPrice;
    /** Multiplies the estimate (at least 1). A run raises it when a settled cost came in above its reservation. */
    scale?: number;
    /** Signals this call answers without being sent (same key as a sent one). Reporting only. */
    cacheHits?: number;
    /** Signals this call answers in all (sent plus cacheHits). Reporting only. */
    cacheMisses?: number;
  },
): Promise<Reservation> {
  const estIn = estimateInputTokens(opts.inputChars);
  const scale = Number.isFinite(opts.scale) && (opts.scale as number) > 1 ? (opts.scale as number) : 1;
  const estimate = round6(costUsd(estIn, opts.maxOutputTokens, opts.price ?? DEFAULT_PRICE) * scale);
  let id: number | string;
  try {
    const ins = await db
      .from('holler_ai_spend')
      .insert({
        month: opts.month,
        kind: 'reserved',
        signals: opts.signals,
        input_tokens: estIn,
        output_tokens: opts.maxOutputTokens,
        cost_usd: estimate,
        cache_hits: Math.max(0, opts.cacheHits ?? 0),
        cache_misses: Math.max(0, opts.cacheMisses ?? opts.signals),
        skipped: 0,
      })
      .select('id');
    if (ins.error) return { ok: false, reason: 'spend_unavailable', detail: 'could not record spend', missing: isMissingRelation(ins.error.message) };
    const got = (ins.data as { id: number | string }[] | null)?.[0]?.id;
    if (got === undefined || got === null) return { ok: false, reason: 'spend_unavailable', detail: 'no reservation id' };
    id = got;
  } catch {
    return { ok: false, reason: 'spend_unavailable', detail: 'could not record spend' };
  }
  let total: number;
  try {
    total = await monthSpendUsd(db, opts.month);
  } catch {
    await settleRow(db, id, { kind: 'refused', input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    return { ok: false, reason: 'spend_unavailable', detail: 'could not read spend' };
  }
  if (total > opts.capUsd + 1e-9) {
    await settleRow(db, id, { kind: 'refused', input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    return { ok: false, reason: 'cap_reached', spentUsd: round6(total - estimate), capUsd: opts.capUsd };
  }
  return { ok: true, id, estimateUsd: estimate, monthTotalUsd: total };
}

async function settleRow(
  db: Db,
  id: number | string,
  patch: { kind: SpendKind; input_tokens: number; output_tokens: number; cost_usd: number },
): Promise<boolean> {
  try {
    const { error } = await db.from('holler_ai_spend').update(patch).eq('id', id);
    return !error;
  } catch {
    // The reservation keeps its estimate, which is the safe side for a cap.
    return false;
  }
}

export type SettleOutcome =
  /** The call returned (or failed after the model answered). Token counts are null when the response did not report them. */
  | {
      kind: 'classify' | 'draft' | 'error';
      inputTokens: number | null;
      outputTokens: number | null;
      gatewayCostUsd?: number | null;
      price?: ModelPrice;
      /** The reservation's estimate: kept when neither usage numbers nor a gateway cost came back. */
      estimateUsd: number;
    }
  /** Timeout or anything else where the request may have been processed: the worst-case estimate stays. */
  | { kind: 'unknown' }
  /** The call failed before any response (connection error, error status): nothing was spent. */
  | { kind: 'no_response' };

/**
 * Settle a reservation to what the call really used, and return the cost now booked (null when the estimate was left as it was).
 * - usage known: cost from the reported tokens at the model's prices; a higher gateway-reported cost wins (never a lower one).
 * - only a gateway cost: that cost.
 * - neither (a provider that reports no usage): the worst-case estimate stays, marked 'unknown'.
 * - timeout: the estimate stays, marked 'unknown'.
 * - no response: cost 0, marked 'error'.
 */
export async function settle(db: Db, id: number | string, outcome: SettleOutcome): Promise<number | null> {
  if (outcome.kind === 'unknown') {
    try {
      await db.from('holler_ai_spend').update({ kind: 'unknown' }).eq('id', id);
    } catch {
      // keeps 'reserved' and the estimate
    }
    return null;
  }
  if (outcome.kind === 'no_response') {
    const ok = await settleRow(db, id, { kind: 'error', input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    return ok ? 0 : null;
  }
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const inTok = num(outcome.inputTokens);
  const outTok = num(outcome.outputTokens);
  const g = num(outcome.gatewayCostUsd);
  const gateway = g !== null && g < 100 ? g : null;
  const usageKnown = inTok !== null && outTok !== null && inTok + outTok > 0;
  if (!usageKnown && gateway === null) {
    try {
      await db.from('holler_ai_spend').update({ kind: 'unknown' }).eq('id', id);
    } catch {
      // keeps 'reserved' and the estimate
    }
    return outcome.estimateUsd;
  }
  let cost = usageKnown ? costUsd(inTok!, outTok!, outcome.price ?? DEFAULT_PRICE) : 0;
  if (gateway !== null && gateway > cost) cost = round6(gateway);
  const ok = await settleRow(db, id, {
    kind: outcome.kind,
    input_tokens: Math.round(inTok ?? 0),
    output_tokens: Math.round(outTok ?? 0),
    cost_usd: cost,
  });
  // A failed settle leaves the estimate in the books.
  return ok ? cost : outcome.estimateUsd;
}

/**
 * The per-run volume row (kind 'run', cost 0): every signal written this run, how many came from the cache (or from another signal
 * with the same key in this run), how many the model answered, and how many were skipped by source. Best effort: never throws.
 * Effective cost per 1,000 signals for a month = sum(cost_usd) / sum(signals where kind = 'run') * 1000.
 */
export async function recordRun(
  db: Db,
  r: { month: string; signals: number; cacheHits: number; cacheMisses: number; skipped: number },
): Promise<boolean> {
  if (r.signals <= 0 && r.cacheHits <= 0 && r.cacheMisses <= 0 && r.skipped <= 0) return true;
  try {
    const { error } = await db.from('holler_ai_spend').insert({
      month: r.month,
      kind: 'run',
      signals: Math.max(0, r.signals),
      cost_usd: 0,
      cache_hits: Math.max(0, r.cacheHits),
      cache_misses: Math.max(0, r.cacheMisses),
      skipped: Math.max(0, r.skipped),
    });
    return !error;
  } catch {
    return false;
  }
}

/** Which admin alerts this state calls for. The route claims each one (claimAlert) so it is sent once per month. */
export function alertFlags(spentUsd: number, capUsd: number, capHit: boolean): AlertKind[] {
  const out: AlertKind[] = [];
  if (capUsd <= 0) return capHit ? ['alert_100'] : [];
  if (spentUsd >= ALERT_THRESHOLD * capUsd - 1e-9 || capHit) out.push('alert_80');
  if (capHit || spentUsd >= capUsd - 1e-9) out.push('alert_100');
  return out;
}

/**
 * Claim the right to send one alert for this month. True only for the first claim: the unique index on (month, kind) for alert rows
 * makes every later insert fail. Any error counts as "not claimed", so a broken table never sends repeated emails.
 */
export async function claimAlert(db: Db, month: string, kind: AlertKind, day?: string): Promise<boolean> {
  try {
    // alert_price is once per day: the unique index for it is on (day, kind).
    const row: Record<string, string | number> = { month, kind, signals: 0, cost_usd: 0 };
    if (kind === 'alert_price') row.day = day ?? month;
    const { data, error } = await db.from('holler_ai_spend').insert(row).select('id');
    return !error && Array.isArray(data) && data.length === 1;
  } catch {
    return false;
  }
}

/** Give a claim back (the email could not be sent), so a later run tries again. */
export async function releaseAlert(db: Db, month: string, kind: AlertKind, day?: string): Promise<void> {
  try {
    const q = db.from('holler_ai_spend').delete().eq('month', month).eq('kind', kind);
    await (kind === 'alert_price' && day ? q.eq('day', day) : q);
  } catch {
    // stays claimed: at worst the alert is not repeated
  }
}
