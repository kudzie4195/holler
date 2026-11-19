import { FakeDb } from '../ops/fakedb';
import type { Condition, MonitorSourceRow } from '@/lib/monitor/rules';
import type { SourceHealthRow } from '@/lib/signals/health';

export const NOW = new Date('2026-11-19T14:11:00Z');
export const MIN = 60_000;
export const H = 3_600_000;
export const D = 24 * H;
export const ago = (ms: number, now: Date = NOW) => new Date(now.getTime() - ms).toISOString();

/** FakeDb whose upsert really replaces by the conflict key (FakeDb's own upsert ignores duplicates). */
export class MonitorDb extends FakeDb {
  from(table: string) {
    const b = super.from(table) as unknown as Record<string, unknown>;
    const orig = b.upsert as (rows: Record<string, unknown>[], o?: { onConflict?: string }) => unknown;
    b.upsert = (rows: Record<string, unknown>[], o: { onConflict?: string } = {}) => {
      if (this.failOn[`${table}.upsert`]) return orig.call(b, rows, o);
      this.calls.push(`${table}.upsert`);
      const keys = String(o.onConflict ?? 'id').split(',');
      const t = this.tables[table];
      for (const r of rows) {
        const i = t.findIndex((x) => keys.every((k) => x[k] === r[k]));
        if (i >= 0) t[i] = { ...t[i], ...r };
        else t.push({ ...r });
      }
      return Promise.resolve({ data: null, error: null });
    };
    return b as never;
  }
}

export function health(source: string, over: Partial<MonitorSourceRow> = {}): MonitorSourceRow & Record<string, unknown> {
  const base: SourceHealthRow = {
    source,
    last_run_at: ago(5 * MIN),
    last_success_at: ago(5 * MIN),
    last_error: null,
    last_record_at: ago(2 * H),
    rows_seen_last_run: 4,
    rows_new_last_run: 1,
    consecutive_failures: 0,
    status: 'healthy',
    updated_at: ago(5 * MIN),
    last_new_at: ago(2 * H),
    last_rows_seen_at: ago(5 * MIN),
    tracked_since: ago(30 * D),
  };
  return { ...base, ...over };
}

/** A healthy scan: one finished run 6 minutes old, no errors. */
export function scanRuns(finishedAgoMs = 6 * MIN, error: string | null = null, sources = ['nws', 'spc', 'usgs'], now: Date = NOW) {
  return sources.map((s) => ({ source: s, finished_at: ago(finishedAgoMs, now), started_at: ago(finishedAgoMs + 20_000, now), error, fetched: 3, inserted: 1, matched: 0 }));
}

/** Everything healthy: a recent clean scan, new signals in the last day, healthy source rows. */
export function healthyDb(extra: Record<string, Record<string, unknown>[]> = {}): MonitorDb {
  return new MonitorDb({
    holler_scan_runs: scanRuns(),
    holler_signals: [{ id: 1, created_at: ago(H) }],
    holler_source_health: [health('nws'), health('spc'), health('socrata-chicago-permits', { last_record_at: ago(2 * D) })],
    holler_ops_alerts: [],
    ...extra,
  });
}

export const cond = (over: Partial<Condition> = {}): Condition => ({
  key: 'scan:error',
  code: 'scan_error',
  severity: 2,
  source: 'scan',
  headline: 'scan error',
  reason: 'The latest scan recorded an error, so new signals may not be reaching members and the cause needs a look.',
  lastSuccessAt: ago(H),
  lastError: 'matching failed',
  ...over,
});
