import type { Db } from '@/lib/signals/store';
import { readAllPages } from '@/lib/signals/store';

/**
 * Firecrawl bookkeeping in an existing table, no migration: one marker row in holler_scan_runs per paid call group, source `_fc:<source id>`
 * (the same trick as the `_prune` marker). Columns: fetched = credits spent (estimated from the documented formula), inserted = rows
 * kept, matched = rows dropped, error = the state word below (null never used, so a reader sees what happened).
 * The monitor and the source health ignore sources that start with "_" (lib/monitor/rules.ts groupRuns), so these rows never read as a
 * failing source. The daily prune deletes scan_runs older than 30 days, so "month to date" is at most the last 30 days of this month.
 *
 * States:
 *   extracted   a json extraction ran and its rows were handed to the scan
 *   unchanged   change tracking said the page is the same as last time: 1 credit, no extraction
 *   pending     the page changed but the extraction did not finish (error, timeout, budget): extract again next run, whatever change tracking says
 *   failed      the change check itself failed
 *   skipped     not run (robots.txt, budget)
 *   probe       an owner probe (GET /api/admin/firecrawl-probe): written under `_fc:probe:<id>` so it counts toward the day and month totals and
 *               the probe's own daily cap, but never reads as the source's state (it must not look like an extraction or a pending retry)
 */
export type LedgerState = 'extracted' | 'unchanged' | 'pending' | 'failed' | 'skipped' | 'probe';
export const LEDGER_PREFIX = '_fc:';
export const PROBE_PREFIX = 'probe:';

export interface LedgerEntry {
  source: string;
  at: Date;
  credits: number;
  kept: number;
  dropped: number;
  state: LedgerState;
}

export async function writeLedger(db: Db, e: LedgerEntry): Promise<void> {
  const iso = e.at.toISOString();
  const { error } = await db.from('holler_scan_runs').insert({
    source: `${LEDGER_PREFIX}${e.source}`,
    started_at: iso,
    finished_at: iso,
    fetched: Math.max(0, Math.round(e.credits)),
    inserted: Math.max(0, Math.round(e.kept)),
    matched: Math.max(0, Math.round(e.dropped)),
    error: e.state,
  });
  if (error) throw new Error(`firecrawl ledger insert failed: ${error.message}`);
}

interface Row {
  source: string | null;
  started_at: string | null;
  fetched: number | null;
  inserted: number | null;
  matched: number | null;
  error: string | null;
}

export interface SourceLedger {
  lastState: LedgerState | null;
  lastAt: string | null;
  lastCredits: number;
  lastKept: number;
  lastDropped: number;
  creditsMonth: number;
}

export interface LedgerSummary {
  today: number;
  month: number;
  /** Credits spent today by owner probes (already inside `today` and `month`). */
  probeToday: number;
  /** Start of the month window used, ms: the billing cycle start when known, else the calendar month. */
  windowStartMs: number;
  bySource: Record<string, SourceLedger>;
}

const STATES = new Set<string>(['extracted', 'unchanged', 'pending', 'failed', 'skipped', 'probe']);

/**
 * The month window. Firecrawl's free credits reset per BILLING CYCLE, not per calendar month (docs.firecrawl.dev/billing: "resets at the
 * start of each monthly cycle"), so when the account reports billingPeriodStart (GET /v2/team/credit-usage) the window starts there. Used
 * only when it parses, is not in the future and is at most 40 days old; otherwise the UTC calendar month.
 */
export function monthWindowStart(now: Date, billingPeriodStart: string | null | undefined): number {
  const cal = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const t = Date.parse(billingPeriodStart ?? '');
  if (Number.isFinite(t) && t <= now.getTime() && now.getTime() - t <= 40 * 86_400_000) return t;
  return cal;
}

/** Pure: fold marker rows (any order) into totals. Today is the UTC day of `now`; the month starts at `monthStartMs` (default: the UTC calendar month). */
export function summarizeLedger(rows: Row[], now: Date, monthStartMs?: number): LedgerSummary {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = monthStartMs ?? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const out: LedgerSummary = { today: 0, month: 0, probeToday: 0, windowStartMs: monthStart, bySource: {} };
  const sorted = [...rows].sort((a, b) => Date.parse(b.started_at ?? '') - Date.parse(a.started_at ?? ''));
  for (const r of sorted) {
    if (!r.source || !r.source.startsWith(LEDGER_PREFIX) || !r.started_at) continue;
    const t = Date.parse(r.started_at);
    if (!Number.isFinite(t)) continue;
    const id = r.source.slice(LEDGER_PREFIX.length);
    const credits = r.fetched ?? 0;
    if (t >= monthStart) out.month += credits;
    if (t >= dayStart) out.today += credits;
    if (t >= dayStart && id.startsWith(PROBE_PREFIX)) out.probeToday += credits;
    const s = (out.bySource[id] ??= { lastState: null, lastAt: null, lastCredits: 0, lastKept: 0, lastDropped: 0, creditsMonth: 0 });
    if (t >= monthStart) s.creditsMonth += credits;
    if (s.lastAt === null) {
      s.lastAt = new Date(t).toISOString();
      s.lastState = r.error && STATES.has(r.error) ? (r.error as LedgerState) : null;
      s.lastCredits = credits;
      s.lastKept = r.inserted ?? 0;
      s.lastDropped = r.matched ?? 0;
    }
  }
  return out;
}

/** Reads this month's marker rows. Throws on a database error: the caller decides (the adapter fails closed on the day and month caps by skipping). */
export async function readLedger(db: Db, now: Date, billingPeriodStart?: string | null): Promise<LedgerSummary> {
  const monthStartMs = monthWindowStart(now, billingPeriodStart);
  const monthStart = new Date(monthStartMs).toISOString();
  const rows = await readAllPages<Row>(
    (from, to) =>
      db
        .from('holler_scan_runs')
        .select('source, started_at, fetched, inserted, matched, error')
        .like('source', `${LEDGER_PREFIX.replace('_', '\\_')}%`)
        .gte('started_at', monthStart)
        .order('started_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    5,
  );
  return summarizeLedger(rows, now, monthStartMs);
}

/** The source's newest scan_runs row (the scan logs one per source per scan, after it stored the adapter's rows), or null. */
export interface ScanRunInfo {
  finishedMs: number;
  /** The row's error text, null when the scan stored the rows without a problem. */
  error: string | null;
  /** Rows the adapter handed to the scan (0 on a timeout). */
  fetched: number;
}

export async function lastScanRun(db: Db, source: string): Promise<ScanRunInfo | null> {
  const { data, error } = await db.from('holler_scan_runs').select('finished_at, error, fetched').eq('source', source).order('finished_at', { ascending: false }).limit(1);
  if (error) throw new Error(`scan_runs read failed: ${error.message}`);
  const r = (data ?? [])[0] as { finished_at?: string | null; error?: string | null; fetched?: number | null } | undefined;
  const t = Date.parse(r?.finished_at ?? '');
  if (!r || !Number.isFinite(t)) return null;
  return { finishedMs: t, error: r.error ?? null, fetched: r.fetched ?? 0 };
}

/**
 * Were the rows of the last extraction really stored? Yes only when the scan logged this source AFTER the extraction, with no error
 * (a timeout, a failed insert, a failed matching all write an error), and the adapter handed over at least as many rows as the extraction
 * kept. Anything else means the rows were lost and the page must be read again, whatever change tracking says.
 */
export function rowsWereStored(run: ScanRunInfo | null, lastAtIso: string, lastKept: number): boolean {
  if (!run) return false;
  const at = Date.parse(lastAtIso);
  if (!Number.isFinite(at) || run.finishedMs < at) return false;
  if (run.error !== null && run.error !== '') return false;
  return run.fetched >= lastKept;
}
