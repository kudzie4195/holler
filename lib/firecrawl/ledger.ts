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
 */
export type LedgerState = 'extracted' | 'unchanged' | 'pending' | 'failed' | 'skipped';
export const LEDGER_PREFIX = '_fc:';

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
  bySource: Record<string, SourceLedger>;
}

const STATES = new Set<string>(['extracted', 'unchanged', 'pending', 'failed', 'skipped']);

/** Pure: fold marker rows (any order) into totals. Today and month are UTC calendar boundaries of `now`. */
export function summarizeLedger(rows: Row[], now: Date): LedgerSummary {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const out: LedgerSummary = { today: 0, month: 0, bySource: {} };
  const sorted = [...rows].sort((a, b) => Date.parse(b.started_at ?? '') - Date.parse(a.started_at ?? ''));
  for (const r of sorted) {
    if (!r.source || !r.source.startsWith(LEDGER_PREFIX) || !r.started_at) continue;
    const t = Date.parse(r.started_at);
    if (!Number.isFinite(t)) continue;
    const id = r.source.slice(LEDGER_PREFIX.length);
    const credits = r.fetched ?? 0;
    if (t >= monthStart) out.month += credits;
    if (t >= dayStart) out.today += credits;
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
export async function readLedger(db: Db, now: Date): Promise<LedgerSummary> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = await readAllPages<Row>(
    (from, to) =>
      db
        .from('holler_scan_runs')
        .select('source, started_at, fetched, inserted, matched, error')
        .like('source', `${LEDGER_PREFIX}%`)
        .gte('started_at', monthStart)
        .order('started_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    5,
  );
  return summarizeLedger(rows, now);
}

/** finished_at of the source's newest scan_runs row (the scan logs one after it has stored the adapter's rows), or null. */
export async function lastScanFinish(db: Db, source: string): Promise<number | null> {
  const { data, error } = await db.from('holler_scan_runs').select('finished_at').eq('source', source).order('finished_at', { ascending: false }).limit(1);
  if (error) throw new Error(`scan_runs read failed: ${error.message}`);
  const t = Date.parse(((data ?? [])[0] as { finished_at?: string } | undefined)?.finished_at ?? '');
  return Number.isFinite(t) ? t : null;
}
