import type { Db } from './budget';

/**
 * Volume limits for the cron AI step, on top of the monthly dollar cap in budget.ts (PLAN-2.0 item 2.5). The dollar cap stays the
 * hard stop; these two keep one hour or one day from using a large share of the month, and decide who goes first when there is more
 * to classify than the limits allow.
 *
 *  - per run: at most AI_MAX_SIGNALS_PER_RUN records are sent to the model in one cron run (default 200).
 *  - per day: at most AI_MAX_SIGNALS_PER_DAY records are sent to the model in one UTC day (default 1500), counted from the
 *    holler_ai_spend rows of today (every attempt that may have been billed counts, a timed-out one too; a call that failed before any response, cost 0, does not).
 *    Reply drafts are not counted.
 *
 * Only records that need a model call count. Skipped sources and cache hits are free and never limited.
 *
 * Order: permit and civic records (building permits, 311 requests, violations, inspections) go first, OLDEST first, up to
 * PRIORITY_SHARE of the limit, so a backlog drains in order instead of the newest rows always winning and the oldest ones falling
 * out of the 14 day window unclassified. The rest of the limit goes to every other kind, newest first (the order the candidates
 * were read in), and anything the priority part did not use goes to them too.
 *
 * Nothing here calls a model, the network or the clock.
 */

export const DEFAULT_MAX_SIGNALS_PER_RUN = 200;
export const DEFAULT_MAX_SIGNALS_PER_DAY = 1500;
/** Share of the limit the permit and civic records may take first. */
export const PRIORITY_SHARE = 0.75;
/** The kinds this part of the step is about (lib/signals/types.ts SignalKind). */
export const PRIORITY_KINDS: ReadonlySet<string> = new Set(['permit', 'civic']);

/** Spend kinds that stand for a model attempt (not a refusal, a run summary, an alert row or a reply draft). */
export const ATTEMPT_KINDS = ['reserved', 'classify', 'error', 'unknown'] as const;

function nonNegInt(raw: string | undefined, fallback: number): number {
  const t = raw?.trim();
  if (!t) return fallback;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export function runLimit(env: Record<string, string | undefined> = process.env): number {
  return nonNegInt(env.AI_MAX_SIGNALS_PER_RUN, DEFAULT_MAX_SIGNALS_PER_RUN);
}

export function dayLimit(env: Record<string, string | undefined> = process.env): number {
  return nonNegInt(env.AI_MAX_SIGNALS_PER_DAY, DEFAULT_MAX_SIGNALS_PER_DAY);
}

export function isPriorityKind(kind: string | null | undefined): boolean {
  return PRIORITY_KINDS.has((kind ?? '').toLowerCase());
}

/** 00:00 UTC of the day `now` is in, as an ISO string. */
export function dayStartIso(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Records sent to the model so far today (UTC), from holler_ai_spend. Throws when the table cannot be read: the caller then makes no
 * model call (the same fail-closed rule as the spend itself).
 */
export async function modelSignalsToday(db: Db, now: Date): Promise<number> {
  const since = dayStartIso(now);
  let total = 0;
  let offset = 0;
  for (let page = 0; page < 50; page++) {
    const { data, error } = await db
      .from('holler_ai_spend')
      .select('id,kind,signals,cost_usd')
      .in('kind', [...ATTEMPT_KINDS])
      .gte('created_at', since)
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error('day_usage_unreadable');
    const rows = (data ?? []) as { kind?: string | null; signals: number | string | null; cost_usd?: number | string | null }[];
    if (rows.length === 0) return total;
    for (const r of rows) {
      // A call that failed before any response (connection refused, bad key) is settled as kind 'error' with cost 0: nothing was
      // billed and nothing was classified, so it must not use up the day (a gateway outage would otherwise block the rest of the UTC day).
      if (r.kind === 'error' && Number(r.cost_usd) === 0) continue;
      total += Math.max(0, Number(r.signals) || 0);
    }
    offset += rows.length;
  }
  throw new Error('day_usage_too_many_rows');
}

export interface Orderable {
  kind: string | null;
  /** ISO time of the record's own date (occurred_at). Rows without one sort last among the oldest-first rows. */
  occurredAt?: string | null;
}

const ts = (v: string | null | undefined): number => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
};

/**
 * Pick which records go to the model. `items` come in the order they were read (newest first). Returns at most `limit` of them:
 * permit and civic oldest first (ties keep the read order) up to PRIORITY_SHARE of the limit, then the rest in read order, then
 * any permit and civic records still left if there is room. `deferred` counts the records that did not fit (they stay unclassified
 * and are picked up by a later run while they are inside the 14 day window).
 */
export function pickWithinLimit<T extends Orderable>(items: readonly T[], limit: number): { picked: T[]; deferred: number } {
  const n = Math.max(0, Math.floor(limit));
  if (items.length <= n && !items.some((i) => isPriorityKind(i.kind))) return { picked: [...items], deferred: 0 };
  const priority = items
    .map((it, i) => ({ it, i }))
    .filter((x) => isPriorityKind(x.it.kind))
    .sort((a, b) => ts(a.it.occurredAt) - ts(b.it.occurredAt) || a.i - b.i)
    .map((x) => x.it);
  const others = items.filter((i) => !isPriorityKind(i.kind));
  const priorityRoom = Math.min(priority.length, Math.ceil(n * PRIORITY_SHARE));
  const first = priority.slice(0, priorityRoom);
  const second = others.slice(0, Math.max(0, n - first.length));
  const rest = n - first.length - second.length;
  const third = rest > 0 ? priority.slice(priorityRoom, priorityRoom + rest) : [];
  const picked = [...first, ...second, ...third];
  return { picked, deferred: items.length - picked.length };
}
